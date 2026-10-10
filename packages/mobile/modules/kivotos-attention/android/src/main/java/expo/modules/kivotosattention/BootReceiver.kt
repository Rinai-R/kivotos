package expo.modules.kivotosattention

import android.content.BroadcastReceiver
import android.os.Build
import android.content.Context
import android.content.Intent

/**
 * Resumes the event stream after a reboot when the user had it enabled.
 * Android 15 (API 35) forbids starting a dataSync foreground service from
 * BOOT_COMPLETED: the service would crash in startForeground. There the stream
 * resumes the next time the app is opened (KivotosAttentionModule restarts it).
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) return
    if (AttentionState.enabled(context) && AttentionState.machines(context).isNotEmpty()) {
      AttentionService.start(context)
    }
  }
}
