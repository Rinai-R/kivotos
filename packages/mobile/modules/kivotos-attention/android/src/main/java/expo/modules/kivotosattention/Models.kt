package expo.modules.kivotosattention

import org.json.JSONObject

/** One frame of a machine's `/kivotos/events` stream. */
data class AttentionFrame(
  val id: Long,
  val epoch: String,
  val kind: String,
  val sessionId: String,
  val title: String,
  val key: String,
  val detail: String,
) {
  companion object {
    /** @return the frame, or null for malformed data (never thrown into the stream loop). */
    fun parse(data: String): AttentionFrame? = try {
      val json = JSONObject(data)
      AttentionFrame(
        id = json.getLong("id"),
        epoch = json.getString("epoch"),
        kind = json.getString("kind"),
        sessionId = json.getString("sessionId"),
        title = json.optString("title"),
        key = json.getString("key"),
        detail = json.optString("detail"),
      )
    } catch (_: Exception) {
      null
    }
  }
}

/**
 * A machine whose events the service follows. It is reached directly at
 * [url] (its tailnet listener), through a relay as node [node] of the network
 * with federation key [key] when [relay] is set, or both: one computer the
 * phone knows by both links (packages/kivotos/src/machines.ts). [mode] is
 * how the phone reaches it: `auto`, `tailscale` or `relay`.
 */
data class Machine(
  val id: String,
  val name: String,
  val url: String,
  val relay: String = "",
  val key: String = "",
  val node: String = "",
  val mode: String = AUTO,
) {
  val viaRelay: Boolean get() = relay.isNotEmpty()
  val viaTailnet: Boolean get() = url.isNotEmpty()

  /**
   * The one link the mode holds the machine to (`pinnedVia` in machines.ts):
   * null in auto, and for a machine with one link, which has nothing to choose.
   */
  val pinned: String? get() = mode.takeIf { viaRelay && viaTailnet && (it == TAILSCALE || it == RELAY) }

  /** Whether any request may go over the relay: it has a relay link and is not held to Tailscale. */
  val usesRelay: Boolean get() = viaRelay && pinned != TAILSCALE

  fun toJson(): JSONObject {
    val json = JSONObject().put("id", id).put("name", name).put("url", url)
    if (viaRelay) json.put("relay", JSONObject().put("endpoint", relay).put("key", key).put("node", node))
    if (mode != AUTO) json.put("mode", mode)
    return json
  }

  companion object {
    const val AUTO = "auto"
    const val TAILSCALE = "tailscale"
    const val RELAY = "relay"

    fun fromJson(json: JSONObject): Machine {
      val relay = json.optJSONObject("relay")
      return Machine(
        id = json.getString("id"),
        name = json.getString("name"),
        url = json.optString("url"),
        relay = relay?.optString("endpoint").orEmpty(),
        key = relay?.optString("key").orEmpty(),
        node = relay?.optString("node").orEmpty(),
        mode = json.optString("mode").takeIf { it == TAILSCALE || it == RELAY } ?: AUTO,
      )
    }
  }
}
