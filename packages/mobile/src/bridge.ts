/**
 * Script injected into every dsh page the WebView loads. It reports which
 * Session is on screen to React Native, so the native service skips
 * notifications for it, and lets React Native open a given Session.
 *
 * dsh keeps the current Session in `localStorage['dsh.sessions.current']` as
 * `{"sessionId": ...}` and restores it at startup (dsh 0.2.1-rc.2,
 * ui-workspace). On a Kivotos peer page `localStorage` is already the peer's
 * namespace, so the same key works everywhere.
 *
 * `__kivotosSwitch` tells the plugin's switcher (packages/kivotos/src/client.tsx)
 * that this app takes `kivotos.switch` messages: a page of an app without it
 * navigates by itself.
 *
 * `ready` is posted once per document, when the plugin's switcher is on the
 * page: dsh has rendered its shell, so the page can be shown at once. A
 * MutationObserver watches for it, which a hidden page still runs.
 */
export const BRIDGE = `(() => {
  if (window.__kivotosBridge) return;
  window.__kivotosBridge = true;
  window.__kivotosSwitch = true;
  const KEY = "dsh.sessions.current";
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}").sessionId || ""; } catch (e) { return ""; }
  };
  let last = null;
  const report = () => {
    const sessionId = read();
    if (sessionId === last) return;
    last = sessionId;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "session", sessionId, path: location.pathname }));
  };
  const store = window.localStorage;
  const set = store.setItem.bind(store);
  store.setItem = (key, value) => { set(key, value); if (key === KEY) report(); };
  setInterval(report, 1000);
  report();
  const SHELL = ".kivotos-machines-trigger";
  const ready = () => window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ready" }));
  if (document.querySelector(SHELL) !== null) ready();
  else {
    const observer = new MutationObserver(() => {
      if (document.querySelector(SHELL) === null) return;
      observer.disconnect();
      ready();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})(); true;`;

/**
 * Script that posts the machines the page's computer lists (`/kivotos/peers`,
 * absolute: the serving computer's list also on a peer's page), or null.
 */
export const PEERS_SCRIPT = `fetch("/kivotos/peers", { headers: { accept: "application/json" } })
  .then((res) => (res.ok ? res.json() : null))
  .catch(() => null)
  .then((body) => window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "kivotos.peers",
    machines: body !== null && typeof body === "object" && Array.isArray(body.machines) ? body.machines : null,
  }))); true;`;

/**
 * Script that opens a Session: store it as current, then reload so dsh
 * restores it.
 * @param sessionId - Session to open.
 * @returns script source.
 */
export function openSessionScript(sessionId: string): string {
  const value = JSON.stringify(JSON.stringify({ sessionId }));
  return `localStorage.setItem("dsh.sessions.current", ${value}); location.reload(); true;`;
}

/**
 * Script that sends the page to a path of its own origin, for a switch the
 * app has no page to show for (see `switchTarget` in views.ts).
 * @param path - absolute path on the page's origin.
 * @returns script source.
 */
export function assignScript(path: string): string {
  return `location.assign(${JSON.stringify(path)}); true;`;
}

/** The machine a switcher row names, as the page's computer knows it (`MachineInfo`). */
export interface SwitchTarget {
  /** The computer's mount id; null for "This computer", the page's computer itself. */
  id: string | null;
  name: string;
  /** Kivotos node id, when the computer knows it. */
  node?: string;
  /** Its tailnet listener's `host:port`, when the computer reaches it over Tailscale. */
  address?: string;
}

/** A machine a page's computer lists, as its switcher would name it. */
export interface ListedMachine {
  target: SwitchTarget;
  /** The computer has a route to it now. */
  online: boolean;
}

/** A message the bridge or the plugin's switcher posts. */
export type BridgeMessage =
  | { type: "session"; sessionId: string; path: string }
  | { type: "ready" }
  /** {@link PEERS_SCRIPT}'s answer; null when the computer did not list its machines. */
  | { type: "kivotos.peers"; machines: ListedMachine[] | null }
  | {
      type: "kivotos.switch";
      machine: SwitchTarget;
      /** A Session to open there. */
      sessionId?: string;
      /** The path on this page's origin that opens it through the computer's mount ({@link isFallbackFor}). */
      fallback: string;
    };

const optional = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** The fragment the plugin's namespace script stores as the current Session (packages/kivotos/src/dsh/sessions.ts). */
const SESSION_FRAGMENT = "#kivotos-session=";

/**
 * Whether `fallback` is one of the paths the switcher sends for `id`: "/"
 * for this computer, else the peer's mount path, optionally with the Session
 * fragment for `sessionId`. Only an exact match, built here with the id
 * encoded, so nothing a page sends can name another origin ("//host",
 * "/\\host") or another path.
 */
function isFallbackFor(
  fallback: string,
  id: string | null,
  sessionId: string | undefined,
): boolean {
  const path = id === null ? "/" : `/kivotos/peer/${encodeURIComponent(id)}/`;
  if (fallback === path) return true;
  return (
    id !== null &&
    sessionId !== undefined &&
    fallback === `${path}${SESSION_FRAGMENT}${encodeURIComponent(sessionId)}`
  );
}

function switchOf(message: Record<string, unknown>): BridgeMessage | null {
  const machine = message.machine as Record<string, unknown> | null | undefined;
  const fallback = message.fallback;
  if (typeof fallback !== "string") return null;
  if (typeof machine !== "object" || machine === null) return null;
  if (typeof machine.id !== "string" && machine.id !== null) return null;
  const sessionId = optional(message.sessionId);
  if (!isFallbackFor(fallback, machine.id, sessionId)) return null;
  const target: SwitchTarget = { id: machine.id, name: String(machine.name ?? "") };
  const node = optional(machine.node);
  const address = optional(machine.address);
  if (node !== undefined) target.node = node;
  if (address !== undefined) target.address = address;
  return sessionId === undefined
    ? { type: "kivotos.switch", machine: target, fallback }
    : { type: "kivotos.switch", machine: target, sessionId, fallback };
}

/** A `/kivotos/peers` entry (`MachineInfo`) the way the switcher names it (client.tsx, `navigate`). */
function listedOf(value: unknown): ListedMachine[] {
  if (typeof value !== "object" || value === null) return [];
  const machine = value as Record<string, unknown>;
  const id = optional(machine.id);
  if (id === undefined) return [];
  const target: SwitchTarget = { id, name: String(machine.name ?? "") };
  const node = optional(machine.node);
  const links = Array.isArray(machine.links) ? (machine.links as unknown[]) : [];
  const tailscale = links.find(
    (link): link is Record<string, unknown> =>
      typeof link === "object" && link !== null && Reflect.get(link, "via") === "tailscale",
  );
  const address = optional(tailscale?.address);
  if (node !== undefined) target.node = node;
  if (address !== undefined) target.address = address;
  return [{ target, online: typeof machine.route === "string" }];
}

/** @returns the message, or null for anything else a page posts. */
export function parseBridgeMessage(data: string): BridgeMessage | null {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  if (message.type === "kivotos.switch") return switchOf(message);
  if (message.type === "ready") return { type: "ready" };
  if (message.type === "kivotos.peers")
    return {
      type: "kivotos.peers",
      machines: Array.isArray(message.machines) ? message.machines.flatMap(listedOf) : null,
    };
  if (message.type !== "session" || typeof message.sessionId !== "string") return null;
  return { type: "session", sessionId: message.sessionId, path: String(message.path ?? "") };
}
