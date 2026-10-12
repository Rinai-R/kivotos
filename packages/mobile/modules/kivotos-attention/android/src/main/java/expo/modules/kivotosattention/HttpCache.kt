package expo.modules.kivotosattention

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch

/**
 * The phone's disk cache of machine responses that never change at their URL,
 * with the rules of the computer-side mount cache (packages/kivotos/src/cache.ts):
 * a GET without `Range`, not a navigation, from a client that accepts gzip,
 * answered 200 without `Set-Cookie`, with `Vary` at most `Accept-Encoding`, and
 * `immutable` in its `cache-control` without `no-store`/`no-cache`/`private`
 * (dsh's revisioned plugin batches, and content-hashed Vite assets).
 *
 * An entry is `<name>.body` (the body as received, gzip when the machine
 * compressed it) and `<name>.json` (status, replayed headers, size), under one
 * directory per machine in the app's cache directory. Both are written to temp
 * files, synced and renamed, `.json` last; [init] deletes whatever is not a
 * complete entry. Least recently used entries go past [MAX_BYTES].
 */
object HttpCache {
  private const val TAG = "KivotosCache"

  /**
   * Cap over all machines. The computer-side cache's default: a dsh 0.2.0-rc.2
   * client is about 6 MB and its batches change with every dsh launch, so this
   * holds several revisions of several machines while staying a small share of
   * a phone's storage. Android may also reclaim the cache directory itself.
   */
  const val MAX_BYTES = 256L * 1024 * 1024

  private const val ROOT = "kivotos-http"
  private const val REV_FILE = "rev"
  private const val FLIGHT_WAIT_MS = 120_000L

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
  /** Misses being fetched, by entry key; others wait on the latch. */
  private val flights = HashMap<String, CountDownLatch>()

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

  /** @return the stored response for this request target of this machine, marked recently used. */
  @Synchronized
  fun lookup(machine: String, target: String): Pair<Entry, File>? {
    val top = root ?: return null
    val entry = entries["${machineDir(machine)}/${entryName(machine, target)}"] ?: return null
    val body = File(File(top, entry.dir), "${entry.name}.body")
    if (!body.isFile) {
      // Android reclaimed the cache directory under us.
      forget(entry)
      return null
    }
    File(File(top, entry.dir), "${entry.name}.json").setLastModified(System.currentTimeMillis())
    return entry to body
  }

  @Synchronized
  fun has(machine: String, target: String): Boolean = entries.containsKey("${machineDir(machine)}/${entryName(machine, target)}")

  /**
   * Claim the fetch of a miss.
   * @return null when the caller now owns it (and must [release] it), else a latch that opens when the owner is done.
   */
  @Synchronized
  fun claim(machine: String, target: String): CountDownLatch? {
    val key = "${machineDir(machine)}/${entryName(machine, target)}"
    flights[key]?.let { return it }
    flights[key] = CountDownLatch(1)
    return null
  }

  @Synchronized
  fun release(machine: String, target: String) {
    flights.remove("${machineDir(machine)}/${entryName(machine, target)}")?.countDown()
  }

  /** Wait for another request's fetch of the same entry. */
  fun await(latch: CountDownLatch) {
    latch.await(FLIGHT_WAIT_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
  }

  /** A body being stored as it streams to the WebView; nothing is visible before [commit]. */
  class Writer internal constructor(
    private val dir: File,
    private val name: String,
    private val status: Int,
    private val headers: List<Pair<String, String>>,
    private val expected: Long?,
  ) {
    private val temp = File(dir, "$name.${suffix()}.tmp")
    private var out: FileOutputStream? = try {
      FileOutputStream(temp)
    } catch (_: IOException) {
      null
    }
    private var size = 0L

    /** Never throws: a full disk must not break the page. */
    fun write(buffer: ByteArray, offset: Int, length: Int) {
      val sink = out ?: return
      try {
        sink.write(buffer, offset, length)
        size += length
      } catch (_: IOException) {
        abandon()
      }
    }

    /** @param complete - the whole body passed through to the WebView. */
    fun commit(complete: Boolean) {
      val sink = out ?: return
      out = null
      try {
        if (!complete || (expected != null && size != expected)) throw IOException("incomplete body")
        sink.fd.sync()
        sink.close()
        val body = File(dir, "$name.body")
        if (!temp.renameTo(body)) throw IOException("rename failed")
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
      } catch (_: IOException) {
        runCatching { sink.close() }
        temp.delete()
      }
    }

    fun abandon() {
      val sink = out ?: return
      out = null
      runCatching { sink.close() }
      temp.delete()
    }
  }

  /** @return a writer for a storable response, or null when the cache is not open. */
  @Synchronized
  fun writer(machine: String, target: String, response: HttpHead): Writer? {
    val top = root ?: return null
    val dir = File(top, machineDir(machine)).apply { mkdirs() }
    val kept = KEPT_HEADERS.mapNotNull { field -> response[field]?.let { field to it } }
    val expected = response["content-length"]?.toLongOrNull()
    return Writer(dir, entryName(machine, target), response.status, kept, expected)
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
      if (dir.name in keep) continue
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
  MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
