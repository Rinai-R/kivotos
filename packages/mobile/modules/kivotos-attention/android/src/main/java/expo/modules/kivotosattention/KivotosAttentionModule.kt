package expo.modules.kivotosattention

import android.content.ActivityNotFoundException
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.core.os.bundleOf
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.exception.CodedException
import org.json.JSONArray
import org.json.JSONObject

/** JS face of the attention service: machines, on-screen session, notification taps. */
class KivotosAttentionModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  /**
   * Tells JS when the system asks for memory back, so it drops the pages it
   * keeps loaded but hidden. Not on UI_HIDDEN (each trip to the background):
   * only the levels where the process is short or about to be killed.
   */
  private val memory = object : ComponentCallbacks2 {
    override fun onTrimMemory(level: Int) {
      @Suppress("DEPRECATION")
      val short = level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ||
        level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ||
        level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND
      if (short) sendEvent("onMemoryPressure", bundleOf("level" to level))
    }

    override fun onConfigurationChanged(newConfig: Configuration) = Unit

    @Deprecated("Deprecated in Java")
    override fun onLowMemory() {
      sendEvent("onMemoryPressure", bundleOf("level" to ComponentCallbacks2.TRIM_MEMORY_COMPLETE))
    }
  }

  private fun relayPeers(network: Network): List<Map<String, String>> = try {
    RelayClient.peers(network).map { mapOf("node" to it.node, "name" to it.name) }
  } catch (refused: RelayRefused) {
    throw CodedException(if (refused.code == "denied") "denied" else "unreachable", refused.message, refused)
  } catch (failure: Exception) {
    throw CodedException("unreachable", failure.message, failure)
  }

  override fun definition() = ModuleDefinition {
    Name("KivotosAttention")

    Events("onOpenSession", "onAttention", "onMemoryPressure")

    OnCreate {
      Notifier.ensureChannels(context)
      context.applicationContext.registerComponentCallbacks(memory)
      AttentionState.onOpen = { machine, session ->
        sendEvent("onOpenSession", bundleOf("machineId" to machine, "sessionId" to session))
      }
      AttentionState.onFrame = { machine, frame ->
        sendEvent(
          "onAttention",
          bundleOf(
            "machineId" to machine.id,
            "machineName" to machine.name,
            "kind" to frame.kind,
            "sessionId" to frame.sessionId,
            "title" to frame.title,
            "key" to frame.key,
            "detail" to frame.detail,
          ),
        )
      }
    }

    OnDestroy {
      AttentionState.onOpen = null
      appContext.reactContext?.applicationContext?.unregisterComponentCallbacks(memory)
      AttentionState.onFrame = null
    }

    /** Machines to follow, as a JSON array of {id, name, url, relay?, mode?}; restarts the streams. */
    Function("setMachines") { json: String ->
      val array = JSONArray(json)
      val machines = List(array.length()) { Machine.fromJson(array.getJSONObject(it)) }
      AttentionState.setMachines(context, machines)
      MachineProxy.update(machines)
      Prefetch.machines(context, machines)
      if (AttentionState.enabled(context)) {
        if (machines.isEmpty()) AttentionService.stop(context) else AttentionService.start(context)
      }
    }

    Function("setEnabled") { enabled: Boolean ->
      AttentionState.setEnabled(context, enabled)
      if (enabled && AttentionState.machines(context).isNotEmpty()) AttentionService.start(context)
      if (!enabled) AttentionService.stop(context)
    }

    Function("isEnabled") { AttentionState.enabled(context) }

    /** The session now on screen ("" for none); clears its notifications. */
    Function("setOnScreen") { machineId: String, sessionId: String ->
      if (machineId.isEmpty() || sessionId.isEmpty()) {
        AttentionState.onScreen = null
      } else {
        AttentionState.onScreen = machineId to sessionId
        Notifier.cancelSession(context, machineId, sessionId)
      }
    }

    /**
     * Read an invite link and ask its relay which computers are online.
     * Rejects with "invite" for a malformed link, "denied" when the relay does
     * not know the network, and "unreachable" otherwise.
     */
    AsyncFunction("relayJoin") { invite: String ->
      val network = try {
        Network.parseInvite(invite)
      } catch (_: IllegalArgumentException) {
        throw CodedException("invite", "not an invite link", null)
      }
      mapOf("endpoint" to network.endpoint, "key" to network.key, "peers" to relayPeers(network))
    }

    /** Probe every machine's links now: a `PhoneProbe` (packages/kivotos/src/machines.ts) as JSON. */
    AsyncFunction("probeLinks") {
      Links.probe(context)
    }

    /** Open the local door to a machine. @return the base URL to load. */
    Function("machineOpen") { json: String ->
      MachineProxy.open(context, Machine.fromJson(JSONObject(json)))
    }

    /**
     * Show or hide the page of the WebView under a React view. A WebView in
     * a hidden parent still counts as visible to Chromium (it only reads its
     * own visibility), so a page kept loaded off screen would keep rendering
     * and tell its document it is visible. `WebView.onPause` hides it
     * (`visibilityState` "hidden", timers throttled); its JS and connections
     * keep running.
     */
    AsyncFunction("setPageVisible") { viewTag: Int, visible: Boolean ->
      val web = appContext.findView<View>(viewTag)?.let(::webViewIn) ?: return@AsyncFunction
      if (visible) web.onResume() else web.onPause()
    }.runOnQueue(Queues.MAIN)

    /** A notification tap that launched the app before JS was listening, consumed once. */
    Function("takePendingOpen") {
      val pending = AttentionState.pendingOpen ?: return@Function null
      AttentionState.pendingOpen = null
      mapOf("machineId" to pending.first, "sessionId" to pending.second)
    }

    /** Whether Android may stop the service to save battery. */
    Function("isBatteryRestricted") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      return@Function !power.isIgnoringBatteryOptimizations(context.packageName)
    }

    /** Ask the user to exempt the app from battery optimization (keeps the stream alive). */
    Function("requestBatteryExemption") {
      @Suppress("BatteryLife")
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /** Open the system notification settings for this app. */
    Function("openNotificationSettings") {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
      }
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /**
     * Open the Tailscale app; when it is not installed, its store page (the
     * Play Store, else the web). Needs the `<queries>` entry for its package.
     */
    Function("openTailscale") {
      val launch = context.packageManager.getLaunchIntentForPackage(TAILSCALE)
      val store = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$TAILSCALE"))
      val web = Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$TAILSCALE"))
      // The first that some app handles; the store fallbacks only when Tailscale is not installed.
      listOfNotNull(launch, store, web).any { intent ->
        try {
          context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          true
        } catch (_: ActivityNotFoundException) {
          false
        }
      }
    }
  }

  private fun webViewIn(view: View): WebView? {
    if (view is WebView) return view
    if (view !is ViewGroup) return null
    for (index in 0 until view.childCount) webViewIn(view.getChildAt(index))?.let { return it }
    return null
  }

  private companion object {
    /** The Tailscale Android app's package. */
    const val TAILSCALE = "com.tailscale.ipn"
  }
}
