package expo.modules.kivotosattention

import android.content.Context
import org.json.JSONArray

/**
 * State shared by the JS module, the service, and the boot receiver.
 *
 * Persisted values (SharedPreferences): the machines to follow, whether
 * notifications are enabled, and the last frame id seen per machine.
 * In-memory values: what the app is showing right now and a notification
 * tap the JS side has not consumed yet.
 */
object AttentionState {
  private const val PREFS = "kivotos.attention"
  private const val MACHINES = "machines"
  private const val ENABLED = "enabled"

  /** True while the app's activity is resumed. */
  @Volatile var appVisible = false

  /** Machine id and session id currently on screen, or null. */
  @Volatile var onScreen: Pair<String, String>? = null

  /** A notification tap waiting for the JS side: machine id and session id. */
  @Volatile var pendingOpen: Pair<String, String>? = null

  /** Called on the main thread when a tap arrives while the app is running. */
  @Volatile var onOpen: ((machineId: String, sessionId: String) -> Unit)? = null

  /** Called for a frame while the app is visible, so it can show its in-app banner. */
  @Volatile var onFrame: ((machine: Machine, frame: AttentionFrame) -> Unit)? = null

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun machines(context: Context): List<Machine> {
    val raw = prefs(context).getString(MACHINES, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      List(array.length()) { Machine.fromJson(array.getJSONObject(it)) }
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun setMachines(context: Context, machines: List<Machine>) {
    val array = JSONArray()
    machines.forEach { array.put(it.toJson()) }
    prefs(context).edit().putString(MACHINES, array.toString()).apply()
  }

  fun enabled(context: Context): Boolean = prefs(context).getBoolean(ENABLED, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(ENABLED, enabled).apply()
  }

  /** Stream cursor of a machine: the Host process epoch and the last frame id seen in it. */
  fun cursor(context: Context, machineId: String): Pair<String, Long> {
    val prefs = prefs(context)
    return (prefs.getString("epoch.$machineId", "") ?: "") to prefs.getLong("last.$machineId", 0)
  }

  fun setCursor(context: Context, machineId: String, epoch: String, id: Long) {
    prefs(context).edit().putString("epoch.$machineId", epoch).putLong("last.$machineId", id).apply()
  }

  /** Whether the user is looking at this session right now, so no notification is needed. */
  fun isOnScreen(machineId: String, sessionId: String): Boolean =
    appVisible && onScreen == (machineId to sessionId)
}
