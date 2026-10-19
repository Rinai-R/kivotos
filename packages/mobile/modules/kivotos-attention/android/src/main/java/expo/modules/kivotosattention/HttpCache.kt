package expo.modules.kivotosattention

import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * The phone's disk cache of machine responses that never change at their URL,
 * with the rules of the computer-side mount cache (packages/kivotos/src/cache.ts):
 * a GET without `Range`, not a navigation, from a client that accepts gzip,
 * answered 200 without `Set-Cookie`, with `Vary` at most `Accept-Encoding`, and
 * `immutable` in its `cache-control` without `no-store`/`no-cache`/`private`
 * (dsh's revisioned plugin batches, and content-hashed Vite assets).
 *
 * An entry is `<name>.body` (the body as received, gzip when the machine
 * compressed it; not content-encoded for a batch [Pieces] put together) and
 * `<name>.json` (status, replayed headers, size), under one directory per
 * machine in the app's cache directory. Both are written to temp files, synced
 * and renamed, `.json` last; [init] deletes whatever is not a complete entry.
 * Least recently used entries go past [MAX_BYTES].
 *
 * The pieces of dsh plugin batches ([Pieces]) are entries of one more
 * directory, [PIECES], shared by every machine and named by the SHA-256 of
 * their bytes, which is checked before one is stored.
 *
 * Concurrent misses for one entry fetch once ([Flight], the `flights` of the
 * computer-side cache): the first request leads and tees the body into the
 * entry's temp file; the others read that file as it grows, or, once the
 * entry is stored, from disk. dsh 0.2.1-rc.2 ignores `Range` on its plugin
 * batches (`200`, chunked, no `ETag` or `Last-Modified`), so an interrupted
 * body cannot be resumed and is deleted.
 */
object HttpCache {
  private const val TAG = "KivotosCache"

  /**
   * Cap over all machines. The computer-side cache's default: a dsh 0.2.1-rc.2
   * page load is about 11 MB (about 9 MB of it one plugin batch, 11 MB put
   * together from pieces), and its batch
   * URLs change whenever a plugin's files change, so this holds several
   * revisions of several machines while staying a small share of a phone's
   * storage. Android may also reclaim the cache directory itself.
   */
  const val MAX_BYTES = 256L * 1024 * 1024

  /**
   * Cap of one entry: a response larger than this is passed through but not
   * stored. The largest dsh 0.2.1-rc.2 response is its ~9 MB plugin
   * batch, 11 MB put together.
   */
  const val ENTRY_MAX_BYTES = MAX_BYTES / 8

  private const val ROOT = "kivotos-http"
  private const val REV_FILE = "rev"
  /** The directory of the batch pieces; machine directories are 32 hex digits. */
  private const val PIECES = "pieces"

  /** One stored response. */
  class Entry(
    val dir: String,
    val name: String,
    val status: Int,
    val headers: List<Pair<String, String>>,
    val size: Long,
    /** Bytes on disk, body and metadata. */
    val bytes: Long,
  )

  private var root: File? = null
  /** By `<dir>/<name>`, least recently used first. */
  private val entries = LinkedHashMap<String, Entry>(64, 0.75f, true)
  private var bytes = 0L
  /** Misses being fetched, by entry key. */
  private val flights = HashMap<String, Flight>()

  /** Open the cache under the app's cache directory, once per process. */
  @Synchronized
  fun init(cacheDir: File) {
    if (root != null) return
    val top = File(cacheDir, ROOT)
    root = top
    top.mkdirs()
    val found = mutableListOf<Pair<Long, Entry>>()
    for (dir in top.listFiles().orEmpty()) {
      if (!dir.isDirectory) {
        dir.delete()
        continue
      }
      for (file in dir.listFiles().orEmpty()) {
        val name = file.name
        if (name == REV_FILE || name.endsWith(".body") && File(dir, name.removeSuffix(".body") + ".json").isFile) continue
        if (name.endsWith(".json")) {
          val entry = readEntry(dir, name.removeSuffix(".json"))
          if (entry != null) {
            found.add(file.lastModified() to entry)
            continue
          }
          File(dir, name.removeSuffix(".json") + ".body").delete()
        }
        file.delete()
      }
    }
    found.sortBy { it.first }
    for ((_, entry) in found) {
      entries["${entry.dir}/${entry.name}"] = entry
      bytes += entry.bytes
    }
    evict()
    Log.i(TAG, "open entries=${entries.size} bytes=$bytes")
  }

  private fun readEntry(dir: File, name: String): Entry? = try {
    val meta = File(dir, "$name.json")
    val body = File(dir, "$name.body")
    val json = JSONObject(meta.readText())
    val size = json.getLong("size")
    if (!body.isFile || body.length() != size) {
      null
    } else {
      val list = json.getJSONArray("headers")
      val headers = List(list.length()) { list.getJSONArray(it).let { pair -> pair.getString(0) to pair.getString(1) } }
      Entry(dir.name, name, json.getInt("status"), headers, size, size + meta.length())
    }
  } catch (_: Exception) {
    null
  }

  /** @return the stored response for this request target of this machine, opened and marked recently used. */
  @Synchronized
  fun lookup(machine: String, target: String): Pair<Entry, InputStream>? {
    val top = root ?: return null
    val entry = entries["${machineDir(machine)}/${entryName(machine, target)}"] ?: return null
    val body = try {
      FileInputStream(File(File(top, entry.dir), "${entry.name}.body"))
    } catch (_: IOException) {
      // Android reclaimed the cache directory under us.
      forget(entry)
      return null
    }
    File(File(top, entry.dir), "${entry.name}.json").setLastModified(System.currentTimeMillis())
    return entry to body
  }

  @Synchronized
  fun has(machine: String, target: String): Boolean = entries.containsKey("${machineDir(machine)}/${entryName(machine, target)}")

  /** A request's part in the fetch of a miss: it [leads] the fetch, or follows the one that does. */
  class Claim(val flight: Flight, val leads: Boolean)

  /**
   * Join the fetch of a miss.
   * @return null when the entry is stored by now; else the flight, which a leader must [land].
   */
  @Synchronized
  fun claim(machine: String, target: String): Claim? {
    val key = "${machineDir(machine)}/${entryName(machine, target)}"
    if (entries.containsKey(key)) return null
    // A flight whose body failed while its leader still reads it has nothing left to share.
    flights[key]?.takeIf { !it.ended }?.let { return Claim(it, leads = false) }
    return Claim(Flight().also { flights[key] = it }, leads = true)
  }

  /** The leader is done: the flight ends, stored or not, and the next miss fetches anew. */
  @Synchronized
  fun land(flight: Flight) {
    flights.values.remove(flight)
    flight.settle(false)
  }

  /**
   * One fetch of a miss, shared by every request for the entry while it lasts.
   * Followers wait for the leader's response; when it is being stored they
   * read the body from the entry's temp file as the leader writes it.
   */
  class Flight internal constructor() {
    private val lock = Object()
    private var writer: Writer? = null
    private var size = 0L
    /** null while the fetch runs; then whether the entry was stored. */
    private var stored: Boolean? = null

    internal val ended: Boolean get() = synchronized(lock) { stored != null }

    internal fun started(writer: Writer) = synchronized(lock) {
      this.writer = writer
      lock.notifyAll()
    }

    internal fun grew(size: Long) = synchronized(lock) {
      this.size = size
      lock.notifyAll()
    }

    internal fun settle(stored: Boolean) = synchronized(lock) {
      if (this.stored == null) this.stored = stored
      lock.notifyAll()
    }

    /**
     * Wait for the leader's response.
     * @return the body being stored, to read as it arrives; null when the
     * flight ended first (the entry is stored, or nothing is: try again).
     */
    fun follow(): Tail? {
      val storing = synchronized(lock) {
        while (writer == null && stored == null) lock.wait()
        if (stored != null) return null
        requireNotNull(writer)
      }
      val input = try {
        FileInputStream(storing.temp)
      } catch (_: IOException) {
        // Renamed into the entry, or deleted, just now: the flight is ending.
        synchronized(lock) { while (stored == null) lock.wait() }
        return null
      }
      return Tail(storing, input)
    }

    /** A follower's view of the body the leader is storing. */
    inner class Tail internal constructor(storing: Writer, private val input: InputStream) : AutoCloseable {
      val status = storing.status
      val headers = storing.headers
      /** The body's `content-length`, when the machine sent one. */
      val expected = storing.expected
      private var position = 0L

      /**
       * Read what the leader has written past this point, waiting for more.
       * @return the count read, or -1 at the end of a stored body.
       * @throws IOException when the fetch failed before the end.
       */
      fun read(buffer: ByteArray): Int {
        val available = synchronized(lock) {
          while (stored == null && size <= position) lock.wait()
          if (size > position) {
            size - position
          } else if (stored == true) {
            return -1
          } else {
            throw IOException("the fetch ended before the body did")
          }
        }
        val count = input.read(buffer, 0, minOf(available, buffer.size.toLong()).toInt())
        if (count < 0) throw IOException("the body file ended early")
        position += count
        return count
      }

      override fun close() = input.close()
    }
  }

  /** A body being stored as it streams through the door; nothing is visible before [commit]. */
  class Writer internal constructor(
    private val dir: File,
    private val name: String,
    internal val status: Int,
    internal val headers: List<Pair<String, String>>,
    internal val expected: Long?,
    private val flight: Flight,
  ) {
    internal val temp = File(dir, "$name.${suffix()}.tmp")
    private var out: FileOutputStream? = try {
      FileOutputStream(temp)
    } catch (_: IOException) {
      null
    }
    /** Body bytes stored so far. */
    var size = 0L
      private set
    @Volatile private var wroteAt = SystemClock.elapsedRealtime()

    /** Whether it is still storing: the temp file opened, and nothing gave up yet. */
    val open: Boolean @Synchronized get() = out != null

    /** Milliseconds since the last byte arrived (or since it started). */
    fun idleMs(): Long = SystemClock.elapsedRealtime() - wroteAt

    /** Never throws: a full disk must not break the page. Past [ENTRY_MAX_BYTES] it stops storing. */
    @Synchronized
    fun write(buffer: ByteArray, offset: Int, length: Int) {
      val sink = out ?: return
      wroteAt = SystemClock.elapsedRealtime()
      if (size + length > ENTRY_MAX_BYTES) {
        Log.d(TAG, "unstored $name: larger than $ENTRY_MAX_BYTES bytes")
        return abandon()
      }
      try {
        sink.write(buffer, offset, length)
        size += length
        flight.grew(size)
      } catch (_: IOException) {
        abandon()
      }
    }

    /** @param complete - the whole body arrived from the machine. */
    @Synchronized
    fun commit(complete: Boolean) {
      val sink = out ?: return
      out = null
      try {
        if (!complete || (expected != null && size != expected)) throw IOException("incomplete body")
        sink.fd.sync()
        sink.close()
        place(dir, name, temp, status, headers, size)
        flight.settle(true)
      } catch (_: IOException) {
        runCatching { sink.close() }
        temp.delete()
        flight.settle(false)
      }
    }

    /** Stop storing: the temp file goes, and the followers' connections are closed. */
    @Synchronized
    fun abandon() {
      val sink = out ?: return
      out = null
      runCatching { sink.close() }
      temp.delete()
      flight.settle(false)
    }
  }

  /**
   * Start storing a storable response the flight's leader got; its followers
   * read it from now on.
   * @return the writer, or null when the cache is not open or the file cannot be written.
   */
  @Synchronized
  fun writer(flight: Flight, machine: String, target: String, response: HttpHead): Writer? {
    val top = root ?: return null
    val dir = File(top, machineDir(machine)).apply { mkdirs() }
    val kept = KEPT_HEADERS.mapNotNull { field -> response[field]?.let { field to it } }
    val expected = response["content-length"]?.toLongOrNull()
    if (expected != null && expected > ENTRY_MAX_BYTES) return null
    val writer = Writer(dir, entryName(machine, target), response.status, kept, expected, flight)
    if (!writer.open) return null
    flight.started(writer)
    return writer
  }

  /**
   * Store the body [Pieces] put together for a batch, as the flight's leader:
   * the stored [pieces] in order, then [tail]. Unlike a [writer]'s, its
   * followers see none of it before it is stored, and it is stored only when
   * it is [size] bytes with this [sha256].
   * @return whether it is stored.
   */
  fun assemble(
    flight: Flight,
    machine: String,
    target: String,
    headers: List<Pair<String, String>>,
    pieces: List<String>,
    tail: ByteArray,
    size: Long,
    sha256: String,
  ): Boolean {
    val top = root ?: return false
    if (size > ENTRY_MAX_BYTES) return false
    val dir = File(top, machineDir(machine)).apply { mkdirs() }
    val name = entryName(machine, target)
    val temp = File(dir, "$name.${suffix()}.tmp")
    return try {
      val digest = MessageDigest.getInstance("SHA-256")
      var written = 0L
      FileOutputStream(temp).use { out ->
        val buffer = ByteArray(64 * 1024)
        for (piece in pieces) {
          (openPiece(piece) ?: throw IOException("piece $piece is gone")).use { input ->
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              written += count
              if (written > size) throw IOException("longer than the batch")
              out.write(buffer, 0, count)
              digest.update(buffer, 0, count)
            }
          }
        }
        out.write(tail)
        digest.update(tail)
        written += tail.size
        if (written != size || hex(digest.digest()) != sha256) throw IOException("not the batch's bytes")
        out.fd.sync()
      }
      place(dir, name, temp, 200, headers, size)
      flight.settle(true)
      true
    } catch (_: IOException) {
      temp.delete()
      false
    }
  }

  @Synchronized
  fun hasPiece(sha256: String): Boolean = entries.containsKey("$PIECES/$sha256")

  /**
   * Store a piece: the first [size] bytes of [source], when their SHA-256 is [sha256].
   * @return whether it is stored.
   */
  fun storePiece(sha256: String, size: Long, source: InputStream): Boolean {
    val dir = File(root ?: return false, PIECES).apply { mkdirs() }
    if (size > ENTRY_MAX_BYTES) return false
    val temp = File(dir, "$sha256.${suffix()}.tmp")
    return try {
      val digest = MessageDigest.getInstance("SHA-256")
      FileOutputStream(temp).use { out ->
        val buffer = ByteArray(64 * 1024)
        var left = size
        while (left > 0) {
          val count = source.read(buffer, 0, minOf(left, buffer.size.toLong()).toInt())
          if (count < 0) throw IOException("the piece ended early")
          out.write(buffer, 0, count)
          digest.update(buffer, 0, count)
          left -= count
        }
        if (hex(digest.digest()) != sha256) throw IOException("not the piece's bytes")
        out.fd.sync()
      }
      place(dir, sha256, temp, 200, emptyList(), size)
      true
    } catch (_: IOException) {
      temp.delete()
      false
    }
  }

  /** @return a stored piece, opened and marked recently used; null when it is not stored. */
  @Synchronized
  private fun openPiece(sha256: String): InputStream? {
    val entry = entries["$PIECES/$sha256"] ?: return null
    val dir = File(root, PIECES)
    return try {
      FileInputStream(File(dir, "$sha256.body")).also {
        File(dir, "$sha256.json").setLastModified(System.currentTimeMillis())
      }
    } catch (_: IOException) {
      forget(entry)
      null
    }
  }

  /**
   * Move a synced body into place as entry [name] of [dir], then its
   * metadata, and count it.
   * @throws IOException when a file cannot be written or renamed.
   */
  private fun place(dir: File, name: String, temp: File, status: Int, headers: List<Pair<String, String>>, size: Long) {
    if (!temp.renameTo(File(dir, "$name.body"))) throw IOException("rename failed")
    val list = JSONArray()
    headers.forEach { (field, value) -> list.put(JSONArray().put(field).put(value)) }
    val json = JSONObject().put("status", status).put("headers", list).put("size", size).toString().toByteArray()
    val metaTemp = File(dir, "$name.json.${suffix()}.tmp")
    FileOutputStream(metaTemp).use { meta ->
      meta.write(json)
      meta.fd.sync()
    }
    if (!metaTemp.renameTo(File(dir, "$name.json"))) throw IOException("rename failed")
    added(Entry(dir.name, name, status, headers, size, size + json.size))
  }

  @Synchronized
  private fun added(entry: Entry) {
    entries.remove("${entry.dir}/${entry.name}")?.let { bytes -= it.bytes }
    entries["${entry.dir}/${entry.name}"] = entry
    bytes += entry.bytes
    evict()
  }

  private fun evict() {
    val iterator = entries.values.iterator()
    while (bytes > MAX_BYTES && iterator.hasNext()) {
      val entry = iterator.next()
      iterator.remove()
      bytes -= entry.bytes
      val dir = File(root, entry.dir)
      // `.json` first: a body left alone by a crash is no entry.
      File(dir, "${entry.name}.json").delete()
      File(dir, "${entry.name}.body").delete()
    }
  }

  private fun forget(entry: Entry) {
    if (entries.remove("${entry.dir}/${entry.name}") != null) bytes -= entry.bytes
  }

  /** The boot graph revision whose resources were all prefetched, or null. */
  @Synchronized
  fun rev(machine: String): String? {
    val file = File(File(root ?: return null, machineDir(machine)), REV_FILE)
    return if (file.isFile) file.readText() else null
  }

  @Synchronized
  fun setRev(machine: String, rev: String) {
    val dir = File(root ?: return, machineDir(machine)).apply { mkdirs() }
    File(dir, REV_FILE).writeText(rev)
  }

  /** Delete the entries of machines that are no longer in the list. */
  @Synchronized
  fun retain(ids: Set<String>) {
    val top = root ?: return
    val keep = ids.map(::machineDir).toSet()
    for (dir in top.listFiles().orEmpty()) {
      if (dir.name in keep || dir.name == PIECES) continue
      entries.values.filter { it.dir == dir.name }.forEach(::forget)
      dir.deleteRecursively()
      Log.i(TAG, "dropped machine dir=${dir.name}")
    }
  }

  private val random = SecureRandom()

  private fun suffix(): String = java.lang.Long.toHexString(random.nextLong())
}

/** `cache-control` of a response that never changes at its URL. */
const val IMMUTABLE = "public, max-age=31536000, immutable"

/**
 * A Vite build output, `/assets/[<dir>/…]<name>-<hash>.<ext>`: the same
 * pattern as `HASHED_ASSET` in packages/kivotos/src/cache.ts.
 */
val HASHED_ASSET = Regex("""^/assets/(?:[\w.-]+/)*[\w.-]+-(?=[\w-]{0,7}[A-Z\d])[\w-]{8}\.[A-Za-z\d]+$""")

/**
 * The one encoding variant stored. Cacheable requests go upstream with
 * exactly this `accept-encoding` (dsh negotiates only gzip and identity).
 */
const val VARIANT = "gzip"

/** Response headers an entry keeps and a hit replays. */
val KEPT_HEADERS = listOf(
  "content-type",
  "content-encoding",
  "cache-control",
  "vary",
  "etag",
  "last-modified",
  "x-content-type-options",
)

/** Whether an `accept-encoding` value admits gzip (RFC 9110 §12.5.3). */
fun acceptsGzip(header: String?): Boolean {
  if (header == null) return false
  var any = false
  for (part in header.split(',')) {
    val items = part.split(';').map { it.trim().lowercase() }
    val coding = items.first()
    val weight = items.drop(1).firstOrNull { it.startsWith("q=") }
    val allowed = weight == null || (weight.substring(2).toDoubleOrNull() ?: 0.0) > 0
    if (coding == "gzip" || coding == "x-gzip") return allowed
    if (coding == "*") any = allowed
  }
  return any
}

/** Whether a request may be answered from, and stored in, the cache. */
fun cacheableRequest(head: HttpHead): Boolean =
  head.method == "GET" &&
    !head.has("range") &&
    !head.has("upgrade") &&
    !head["accept"].orEmpty().contains("text/html", ignoreCase = true) &&
    acceptsGzip(head["accept-encoding"])

/** Content-hashed assets a machine sends without caching headers get the immutable ones. */
fun markImmutable(target: String, response: HttpHead) {
  if (response.status == 200 && !response.has("cache-control") && HASHED_ASSET.matches(target.substringBefore('?'))) {
    response["cache-control"] = IMMUTABLE
  }
}

/** Whether a response is the same for every caller and never changes at its URL. */
fun storable(response: HttpHead): Boolean {
  if (response.status != 200 || response.has("set-cookie")) return false
  val control = response["cache-control"].orEmpty().lowercase()
  if (!Regex("""\bimmutable\b""").containsMatchIn(control) || Regex("""\b(?:no-store|no-cache|private)\b""").containsMatchIn(control)) {
    return false
  }
  return HttpHead.tokens(response["vary"]).all { it == "accept-encoding" }
}

/** The entry file name: machine, encoding variant and full target with query. */
fun entryName(machine: String, target: String): String = sha256Hex("$machine\n$VARIANT\n$target").take(40)

/** The directory of a machine's entries; machine ids are URLs, so they are hashed into one safe segment. */
fun machineDir(machine: String): String = sha256Hex(machine).take(32)

private fun sha256Hex(text: String): String =
  hex(MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)))

/** Lowercase hexadecimal, as the computer writes SHA-256 digests. */
fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
