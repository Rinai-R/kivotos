package expo.modules.kivotosattention

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray

/** JS face of the attention service: machines, on-screen session, notification taps. */
class KivotosAttentionModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("KivotosAttention")

    Events("onOpenSession", "onAttention")

    OnCreate {
      Notifier.ensureChannels(context)
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
      AttentionState.onFrame = null
    }

    /** Machines to follow, as a JSON array of {id, name, url}; restarts the streams. */
    Function("setMachines") { json: String ->
      val array = JSONArray(json)
      val machines = List(array.length()) { Machine.fromJson(array.getJSONObject(it)) }
      AttentionState.setMachines(context, machines)
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
  }
}
