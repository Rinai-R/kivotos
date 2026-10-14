package expo.modules.kivotosattention

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import android.system.ErrnoException
import android.system.OsConstants
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * How the phone reaches each machine: one probe of every link at a time
 * ([probe], for the app's screens) and the route memory the doors use in
 * auto ([prefersRelay]). The vocabulary (states, reasons) is the shared
 * machine model of packages/kivotos/src/machines.ts, whose `routeOf` gives
 * each row its route by the machine's mode. Both links are probed whatever
 * the mode, so every choice can show what it gives now.
 *
 * The phone holds no standing relay connection, so a relay network is
 * `online` when its relay answered this probe, and a machine of it is online
 * when the relay lists it. A tailnet machine is probed with `/kivotos/hello`.
 */
object Links {
  private const val PREFS = "kivotos.links"
  private const val HELLO_TIMEOUT_MS = 6_000
  private const val PROBE_TIMEOUT_MS = 12_000L
  /** In auto, after a failed tailnet dial, a machine with a relay goes through the relay first this long. */
  private const val RELAY_FIRST_MS = 2 * 60_000L

  /** When each machine's tailnet listener last failed a door's dial (elapsed realtime). */
  private val tailnetFailed = ConcurrentHashMap<String, Long>()

  /**
   * Failed checks in a row a working link survives, as `FAILURE_GRACE` in
   * packages/kivotos/src/machine-book.ts: until the third, it stays online
   * and shows `unstable`. Only a link seen working within [GRACE_WINDOW_MS]
   * gets it, and only for failures that may be a passing hiccup.
   */
  private const val FAILURE_GRACE = 3
  private const val GRACE_WINDOW_MS = 5 * 60_000L
  private val TRANSIENT = setOf("timeout", "network", "relay-unreachable", "relay-connecting")

  /**
   * Failed checks in a row of each link last shown online, by
   * `<via>.<machine id>`: 0 is working, up to [FAILURE_GRACE] - 1 is
   * unstable. A link not in the map is shown as its probe found it.
   */
  private val failures = ConcurrentHashMap<String, Int>()

  /**
   * Whether a link's failed probe should still show online (unstable), given
   * when it was last seen working.
   */
  private fun held(slot: String, state: String, reason: String?, lastSeen: Long, now: Long): Boolean {
    if (state == "online") {
      failures[slot] = 0
      return false
    }
    val before = failures.remove(slot) ?: return false
    val transient = state == "unreachable" && reason in TRANSIENT
    if (!transient || lastSeen <= 0 || now - lastSeen > GRACE_WINDOW_MS) return false
    val failed = before + 1
    if (failed >= FAILURE_GRACE) return false
    failures[slot] = failed
    return true
  }

  /** Whether a door in auto should dial the relay before the tailnet listener. */
  fun prefersRelay(machine: Machine): Boolean {
    if (!machine.viaRelay) return false
    if (!machine.viaTailnet) return true
    val failed = tailnetFailed[machine.id] ?: return false
    return SystemClock.elapsedRealtime() - failed < RELAY_FIRST_MS
  }

  /** A door in auto reached, or failed to reach, a machine over one link. */
  fun dialed(machine: Machine, tailnet: Boolean, ok: Boolean) {
    if (!tailnet) return
    if (ok) tailnetFailed.remove(machine.id) else tailnetFailed[machine.id] = SystemClock.elapsedRealtime()
  }

  private class Hello(val state: String, val reason: String? = null, val node: String? = null)

  /** Ask a tailnet listener who it is. */
  private fun hello(url: String): Hello {
    val connection = try {
      URL(url.trimEnd('/') + "/kivotos/hello").openConnection() as HttpURLConnection
    } catch (_: IOException) {
      return Hello("unreachable", "network")
    }
    connection.connectTimeout = HELLO_TIMEOUT_MS
    connection.readTimeout = HELLO_TIMEOUT_MS
    connection.setRequestProperty("Accept", "application/json")
    return try {
      val status = connection.responseCode
      when {
        status == 403 || status == 421 -> Hello("unreachable", "forbidden")
        status != 200 -> Hello("unreachable", "not-kivotos")
        else -> {
          val body = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
          if (!body.has("kivotos")) Hello("unreachable", "not-kivotos")
          else Hello("online", node = body.optString("node").ifEmpty { null })
        }
      }
    } catch (_: SocketTimeoutException) {
      Hello("unreachable", "timeout")
    } catch (_: SSLException) {
      Hello("unreachable", "tls")
    } catch (_: ConnectException) {
      Hello("unreachable", if (refused(connection.url)) "no-listener" else "network")
    } catch (_: JSONException) {
      Hello("unreachable", "not-kivotos")
    } catch (_: IOException) {
      Hello("unreachable", "network")
    } finally {
      connection.disconnect()
    }
  }

  /**
   * Whether nothing listens at the URL's address. Android's HTTP stack words
   * every failed connect "Failed to connect to …" and drops the cause, so a
   * plain socket asks again; its failure carries the errno.
   */
  private fun refused(url: URL): Boolean = try {
    Socket().use { it.connect(InetSocketAddress(url.host, if (url.port > 0) url.port else url.defaultPort), HELLO_TIMEOUT_MS) }
    false
  } catch (failure: ConnectException) {
    generateSequence<Throwable>(failure) { it.cause }.any { (it as? ErrnoException)?.errno == OsConstants.ECONNREFUSED }
  } catch (_: IOException) {
    false
  }

  private class Members(val state: String, val error: String?, val peers: List<RelayPeer>)

  private fun members(network: Network): Members = try {
    Members("online", null, RelayClient.peers(network))
  } catch (refused: RelayRefused) {
    Members(if (refused.code == "denied") "denied" else "unreachable", refused.code, emptyList())
  } catch (failure: Exception) {
    Members("unreachable", failure.message, emptyList())
  }

  private fun online(context: Context): Boolean {
    val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return false
    val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
  }

  private fun authority(url: String): String = try {
    URI(url).rawAuthority ?: url
  } catch (_: Exception) {
    url
  }

  private fun <T> await(future: Future<T>, fallback: T): T = try {
    future.get(PROBE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
  } catch (_: Exception) {
    future.cancel(true)
    fallback
  }

  /**
   * Probe every machine's links now (blocking; call off the main thread).
   * @return a `PhoneProbe` as JSON.
   */
  fun probe(context: Context): String {
    val machines = AttentionState.machines(context)
    val pool = Executors.newFixedThreadPool(8)
    try {
      val networks = machines.filter { it.viaRelay }.distinctBy { it.key }.associate { machine ->
        machine.key to (machine to pool.submit<Members> { members(Network.of(machine.relay, machine.key)) })
      }
      val hellos = machines.filter { it.viaTailnet }.associate { machine ->
        machine.id to pool.submit<Hello> { hello(machine.url) }
      }
      val members = networks.mapValues { (_, pending) ->
        await(pending.second, Members("unreachable", "timeout", emptyList()))
      }
      val probed = JSONArray()
      for (machine in machines) {
        val said = hellos[machine.id]?.let { await(it, Hello("unreachable", "timeout")) }
        probed.put(machineJson(context, machine, said, members[machine.key]))
      }
      val networkArray = JSONArray()
      for ((key, pending) in networks) {
        val endpoint = pending.first.relay
        val found = members.getValue(key)
        val json = JSONObject()
          .put("endpoint", endpoint)
          .put("key", key)
          .put("id", runCatching { Network.of(endpoint, key).id }.getOrDefault(""))
          .put("state", found.state)
          .put("peers", JSONArray(found.peers.map { JSONObject().put("node", it.node).put("name", it.name) }))
        if (found.error != null) json.put("error", found.error)
        networkArray.put(json)
      }
      return JSONObject()
        .put("online", online(context))
        .put("machines", probed)
        .put("networks", networkArray)
        .toString()
    } finally {
      pool.shutdownNow()
    }
  }

  /** One link's probe result as `MachineLink` JSON, with the grace of [held] applied. */
  private fun linkJson(via: String, id: String, address: String, state: String, reason: String?, seen: Long, now: Long): JSONObject {
    val link = JSONObject().put("via", via).put("address", address)
    if (held("$via.$id", state, reason, seen, now)) {
      link.put("state", "online").put("unstable", true)
    } else {
      link.put("state", state)
      if (reason != null) link.put("reason", reason)
    }
    if (seen > 0) link.put("lastSeen", seen)
    return link
  }

  private fun machineJson(context: Context, machine: Machine, said: Hello?, network: Members?): JSONObject {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val links = JSONArray()
    if (said != null) {
      if (said.state == "online") {
        prefs.edit().putLong("seen.tailscale.${machine.id}", now).apply()
        tailnetFailed.remove(machine.id)
      }
      val seen = if (said.state == "online") now else prefs.getLong("seen.tailscale.${machine.id}", 0)
      links.put(linkJson("tailscale", machine.id, authority(machine.url), said.state, said.reason, seen, now))
    }
    if (network != null) {
      val state = when {
        network.state != "online" -> network.state
        network.peers.any { it.node == machine.node } -> "online"
        else -> "offline"
      }
      if (state == "online") prefs.edit().putLong("seen.relay.${machine.id}", now).apply()
      val seen = if (state == "online") now else prefs.getLong("seen.relay.${machine.id}", 0)
      val reason = if (state == "unreachable") "relay-unreachable" else null
      links.put(linkJson("relay", machine.id, authority(machine.relay), state, reason, seen, now))
    }
    val stream = when {
      !AttentionState.enabled(context) -> "off"
      machine.id in AttentionService.live -> "live"
      else -> "down"
    }
    val json = JSONObject().put("id", machine.id).put("links", links).put("stream", stream)
    said?.node?.let { json.put("node", it) }
    return json
  }
}
