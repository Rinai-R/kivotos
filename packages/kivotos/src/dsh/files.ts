/**
 * dsh 0.2.1-rc.2's session-scoped file resource address, as the Files action
 * opens one.
 *
 * dsh names a previewable file `dsh-resource://file/session/<session>/<path>`
 * (`@deepseek-ai/dsh-util-workspace-path` `sessionFileAddress`): the session id
 * and each `/`-separated path segment are component-encoded, a colon stays
 * literal for a drive letter, and backslashes are normalized to `/`. A path
 * relative to the workspace is sent as-is; an absolute path keeps its leading
 * `/`, which leaves an empty first segment. The document preview reads either
 * through the Session's filesystem, including an absolute path outside the
 * workspace.
 *
 * The grammar is pinned to the release and not probed at run time: a wrong
 * address only makes that one tab fail to open, and the nightly check
 * (scripts/dsh-compat.mjs) reports a missing prefix first.
 *
 * No Node imports: the Client bundle includes this module.
 */

const PREFIX = "dsh-resource://file/session/";

/**
 * Component-encode one id or path segment; a colon stays literal for `C:`.
 * @param segment - one decoded segment.
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ":");
}

/**
 * Build the address that opens one file in the document preview.
 * @param sessionId - the Session whose filesystem resolves the path.
 * @param path - absolute or workspace-relative path, in either separator.
 * @returns the `dsh-resource://file/session/<session>/<path>` address.
 */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  return `${PREFIX}${encodeSegment(sessionId)}/${normalized
    .split("/")
    .map(encodeSegment)
    .join("/")}`;
}

/** Strings the nightly check expects in dsh's bundles (scripts/dsh-compat.mjs). */
export const MARKERS = [PREFIX];
