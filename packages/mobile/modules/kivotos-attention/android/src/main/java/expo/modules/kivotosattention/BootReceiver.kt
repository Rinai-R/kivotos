package expo.modules.kivotosattention

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Resumes the event stream after a reboot when the user had it enabled. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    if (AttentionState.enabled(context) && AttentionState.machines(context).isNotEmpty()) {
      AttentionService.start(context)
    }
  }
}
