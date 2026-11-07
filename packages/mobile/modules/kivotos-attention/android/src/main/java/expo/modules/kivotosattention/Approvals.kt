package expo.modules.kivotosattention

import android.content.Context
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * Answering a pending approval from its notification (#notification-approval).
 *
 * The decision goes through the machine's door like every other request from
 * the app: `POST <door>/kivotos/approve` with the door's cookie, so the Host
 * sees it through the same admission (the tailnet listener or a relay session)
 * and the plugin answers only the exact ask the notification named. A refused
 * or unreachable link only leaves the notification in place; the decision can
 * always be made in the session's own page.
 */
object Approvals {
  private const val TAG = "KivotosApprovals"
  private const val TIMEOUT_MS = 10_000

  /**
   * Send one decision.
   * @param machineId - machine the notification came from.
   * @param token - the ask token the frame carried.
   * @param decision - `allow` or `deny`.
   */
  fun post(context: Context, machineId: String, token: String, decision: String): Boolean {
    val machine = AttentionState.machines(context).firstOrNull { it.id == machineId }
    if (machine == null) {
      Log.w(TAG, "no machine $machineId for an approval")
      return false
    }
    val endpoint = "${MachineProxy.url(context, machine)}/kivotos/approve"
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = TIMEOUT_MS
        readTimeout = TIMEOUT_MS
        doOutput = true
        setRequestProperty("content-type", "application/json")
        setRequestProperty("cookie", MachineProxy.cookie)
      }
      val body = JSONObject().put("token", token).put("decision", decision).toString()
      connection.outputStream.use { it.write(body.toByteArray()) }
      val status = connection.responseCode
      if (status == 200) return true
      Log.w(TAG, "approval answered $status")
      false
    } catch (failure: Exception) {
      // A door with no reachable link, or a Host already past the ask.
      Log.w(TAG, "approval not delivered", failure)
      false
    } finally {
      connection?.disconnect()
    }
  }
}
