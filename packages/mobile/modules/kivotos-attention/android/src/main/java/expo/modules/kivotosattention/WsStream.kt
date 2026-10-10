package expo.modules.kivotosattention

import android.util.Base64
import java.io.BufferedInputStream
import java.io.Closeable
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.security.SecureRandom
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * A WebSocket to the relay, used as one byte stream: binary messages both
 * ways, boundaries ignored (packages/relay/tunnel). A minimal client of its
 * own, because TLS between members runs inside the stream and needs plain
 * blocking input and output.
 */
class WsStream private constructor(private val socket: Socket, source: InputStream) : Closeable {
  private val source = source
  private val sink: OutputStream = socket.getOutputStream()
  private val writeLock = Any()
  private val random = SecureRandom()

  /** Bytes left in the data message being read. */
  private var remaining = 0L
  private var ended = false

  val input: InputStream = object : InputStream() {
    override fun read(): Int {
      val one = ByteArray(1)
      return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
      if (length == 0) return 0
      while (remaining == 0L) {
        if (ended || !nextFrame()) return -1
      }
      val count = source.read(buffer, offset, minOf(length.toLong(), remaining).toInt())
      if (count < 0) throw EOFException("relay connection closed inside a message")
      remaining -= count
      return count
    }
  }

  val output: OutputStream = object : OutputStream() {
    override fun write(byte: Int) = write(byteArrayOf(byte.toByte()), 0, 1)

    override fun write(buffer: ByteArray, offset: Int, length: Int) {
      var sent = 0
      while (sent < length) {
        val size = minOf(length - sent, MAX_FRAME)
        frame(OP_BINARY, buffer, offset + sent, size)
        sent += size
      }
    }
  }

  /** Read one frame header; control frames are handled here. @return false at the end. */
  private fun nextFrame(): Boolean {
    val first = source.read()
    if (first < 0) {
      ended = true
      return false
    }
    val second = readByte()
    var length = (second and 0x7f).toLong()
    if (length == 126L) {
      length = ((readByte() shl 8) or readByte()).toLong()
    } else if (length == 127L) {
      length = 0
      repeat(8) { length = (length shl 8) or readByte().toLong() }
    }
    // A server never masks; a masked frame is a protocol error.
    if (second and 0x80 != 0) throw IOException("relay sent a masked frame")
    when (first and 0x0f) {
      OP_CONTINUATION, OP_BINARY -> remaining = length
      OP_PING -> frame(OP_PONG, control(length), 0, length.toInt())
      OP_PONG -> control(length)
      OP_CLOSE -> {
        control(length)
        ended = true
        return false
      }
      else -> throw IOException("relay sent an unexpected frame")
    }
    return true
  }

  private fun readByte(): Int {
    val value = source.read()
    if (value < 0) throw EOFException("relay connection closed inside a frame")
    return value
  }

  private fun control(length: Long): ByteArray {
    if (length > 125) throw IOException("relay sent an oversized control frame")
    val payload = ByteArray(length.toInt())
    var read = 0
    while (read < payload.size) {
      val count = source.read(payload, read, payload.size - read)
      if (count < 0) throw EOFException("relay connection closed inside a frame")
      read += count
    }
    return payload
  }

  /** Send one masked frame, as a client must. */
  private fun frame(opcode: Int, payload: ByteArray, offset: Int, length: Int) {
    val mask = ByteArray(4).also(random::nextBytes)
    val header = when {
      length < 126 -> byteArrayOf((0x80 or opcode).toByte(), (0x80 or length).toByte())
      else -> byteArrayOf((0x80 or opcode).toByte(), (0x80 or 126).toByte(), (length shr 8).toByte(), length.toByte())
    }
    val body = ByteArray(length) { (payload[offset + it].toInt() xor mask[it and 3].toInt()).toByte() }
    synchronized(writeLock) {
      sink.write(header)
      sink.write(mask)
      sink.write(body)
      sink.flush()
    }
  }

  override fun close() {
    try {
      socket.close()
    } catch (_: IOException) {
      // Already closed.
    }
  }

  companion object {
    private const val OP_CONTINUATION = 0
    private const val OP_BINARY = 2
    private const val OP_CLOSE = 8
    private const val OP_PING = 9
    private const val OP_PONG = 10

    /** Largest payload sent in one frame: fits the 16-bit length form. */
    private const val MAX_FRAME = 32 * 1024
    private const val CONNECT_TIMEOUT_MS = 15_000

    /** The relay pings every 30 s; a connection silent this long is dead. */
    private const val SILENCE_TIMEOUT_MS = 90_000

    /** @param endpoint `ws://` or `wss://` URL of the relay's connect route. */
    fun open(endpoint: String): WsStream {
      val uri = URI(endpoint)
      val secure = uri.scheme == "wss"
      val host = uri.host ?: throw IOException("relay address has no host")
      val port = if (uri.port > 0) uri.port else if (secure) 443 else 80
      var socket = Socket()
      try {
        socket.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)
        socket.soTimeout = SILENCE_TIMEOUT_MS
        socket.tcpNoDelay = true
        if (secure) {
          val tls = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(socket, host, port, true) as SSLSocket
          socket = tls
          tls.startHandshake()
          // A plain SSLSocket does not check the name on the certificate.
          if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, tls.session)) {
            throw IOException("the relay's certificate is not for $host")
          }
        }
        val key = Base64.encodeToString(ByteArray(16).also(SecureRandom()::nextBytes), Base64.NO_WRAP)
        val path = (uri.rawPath?.ifEmpty { "/" } ?: "/") + (uri.rawQuery?.let { "?$it" } ?: "")
        val authority = if (uri.port > 0) "$host:$port" else host
        socket.getOutputStream().apply {
          write(
            ("GET $path HTTP/1.1\r\nHost: $authority\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
              "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\n\r\n").toByteArray(Charsets.US_ASCII),
          )
          flush()
        }
        val source = BufferedInputStream(socket.getInputStream())
        val status = readHead(source).substringBefore("\r\n")
        if (!status.startsWith("HTTP/1.1 101")) throw IOException("the relay refused the WebSocket: $status")
        return WsStream(socket, source)
      } catch (failure: Exception) {
        try {
          socket.close()
        } catch (_: IOException) {
          // Nothing to release.
        }
        throw failure
      }
    }

    /** Read response headers up to and including the blank line. */
    private fun readHead(source: InputStream): String {
      val head = StringBuilder()
      while (!head.endsWith("\r\n\r\n")) {
        val byte = source.read()
        if (byte < 0) throw EOFException("the relay closed the connection")
        head.append(byte.toChar())
        if (head.length > 8192) throw IOException("the relay's response is too long")
      }
      return head.toString()
    }
  }
}
