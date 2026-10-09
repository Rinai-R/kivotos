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

/** A machine whose events the service follows. */
data class Machine(val id: String, val name: String, val url: String) {
  fun toJson(): JSONObject = JSONObject().put("id", id).put("name", name).put("url", url)

  companion object {
    fun fromJson(json: JSONObject) = Machine(json.getString("id"), json.getString("name"), json.getString("url"))
  }
}
