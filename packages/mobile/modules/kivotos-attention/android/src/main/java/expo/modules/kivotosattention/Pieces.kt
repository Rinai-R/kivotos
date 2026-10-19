package expo.modules.kivotosattention

import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.net.URLEncoder
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicReference

/** A connection of a door's own to its machine, for GETs one at a time. */
interface MachineGet : Closeable {
  /** Body bytes received so far, as they crossed the link (content-encoded). */
  val wire: Long

  /**
   * GET [target] from the machine.
   * @param read gets the response head and its body, content-decoded; the
   * rest of the body is dropped after it returns.
   * @throws Exception when the machine cannot be reached or the exchange fails.
   */
  fun <T> get(target: String, accept: String, read: (HttpHead, InputStream) -> T): T
}

/**
 * dsh plugin batches put together on the phone. A batch
 * (`/plugins/??<id>/client.js,…&rev=<rev>`, ~9 MB) gets a new URL
 * whenever any of its rows' files changes, though most of its bytes stay the
 * same. On a batch miss the door asks the machine's Kivotos for the batch's
 * manifest (`/kivotos/pieces`, packages/kivotos/src/pieces.ts): each row's
 * own URL, size and SHA-256, and the batch's last line, size and SHA-256. It
 * downloads only the pieces [HttpCache] does not hold, by content and for
 * every machine alike, two at a time over all machines, checks each one, and
 * stores the batch only when the pieces and the last line add up to its size
 * and SHA-256. Anything else, a machine whose Kivotos has no manifest
 * included, leaves the batch to be fetched whole: the page never gets bytes
 * that are not the batch's.
 */
object Pieces {
  private const val TAG = "KivotosCache"
  private const val MANIFEST_PATH = "/kivotos/pieces"
  private const val MANIFEST_MAX_BYTES = 1024 * 1024
  /** Pieces downloading at a time, over all machines. */
  private val slots = Semaphore(2)

  /** A dsh 0.2.1-rc.2 plugin batch, root-relative or under a peer mount's prefix (the first group). */
  private val BATCH = Regex("""^(.*?)(/plugins/\?\?[^?#&]+&rev=[\w.-]+)$""")
  private val SHA256 = Regex("^[0-9a-f]{64}$")

  /** Why a batch is fetched whole. */
  private class Fallback(message: String) : IOException(message)

  private class Piece(val path: String, val bytes: Long, val sha256: String)

  private class Manifest(
    val bytes: Long,
    val sha256: String,
    val headers: List<Pair<String, String>>,
    val pieces: List<Piece>,
    val tail: ByteArray,
  )

  /** Whether [assemble] may put the response to [target] together. */
  fun batch(target: String): Boolean = BATCH.matches(target)

  /**
   * Put the batch at [target] together and store it as the [flight]'s leader.
   * @param first - the connection to ask for the manifest on; [more] opens another one.
   * @return whether it is stored; false when the caller is to fetch it whole.
   */
  fun assemble(
    label: String,
    machine: String,
    target: String,
    flight: HttpCache.Flight,
    first: MachineGet,
    more: () -> MachineGet,
  ): Boolean {
    val (prefix, batch) = BATCH.matchEntire(target)?.destructured ?: return false
    val rev = batch.substringAfterLast("&rev=")
    val started = SystemClock.elapsedRealtime()
    val clients = mutableListOf(first)
    try {
      val manifest = manifest(first, prefix, batch)
      val manifestWire = first.wire
      val missing = manifest.pieces.filter { !HttpCache.hasPiece(it.sha256) }.distinctBy { it.sha256 }
      val queue = ConcurrentLinkedQueue(missing)
      val failure = AtomicReference<String?>(null)
      fun work(client: MachineGet) {
        while (failure.get() == null) {
          val piece = queue.poll() ?: return
          try {
            slots.acquire()
          } catch (_: InterruptedException) {
            failure.compareAndSet(null, "interrupted")
            return
          }
          try {
            val stored = client.get(prefix + piece.path, "*/*") { head, body ->
              head.status == 200 && HttpCache.storePiece(piece.sha256, piece.bytes, body)
            }
            if (!stored) failure.compareAndSet(null, "piece ${piece.path.substringAfterLast("&rev=")} is not its bytes")
          } catch (error: Exception) {
            failure.compareAndSet(null, "piece ${piece.path.substringAfterLast("&rev=")}: ${error.javaClass.simpleName}")
          } finally {
            slots.release()
          }
        }
      }
      val helper = if (missing.size > 1) more().also(clients::add) else null
      val second = helper?.let { client ->
        Thread({ work(client) }, "kivotos-pieces").apply {
          isDaemon = true
          start()
        }
      }
      work(first)
      second?.join()
      failure.get()?.let { throw Fallback(it) }
      val stored = HttpCache.assemble(
        flight, machine, target, manifest.headers, manifest.pieces.map { it.sha256 }, manifest.tail, manifest.bytes, manifest.sha256,
      )
      if (!stored) throw Fallback("the pieces are not the batch")
      Log.i(
        TAG,
        "pieces '$label' rev=$rev rows=${manifest.pieces.size} held=${manifest.pieces.size - missing.size} " +
          "fetched=${missing.size} manifestWire=$manifestWire piecesWire=${clients.sumOf { it.wire } - manifestWire} " +
          "bytes=${manifest.bytes} ms=${SystemClock.elapsedRealtime() - started}",
      )
      return true
    } catch (failure: Exception) {
      // Only this file's own messages: others can carry the machine's address.
      Log.i(TAG, "pieces '$label' rev=$rev fetched whole: ${(failure as? Fallback)?.message ?: failure.javaClass.simpleName}")
      return false
    } finally {
      for (client in clients) runCatching { client.close() }
    }
  }

  /** @throws IOException naming why the machine offers no usable manifest. */
  private fun manifest(client: MachineGet, prefix: String, batch: String): Manifest {
    val target = "$prefix$MANIFEST_PATH?batch=${URLEncoder.encode(batch, "UTF-8")}"
    var status = 0
    val text = client.get(target, "application/json") { head, body ->
      status = head.status
      if (status == 200 && head["content-type"].orEmpty().startsWith("application/json")) readText(body) else null
    } ?: throw Fallback("no manifest (HTTP $status)")
    val json = JSONObject(text)
    if (json.getString("batch") != batch) throw Fallback("a manifest of another batch")
    val head = HttpHead("HTTP/1.1 200 OK", mutableListOf("content-type" to json.getString("contentType"), "cache-control" to json.getString("cacheControl")))
    if (!storable(head)) throw Fallback("the batch is not immutable")
    val list = json.getJSONArray("pieces")
    val pieces = List(list.length()) { index ->
      val piece = list.getJSONObject(index)
      Piece(piece.getString("path"), piece.getLong("bytes"), piece.getString("sha256"))
    }
    val tail = json.getString("tail").toByteArray(Charsets.UTF_8)
    val bytes = json.getLong("bytes")
    val sha256 = json.getString("sha256")
    // Pieces come from the machine's own plugin route and add up to the batch.
    val sound = pieces.isNotEmpty() &&
      pieces.all { BATCH.matchEntire(it.path)?.groupValues?.get(1) == "" && it.bytes >= 0 && SHA256.matches(it.sha256) } &&
      SHA256.matches(sha256) &&
      pieces.sumOf { it.bytes } + tail.size == bytes
    if (!sound) throw Fallback("a malformed manifest")
    return Manifest(bytes, sha256, head.fields, pieces, tail)
  }

  private fun readText(body: InputStream): String {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    while (true) {
      val count = body.read(buffer)
      if (count < 0) break
      out.write(buffer, 0, count)
      if (out.size() > MANIFEST_MAX_BYTES) throw Fallback("the manifest is too large")
    }
    return out.toString("UTF-8")
  }
}
