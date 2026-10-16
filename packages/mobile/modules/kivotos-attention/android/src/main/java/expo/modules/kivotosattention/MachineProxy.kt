package expo.modules.kivotosattention

import android.content.Context
import android.os.SystemClock
import android.system.ErrnoException
import android.system.OsConstants
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ConnectException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI
import java.net.UnknownHostException
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import org.json.JSONArray
import org.json.JSONObject

/**
 * Local doors to the machines. Each machine gets a loopback HTTP address the
 * WebView loads it from; every connection to it gets its own connection to the
 * machine: TCP (TLS for an `https` listener) to its tailnet listener, or a
 * secured relay session. A machine with both links goes the way its mode
 * says: in auto over the tailnet first and through the relay when the
 * listener cannot be reached ([Links]); held to one link, only over that one.
 * Either way it is behind the same door, so the page keeps its origin
 * whichever link carries it. Requests are read one by one so
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
    /** Its connections to the machine; closed with the door so none stays on a link it no longer uses. */
    val upstreams: MutableSet<Closeable> = ConcurrentHashMap.newKeySet()

    fun close() {
      server.close()
      for (client in clients) runCatching { client.close() }
      for (upstream in upstreams) runCatching { upstream.close() }
    }
  }

  /** One connection to a machine; it leaves its door's set when closed. */
  private class Upstream(
    val input: InputStream,
    val output: OutputStream,
    private val closer: Closeable,
    /** Goes to the tailnet listener, which wants its own Host and Origin. */
    val tailnet: Boolean,
  ) : Closeable {
    var idleSince = SystemClock.elapsedRealtime()
    /** The set it is kept in while open (its door's). */
    var owner: MutableSet<Closeable>? = null
    override fun close() {
      owner?.remove(this)
      try {
        closer.close()
      } catch (_: IOException) {
        // Already closed.
      }
    }
  }

  private val doors = ConcurrentHashMap<String, Door>()

  /** A link that did not reach a machine: `tailscale` or `relay`, a `LinkDown` word, and the error. */
  private class LinkFailure(val via: String, val down: String, val message: String)

  /** No link reached the machine. */
  private class Unreachable(val failures: List<LinkFailure>) : IOException(failures.joinToString("; ") { "${it.via}: ${it.message}" })

  /** The links that failed at each machine's last dial that reached none, by machine id. */
  private val unreached = ConcurrentHashMap<String, List<LinkFailure>>()

  /** Relay refusals (`wire.ErrCode*`) that are `LinkDown` words as they are. */
  private val RELAY_DOWN = setOf("denied", "offline", "timeout")
  private val CRLF = "\r\n".toByteArray(Charsets.US_ASCII)
  private val LAST_CHUNK = "0\r\n\r\n".toByteArray(Charsets.US_ASCII)
  /** A body being stored with no client left is given up after this long without a byte. */
  private const val STALL_MS = 60_000L
  private const val STALL_CHECK_MS = 5_000L
  /** Checks the bodies being stored for [STALL_MS]. */
  private val watchdog = Executors.newSingleThreadScheduledExecutor { task ->
    Thread(task, "kivotos-door-watch").apply { isDaemon = true }
  }
  /** A URL in an error message: scheme, userinfo, authority, path, query, fragment. */
  private val URL_IN_TEXT = Regex("""([A-Za-z][A-Za-z\d+.-]*://)([^/@\s?#]*@)?([^/\s?#]*)([^\s?#]*)(\?[^\s#]*)?(#\S*)?""")

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

  /**
   * Follow the machine list: close the doors, and drop the cache, of machines
   * that left it; reopen on the same port the doors of machines whose links or
   * mode changed, so no open connection keeps going the old way.
   */
  @Synchronized
  fun update(machines: List<Machine>) {
    val byId = machines.associateBy { it.id }
    for ((id, door) in doors) {
      val machine = byId[id]
      if (machine != null && door.machine.copy(name = machine.name) == machine) continue
      doors.remove(id)
      door.close()
      if (machine != null) doors[id] = listen(machine)
    }
    unreached.keys.retainAll(byId.keys)
    HttpCache.retain(byId.keys)
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

  /** Connect to the machine over the link its mode allows; in auto the preferred one, then the other. */
  private fun dial(door: Door): Upstream {
    val machine = door.machine
    val auto = machine.pinned == null
    val order = when (machine.pinned) {
      Machine.TAILSCALE -> listOf(true)
      Machine.RELAY -> listOf(false)
      else -> if (Links.prefersRelay(machine)) listOf(false, true) else listOf(true, false)
    }
    val failures = mutableListOf<LinkFailure>()
    for (tailnet in order) {
      if (if (tailnet) door.uri == null else door.network == null) continue
      try {
        val upstream = if (tailnet) dialTailnet(door) else dialRelay(door)
        if (auto) Links.dialed(machine, tailnet, ok = true)
        unreached.remove(machine.id)
        upstream.owner = door.upstreams
        door.upstreams.add(upstream)
        // Closed while dialing: the door's close did not see it.
        if (door.server.isClosed) upstream.close()
        return upstream
      } catch (error: Exception) {
        if (auto) Links.dialed(machine, tailnet, ok = false)
        failures.add(linkFailure(tailnet, error))
      }
    }
    if (failures.isEmpty()) failures.add(LinkFailure(if (door.uri != null) "relay" else "tailscale", "network", "the machine has no such link"))
    unreached[machine.id] = failures
    throw Unreachable(failures)
  }

  /**
   * Why a link did not reach a machine, in the words of the machine model
   * (`LinkDown` in packages/kivotos/src/machines.ts), as [Links] words its probes.
   */
  private fun linkFailure(tailnet: Boolean, failure: Exception): LinkFailure {
    val errno = generateSequence<Throwable>(failure) { it.cause }.firstNotNullOfOrNull { (it as? ErrnoException)?.errno }
    val down = when {
      failure is RelayRefused -> if (failure.code in RELAY_DOWN) failure.code else "network"
      failure is TlsReset -> "tls-reset"
      !tailnet && (failure is ConnectException || failure is SocketTimeoutException || failure is UnknownHostException) -> "relay-unreachable"
      errno == OsConstants.ECONNREFUSED -> "no-listener"
      errno == OsConstants.ENETUNREACH -> "not-on-tailnet"
      failure is SocketTimeoutException -> "timeout"
      failure is SSLException -> "tls"
      else -> "network"
    }
    return LinkFailure(if (tailnet) "tailscale" else "relay", down, failure.message ?: failure.javaClass.simpleName)
  }

  /**
   * Why the door could not reach a machine the last time it tried, as JSON
   * `[{via, reason}]`; `[]` when its last dial succeeded or none failed yet.
   */
  fun failure(machineId: String): String {
    val list = JSONArray()
    for (failure in unreached[machineId].orEmpty()) list.put(JSONObject().put("via", failure.via).put("reason", failure.down))
    return list.toString()
  }

  private fun dialRelay(door: Door): Upstream {
    val session = RelayClient.dial(requireNotNull(door.network), door.machine.node)
    return Upstream(BufferedInputStream(session.input), BufferedOutputStream(session.output, 32 * 1024), session, tailnet = false)
  }

  private fun dialTailnet(door: Door): Upstream {
    val plain = Socket()
    try {
      // Give up early only when the relay can take over.
      val timeout = if (door.machine.pinned == null && door.network != null) FALLBACK_CONNECT_TIMEOUT_MS else CONNECT_TIMEOUT_MS
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
          } catch (failure: Exception) {
            unreachable(toClient, door, failure)
            return
          }
          upstream = opened
          address(door, head, opened)
          tunnel(head, fromClient, toClient, opened, client)
          return
        }
        val exchange = Exchange(door, head, fromClient, toClient, upstream)
        val keep = try {
          exchange.run()
        } finally {
          // Also after a failure, so a connection it dialed is closed below.
          upstream = exchange.upstream
        }
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
      if (!cacheableRequest(head)) return forward(null)
      head["accept-encoding"] = VARIANT
      // Each pass ends served, or finds the flight it followed ended without a
      // body to read; the next miss then leads a fetch itself.
      while (true) {
        if (hit()) return !head.closes
        val claim = HttpCache.claim(machine, target) ?: continue
        if (claim.leads) {
          try {
            return forward(claim.flight)
          } finally {
            HttpCache.land(claim.flight)
          }
        }
        val tail = claim.flight.follow() ?: continue
        return tail.use(::follow)
      }
    }

    private fun hit(): Boolean {
      val (entry, body) = HttpCache.lookup(machine, target) ?: return false
      val reply = HttpHead("HTTP/1.1 ${entry.status} OK", entry.headers.toMutableList())
      reply["content-length"] = entry.size.toString()
      body.use { source ->
        toClient.write(reply.bytes())
        source.copyTo(toClient, 64 * 1024)
        toClient.flush()
      }
      Log.d(TAG, "hit '${door.machine.name}' ${target.substringBefore('?')} bytes=${entry.size}")
      return true
    }

    /** Serve the body another request is fetching, as it arrives in the entry's temp file. */
    private fun follow(tail: HttpCache.Flight.Tail): Boolean {
      val reply = HttpHead("HTTP/1.1 ${tail.status} OK", tail.headers.toMutableList())
      val length = tail.expected
      if (length != null) reply["content-length"] = length.toString() else reply["transfer-encoding"] = "chunked"
      toClient.write(reply.bytes())
      toClient.flush()
      val buffer = ByteArray(64 * 1024)
      var sent = 0L
      while (true) {
        val count = try {
          tail.read(buffer)
        } catch (failure: IOException) {
          // Cut short, as the leader's own response was.
          Log.d(TAG, "joined '${door.machine.name}' ${target.substringBefore('?')} failed after $sent bytes: ${failure.message}")
          return false
        }
        if (count < 0) break
        if (length == null) toClient.write("${Integer.toHexString(count)}\r\n".toByteArray(Charsets.US_ASCII))
        toClient.write(buffer, 0, count)
        if (length == null) toClient.write(CRLF)
        toClient.flush()
        sent += count
      }
      if (length == null) toClient.write(LAST_CHUNK)
      toClient.flush()
      Log.d(TAG, "joined '${door.machine.name}' ${target.substringBefore('?')} bytes=$sent")
      return !head.closes
    }

    /**
     * Send the request to the machine and its response back.
     * @param flight - the miss this request leads the fetch of; a storable
     * response is stored, and read by the flight's followers as it arrives.
     */
    private fun forward(flight: HttpCache.Flight?): Boolean {
      val reused = upstream != null
      val up = upstream ?: try {
        dial(door).also { upstream = it }
      } catch (failure: Exception) {
        Log.d(TAG, "unreachable '${door.machine.name}' for ${head.method} ${target.substringBefore('?')}")
        unreachable(toClient, door, failure)
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
        if (!reused) refuse(toClient, "502 Bad Gateway", "${linkName(up.tailnet)}: ${door.machine.name} closed the connection before answering")
        return false
      }
      while (response.status in 100..199) {
        toClient.write(response.bytes())
        toClient.flush()
        response = HttpHead.read(up.input) ?: return false
      }
      markImmutable(target, response)
      val framing = Framing.ofResponse(head.method, response)
      val writer = if (flight != null && storable(response)) HttpCache.writer(flight, machine, target, response) else null
      // Nothing to store: the followers fetch for themselves.
      if (flight != null && writer == null) HttpCache.land(flight)
      // A body being stored is read to its end even when this request's
      // client goes away: the followers and the cache still want it. Not
      // forever: past the entry cap the writer gives up storing, and with no
      // client left a body without progress for STALL_MS is given up too.
      val sink = if (writer != null) Detachable(toClient, writer) else toClient
      val watch = if (writer != null && sink is Detachable) {
        watchdog.scheduleWithFixedDelay({
          if (sink.gone && writer.idleMs() > STALL_MS) {
            Log.d(TAG, "stalled '${door.machine.name}' ${target.substringBefore('?')}: no client and no progress")
            writer.abandon()
            up.close()
          }
        }, STALL_CHECK_MS, STALL_CHECK_MS, TimeUnit.MILLISECONDS)
      } else {
        null
      }
      var complete = false
      try {
        sink.write(response.bytes())
        sink.flush()
        complete = copyBody(up.input, sink, framing, writer?.let { it::write })
      } finally {
        watch?.cancel(false)
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
      // A client that went away gets its connection closed.
      return !head.closes && !(sink is Detachable && sink.gone)
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

  /**
   * Answer with a status and a short text body. Chromium shows its own error
   * page for an error status without a body (`ERR_HTTP_RESPONSE_CODE_FAILURE`).
   */
  private fun refuse(sink: OutputStream, status: String, body: String = "") {
    val text = if (body.isEmpty()) ByteArray(0) else "$body\n".toByteArray(Charsets.UTF_8)
    val type = if (body.isEmpty()) "" else "Content-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\n"
    sink.write("HTTP/1.1 $status\r\n${type}Content-Length: ${text.size}\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
    sink.write(text)
    sink.flush()
  }

  /**
   * `502` naming each link tried and its reason in the machine model's words,
   * e.g. `Tailscale: timeout; Relay: relay-unreachable`. The errors themselves
   * go only to logcat.
   */
  private fun unreachable(sink: OutputStream, door: Door, failure: Exception) {
    val failures = (failure as? Unreachable)?.failures
    val links = failures?.joinToString("; ") { "${linkName(it.via == "tailscale")}: ${it.down}" } ?: "network"
    failures?.forEach { Log.d(TAG, "unreachable '${door.machine.name}' via ${it.via}: ${it.down}: ${redact(it.message)}") }
    refuse(sink, "502 Bad Gateway", "Cannot reach ${door.machine.name}. $links")
  }

  /** An error message for the log: URLs keep only scheme, host, port and path (no userinfo, query or fragment). */
  private fun redact(text: String): String =
    URL_IN_TEXT.replace(text) { match -> "${match.groupValues[1]}${match.groupValues[3]}${match.groupValues[4]}" }

  private fun linkName(tailnet: Boolean): String = if (tailnet) "Tailscale" else "Relay"

  /**
   * A WebView connection that may go away mid-body: while the body is still
   * being stored, writes after the first failure are dropped so it is read to
   * its end; once the writer gave up, they fail, which ends the exchange.
   */
  private class Detachable(private val sink: OutputStream, private val writer: HttpCache.Writer) : OutputStream() {
    @Volatile var gone = false
      private set

    override fun write(byte: Int) = write(byteArrayOf(byte.toByte()), 0, 1)

    override fun write(buffer: ByteArray, offset: Int, length: Int) {
      if (gone) return detached()
      try {
        sink.write(buffer, offset, length)
      } catch (_: IOException) {
        gone = true
        detached()
      }
    }

    override fun flush() {
      if (gone) return detached()
      try {
        sink.flush()
      } catch (_: IOException) {
        gone = true
        detached()
      }
    }

    private fun detached() {
      if (!writer.open) throw IOException("the client went away and nothing is being stored")
    }
  }

  private fun close(socket: Socket) {
    try {
      socket.close()
    } catch (_: IOException) {
      // Already closed.
    }
  }
}
