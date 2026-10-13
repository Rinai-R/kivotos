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
 * its Kivotos (`/kivotos/events`), over the tailnet or through a relay as the
 * machine's mode allows. Each frame becomes a system notification unless the
 * user is looking at that session.
 */
class AttentionService : Service() {
  /** One machine's stream, as it was when the worker started. */
  private class Worker(val machine: Machine) {
    lateinit var thread: Thread
    @Volatile var connection: HttpURLConnection? = null

    /** Interrupt, and drop the connection so a blocked read ends now. */
    fun stop() {
      thread.interrupt()
      connection?.disconnect()
    }
  }

  private val workers = ConcurrentHashMap<String, Worker>()
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var stopping = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    Notifier.ensureChannels(this)
    goForeground()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Refused as a foreground service: goForeground already stopped it.
    if (!goForeground()) return START_NOT_STICKY
    reconcile()
    return START_STICKY
  }

  /**
   * Android 15+ calls this when a time-limited type (dataSync, 6 hours per day) runs
   * out. The service runs as specialUse there, which has no limit, so this is a guard:
   * stop cleanly instead of being killed for overstaying. The streams resume the next
   * time the app or the boot receiver starts the service.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopping = true
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    stopping = true
    workers.values.forEach { it.stop() }
    workers.clear()
    connected.clear()
    super.onDestroy()
  }

  /** Returns false, having stopped the service, when the system refuses the foreground start. */
  private fun goForeground(): Boolean {
    val notification = Notifier.serviceNotification(this, connected.size, AttentionState.machines(this).size)
    // Android 15 caps dataSync at 6 hours per day and forbids starting it from
    // BOOT_COMPLETED; specialUse (API 34+) has neither restriction. Below 14 there
    // is no such cap and dataSync is the honest type.
    val type = when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ->
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ->
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
      else -> 0
    }
    return try {
      ServiceCompat.startForeground(this, SERVICE_NOTIFICATION_ID, notification, type)
      true
    } catch (_: Exception) {
      // ForegroundServiceStartNotAllowedException and friends: never crash the app
      // over a notification.
      stopping = true
      stopSelf()
      false
    }
  }

  private fun refreshServiceNotification() {
    main.post { if (!stopping) goForeground() }
  }

  /**
   * Start a worker for each followed machine; stop the workers of removed
   * machines and restart those whose links or mode changed, so no stream stays
   * on a link the machine no longer uses.
   */
  private fun reconcile() {
    val machines = AttentionState.machines(this).associateBy { it.id }
    var dropped = false
    for ((id, worker) in workers) {
      val machine = machines[id]
      if (machine != null && worker.machine.copy(name = machine.name) == machine) continue
      worker.stop()
      workers.remove(id)
      dropped = connected.remove(id) || dropped
    }
    if (dropped) refreshServiceNotification()
    for (machine in machines.values) {
      if (workers[machine.id]?.thread?.isAlive == true) continue
      val worker = Worker(machine)
      worker.thread = Thread({ follow(worker) }, "kivotos-events-${machine.id}")
      workers[machine.id] = worker
      worker.thread.start()
    }
  }

  /** Keep the stream open, reconnecting with capped backoff, until the worker is stopped. */
  private fun follow(worker: Worker) {
    val machine = worker.machine
    var delayMs = 1_000L
    while (!stopping && !Thread.currentThread().isInterrupted) {
      try {
        stream(worker)
        delayMs = 1_000L
      } catch (_: InterruptedException) {
        return
      } catch (_: Exception) {
        // Unreachable machine, phone offline, listener restarting: retry below.
      }
      // Stopped: its replacement owns the machine's connected mark now.
      if (Thread.currentThread().isInterrupted) return
      if (connected.remove(machine.id)) refreshServiceNotification()
      try {
        Thread.sleep(delayMs)
      } catch (_: InterruptedException) {
        return
      }
      delayMs = (delayMs * 2).coerceAtMost(60_000L)
    }
  }

  private fun stream(worker: Worker) {
    val machine = worker.machine
    val (epoch, after) = AttentionState.cursor(this, machine.id)
    val query = "after=$after&epoch=" + java.net.URLEncoder.encode(epoch, "UTF-8")
    // A machine that may go over the relay is reached through its local door, which
    // wants the door's cookie and dials as the mode says (auto falls back from the
    // tailnet to the relay). A machine reached only over the tailnet is followed
    // directly: the stream needs nothing the door adds.
    val door = machine.usesRelay
    val base = if (door) MachineProxy.url(this, machine) else machine.url.trimEnd('/')
    val connection = URL("$base/kivotos/events?$query").openConnection() as HttpURLConnection
    worker.connection = connection
    if (door) connection.setRequestProperty("Cookie", MachineProxy.cookie)
    connection.connectTimeout = 10_000
    // The listener sends a comment every 25 s; silence beyond this means a dead link.
    connection.readTimeout = 70_000
    connection.setRequestProperty("Accept", "text/event-stream")
    try {
      if (connection.responseCode != 200) throw IllegalStateException("HTTP ${connection.responseCode}")
      if (connected.add(machine.id)) {
        refreshServiceNotification()
        // Reachable again: its dsh may have restarted with new plugin batches.
        Prefetch.request(this, machine)
      }
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
      worker.connection = null
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

    /** Machines whose event stream is connected now; the app's machine rows read it (Links). */
    private val connected: MutableSet<String> = ConcurrentHashMap.newKeySet()
    val live: Set<String> get() = connected

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, AttentionService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, AttentionService::class.java))
    }
  }
}
