package expo.modules.kivotosattention

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
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
 * ([probe], for the app's screens) and the route memory the doors use
 * ([prefersRelay]). The vocabulary (states, reasons, routes) is the shared
 * machine model of packages/kivotos/src/machines.ts.
 *
 * The phone holds no standing relay connection, so a relay network is
 * `online` when its relay answered this probe, and a machine of it is online
 * when the relay lists it. A tailnet machine is probed with `/kivotos/hello`.
 */
object Links {
  private const val PREFS = "kivotos.links"
  private const val HELLO_TIMEOUT_MS = 4_000
  private const val PROBE_TIMEOUT_MS = 12_000L
  /** After a failed tailnet dial, a machine with a relay goes through the relay first this long. */
  private const val RELAY_FIRST_MS = 2 * 60_000L

  /** When each machine's tailnet listener last failed a door's dial (elapsed realtime). */
  private val tailnetFailed = ConcurrentHashMap<String, Long>()

  /** Whether a door should dial the relay before the tailnet listener. */
  fun prefersRelay(machine: Machine): Boolean {
    if (!machine.viaRelay) return false
    if (!machine.viaTailnet) return true
    val failed = tailnetFailed[machine.id] ?: return false
    return SystemClock.elapsedRealtime() - failed < RELAY_FIRST_MS
  }

  /** A door reached, or failed to reach, a machine over one link. */
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
    } catch (failure: ConnectException) {
      // Android words a refused connection "ECONNREFUSED (Connection refused)".
      val refused = failure.message.orEmpty().contains("refused", ignoreCase = true)
      Hello("unreachable", if (refused) "no-listener" else "network")
    } catch (_: JSONException) {
      Hello("unreachable", "not-kivotos")
    } catch (_: IOException) {
      Hello("unreachable", "network")
    } finally {
      connection.disconnect()
    }
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

  private fun machineJson(context: Context, machine: Machine, said: Hello?, network: Members?): JSONObject {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val links = JSONArray()
    var route: String? = null
    if (said != null) {
      val link = JSONObject().put("via", "tailscale").put("state", said.state).put("address", authority(machine.url))
      if (said.reason != null) link.put("reason", said.reason)
      if (said.state == "online") {
        prefs.edit().putLong("seen.tailscale.${machine.id}", now).apply()
        tailnetFailed.remove(machine.id)
        route = "tailscale"
      }
      prefs.getLong("seen.tailscale.${machine.id}", 0).takeIf { it > 0 }?.let { link.put("lastSeen", it) }
      links.put(link)
    }
    if (network != null) {
      val state = when {
        network.state != "online" -> network.state
        network.peers.any { it.node == machine.node } -> "online"
        else -> "offline"
      }
      val link = JSONObject().put("via", "relay").put("state", state).put("address", authority(machine.relay))
      if (state == "unreachable") link.put("reason", "relay-unreachable")
      if (state == "online") {
        prefs.edit().putLong("seen.relay.${machine.id}", now).apply()
        if (route == null) route = "relay"
      }
      prefs.getLong("seen.relay.${machine.id}", 0).takeIf { it > 0 }?.let { link.put("lastSeen", it) }
      links.put(link)
    }
    val stream = when {
      !AttentionState.enabled(context) -> "off"
      machine.id in AttentionService.live -> "live"
      else -> "down"
    }
    val json = JSONObject().put("id", machine.id).put("route", route ?: JSONObject.NULL).put("links", links).put("stream", stream)
    said?.node?.let { json.put("node", it) }
    return json
  }
}
