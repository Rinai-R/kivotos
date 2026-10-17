/**
 * The audio formats Kivotos' document renderer plays, and the MIME type each
 * one is handed to a Blob URL with.
 *
 * dsh's own preview lists these suffixes as unviewable binary files; a
 * registered renderer takes precedence, so the same registry that shows text
 * and images shows audio too. Only formats a browser can play are listed:
 * a `.wma` file keeps dsh's unsupported state instead of a player that cannot
 * start.
 *
 * No Node imports: the Client bundle includes this module.
 */

/** Suffixes the audio renderer claims, without a leading dot. */
export const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "flac",
  "ogg",
  "oga",
  "m4a",
  "aac",
  "opus",
  "weba",
] as const;

/** The Blob type of each suffix above. */
const AUDIO_TYPES: Record<(typeof AUDIO_EXTENSIONS)[number], string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/ogg",
  weba: "audio/webm",
};

/**
 * Read the MIME type of an audio path.
 * @param path - a decoded path or a resource address ending in the file name.
 * @returns the Blob type for a claimed suffix, otherwise "".
 */
export function audioMimeOf(path: string): string {
  // Query and fragment belong to a URL, not to the file name.
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? "";
  const name = withoutQuery.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  const suffix = name.slice(dot + 1).toLowerCase();
  if (!Object.hasOwn(AUDIO_TYPES, suffix)) return "";
  return AUDIO_TYPES[suffix as keyof typeof AUDIO_TYPES];
}
