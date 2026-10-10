/**
 * Script injected into every dsh page the WebView loads. It reports which
 * Session is on screen to React Native, so the native service skips
 * notifications for it, and lets React Native open a given Session.
 *
 * dsh keeps the current Session in `localStorage['dsh.sessions.current']` as
 * `{"sessionId": ...}` and restores it at startup (dsh 0.2.0-rc.2,
 * ui-workspace). On a Kivotos peer page `localStorage` is already the peer's
 * namespace, so the same key works everywhere.
 */
export const BRIDGE = `(() => {
  if (window.__kivotosBridge) return;
  window.__kivotosBridge = true;
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
})(); true;`;

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

/** A message the bridge posts. */
export interface BridgeMessage {
  type: "session";
  sessionId: string;
  path: string;
}

/** @returns the message, or null for anything else a page posts. */
export function parseBridgeMessage(data: string): BridgeMessage | null {
  try {
    const message = JSON.parse(data) as Partial<BridgeMessage>;
    if (message.type !== "session" || typeof message.sessionId !== "string") return null;
    return { type: "session", sessionId: message.sessionId, path: String(message.path ?? "") };
  } catch {
    return null;
  }
}
