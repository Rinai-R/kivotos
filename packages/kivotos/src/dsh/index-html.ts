/**
 * The index dsh 0.2.1-rc.2 serves, and what Kivotos rewrites in it. dsh's
 * webServer renders every index from `apps/web/index.html` plus its injection
 * rows; the strings below are the exact ones rc.2 renders.
 *
 * Every rewrite probes its markup first and leaves the page as dsh served it
 * when the probe fails, returning the probe for the caller to report.
 */
import { changed, injectHead, missing, ok, type Probe } from "./compat.ts";

/** A rewrite's page and the probe its markup passed or failed. */
export interface Rewritten {
  readonly html: string;
  readonly probe: Probe;
}

const VIEWPORT_FROM = '<meta name="viewport" content="width=device-width, initial-scale=1" />';
const VIEWPORT_TO =
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />';
const VIEWPORT_ANY = /<meta\s[^>]*\bname=["']?viewport\b/i;

/**
 * Let the page draw under the phone's safe areas (notch, home indicator).
 * Point `viewport`.
 * @param html - the index as dsh served it.
 * @returns the page with a safe-area viewport, or unchanged.
 */
export function coverViewport(html: string): Rewritten {
  if (html.includes(VIEWPORT_TO))
    return { html, probe: ok("the viewport meta is already rewritten") };
  if (html.includes(VIEWPORT_FROM)) {
    return {
      html: html.replace(VIEWPORT_FROM, VIEWPORT_TO),
      probe: ok("the pinned viewport meta"),
    };
  }
  const probe = VIEWPORT_ANY.test(html)
    ? changed("the viewport meta is not the pinned 0.2.1-rc.2 form")
    : missing("the index has no viewport meta");
  return { html, probe };
}

const MANIFEST_FROM = '<link rel="manifest" href="./manifest.webmanifest" />';
const MANIFEST_TO =
  '<link rel="manifest" href="./manifest.webmanifest" crossorigin="use-credentials" />';
const MANIFEST_ANY = /<link\s[^>]*\brel=["']?manifest\b/i;

/**
 * Make a mounted peer page fetch its web manifest with credentials. Browsers
 * request a manifest link without cookies, dsh serves it publicly, but every
 * path under a peer mount sits behind the connection fence, so the
 * uncredentialed fetch would answer 401. Point `manifest`.
 * @param html - the peer's index as it arrived.
 * @returns the page with a credentialed manifest link, or unchanged.
 */
export function credentialedManifest(html: string): Rewritten {
  if (html.includes(MANIFEST_TO))
    return { html, probe: ok("the manifest link is already rewritten") };
  if (html.includes(MANIFEST_FROM)) {
    return {
      html: html.replace(MANIFEST_FROM, MANIFEST_TO),
      probe: ok("the pinned manifest link"),
    };
  }
  const probe = MANIFEST_ANY.test(html)
    ? changed("the manifest link is not the pinned 0.2.1-rc.2 form")
    : missing("the index has no manifest link");
  return { html, probe };
}

/** The boot graph script (`webserver/injections.ts`), JSON with `<` escaped. */
const BOOT_GRAPH_SCRIPT = /<script>globalThis\["__DSH_BOOT__"\] = (.*?)<\/script>/s;

/** A parsed `__DSH_BOOT__` graph, reduced to what the warm-up and the piece manifests read. */
export interface BootGraph {
  /** The graph's revision: unchanged means the same resources. */
  readonly rev: string;
  /** The batches' URLs, in boot order. */
  readonly urls: readonly string[];
  /**
   * Each batch's rows by batch URL: the URL each row is served at on its own
   * (`entries[].url`), in batch order. A batch whose rows the graph does not
   * name that way is left out.
   */
  readonly rows: ReadonlyMap<string, readonly string[]>;
}

/**
 * Read the boot graph out of a served index. Point `boot-graph`.
 * @param html - the index page.
 * @returns the graph when it is the pinned `{ rev, batches: [{ url }] }` shape.
 */
export function bootGraphOf(html: string): { graph: BootGraph | undefined; probe: Probe } {
  const json = BOOT_GRAPH_SCRIPT.exec(html)?.[1];
  if (json === undefined) {
    return { graph: undefined, probe: missing("the index has no __DSH_BOOT__ graph") };
  }
  const graph = graphOf(json);
  if (graph === undefined) {
    return { graph, probe: changed("the boot graph is not the pinned rev/batches shape") };
  }
  return { graph, probe: ok(`the boot graph rev ${graph.rev} with ${graph.urls.length} batches`) };
}

function graphOf(json: string): BootGraph | undefined {
  let graph: unknown;
  try {
    graph = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof graph !== "object" || graph === null) return undefined;
  const rev: unknown = Reflect.get(graph, "rev");
  const batches: unknown = Reflect.get(graph, "batches");
  if (typeof rev !== "string" || !Array.isArray(batches)) return undefined;
  const own = new Map<string, string>();
  const entries: unknown = Reflect.get(graph, "entries");
  for (const entry of Array.isArray(entries) ? (entries as unknown[]) : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const id: unknown = Reflect.get(entry, "id");
    const url: unknown = Reflect.get(entry, "url");
    if (typeof id === "string" && typeof url === "string") own.set(id, url);
  }
  const urls: string[] = [];
  const rows = new Map<string, string[]>();
  for (const batch of batches as unknown[]) {
    const url: unknown =
      typeof batch === "object" && batch !== null ? Reflect.get(batch, "url") : undefined;
    if (typeof url !== "string") return undefined;
    urls.push(url);
    const ids: unknown = Reflect.get(batch as object, "entries");
    const row = Array.isArray(ids) ? (ids as unknown[]).map((id) => own.get(String(id))) : [];
    if (row.length > 0 && row.every((item): item is string => item !== undefined)) {
      rows.set(url, row);
    }
  }
  return { rev, urls, rows };
}

/**
 * The tail script that settles dsh's boot gate, rendered after the last body
 * row. The desktop guard (desktop.ts) replaces the gate before dsh's entry
 * reads it, which only works while the entry still waits on a gate of this name.
 */
export const BOOT_GATE = "__DSH_BOOT_READY__";
const BOOT_GATE_TAIL = `<script>(globalThis.${BOOT_GATE} ??= Promise.withResolvers()).resolve()</script>`;

/**
 * Whether a mounted page still settles the boot gate the desktop guard takes
 * over. Half of point `desktop-boot`; desktop.ts probes the shell's half.
 * @param html - the peer's index as it arrived.
 */
export function probeBootGate(html: string): Probe {
  if (html.includes(BOOT_GATE_TAIL)) return ok("the index settles the pinned boot gate");
  if (html.includes(BOOT_GATE))
    return changed(`the index has ${BOOT_GATE} but not the pinned tail script`);
  return missing(`the index has no ${BOOT_GATE} gate`);
}

/** dsh's transport global: who owns the host, and where streams go. */
export const TRANSPORT_GLOBAL = "__DSH_TRANSPORT__";
const OWNS_HOST = `<script>globalThis.${TRANSPORT_GLOBAL}=Object.assign(globalThis.${TRANSPORT_GLOBAL}||{},{ownsHost:true})</script>`;

/**
 * Give a page served through a Kivotos hop the operator surface (settings the
 * host persists) a loopback page gets: it belongs to the same tailnet user.
 * @param html - index html.
 * @returns html with `ownsHost` set before dsh's scripts read the transport.
 */
export function injectOwnsHost(html: string): string {
  return injectHead(html, OWNS_HOST);
}

/** Strings the nightly check expects in dsh's bundles (scripts/dsh-compat.mjs). */
export const MARKERS = ["__DSH_BOOT__", BOOT_GATE, TRANSPORT_GLOBAL, "ownsHost"];
