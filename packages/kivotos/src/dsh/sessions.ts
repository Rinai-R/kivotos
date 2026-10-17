/**
 * dsh 0.2.1-rc.2's client stores, as Kivotos reads and writes them.
 *
 * dsh persists its client stores whole as JSON in localStorage under fixed
 * keys (`dsh-client-store` `attachPersistence`). The current Session is
 * ui-workspace's `selection` store, `{ sessionId, subagentAddress? }` under
 * `dsh.sessions.current`; dsh rehydrates it once at boot and restores that
 * Session (`restoreSelection`).
 *
 * No Node imports: the Client bundle includes this module.
 */
import { changed, injectHead, ok, type Probe } from "./compat.ts";

const CURRENT_SESSION_KEY = "dsh.sessions.current";
/** The attribute dsh puts the Session it shows on (ui-conversation ConversationContent). */
const SHOWN_SESSION = "data-conversation-session";

/** The storage reads and writes this module makes; `Storage` satisfies it. */
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The page read the probe makes; `Document` satisfies it. */
export interface SessionPage {
  querySelector(selectors: string): { getAttribute(name: string): string | null } | null;
}

/**
 * @param storage - the page's localStorage.
 * @returns the stored current Session's raw value, for change detection.
 */
export function rawSelection(storage: SessionStorage): string | null {
  return storage.getItem(CURRENT_SESSION_KEY);
}

/**
 * @param storage - the page's localStorage.
 * @returns the Session dsh shows on this page, "" when none or unreadable.
 */
export function currentSession(storage: SessionStorage): string {
  try {
    const value: unknown = JSON.parse(storage.getItem(CURRENT_SESSION_KEY) ?? "{}");
    const id: unknown =
      typeof value === "object" && value !== null ? Reflect.get(value, "sessionId") : undefined;
    return typeof id === "string" ? id : "";
  } catch {
    return "";
  }
}

/**
 * Make a Session the one dsh restores at its next boot.
 * @param storage - the page's localStorage.
 * @param sessionId - the Session.
 */
export function selectSession(storage: SessionStorage, sessionId: string): void {
  storage.setItem(CURRENT_SESSION_KEY, JSON.stringify({ sessionId }));
}

/**
 * Whether dsh still keeps its current Session where Kivotos reads and writes
 * it. Point `session-store`. It judges only on evidence, a Session on screen:
 * with none shown there is nothing to compare, and it answers undefined.
 * @param storage - the page's localStorage.
 * @param page - the page dsh rendered.
 */
export function probeSessionStore(storage: SessionStorage, page: SessionPage): Probe | undefined {
  const shown = page.querySelector(`[${SHOWN_SESSION}]`)?.getAttribute(SHOWN_SESSION) ?? "";
  if (shown === "") return undefined;
  const raw = storage.getItem(CURRENT_SESSION_KEY);
  if (raw === null)
    return changed(`dsh shows a Session but stores nothing under ${CURRENT_SESSION_KEY}`);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return changed(`${CURRENT_SESSION_KEY} is not JSON`);
  }
  if (typeof value !== "object" || value === null)
    return changed(`${CURRENT_SESSION_KEY} is not an object`);
  const sessionId: unknown = Reflect.get(value, "sessionId");
  if (typeof sessionId !== "string")
    return changed(`${CURRENT_SESSION_KEY} holds no sessionId string`);
  return ok(`${CURRENT_SESSION_KEY} holds { sessionId }`);
}

/**
 * The fragment a page on another machine opens this machine with, to land on
 * one Session: the namespace script below stores it before dsh boots.
 */
export const SESSION_FRAGMENT = "#kivotos-session=";

/**
 * Give a mounted peer page its own localStorage namespace. Every peer UI is
 * served from the host page's origin, and dsh persists its stores under fixed
 * keys, so without a namespace two machines' UIs overwrite each other's state.
 *
 * A navigation to {@link SESSION_FRAGMENT}`<id>` also makes that Session the
 * current one before dsh restores it, then drops the fragment.
 * @param html - peer index html.
 * @param peerId - URL-safe peer id.
 * @returns html with the namespace installed before any app script.
 */
export function injectStorageNamespace(html: string, peerId: string): string {
  // `<` is escaped so the id cannot close the script element, whatever the caller validated.
  const prefix = JSON.stringify(`kivotos:${peerId}:`).replaceAll("<", "\\u003c");
  const fragment = new RegExp(`^${SESSION_FRAGMENT}([^&]+)$`).source;
  const script = `<script>(()=>{const s=window.localStorage,p=${prefix},own=()=>{const k=[];for(let i=0;i<s.length;i++){const n=s.key(i);if(n!==null&&n.startsWith(p))k.push(n.slice(p.length))}return k};const v={getItem:k=>s.getItem(p+k),setItem:(k,x)=>s.setItem(p+k,String(x)),removeItem:k=>s.removeItem(p+k),key:i=>own()[i]??null,clear:()=>{for(const k of own())s.removeItem(p+k)},get length(){return own().length}};Object.defineProperty(window,"localStorage",{configurable:true,get:()=>v});const o=/${fragment}/.exec(location.hash);if(o!==null){try{s.setItem(p+${JSON.stringify(CURRENT_SESSION_KEY)},JSON.stringify({sessionId:decodeURIComponent(o[1])}))}catch{}history.replaceState(history.state,"",location.pathname+location.search)}})()</script>`;
  return injectHead(html, script);
}

/** Strings the nightly check expects in dsh's bundles (scripts/dsh-compat.mjs). */
export const MARKERS = [JSON.stringify(CURRENT_SESSION_KEY), SHOWN_SESSION];
