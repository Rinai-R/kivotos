package expo.modules.kivotosattention

import org.json.JSONObject

/** One frame of a machine's `/kivotos/events` stream. */
/** The exact tool call a notification's buttons may decide (#notification-approval). */
data class ApprovalAction(
  val token: String,
  val callId: String,
  val toolName: String,
)

data class AttentionFrame(
  val id: Long,
  val epoch: String,
  val kind: String,
  val sessionId: String,
  val title: String,
  val key: String,
  val detail: String,
  /** Present only when the Host holds this ask for the phone; absent = reminder only. */
  val approval: ApprovalAction? = null,
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
        approval = json.optJSONObject("approval")?.let { action ->
          ApprovalAction(
            token = action.getString("token"),
            callId = action.getString("callId"),
            toolName = action.optString("toolName"),
          )
        },
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
 * phone knows by both links (packages/kivotos/src/machines.ts). [mode] is the
 * link the phone prefers: `tailscale` (the default, the relay when it fails)
 * or `relay` (the tailnet listener when it fails).
 */
data class Machine(
  val id: String,
  val name: String,
  val url: String,
  val relay: String = "",
  val key: String = "",
  val node: String = "",
  val mode: String = TAILSCALE,
) {
  val viaRelay: Boolean get() = relay.isNotEmpty()
  val viaTailnet: Boolean get() = url.isNotEmpty()

  /** Whether any request may go over the relay: the machine has a relay link. */
  val usesRelay: Boolean get() = viaRelay

  fun toJson(): JSONObject {
    val json = JSONObject().put("id", id).put("name", name).put("url", url)
    if (viaRelay) json.put("relay", JSONObject().put("endpoint", relay).put("key", key).put("node", node))
    if (mode != TAILSCALE) json.put("mode", mode)
    return json
  }

  companion object {
    const val TAILSCALE = "tailscale"
    const val RELAY = "relay"

    fun fromJson(json: JSONObject): Machine {
      val relay = json.optJSONObject("relay")
      // A mode written by an older app (`auto`) or unreadable is the default.
      return Machine(
        id = json.getString("id"),
        name = json.getString("name"),
        url = json.optString("url"),
        relay = relay?.optString("endpoint").orEmpty(),
        key = relay?.optString("key").orEmpty(),
        node = relay?.optString("node").orEmpty(),
        mode = if (json.optString("mode") == RELAY) RELAY else TAILSCALE,
      )
    }
  }
}
