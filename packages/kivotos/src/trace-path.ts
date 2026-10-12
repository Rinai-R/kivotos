/**
 * Request targets as the trace log writes them. No Node imports: the Host
 * trace (`trace.ts`, `index.ts`) and the page's load report (`client.tsx`)
 * share it, so one resource reads the same in a `peer.http` and a `client`
 * record.
 */

/** dsh's revision parameter, when it looks like one (`plugins/??…&rev=<hex>`). */
const REV = /(?:^|[?&])rev=([\w.-]{1,64})(?:&|$)/;

/**
 * Path of a request target with a fingerprint in place of its query. The
 * query can carry a login token, so it is never written; the fingerprint
 * keeps dsh's `rev` value, the query's length and a 32-bit FNV-1a hash of it,
 * enough to tell two `plugins/??…` batches apart.
 * @param url - request target, e.g. `/plugins/??a/client.js&rev=1f2e`.
 * @returns e.g. `/plugins/?{rev=1f2e len=20 h=0c6d1f9a}`; the bare path when there is no query.
 */
export function tracePath(url: string): string {
  const at = url.indexOf("?");
  if (at === -1) return url;
  const query = url.slice(at + 1);
  const rev = REV.exec(query)?.[1];
  const revPart = rev === undefined ? "" : `rev=${rev} `;
  return `${url.slice(0, at)}?{${revPart}len=${query.length} h=${fnv1a(query)}}`;
}

/** FNV-1a over UTF-16 code units, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
