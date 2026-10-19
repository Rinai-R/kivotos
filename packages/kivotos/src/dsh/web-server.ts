/**
 * dsh 0.2.1-rc.2's webServer, as Kivotos proxies it: its own API paths, the
 * naming of the build assets it serves, and how it puts its plugin batches
 * together.
 *
 * Nothing here is probed at run time. A renamed path or a new asset naming
 * degrades by itself (a mount that cannot stream, an asset that is not
 * cached); the nightly check (scripts/dsh-compat.mjs) catches it first. A
 * batch made another way gets no piece manifest: each one is checked against
 * the bytes dsh serves before it is offered.
 */

/** The remote multiplexer WebSocket a page opens to its Host (dsh-api-gateway). */
export const REMOTE_MUX_PATH = "/api/remote.mux";

/**
 * A Vite build output, `/assets/[<dir>/…]<name>-<hash>.<ext>`, the hash being
 * Rollup's 8 base64url characters. One of them must be an uppercase letter or
 * a digit, which keeps kebab-case names such as `/assets/vue-language.js` out;
 * a real hash lacks both with probability (28/64)^8 ≈ 0.1%, and its file is then
 * merely not cached.
 */
export const HASHED_ASSET =
  /^\/assets\/(?:[\w.-]+\/)*[\w.-]+-(?=[\w-]{0,7}[A-Z\d])[\w-]{8}\.[A-Za-z\d]+$/;

/** `src` and `href` attributes naming a build asset, document-relative or root-relative. */
const ASSET_REF = /\s(?:src|href)="(?:\.\/|\/)?(assets\/[^"?#]+)"/g;

/**
 * @param html - an index page.
 * @returns the root-relative content-hashed assets it links.
 */
export function hashedAssetsOf(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(ASSET_REF)) {
    const target = `/${match[1]}`;
    if (HASHED_ASSET.test(target)) out.push(target);
  }
  return out;
}

/**
 * A plugin batch request target, root-relative (dsh-client-modules
 * `comboUrl`): `/plugins/??<id>/client.js,…&rev=<rev>`. A row's own URL
 * (`entries[].url` of the boot graph) is a batch of that one row.
 */
export const PLUGIN_BATCH = /^\/plugins\/\?\?[^?#&]+&rev=[\w.-]+$/;

/** How a batch script ends: one source-map line for the whole body. */
const MAP_LINE = "//# sourceMappingURL=";

/**
 * Split a batch script into its rows and its source-map line. dsh writes a
 * batch (dsh-client-modules `buildComboScript`) as each row's bundle, its own
 * trailers removed, as `<source>;\n`, then `//# sourceMappingURL=<map>\n`
 * naming the batch's own map. A row's own URL serves the same with only that
 * row in it, so a batch is its rows' bodies without their last line, followed
 * by its own last line.
 * @param body - a batch script as dsh serves it, not content-encoded.
 * @returns the rows' bytes and the source-map line; undefined when the body
 * does not end in one.
 */
export function splitMapLine(body: Buffer): { rows: Buffer; tail: Buffer } | undefined {
  if (body.length === 0 || body[body.length - 1] !== 0x0a) return undefined;
  const start = body.lastIndexOf(0x0a, body.length - 2) + 1;
  if (body.toString("latin1", start, start + MAP_LINE.length) !== MAP_LINE) return undefined;
  return { rows: body.subarray(0, start), tail: body.subarray(start) };
}

/** Strings the nightly check expects in dsh's bundles (scripts/dsh-compat.mjs). */
export const MARKERS = ["remote.mux"];
