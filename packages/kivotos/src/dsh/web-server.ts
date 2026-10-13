/**
 * dsh 0.2.0-rc.2's webServer, as Kivotos proxies it: its own API paths and the
 * naming of the build assets it serves.
 *
 * Nothing here is probed at run time. A renamed path or a new asset naming
 * degrades by itself (a mount that cannot stream, an asset that is not
 * cached); the nightly check (scripts/dsh-compat.mjs) catches it first.
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

/** Strings the nightly check expects in dsh's bundles (scripts/dsh-compat.mjs). */
export const MARKERS = ["remote.mux"];
