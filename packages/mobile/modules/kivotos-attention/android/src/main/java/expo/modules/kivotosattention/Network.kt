package expo.modules.kivotosattention

import android.net.Uri
import android.util.Base64
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * A relay federation as this phone knows it: the values derived from the
 * shared key, and the proof members give each other. The same derivations as
 * the dsh plugin (packages/kivotos/src/federation.ts) and the contract in
 * packages/relay/wire/wire.go.
 */
class Network private constructor(
  /** Relay WebSocket endpoint, e.g. `wss://relay.example.com/v1/connect`. */
  val endpoint: String,
  /** The federation key, base64url. Never sent to the relay. */
  val key: String,
  secret: ByteArray,
) {
  /** Public name of the network on the relay. */
  val id: String = b64(hkdf(secret, "kivotos network id", 16))

  /** Shown to the relay in every hello; says "may use this relay", nothing more. */
  val token: String = b64(hkdf(secret, "kivotos relay token", 32))

  private val proofKey: ByteArray = hkdf(secret, "kivotos peer proof", 32)

  /**
   * The proof one side of a member-to-member TLS session gives the other,
   * bound to both certificates of that session.
   */
  fun proof(role: String, serverNode: String, clientNode: String): ByteArray {
    val mac = Mac.getInstance(HMAC)
    mac.init(SecretKeySpec(proofKey, HMAC))
    return mac.doFinal("kivotos-peer-v1\n$role\n$serverNode\n$clientNode".toByteArray(Charsets.UTF_8))
  }

  companion object {
    private const val HMAC = "HmacSHA256"
    const val PROOF_BYTES = 32

    fun b64(bytes: ByteArray): String =
      Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    /** A node id: the SHA-256 of the certificate a member presents. */
    fun nodeId(certificate: ByteArray): String =
      b64(MessageDigest.getInstance("SHA-256").digest(certificate))

    /** HKDF-SHA256 without salt, for outputs of at most one block. */
    private fun hkdf(secret: ByteArray, info: String, length: Int): ByteArray {
      val mac = Mac.getInstance(HMAC)
      // "No salt" is a salt of zeros; an empty HMAC key is the same key.
      mac.init(SecretKeySpec(ByteArray(32), HMAC))
      val prk = mac.doFinal(secret)
      mac.init(SecretKeySpec(prk, HMAC))
      mac.update(info.toByteArray(Charsets.UTF_8))
      mac.update(1.toByte())
      return mac.doFinal().copyOf(length)
    }

    /** @throws IllegalArgumentException when the endpoint or key is malformed. */
    fun of(endpoint: String, key: String): Network {
      val secret = try {
        Base64.decode(key, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
      } catch (_: IllegalArgumentException) {
        ByteArray(0)
      }
      require(secret.size == 32) { "invite" }
      val scheme = Uri.parse(endpoint).scheme
      require(scheme == "ws" || scheme == "wss") { "invite" }
      return Network(endpoint, key, secret)
    }

    /**
     * @param invite `kivotos://join?relay=<endpoint>&key=<key>`, as dsh shows it.
     * @throws IllegalArgumentException when it is not such a link.
     */
    fun parseInvite(invite: String): Network {
      val uri = Uri.parse(invite.trim())
      val relay = uri.getQueryParameter("relay")
      val key = uri.getQueryParameter("key")
      require(uri.scheme == "kivotos" && uri.host == "join" && relay != null && key != null) { "invite" }
      return of(relay, key)
    }
  }
}
