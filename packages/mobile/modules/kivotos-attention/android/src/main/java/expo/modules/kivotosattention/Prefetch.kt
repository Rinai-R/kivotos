package expo.modules.kivotosattention

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network as AndroidNetwork
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** What a dsh index boots from: its boot graph revision and the root-relative targets to load. */
data class BootResources(val rev: String, val targets: List<String>)

/** The boot graph global as dsh 0.2.0-rc.2 renders it (`webserver/injections.ts`): JSON with `<` escaped. */
private val BOOT_GRAPH = Regex("""<script>globalThis\["__DSH_BOOT__"\] = (.*?)</script>""", RegexOption.DOT_MATCHES_ALL)

/** `src` and `href` attributes naming a build asset, document-relative or root-relative. */
private val ASSET_REF = Regex("""\s(?:src|href)="(?:\./|/)?(assets/[^"?#]+)"""")

/**
 * The resources a dsh index boots from: the boot graph's batch scripts and
 * the content-hashed build assets the page links. The same reading as
 * `bootResources` in packages/kivotos/src/cache.ts.
 * @return null without a boot graph.
 */
fun bootResources(html: String): BootResources? {
  val json = BOOT_GRAPH.find(html)?.groupValues?.get(1) ?: return null
  val graph = try {
    JSONObject(json)
  } catch (_: Exception) {
    return null
  }
  val rev = graph.opt("rev") as? String ?: return null
  val batches = graph.optJSONArray("batches") ?: return null
  val targets = LinkedHashSet<String>()
  for (index in 0 until batches.length()) {
    val url = batches.optJSONObject(index)?.opt("url") as? String ?: continue
    rootTarget(url)?.let(targets::add)
  }
  for (match in ASSET_REF.findAll(html)) {
    val target = "/${match.groupValues[1]}"
    if (HASHED_ASSET.matches(target)) targets.add(target)
  }
  return BootResources(rev, targets.toList())
}

/** A document-relative reference against the index at `/`, as the request target the WebView sends. */
fun rootTarget(reference: String): String? = try {
  val url = URI("http://peer/").resolve(reference)
  if (url.scheme != "http" || url.rawAuthority != "peer") null else url.rawPath + (url.rawQuery?.let { "?$it" } ?: "")
} catch (_: Exception) {
  null
}

/**
 * Fills [HttpCache] with each machine's boot resources before the WebView asks
 * for them: when the app starts, when a machine is added, and when a machine
 * becomes reachable again (its event stream reconnects, or the phone's network
 * comes back after a failed attempt). It reads the index through the machine's
 * door and fetches the missing resources through the door too, two at a time
 * over all machines, so they are stored by the same rules as the WebView's own
 * requests. An unchanged boot graph `rev` skips the fetch. On a metered network
 * it runs only while the app is in the foreground; otherwise it waits for the
 * app to come forward. Failures only reach logcat.
 */
object Prefetch {
  private const val TAG = "KivotosCache"
  private const val CONCURRENCY = 2
  /** A machine's index is read again at most this often. */
  private const val RECHECK_MS = 60_000L
  private const val INDEX_MAX_BYTES = 4 * 1024 * 1024
  private const val TIMEOUT_MS = 60_000

  private val downloads = Executors.newFixedThreadPool(CONCURRENCY) { task ->
    Thread(task, "kivotos-prefetch").apply { isDaemon = true }
  }
  /** Machines with a prefetch running. */
  private val running = ConcurrentHashMap.newKeySet<String>()
  /** Machines asked for since the process started. */
  private val seen = ConcurrentHashMap.newKeySet<String>()
  /** `elapsedRealtime` of each machine's last index read. */
  private val checkedAt = ConcurrentHashMap<String, Long>()
  /** Machines to try again: on the next foreground for a metered network, or when a network comes up. */
  private val waiting = ConcurrentHashMap<String, Machine>()
  @Volatile private var watching = false

  /** The machine list changed: prefetch the machines not seen yet in this process. */
  fun machines(context: Context, machines: List<Machine>) {
    watch(context.applicationContext)
    val ids = machines.map { it.id }.toSet()
    seen.retainAll(ids)
    waiting.keys.retainAll(ids)
    for (machine in machines) if (seen.add(machine.id)) request(context, machine)
  }

  /** Check a machine now, unless it is being checked or was checked within [RECHECK_MS]. */
  fun request(context: Context, machine: Machine) {
    if (!running.add(machine.id)) return
    val app = context.applicationContext
    Thread({
      try {
        run(app, machine)
      } catch (failure: Exception) {
        Log.w(TAG, "prefetch ${short(machine)} failed: $failure")
      } finally {
        running.remove(machine.id)
      }
    }, "kivotos-prefetch-${machine.id.takeLast(8)}").apply { isDaemon = true }.start()
  }

  /** The app came to the foreground: run what a metered network held back. */
  fun resumed(context: Context) {
    retry(context.applicationContext)
  }

  private fun retry(context: Context) {
    for (machine in waiting.values.toList()) {
      waiting.remove(machine.id)
      request(context, machine)
    }
  }

  @Synchronized
  private fun watch(context: Context) {
    if (watching) return
    watching = true
    val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return
    connectivity.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: AndroidNetwork) = retry(context)
    })
  }

  private fun run(context: Context, machine: Machine) {
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    if (connectivity?.isActiveNetworkMetered == true && !AttentionState.appVisible) {
      waiting[machine.id] = machine
      Log.i(TAG, "prefetch ${short(machine)} deferred: metered network in the background")
      return
    }
    val last = checkedAt[machine.id]
    if (last != null && SystemClock.elapsedRealtime() - last < RECHECK_MS) return
    val started = SystemClock.elapsedRealtime()
    val base = MachineProxy.url(context, machine)
    val html = try {
      index(base)
    } catch (failure: Exception) {
      // Unreachable now: try again when a network comes up or the event stream reconnects.
      waiting[machine.id] = machine
      Log.i(TAG, "prefetch ${short(machine)} index failed: $failure")
      return
    }
    checkedAt[machine.id] = SystemClock.elapsedRealtime()
    val boot = bootResources(html)
    if (boot == null) {
      Log.i(TAG, "prefetch ${short(machine)}: no boot graph")
      return
    }
    if (HttpCache.rev(machine.id) == boot.rev) {
      Log.i(TAG, "prefetch ${short(machine)} rev=${boot.rev}: unchanged")
      return
    }
    val missing = boot.targets.filter { !HttpCache.has(machine.id, it) }
    val fetches: List<Future<Long>> = missing.map { target -> downloads.submit<Long> { fetch(base, target) } }
    var failed = 0
    var bytes = 0L
    for (fetch in fetches) {
      val got = try {
        fetch.get()
      } catch (_: Exception) {
        -1L
      }
      if (got < 0) failed++ else bytes += got
    }
    if (failed == 0) HttpCache.setRev(machine.id, boot.rev)
    Log.i(
      TAG,
      "prefetch ${short(machine)} rev=${boot.rev} targets=${boot.targets.size} fetched=${missing.size - failed} " +
        "failed=$failed bytes=$bytes ms=${SystemClock.elapsedRealtime() - started}",
    )
  }

  private fun connect(base: String, target: String): HttpURLConnection =
    (URL(base + target).openConnection() as HttpURLConnection).apply {
      connectTimeout = TIMEOUT_MS
      readTimeout = TIMEOUT_MS
      setRequestProperty("Cookie", MachineProxy.cookie)
    }

  private fun index(base: String): String {
    val connection = connect(base, "/")
    connection.setRequestProperty("Accept", "text/html")
    try {
      if (connection.responseCode != 200) throw IllegalStateException("HTTP ${connection.responseCode}")
      val html = java.io.ByteArrayOutputStream()
      connection.inputStream.use { body ->
        val buffer = ByteArray(64 * 1024)
        while (html.size() < INDEX_MAX_BYTES) {
          val count = body.read(buffer)
          if (count < 0) break
          html.write(buffer, 0, count)
        }
      }
      return html.toString("UTF-8")
    } finally {
      connection.disconnect()
    }
  }

  /** @return body bytes received, or -1 when the machine did not answer 200. */
  private fun fetch(base: String, target: String): Long {
    val connection = connect(base, target)
    // As the WebView asks for a script: the door stores the gzip variant.
    connection.setRequestProperty("Accept", "*/*")
    connection.setRequestProperty("Accept-Encoding", VARIANT)
    try {
      if (connection.responseCode != 200) return -1
      var total = 0L
      val buffer = ByteArray(64 * 1024)
      connection.inputStream.use { body ->
        while (true) {
          val count = body.read(buffer)
          if (count < 0) break
          total += count
        }
      }
      return total
    } finally {
      connection.disconnect()
    }
  }

  private fun short(machine: Machine): String = "'${machine.name}'"
}
