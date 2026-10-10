package expo.modules.kivotosattention

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * Foreground service holding one Server-Sent Events connection per machine to
 * its Kivotos (`/kivotos/events`), over the tailnet or through a relay. Each frame becomes a
 * system notification unless the user is looking at that session.
 */
class AttentionService : Service() {
  private val workers = ConcurrentHashMap<String, Thread>()
  private val connected = ConcurrentHashMap.newKeySet<String>()
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var stopping = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    Notifier.ensureChannels(this)
    goForeground()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    goForeground()
    reconcile()
    return START_STICKY
  }

  override fun onDestroy() {
    stopping = true
    workers.values.forEach { it.interrupt() }
    workers.clear()
    super.onDestroy()
  }

  private fun goForeground() {
    val notification = Notifier.serviceNotification(this, connected.size, AttentionState.machines(this).size)
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
    ServiceCompat.startForeground(this, SERVICE_NOTIFICATION_ID, notification, type)
  }

  private fun refreshServiceNotification() {
    main.post { if (!stopping) goForeground() }
  }

  /** Start a worker for each followed machine and stop workers for removed ones. */
  private fun reconcile() {
    val machines = AttentionState.machines(this).associateBy { it.id }
    for ((id, worker) in workers) {
      if (id !in machines) {
        worker.interrupt()
        workers.remove(id)
        connected.remove(id)
      }
    }
    for (machine in machines.values) {
      if (workers[machine.id]?.isAlive == true) continue
      val worker = Thread({ follow(machine) }, "kivotos-events-${machine.id}")
      workers[machine.id] = worker
      worker.start()
    }
  }

  /** Keep the stream open, reconnecting with capped backoff. */
  private fun follow(machine: Machine) {
    var delayMs = 1_000L
    while (!stopping && !Thread.currentThread().isInterrupted) {
      try {
        stream(machine)
        delayMs = 1_000L
      } catch (_: InterruptedException) {
        return
      } catch (_: Exception) {
        // Unreachable machine, phone offline, listener restarting: retry below.
      }
      if (connected.remove(machine.id)) refreshServiceNotification()
      try {
        Thread.sleep(delayMs)
      } catch (_: InterruptedException) {
        return
      }
      delayMs = (delayMs * 2).coerceAtMost(60_000L)
    }
  }

  private fun stream(machine: Machine) {
    val (epoch, after) = AttentionState.cursor(this, machine.id)
    val query = "after=$after&epoch=" + java.net.URLEncoder.encode(epoch, "UTF-8")
    // A relay machine is reached through its local door, which wants the door's cookie.
    val base = if (machine.viaRelay) RelayProxy.open(machine) else machine.url.trimEnd('/')
    val connection = URL("$base/kivotos/events?$query").openConnection() as HttpURLConnection
    if (machine.viaRelay) connection.setRequestProperty("Cookie", RelayProxy.cookie)
    connection.connectTimeout = 10_000
    // The listener sends a comment every 25 s; silence beyond this means a dead link.
    connection.readTimeout = 70_000
    connection.setRequestProperty("Accept", "text/event-stream")
    try {
      if (connection.responseCode != 200) throw IllegalStateException("HTTP ${connection.responseCode}")
      if (connected.add(machine.id)) refreshServiceNotification()
      BufferedReader(InputStreamReader(connection.inputStream, Charsets.UTF_8)).use { reader ->
        val data = StringBuilder()
        while (!Thread.currentThread().isInterrupted) {
          val line = reader.readLine() ?: return
          when {
            line.isEmpty() -> {
              if (data.isNotEmpty()) deliver(machine, data.toString())
              data.setLength(0)
            }
            line.startsWith("data:") -> {
              if (data.isNotEmpty()) data.append('\n')
              data.append(line.removePrefix("data:").trimStart())
            }
          }
        }
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun deliver(machine: Machine, data: String) {
    val frame = AttentionFrame.parse(data) ?: return
    val (epoch, last) = AttentionState.cursor(this, machine.id)
    // Ids are comparable only within one Host process (epoch).
    if (frame.epoch == epoch && frame.id <= last) return
    AttentionState.setCursor(this, machine.id, frame.epoch, frame.id)
    if (frame.kind == "resolved") {
      Notifier.cancel(this, machine.id, frame.sessionId, frame.key)
      AttentionState.onFrame?.let { listener -> main.post { listener(machine, frame) } }
      return
    }
    if (AttentionState.isOnScreen(machine.id, frame.sessionId)) return
    Notifier.post(this, machine, frame)
    if (AttentionState.appVisible) {
      val listener = AttentionState.onFrame
      if (listener != null) main.post { listener(machine, frame) }
    }
  }

  companion object {
    private const val SERVICE_NOTIFICATION_ID = 7380

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, AttentionService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, AttentionService::class.java))
    }
  }
}
