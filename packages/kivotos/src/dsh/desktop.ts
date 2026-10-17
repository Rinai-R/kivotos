/**
 * The dsh 0.2.1-rc.2 desktop shell, as a mounted machine's page meets it.
 *
 * The shell (`apps/desktop/src/preload-app.ts`) exposes `dshDesktopBoot` to
 * every page of its `dsh-app://app` origin. dsh's web entry
 * (`apps/web/src/main.ts`), finding it, asks `ready()` for the local Host's
 * boot rows and `streamBaseUrl`, installs them as `__DSH_TRANSPORT__`, then
 * settles `__DSH_BOOT_READY__`. On another machine's page that races its own
 * boot (#3).
 *
 * No Node imports: the Client bundle includes this module.
 */
import { changed, injectHead, missing, ok, type Probe } from "./compat.ts";
import { BOOT_GATE, probeBootGate, TRANSPORT_GLOBAL, type Rewritten } from "./index-html.ts";

/** The desktop app's scheme for its own pages. */
export const DESKTOP_SCHEME = "dsh-app:";

/** The global the desktop shell exposes its boot handshake as. */
const BRIDGE = "dshDesktopBoot";
/** The field of the handshake's answer the guard rebases under a mount. */
const STREAM_BASE = "streamBaseUrl";

/**
 * Keep the desktop app's own boot out of a mounted peer page.
 *
 * The guard runs before every other page script. It takes the desktop
 * handshake itself, keeps only its Host origin and rebases the WebSocket under
 * this mount, so the streams reach the peer through it. It holds the page's
 * boot until the handshake settles, and refuses the web entry's own transport,
 * which stops the entry before it applies the local rows. Without the bridge
 * (browser, phone) it does nothing.
 *
 * The guard is always installed; the probe of the boot gate it replaces is
 * half of point `desktop-boot`, whose failure keeps the desktop window from
 * opening other machines at all (client.tsx).
 * @param html - peer index html.
 * @param prefix - the mount's path prefix, e.g. `/kivotos/peer/<id>`.
 * @returns html with the guard first in its head.
 */
export function guardDesktopBoot(html: string, prefix: string): Rewritten {
  // `<` is escaped so the prefix cannot close the script element.
  const mount = JSON.stringify(`${prefix}/`).replaceAll("<", "\\u003c");
  const script = `<script>(()=>{const d=globalThis.${BRIDGE};if(typeof d!=="object"||d===null||typeof d.ready!=="function")return;const m=${mount},b=Promise.withResolvers();let t=globalThis.${TRANSPORT_GLOBAL};Object.defineProperty(globalThis,"${TRANSPORT_GLOBAL}",{configurable:true,enumerable:true,get:()=>t,set(n){if(n!==t&&typeof n==="object"&&n!==null&&"${STREAM_BASE}" in n)throw new Error("kivotos: a mounted machine's page keeps its own boot");t=n}});globalThis.${BOOT_GATE}={promise:b.promise,resolve(){},reject(){}};d.ready().then(r=>{t={...t,ownsHost:true,${STREAM_BASE}:new URL(m,r.${STREAM_BASE}).href};b.resolve()},b.reject)})()</script>`;
  return { html: injectHead(html, script), probe: probeBootGate(html) };
}

/** @returns the desktop shell's bridge on this page, of unknown shape. */
export function desktopBridge(): unknown {
  return Reflect.get(globalThis, BRIDGE);
}

/**
 * Whether the desktop shell's handshake still answers what the guard rebases.
 * The page's half of point `desktop-boot`; only a `dsh-app://` page has a
 * shell to ask.
 * @param bridge - {@link desktopBridge}.
 */
export async function probeDesktopBridge(bridge: unknown): Promise<Probe> {
  const ready: unknown =
    typeof bridge === "object" && bridge !== null ? Reflect.get(bridge, "ready") : undefined;
  if (typeof ready !== "function") return missing(`there is no ${BRIDGE}.ready to ask`);
  let answer: unknown;
  try {
    answer = await (ready as () => Promise<unknown>).call(bridge);
  } catch (error) {
    return changed(`the boot handshake failed: ${String(error)}`);
  }
  const base: unknown =
    typeof answer === "object" && answer !== null ? Reflect.get(answer, STREAM_BASE) : undefined;
  if (typeof base !== "string") return changed(`the boot handshake answered no ${STREAM_BASE}`);
  return ok(`the boot handshake answers ${base}`);
}

/** Strings the nightly check expects in dsh's bundles (scripts/dsh-compat.mjs). */
export const MARKERS = [BRIDGE, STREAM_BASE];
