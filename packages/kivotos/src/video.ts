/**
 * The video formats Kivotos' document renderer plays, and the MIME type each
 * one is handed to a Blob URL with.
 *
 * dsh's own preview lists the common video containers as unviewable binary
 * files; a registered renderer takes precedence, so the same registry that
 * shows text and images shows video too. Only containers a browser can
 * usually play are listed; codec support still varies by browser (an H.264
 * MP4 and a VP9 WebM are not equally portable), so a failed decode keeps the
 * renderer's own unsupported message instead of a player that cannot start.
 *
 * No Node imports: the Client bundle includes this module.
 */

/** Suffixes the video renderer claims, without a leading dot. */
export const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "ogv"] as const;

/** The Blob type of each suffix above. */
const VIDEO_TYPES: Record<(typeof VIDEO_EXTENSIONS)[number], string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
};

/**
 * Read the MIME type of a video path.
 * @param path - a decoded path or a resource address ending in the file name.
 * @returns the Blob type for a claimed suffix, otherwise "".
 */
export function videoMimeOf(path: string): string {
  // Query and fragment belong to a URL, not to the file name.
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? "";
  const name = withoutQuery.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  const suffix = name.slice(dot + 1).toLowerCase();
  if (!Object.hasOwn(VIDEO_TYPES, suffix)) return "";
  return VIDEO_TYPES[suffix as keyof typeof VIDEO_TYPES];
}
