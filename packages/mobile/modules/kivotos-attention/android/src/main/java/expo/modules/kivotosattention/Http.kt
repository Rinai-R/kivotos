package expo.modules.kivotosattention

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * The slice of HTTP/1.1 the machine doors need: message heads they read and
 * rewrite, and body framing, so they know where one exchange ends and the
 * next begins on a kept-alive connection. Bodies are copied as they arrive,
 * never buffered: Server-Sent Events and long downloads stream through.
 */
class HttpHead(var start: String, val fields: MutableList<Pair<String, String>>) {
  /** Request method; "" for a response. */
  val method: String get() = start.substringBefore(' ')

  /** Request target, path and query as sent. */
  val target: String get() = start.split(' ').getOrElse(1) { "" }

  /** Response status code; 0 when the start line is not a status line. */
  val status: Int get() = start.split(' ').getOrNull(1)?.toIntOrNull() ?: 0

  operator fun get(name: String): String? = fields.firstOrNull { it.first.equals(name, ignoreCase = true) }?.second

  fun has(name: String): Boolean = fields.any { it.first.equals(name, ignoreCase = true) }

  fun remove(name: String) {
    fields.removeAll { it.first.equals(name, ignoreCase = true) }
  }

  operator fun set(name: String, value: String) {
    val at = fields.indexOfFirst { it.first.equals(name, ignoreCase = true) }
    remove(name)
    if (at < 0) fields.add(name to value) else fields.add(at, name to value)
  }

  /** Whether the sender ends the connection after this message. */
  val closes: Boolean
    get() {
      val connection = this["connection"].orEmpty()
      val version = if (status == 0) start.substringAfterLast(' ') else start.substringBefore(' ')
      return tokens(connection).contains("close") ||
        (version == "HTTP/1.0" && !tokens(connection).contains("keep-alive"))
    }

  fun bytes(): ByteArray {
    val text = StringBuilder(start).append("\r\n")
    for ((name, value) in fields) text.append(name).append(": ").append(value).append("\r\n")
    return text.append("\r\n").toString().toByteArray(Charsets.ISO_8859_1)
  }

  companion object {
    private const val LIMIT = 64 * 1024

    /**
     * Read one message head, through the blank line.
     * @return null when the stream ends before its first byte (a clean close between messages).
     */
    fun read(source: InputStream): HttpHead? {
      val head = ByteArrayOutputStream()
      var matched = 0
      while (matched < 4) {
        val byte = source.read()
        if (byte < 0) {
          if (head.size() == 0) return null
          throw IOException("closed inside a message head")
        }
        head.write(byte)
        matched = when {
          byte == (if (matched % 2 == 0) 13 else 10) -> matched + 1
          byte == 13 -> 1
          else -> 0
        }
        if (head.size() > LIMIT) throw IOException("message head too long")
      }
      return parse(String(head.toByteArray(), Charsets.ISO_8859_1))
    }

    fun parse(text: String): HttpHead {
      val lines = text.split("\r\n").filter { it.isNotEmpty() }
      if (lines.isEmpty()) throw IOException("empty message head")
      val fields = lines.drop(1).map { line ->
        val colon = line.indexOf(':')
        if (colon <= 0) throw IOException("malformed header field")
        line.substring(0, colon).trim() to line.substring(colon + 1).trim()
      }
      return HttpHead(lines[0], fields.toMutableList())
    }

    /** Lowercased comma-separated tokens of a header value. */
    fun tokens(value: String?): List<String> =
      value.orEmpty().split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }
  }
}

/** Where a message body ends. */
sealed interface Framing {
  data object None : Framing
  data class Length(val bytes: Long) : Framing
  data object Chunked : Framing
  /** Until the sender closes the connection (a response without length). */
  data object UntilClose : Framing

  companion object {
    fun ofRequest(head: HttpHead): Framing = when {
      head.has("transfer-encoding") -> Chunked
      head.has("content-length") -> Length(contentLength(head))
      else -> None
    }

    fun ofResponse(method: String, head: HttpHead): Framing = when {
      method == "HEAD" || head.status in 100..199 || head.status == 204 || head.status == 304 -> None
      head.has("transfer-encoding") -> if (HttpHead.tokens(head["transfer-encoding"]).lastOrNull() == "chunked") Chunked else UntilClose
      head.has("content-length") -> Length(contentLength(head))
      else -> UntilClose
    }

    private fun contentLength(head: HttpHead): Long =
      head["content-length"]?.toLongOrNull()?.takeIf { it >= 0 } ?: throw IOException("bad content-length")
  }
}

/**
 * Copy one body from [source] to [sink] byte for byte (chunk framing
 * included), flushing after every read so nothing waits in a buffer.
 * @param tap gets the body bytes without chunk framing, as they pass.
 * @return false when the source ended before the body did (only possible for a framed body).
 */
fun copyBody(source: InputStream, sink: OutputStream, framing: Framing, tap: ((ByteArray, Int, Int) -> Unit)? = null): Boolean {
  val buffer = ByteArray(32 * 1024)
  fun copy(limit: Long): Boolean {
    var left = limit
    while (left > 0) {
      val count = source.read(buffer, 0, minOf(left, buffer.size.toLong()).toInt())
      if (count < 0) return limit == Long.MAX_VALUE
      sink.write(buffer, 0, count)
      sink.flush()
      tap?.invoke(buffer, 0, count)
      left -= count
    }
    return true
  }
  fun line(): String {
    val bytes = ByteArrayOutputStream()
    while (true) {
      val byte = source.read()
      if (byte < 0) throw IOException("closed inside chunk framing")
      bytes.write(byte)
      if (byte == 10) break
      if (bytes.size() > 4096) throw IOException("chunk line too long")
    }
    sink.write(bytes.toByteArray())
    return String(bytes.toByteArray(), Charsets.ISO_8859_1).trimEnd('\r', '\n')
  }
  fun chunked(): Boolean {
    while (true) {
      val size = line().substringBefore(';').trim().toLongOrNull(16) ?: throw IOException("bad chunk size")
      if (size == 0L) {
        while (line().isNotEmpty()) Unit // Trailer fields, then the blank line.
        sink.flush()
        return true
      }
      if (!copy(size)) return false
      line() // The CRLF closing the chunk.
    }
  }
  return when (framing) {
    Framing.None -> true
    is Framing.Length -> copy(framing.bytes)
    Framing.UntilClose -> copy(Long.MAX_VALUE)
    Framing.Chunked -> chunked()
  }
}

/**
 * One message body read as a stream, its framing removed: what a door reads
 * for itself rather than passing on. It ends where the body does, so the
 * connection can carry the next exchange once it is [drain]ed.
 */
class BodyInput(private val source: InputStream, private val framing: Framing) : InputStream() {
  /** Body bytes read off the wire so far, chunk framing excluded. */
  var wire = 0L
    private set
  /** Bytes left in the current chunk, or of the whole body for a framed length. */
  private var left = (framing as? Framing.Length)?.bytes ?: 0L
  private var chunks = 0
  private var ended = framing == Framing.None

  override fun read(): Int {
    val one = ByteArray(1)
    return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    if (ended) return -1
    if (length == 0) return 0
    val open = when (framing) {
      Framing.None -> false
      is Framing.Length -> left > 0
      Framing.Chunked -> left > 0 || nextChunk()
      Framing.UntilClose -> true
    }
    if (!open) {
      ended = true
      return -1
    }
    val want = if (framing == Framing.UntilClose) length else minOf(length.toLong(), left).toInt()
    val count = source.read(buffer, offset, want)
    if (count < 0) {
      if (framing != Framing.UntilClose) throw IOException("closed inside a message body")
      ended = true
      return -1
    }
    left -= count
    wire += count
    return count
  }

  /** Read the rest of the body and drop it. */
  fun drain() {
    val buffer = ByteArray(32 * 1024)
    while (read(buffer, 0, buffer.size) >= 0) Unit
  }

  /** @return false at the last chunk (its trailer fields read). */
  private fun nextChunk(): Boolean {
    if (chunks++ > 0) line() // The CRLF closing the chunk before.
    val size = line().substringBefore(';').trim().toLongOrNull(16) ?: throw IOException("bad chunk size")
    if (size == 0L) {
      while (line().isNotEmpty()) Unit // Trailer fields, then the blank line.
      return false
    }
    left = size
    return true
  }

  private fun line(): String {
    val bytes = ByteArrayOutputStream()
    while (true) {
      val byte = source.read()
      if (byte < 0) throw IOException("closed inside chunk framing")
      if (byte == 10) break
      bytes.write(byte)
      if (bytes.size() > 4096) throw IOException("chunk line too long")
    }
    return String(bytes.toByteArray(), Charsets.ISO_8859_1).trimEnd('\r')
  }
}

/** Copy everything until the source ends; a tunnel after a protocol switch. */
fun pump(source: InputStream, sink: OutputStream) {
  val buffer = ByteArray(32 * 1024)
  while (true) {
    val count = source.read(buffer)
    if (count < 0) return
    sink.write(buffer, 0, count)
    sink.flush()
  }
}
