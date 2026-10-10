package expo.modules.kivotosattention

import android.util.Base64
import android.webkit.CookieManager
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/**
 * Local doors to the computers reached through a relay. Each computer gets a
 * loopback HTTP address the WebView and the attention service can use like a
 * tailnet address; every connection to it becomes a secured session to that
 * computer and carries the bytes unchanged, WebSocket upgrades included.
 *
 * Any app on the phone can connect to a loopback port, so a connection is
 * served only if its first request carries this process's secret cookie.
 */
object RelayProxy {
  private const val COOKIE = "kivotos_proxy"
  private const val PORT_BASE = 20_000
  private const val PORT_SPAN = 20_000
  private const val HEAD_LIMIT = 64 * 1024
  private const val HEAD_TIMEOUT_MS = 30_000

  /** One secret per app process; the WebView gets it as a cookie. */
  private val token: String = Base64.encodeToString(
    ByteArray(24).also(SecureRandom()::nextBytes),
    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
  )

  /** The value of the Cookie header that opens a door. */
  val cookie: String = "$COOKIE=$token"

  private class Door(val server: ServerSocket, val network: Network, val node: String)

  private val doors = ConcurrentHashMap<String, Door>()

  /**
   * Open (once) the door to a relay machine and let the WebView through it.
   * @return its base URL, `http://127.0.0.1:<port>`.
   */
  @Synchronized
  fun open(machine: Machine): String {
    val door = doors[machine.id] ?: listen(machine).also { doors[machine.id] = it }
    val url = "http://127.0.0.1:${door.server.localPort}"
    CookieManager.getInstance().apply {
      setCookie(url, "$cookie; Path=/; HttpOnly")
      flush()
    }
    return url
  }

  /** Close the doors of machines that are no longer in the list. */
  @Synchronized
  fun retain(ids: Set<String>) {
    for ((id, door) in doors) {
      if (id in ids) continue
      doors.remove(id)
      door.server.close()
    }
  }

  private fun listen(machine: Machine): Door {
    val network = Network.of(machine.relay, machine.key)
    val loopback = InetAddress.getByName("127.0.0.1")
    // The same port every time keeps the page's origin, and with it dsh's
    // localStorage for this computer, across app restarts.
    val preferred = PORT_BASE + Math.floorMod(machine.node.hashCode(), PORT_SPAN)
    var server: ServerSocket? = null
    for (step in 0 until 32) {
      server = try {
        ServerSocket(preferred + step, 16, loopback)
      } catch (_: IOException) {
        continue
      }
      break
    }
    val door = Door(server ?: ServerSocket(0, 16, loopback), network, machine.node)
    Thread({ accept(door) }, "kivotos-relay-door").apply { isDaemon = true }.start()
    return door
  }

  private fun accept(door: Door) {
    while (true) {
      val client = try {
        door.server.accept()
      } catch (_: IOException) {
        return // The door was closed.
      }
      Thread({ serve(door, client) }, "kivotos-relay-conn").apply { isDaemon = true }.start()
    }
  }

  private fun serve(door: Door, client: Socket) {
    var session: RelaySession? = null
    try {
      client.soTimeout = HEAD_TIMEOUT_MS
      client.tcpNoDelay = true
      val fromClient = client.getInputStream()
      val toClient = client.getOutputStream()
      val head = readHead(fromClient)
      if (!admitted(head)) {
        refuse(toClient, "403 Forbidden")
        return
      }
      val opened = try {
        RelayClient.dial(door.network, door.node)
      } catch (_: Exception) {
        refuse(toClient, "502 Bad Gateway")
        return
      }
      session = opened
      client.soTimeout = 0
      opened.output.write(head)
      val upstream = Thread({
        try {
          pump(fromClient, opened.output)
        } catch (_: Exception) {
          // Either side went away. An uncaught exception here would end the app.
        } finally {
          opened.close()
          close(client)
        }
      }, "kivotos-relay-up").apply { isDaemon = true }
      upstream.start()
      pump(opened.input, toClient)
    } catch (_: Exception) {
      // Either side went away; both are closed below.
    } finally {
      session?.close()
      close(client)
    }
  }

  /** Read the first request's head, up to and including the blank line. */
  private fun readHead(source: InputStream): ByteArray {
    val head = ByteArrayOutputStream()
    var matched = 0
    val end = byteArrayOf(13, 10, 13, 10)
    while (matched < end.size) {
      val byte = source.read()
      if (byte < 0) throw IOException("closed before a request")
      head.write(byte)
      matched = if (byte.toByte() == end[matched]) matched + 1 else if (byte == 13) 1 else 0
      if (head.size() > HEAD_LIMIT) throw IOException("request head too long")
    }
    return head.toByteArray()
  }

  private fun admitted(head: ByteArray): Boolean =
    String(head, Charsets.ISO_8859_1).split("\r\n").any { line ->
      line.startsWith("cookie:", ignoreCase = true) &&
        line.substringAfter(':').split(';').any { it.trim() == cookie }
    }

  private fun refuse(sink: OutputStream, status: String) {
    sink.write("HTTP/1.1 $status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
    sink.flush()
  }

  private fun pump(source: InputStream, sink: OutputStream) {
    val buffer = ByteArray(32 * 1024)
    while (true) {
      val count = source.read(buffer)
      if (count < 0) return
      sink.write(buffer, 0, count)
      sink.flush()
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
