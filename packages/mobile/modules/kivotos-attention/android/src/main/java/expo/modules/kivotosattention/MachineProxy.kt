package expo.modules.kivotosattention

import android.content.Context
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Local doors to the machines. Each machine gets a loopback HTTP address the
 * WebView loads it from; every connection to it gets its own connection to the
 * machine: TCP (TLS for an `https` listener) to its tailnet listener, or a
 * secured relay session. A machine with both links goes over the tailnet
 * first and through the relay when the listener cannot be reached ([Links]),
 * behind the same door, so the page keeps its origin whichever link carries it. Requests are read one by one so
 * the immutable ones can be answered from [HttpCache]; everything else, and
 * every byte after a protocol switch (`/api/remote.mux`), streams through
 * unbuffered.
 *
 * Any app on the phone can connect to a loopback port, so a connection is
 * served only if its first request carries this process's secret cookie,
 * which the door never passes on to the machine.
 *
 * The tailnet listener admits by Host and same-site markers (`Admission.check`
 * in packages/kivotos/src/index.ts): the door sends the listener's authority
 * as Host and, for requests the page made itself, the listener's origin as
 * Origin. A request with any other Origin (another door's page) is refused.
 */
object MachineProxy {
  private const val TAG = "KivotosCache"
  private const val COOKIE = "kivotos_proxy"
  private const val PORT_BASE = 20_000
  private const val PORT_SPAN = 20_000
  private const val HEAD_TIMEOUT_MS = 30_000
  /** A kept-alive WebView connection idle this long is closed. */
  private const val KEEPALIVE_MS = 5 * 60_000
  private const val CONNECT_TIMEOUT_MS = 10_000
  /** A listener that does not answer this soon, when a relay can take over, is given up on. */
  private const val FALLBACK_CONNECT_TIMEOUT_MS = 4_000
  /**
   * A machine connection idle this long is replaced before the next request:
   * the listener and the relay sessions are Node servers, which close idle
   * kept-alive connections after 5 s (`keepAliveTimeout`).
   */
  private const val UPSTREAM_IDLE_MS = 4_000L

  /** One secret per app process; the WebView gets it as a cookie. */
  private val token: String = Base64.encodeToString(
    ByteArray(24).also(SecureRandom()::nextBytes),
    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
  )

  /** The value of the Cookie header that opens a door. */
  val cookie: String = "$COOKIE=$token"

  private class Door(val server: ServerSocket, val machine: Machine, val network: Network?) {
    val origin = "http://127.0.0.1:${server.localPort}"
    val uri: URI? = if (machine.viaTailnet) URI(machine.url.trimEnd('/')) else null
    val tls = uri?.scheme.equals("https", ignoreCase = true)
    val host: String = uri?.host.orEmpty()
    val port: Int = uri?.port?.takeIf { it > 0 } ?: if (tls) 443 else 80
    /** What the listener expects as Host. */
    val authority: String = uri?.rawAuthority.orEmpty()
    val upstreamOrigin: String = "${uri?.scheme}://$authority"
    /** Open WebView connections; closed with the door so none keeps using a removed machine. */
    val clients: MutableSet<Socket> = ConcurrentHashMap.newKeySet()

    fun close() {
      server.close()
      for (client in clients) runCatching { client.close() }
    }
  }

  /** One connection to a machine. */
  private class Upstream(
    val input: InputStream,
    val output: OutputStream,
    private val closer: Closeable,
    /** Goes to the tailnet listener, which wants its own Host and Origin. */
    val tailnet: Boolean,
  ) : Closeable {
    var idleSince = SystemClock.elapsedRealtime()
    override fun close() {
      try {
        closer.close()
      } catch (_: IOException) {
        // Already closed.
      }
    }
  }

  private val doors = ConcurrentHashMap<String, Door>()

  /**
   * Open (once) the door to a machine.
   * @return its base URL, `http://127.0.0.1:<port>`.
   */
  @Synchronized
  fun url(context: Context, machine: Machine): String {
    HttpCache.init(context.cacheDir)
    val known = doors[machine.id]
    if (known != null && known.machine.copy(name = machine.name) == machine) return known.origin
    // A link was added or left (one machine reached two ways): the same port, new upstreams.
    known?.close()
    val door = listen(machine)
    doors[machine.id] = door
    return door.origin
  }

  /** [url], and let the WebView through the door. */
  fun open(context: Context, machine: Machine): String {
    val url = url(context, machine)
    CookieManager.getInstance().apply {
      setCookie(url, "$cookie; Path=/; HttpOnly")
      flush()
    }
    return url
  }

  /** Close the doors, and drop the cache, of machines that are no longer in the list. */
  @Synchronized
  fun retain(ids: Set<String>) {
    for ((id, door) in doors) {
      if (id in ids) continue
      doors.remove(id)
      door.close()
    }
    HttpCache.retain(ids)
  }

  private fun listen(machine: Machine): Door {
    val network = if (machine.viaRelay) Network.of(machine.relay, machine.key) else null
    val loopback = InetAddress.getByName("127.0.0.1")
    // The same port every time keeps the page's origin, and with it dsh's
    // localStorage for this computer, across app restarts. The id never changes
    // for a machine (a URL, or `relay:<node>`); a link added later keeps the port.
    val seed = machine.id.removePrefix("relay:")
    val preferred = PORT_BASE + Math.floorMod(seed.hashCode(), PORT_SPAN)
    var server: ServerSocket? = null
    for (step in 0 until 32) {
      server = try {
        ServerSocket(preferred + step, 16, loopback)
      } catch (_: IOException) {
        continue
      }
      break
    }
    val door = Door(server ?: ServerSocket(0, 16, loopback), machine, network)
    Thread({ accept(door) }, "kivotos-door").apply { isDaemon = true }.start()
    return door
  }

  private fun accept(door: Door) {
    while (true) {
      val client = try {
        door.server.accept()
      } catch (_: IOException) {
        return // The door was closed.
      }
      Thread({ serve(door, client) }, "kivotos-door-conn").apply { isDaemon = true }.start()
    }
  }

  /** Connect to the machine over its preferred link, then the other one. */
  private fun dial(door: Door): Upstream {
    val machine = door.machine
    val order = if (Links.prefersRelay(machine)) listOf(false, true) else listOf(true, false)
    var failure: Exception? = null
    for (tailnet in order) {
      if (if (tailnet) door.uri == null else door.network == null) continue
      try {
        val upstream = if (tailnet) dialTailnet(door) else dialRelay(door)
        Links.dialed(machine, tailnet, ok = true)
        return upstream
      } catch (error: Exception) {
        Links.dialed(machine, tailnet, ok = false)
        failure = error
      }
    }
    throw failure ?: IOException("no link to ${machine.name}")
  }

  private fun dialRelay(door: Door): Upstream {
    val session = RelayClient.dial(requireNotNull(door.network), door.machine.node)
    return Upstream(BufferedInputStream(session.input), BufferedOutputStream(session.output, 32 * 1024), session, tailnet = false)
  }

  private fun dialTailnet(door: Door): Upstream {
    val plain = Socket()
    try {
      val timeout = if (door.network == null) CONNECT_TIMEOUT_MS else FALLBACK_CONNECT_TIMEOUT_MS
      plain.connect(InetSocketAddress(door.host, door.port), timeout)
      plain.tcpNoDelay = true
      val socket = if (door.tls) {
        val secure = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(plain, door.host, door.port, true) as SSLSocket
        secure.startHandshake()
        if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(door.host, secure.session)) {
          throw SSLPeerUnverifiedException("certificate does not name ${door.host}")
        }
        secure
      } else {
        plain
      }
      return Upstream(BufferedInputStream(socket.getInputStream()), BufferedOutputStream(socket.getOutputStream(), 32 * 1024), socket, tailnet = true)
    } catch (failure: Exception) {
      close(plain)
      throw failure
    }
  }

  private fun serve(door: Door, client: Socket) {
    var upstream: Upstream? = null
    door.clients.add(client)
    if (door.server.isClosed) close(client)
    try {
      client.soTimeout = HEAD_TIMEOUT_MS
      client.tcpNoDelay = true
      val fromClient = BufferedInputStream(client.getInputStream())
      val toClient = BufferedOutputStream(client.getOutputStream(), 32 * 1024)
      var first = true
      while (true) {
        val head = HttpHead.read(fromClient) ?: return
        if (first && !admitted(head)) {
          refuse(toClient, "403 Forbidden")
          return
        }
        first = false
        client.soTimeout = 0
        if (!rewrite(door, head)) {
          refuse(toClient, "403 Forbidden")
          return
        }
        // A machine connection left idle may have been closed on the other side.
        upstream?.let { if (SystemClock.elapsedRealtime() - it.idleSince > UPSTREAM_IDLE_MS) { it.close(); upstream = null } }
        if (head.has("upgrade")) {
          val opened = upstream ?: try {
            dial(door)
          } catch (_: Exception) {
            refuse(toClient, "502 Bad Gateway")
            return
          }
          upstream = opened
          address(door, head, opened)
          tunnel(head, fromClient, toClient, opened, client)
          return
        }
        val exchange = Exchange(door, head, fromClient, toClient, upstream)
        val keep = exchange.run()
        upstream = exchange.upstream
        if (!keep) return
        client.soTimeout = KEEPALIVE_MS
      }
    } catch (_: Exception) {
      // Either side went away; both are closed below. An uncaught exception here would end the app.
    } finally {
      upstream?.close()
      close(client)
      door.clients.remove(client)
    }
  }

  /** One request and its response on a kept-alive connection. */
  private class Exchange(
    val door: Door,
    val head: HttpHead,
    val fromClient: InputStream,
    val toClient: OutputStream,
    var upstream: Upstream?,
  ) {
    private val machine = door.machine.id
    private val target = head.target

    /** @return whether the WebView connection stays open for another request. */
    fun run(): Boolean {
      if (!cacheableRequest(head)) return forward(owned = false)
      head["accept-encoding"] = VARIANT
      if (hit()) return !head.closes
      val other = HttpCache.claim(machine, target)
      if (other == null) {
        try {
          return forward(owned = true)
        } finally {
          HttpCache.release(machine, target)
        }
      }
      HttpCache.await(other)
      if (hit()) return !head.closes
      return forward(owned = false)
    }

    private fun hit(): Boolean {
      val (entry, body) = HttpCache.lookup(machine, target) ?: return false
      val reply = HttpHead("HTTP/1.1 ${entry.status} OK", entry.headers.toMutableList())
      reply["content-length"] = entry.size.toString()
      val opened = try {
        body.inputStream()
      } catch (_: IOException) {
        return false
      }
      opened.use { source ->
        toClient.write(reply.bytes())
        source.copyTo(toClient, 64 * 1024)
        toClient.flush()
      }
      Log.d(TAG, "hit '${door.machine.name}' ${target.substringBefore('?')} bytes=${entry.size}")
      return true
    }

    private fun forward(owned: Boolean): Boolean {
      val reused = upstream != null
      val up = upstream ?: try {
        dial(door).also { upstream = it }
      } catch (failure: Exception) {
        Log.d(TAG, "unreachable '${door.machine.name}': ${failure.message}")
        refuse(toClient, "502 Bad Gateway")
        return false
      }
      address(door, head, up)
      up.output.write(head.bytes())
      copyBody(fromClient, up.output, Framing.ofRequest(head))
      up.output.flush()
      var response: HttpHead = try {
        HttpHead.read(up.input)
      } catch (_: IOException) {
        null
      } ?: run {
        // Closed before answering. On a reused connection the WebView retries
        // a request whose connection ends without a response; otherwise say so.
        if (!reused) refuse(toClient, "502 Bad Gateway")
        return false
      }
      while (response.status in 100..199) {
        toClient.write(response.bytes())
        toClient.flush()
        response = HttpHead.read(up.input) ?: return false
      }
      markImmutable(target, response)
      val framing = Framing.ofResponse(head.method, response)
      val writer = if (owned && storable(response)) HttpCache.writer(machine, target, response) else null
      var complete = false
      try {
        toClient.write(response.bytes())
        toClient.flush()
        complete = copyBody(up.input, toClient, framing, writer?.let { it::write })
      } finally {
        if (writer != null) {
          writer.commit(complete)
          Log.d(TAG, "${if (complete) "stored" else "unstored"} '${door.machine.name}' ${target.substringBefore('?')}")
        }
      }
      if (!complete || framing == Framing.UntilClose || response.closes) {
        up.close()
        upstream = null
        return false
      }
      up.idleSince = SystemClock.elapsedRealtime()
      return !head.closes
    }
  }

  /** After a protocol switch the connection is a byte stream both ways. */
  private fun tunnel(head: HttpHead, fromClient: InputStream, toClient: OutputStream, up: Upstream, client: Socket) {
    up.output.write(head.bytes())
    up.output.flush()
    val upward = Thread({
      try {
        pump(fromClient, up.output)
      } catch (_: Exception) {
        // Either side went away. An uncaught exception here would end the app.
      } finally {
        up.close()
        close(client)
      }
    }, "kivotos-door-up").apply { isDaemon = true }
    upward.start()
    pump(up.input, toClient)
  }

  /**
   * Drop the door's cookie.
   * @return false for a request a page of another origin made.
   */
  private fun rewrite(door: Door, head: HttpHead): Boolean {
    val cookies = head["cookie"]?.split(';')?.map { it.trim() }?.filter { it.isNotEmpty() && it != cookie }
    if (cookies.isNullOrEmpty()) head.remove("cookie") else head["cookie"] = cookies.joinToString("; ")
    val origin = head["origin"]
    return origin == null || origin == door.origin
  }

  /** Over the tailnet, name the listener in Host and Origin; a relay session takes the request as it is. */
  private fun address(door: Door, head: HttpHead, up: Upstream) {
    if (!up.tailnet) return
    head["host"] = door.authority
    if (head["origin"] != null) head["origin"] = door.upstreamOrigin
  }

  private fun admitted(head: HttpHead): Boolean =
    head.fields.any { (name, value) ->
      name.equals("cookie", ignoreCase = true) && value.split(';').any { it.trim() == cookie }
    }

  private fun refuse(sink: OutputStream, status: String) {
    sink.write("HTTP/1.1 $status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
    sink.flush()
  }

  private fun close(socket: Socket) {
    try {
      socket.close()
    } catch (_: IOException) {
      // Already closed.
    }
  }
}
