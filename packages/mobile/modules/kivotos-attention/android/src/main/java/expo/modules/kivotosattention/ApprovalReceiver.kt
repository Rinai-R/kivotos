package expo.modules.kivotosattention

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.concurrent.Executors

/**
 * A notification's 允许本次 / 拒绝 button
 * (#notification-approval).
 *
 * The decision is sent off the main thread through the machine's door; the
 * notification is withdrawn once the Host took it. Otherwise it stays, so the
 * user can still answer in the session's own page.
 */
class ApprovalReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val machineId = intent.getStringExtra(Notifier.EXTRA_MACHINE) ?: return
    val token = intent.getStringExtra(Notifier.EXTRA_APPROVAL) ?: return
    val decision = intent.getStringExtra(Notifier.EXTRA_DECISION) ?: return
    val sessionId = intent.getStringExtra(Notifier.EXTRA_SESSION).orEmpty()
    val key = intent.getStringExtra(Notifier.EXTRA_KEY).orEmpty()
    val pending = goAsync()
    executor.execute {
      try {
        if (Approvals.post(context, machineId, token, decision)) {
          Notifier.cancel(context, machineId, sessionId, key)
        }
      } finally {
        pending.finish()
      }
    }
  }

  private companion object {
    /** One decision at a time; an answer is a single small request. */
    val executor = Executors.newSingleThreadExecutor()
  }
}
