package expo.modules.kivotosattention

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** Registers the activity hooks; Expo autolinking discovers `*Package.kt`. */
class KivotosAttentionPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(AttentionActivityListener())
}

/**
 * Tracks whether the app is on screen (notifications are suppressed only for
 * the session actually shown) and captures notification taps.
 */
class AttentionActivityListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    capture(activity.intent)
  }

  override fun onResume(activity: Activity) {
    AttentionState.appVisible = true
  }

  override fun onPause(activity: Activity) {
    AttentionState.appVisible = false
  }

  override fun onNewIntent(intent: Intent): Boolean {
    capture(intent)
    return false
  }

  private fun capture(intent: Intent?) {
    val machine = intent?.getStringExtra(Notifier.EXTRA_MACHINE) ?: return
    val session = intent.getStringExtra(Notifier.EXTRA_SESSION) ?: return
    // Consume the extras so a recreated activity does not reopen the same tap.
    intent.removeExtra(Notifier.EXTRA_MACHINE)
    intent.removeExtra(Notifier.EXTRA_SESSION)
    val listener = AttentionState.onOpen
    if (listener != null) listener(machine, session) else AttentionState.pendingOpen = machine to session
  }
}
