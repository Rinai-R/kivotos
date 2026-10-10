package expo.modules.kivotosattention

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.Closeable
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.Socket
import java.nio.ByteBuffer
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLEngineResult.HandshakeStatus
import javax.net.ssl.SSLEngineResult.Status
import javax.net.ssl.X509ExtendedTrustManager
import org.json.JSONObject

/** A node of a network that is online, as the relay reports it. */
data class RelayPeer(val node: String, val name: String)

/** The relay answered a hello with an error code (wire.ErrCode*). */
class RelayRefused(val code: String) : IOException("relay refused: $code")

/**
 * This phone's identity towards other members: a P-256 key that never leaves
 * the Android Keystore, with the self-signed certificate the Keystore issues
 * for it. Members identify each other by the certificate's hash and the
 * federation proof, never by the certificate's contents.
 */
object NodeIdentity {
  private const val STORE = "AndroidKeyStore"
  private const val ALIAS = "kivotos-node"

  private val store: KeyStore by lazy {
    KeyStore.getInstance(STORE).apply {
      load(null)
      if (!containsAlias(ALIAS)) {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
          .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
          // TLS signs handshake hashes itself (NONE) or asks for a digest by name.
          .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
          .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, STORE).apply { initialize(spec) }.generateKeyPair()
      }
    }
  }

  /** This phone's node id. */
  val node: String by lazy { Network.nodeId(store.getCertificate(ALIAS).encoded) }

  /** Accepts any certificate: the caller pins the node id and checks the proof. */
  private object AnyCertificate : X509ExtendedTrustManager() {
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) = Unit
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket) = Unit
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket) = Unit
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine) = Unit
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine) = Unit
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
  }

  val tls: SSLContext by lazy {
    val keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(store, null) }
    SSLContext.getInstance("TLS").apply { init(keys.keyManagers, arrayOf(AnyCertificate), null) }
  }
}

/** A secured session to another member: application bytes in and out. */
class RelaySession internal constructor(private val tls: TlsChannel) : Closeable {
  val input: InputStream = object : InputStream() {
    override fun read(): Int {
      val one = ByteArray(1)
      return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = tls.read(buffer, offset, length)
  }

  val output: OutputStream = object : OutputStream() {
    override fun write(byte: Int) = write(byteArrayOf(byte.toByte()), 0, 1)
    override fun write(buffer: ByteArray, offset: Int, length: Int) = tls.write(buffer, offset, length)
  }

  override fun close() = tls.close()
}

/** TLS over a pair of blocking streams, driven with an SSLEngine. */
internal class TlsChannel(private val engine: SSLEngine, private val source: InputStream, private val sink: OutputStream, private val under: Closeable) : Closeable {
  // Read-mode buffers start empty.
  private val netIn = ByteBuffer.allocate(engine.session.packetBufferSize).apply { limit(0) }
  private val appIn = ByteBuffer.allocate(engine.session.applicationBufferSize).apply { limit(0) }
  private val netOut = ByteBuffer.allocate(engine.session.packetBufferSize)
  private val wrapLock = Any()

  fun handshake() {
    engine.beginHandshake()
    while (true) {
      when (engine.handshakeStatus) {
        HandshakeStatus.NEED_WRAP -> wrap(ByteBuffer.allocate(0))
        HandshakeStatus.NEED_TASK -> runTasks()
        HandshakeStatus.FINISHED, HandshakeStatus.NOT_HANDSHAKING -> return
        else -> if (!unwrap()) throw EOFException("connection closed during the TLS handshake")
      }
    }
  }

  private fun runTasks() {
    while (true) (engine.delegatedTask ?: return).run()
  }

  /** One unwrap step, reading more from the stream when needed. @return false at the end. */
  private fun unwrap(): Boolean {
    while (true) {
      appIn.compact()
      val result = engine.unwrap(netIn, appIn)
      appIn.flip()
      when (result.status) {
        Status.OK -> return true
        // Application data is waiting to be read first.
        Status.BUFFER_OVERFLOW -> return true
        Status.CLOSED -> return false
        else -> {
          netIn.compact()
          val count = source.read(netIn.array(), netIn.position(), netIn.remaining())
          if (count > 0) netIn.position(netIn.position() + count)
          netIn.flip()
          if (count < 0) return false
        }
      }
    }
  }

  private fun wrap(data: ByteBuffer) {
    synchronized(wrapLock) {
      do {
        netOut.clear()
        val result = engine.wrap(data, netOut)
        if (result.status == Status.CLOSED && netOut.position() == 0) throw IOException("TLS session is closed")
        sink.write(netOut.array(), 0, netOut.position())
        if (result.handshakeStatus == HandshakeStatus.NEED_TASK) runTasks()
      } while (data.hasRemaining())
      sink.flush()
    }
  }

  fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    while (!appIn.hasRemaining()) {
      if (!unwrap()) return -1
      // Messages after the handshake (key updates) can ask for a reply.
      when (engine.handshakeStatus) {
        HandshakeStatus.NEED_WRAP -> wrap(ByteBuffer.allocate(0))
        HandshakeStatus.NEED_TASK -> runTasks()
        else -> Unit
      }
    }
    val count = minOf(length, appIn.remaining())
    appIn.get(buffer, offset, count)
    return count
  }

  fun write(buffer: ByteArray, offset: Int, length: Int) = wrap(ByteBuffer.wrap(buffer, offset, length))

  fun peerCertificate(): ByteArray = engine.session.peerCertificates.first().encoded

  override fun close() {
    try {
      under.close()
    } catch (_: IOException) {
      // Already closed.
    }
  }
}

/** The member's side of the relay protocol (packages/relay/wire). */
object RelayClient {
  private const val WIRE_VERSION = 2

  /** Longest relay reply line: a full node list (wire.MaxLine). */
  private const val MAX_LINE = 16 * 1024

  private fun hello(network: Network, role: String, fields: Map<String, String> = emptyMap()): Pair<WsStream, JSONObject> {
    val stream = WsStream.open(network.endpoint)
    try {
      val message = JSONObject()
        .put("v", WIRE_VERSION)
        .put("role", role)
        .put("network", network.id)
        .put("token", network.token)
        .put("node", NodeIdentity.node)
      fields.forEach { (name, value) -> message.put(name, value) }
      stream.output.write((message.toString() + "\n").toByteArray(Charsets.UTF_8))
      val reply = JSONObject(readLine(stream.input))
      if (!reply.optBoolean("ok")) throw RelayRefused(reply.optString("error", "unknown"))
      return stream to reply
    } catch (failure: Exception) {
      stream.close()
      throw failure
    }
  }

  /** Read one line, byte by byte: nothing behind the newline may be consumed. */
  private fun readLine(source: InputStream): String {
    val line = java.io.ByteArrayOutputStream()
    while (true) {
      val byte = source.read()
      if (byte < 0) throw EOFException("the relay closed the connection")
      if (byte == '\n'.code) return line.toString("UTF-8")
      line.write(byte)
      if (line.size() > MAX_LINE) throw IOException("the relay's reply is too long")
    }
  }

  /** @return the computers of the network that are online. */
  fun peers(network: Network): List<RelayPeer> {
    val (stream, reply) = hello(network, "peers")
    stream.close()
    val list = reply.optJSONArray("peers") ?: return emptyList()
    return List(list.length()) { list.getJSONObject(it) }
      .map { RelayPeer(it.getString("node"), it.optString("name")) }
  }

  /**
   * Open a secured session to a computer: a relay stream, TLS 1.3 with both
   * certificates, the computer's certificate pinned by node id, then the
   * federation proofs. The relay sees none of what follows.
   */
  fun dial(network: Network, target: String): RelaySession {
    val (stream, _) = hello(network, "dial", mapOf("target" to target))
    try {
      val engine = NodeIdentity.tls.createSSLEngine().apply {
        useClientMode = true
        enabledProtocols = arrayOf("TLSv1.3")
      }
      val tls = TlsChannel(engine, stream.input, stream.output, stream)
      tls.handshake()
      val serverNode = Network.nodeId(tls.peerCertificate())
      if (serverNode != target) throw IOException("the relay connected a different computer")
      val clientNode = NodeIdentity.node
      val proof = network.proof("client", serverNode, clientNode)
      tls.write(proof, 0, proof.size)
      val answer = ByteArray(Network.PROOF_BYTES)
      var read = 0
      while (read < answer.size) {
        val count = tls.read(answer, read, answer.size - read)
        if (count < 0) throw IOException("the computer is not a member of this network")
        read += count
      }
      if (!MessageDigest.isEqual(answer, network.proof("server", serverNode, clientNode))) {
        throw IOException("the computer is not a member of this network")
      }
      return RelaySession(tls)
    } catch (failure: Exception) {
      stream.close()
      throw failure
    }
  }
}
