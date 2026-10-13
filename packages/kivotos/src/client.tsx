/**
 * Kivotos Client module.
 *
 * - `sidebar.footer.action`: machine switcher. It lists the serving host and
 *   the peers it mounts under `/kivotos/peer/<id>/`, and navigates between them.
 * - `conversation.header.leading`: drawer toggle, shown only on phones.
 * - `shell.overlay`: drawer backdrop plus the plugin's stylesheet. The
 *   stylesheet renders as a React element, so unmounting the plugin removes it.
 * - `settings.section`: "Remote access", this machine's links and the
 *   machines it knows, with their modes (settings.tsx).
 *
 * Built by scripts/build.mjs into the `window.__ModuleLoader__.load` form dsh
 * expects, with `react` taken from dsh's module require.
 */
// The classic JSX transform compiles to React.createElement; the bundle takes
// react from dsh's module require, so this is the instance dsh renders with.
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { AttentionNotice, AttentionState, PeerAttention } from "./attention-hub.ts";
import type { AttentionFrame } from "./attention.ts";
import { statusOf, type MachineInfo } from "./machines.ts";
import {
  LinksSection,
  machineListOf,
  PairDialog,
  SETTINGS_CSS,
  SETTINGS_EN,
  SETTINGS_ZH,
  statusText,
  type MachineList,
  type Translate,
} from "./settings.tsx";
import { SseReader } from "./sse.ts";
import { tracePath } from "./trace-path.ts";

/** The slice of the dsh 0.2.0-rc.2 Client context Kivotos uses. */
interface ClientContext {
  effect(factory: () => () => void, label?: string): void;
  locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void;
    bind(ns: string): Translate;
  };
  layout: { toggleSidebar(): void };
  slots: {
    inject(name: string, register: () => () => void): void;
    register<Props>(
      registration: {
        name: string;
        id?: string;
        order?: number;
        locale?: string;
        /** Navigation label of a `settings.section`. */
        label?: () => string;
        /** Extra props merged into every render of the component. */
        inject?: () => object;
      },
      component: (props: Props) => ReactNode,
    ): () => void;
  };
}

const NS = "kivotos";
/** The Kivotos phone app names itself in its WebView's User-Agent (packages/mobile MachineView). */
const IN_APP = /\bKivotos\b/.test(navigator.userAgent);
/**
 * When the phone layout applies. Width alone would also catch a narrowed
 * desktop window, where dsh's own layout must stay, so the page must also be
 * in the phone app or, for a phone's own browser, on a touch-first device.
 */
const PHONE = IN_APP ? "(max-width: 767px)" : "(max-width: 767px) and (pointer: coarse)";
const PEER_PATH = /^\/kivotos\/peer\/([^/]+)\//;
const ZH = {
  "machines.label": "机器",
  "machines.local": "本机",
  "machines.current": "当前",
  "machines.empty": "未发现其它机器",
  "machines.failed": "无法读取机器列表",
  "machines.open": "打开 {name}",
  "machines.unavailable": "{name}：{status}",
  "machines.labelWaiting": "机器，{count} 项待处理",
  "machines.labelFinished": "机器，有任务已结束",
  "machines.openWaiting": "打开 {name}，{count} 项待处理",
  "machines.openFinished": "打开 {name}，有任务已结束",
  "attention.approval": "{name}：需要批准",
  "attention.question": "{name}：有问题待回答",
  "attention.done": "{name}：任务已完成",
  "attention.failed": "{name}：任务失败",
  "attention.untitled": "未命名会话",
  "drawer.open": "打开侧边栏",
  "drawer.close": "关闭侧边栏",
};
const EN: Record<keyof typeof ZH, string> = {
  "machines.label": "Machines",
  "machines.local": "This machine",
  "machines.current": "Current",
  "machines.empty": "No other machines found",
  "machines.failed": "Could not load machines",
  "machines.open": "Open {name}",
  "machines.unavailable": "{name}: {status}",
  "machines.labelWaiting": "Machines, {count} waiting",
  "machines.labelFinished": "Machines, a task finished",
  "machines.openWaiting": "Open {name}, {count} waiting",
  "machines.openFinished": "Open {name}, a task finished",
  "attention.approval": "{name}: approval needed",
  "attention.question": "{name}: question waiting",
  "attention.done": "{name}: task finished",
  "attention.failed": "{name}: task failed",
  "attention.untitled": "Untitled session",
  "drawer.open": "Open sidebar",
  "drawer.close": "Close sidebar",
};

/**
 * Phone layout. AppFrame and SidebarRoot class names are CSS-module hashes
 * of dsh 0.2.0-rc.2; selectors match the stable `_<name>` suffix. This
 * is a deliberate, version-pinned exception to "do not read another
 * plugin's DOM": dsh ships no phone layout and no slot owns the frame grid.
 */
const CSS = `
.kivotos-machines{position:relative;display:flex;width:100%;margin:8px 0 0}
.kivotos-machines-trigger{display:inline-flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:0 -2px;padding:0 10px 0 8px;border:none;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer;overflow:hidden}
.kivotos-machines-trigger:hover,.kivotos-machines-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-machines-trigger[data-narrow]{position:relative;justify-content:center;width:40px;padding:0;margin:0}
.kivotos-machines-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kivotos-machines-count{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
.kivotos-machines-list{position:absolute;left:0;bottom:calc(100% + 4px);z-index:30;box-sizing:border-box;width:max(100%,240px);max-height:min(60vh,420px);overflow-y:auto;margin:0;padding:6px;list-style:none;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel)}
.kivotos-machines-item{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.kivotos-machines-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-machines-item[aria-current="true"]{background:var(--dsw-alias-interactive-bg-hover);cursor:default}
.kivotos-machines-text{display:flex;flex:1;flex-direction:column;min-width:0}
.kivotos-machines-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kivotos-machines-status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
.kivotos-machines-meta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kivotos-machines-note{padding:8px;color:var(--dsw-alias-label-tertiary);font-size:13px}
.kivotos-machines-separator{border-top:1px solid var(--dsw-alias-interactive-bg-hover);margin-top:4px;padding-top:4px}
.kivotos-machines-separator .kivotos-machines-note{display:block}
.kivotos-machines-item:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.kivotos-machines-item:disabled:hover{background:transparent}
.kivotos-attention-count{flex:none;box-sizing:border-box;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:11px;font-weight:600;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
.kivotos-attention-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary-new-colorprimary-new-color)}
.kivotos-attention-dot[data-tone="failed"]{background:var(--dsw-alias-state-error-primary)}
.kivotos-attention-dot[data-tone="waiting"]{background:var(--dsw-alias-state-warn-primary)}
.kivotos-machines-trigger[data-narrow] .kivotos-attention-dot{position:absolute;top:8px;right:8px;width:7px;height:7px}
.kivotos-drawer-toggle{display:none;width:28px;height:28px;align-items:center;justify-content:center;margin-right:8px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.kivotos-drawer-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-backdrop{position:fixed;inset:0;z-index:29;border:none;padding:0;background:var(--dsw-alias-bg-mask-1);cursor:default}
@media ${PHONE}{
  html{--dsh-frame-top-clearance:env(safe-area-inset-top,0px);--dsh-frame-overlay-top:calc(env(safe-area-inset-top,0px) + 12px);--dsh-frame-chrome-top:env(safe-area-inset-top,0px)}
  html,body{overscroll-behavior:none}
  div:has(> [data-shell-overlay]){grid-template-columns:0 minmax(0,1fr) 0!important;height:100dvh;box-sizing:border-box;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px);transition:none!important}
  div:has(> [data-shell-overlay]) > [class*="_handle"]{display:none}
  div:has(> [data-shell-overlay]) > [class*="_centerCol"]{grid-column:2;grid-row:1}
  div:has(> [data-shell-overlay]) > [class*="_rightbarCol"]{grid-column:3;grid-row:1}
  div:has(> [data-shell-overlay]) > [class*="_sidebarCol"]{position:fixed;inset:0 auto 0 0;z-index:30;box-sizing:border-box;width:min(86vw,320px);padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);box-shadow:var(--dsw-shadow-lv3);transition:transform var(--ds-transition-duration-slow,240ms) var(--ds-ease-in-out,ease)}
  div:has(> [data-shell-overlay])[data-sidebar-collapsed] > [class*="_sidebarCol"]{transform:translateX(calc(-100% - 24px));box-shadow:none}
  div:has(> [data-shell-overlay]) > [class*="_sidebarCol"] > * > [class*="_root"]{width:100%!important}
  [data-conversation-header-leading] .kivotos-drawer-toggle{display:inline-flex}
  [class*="_header"]:has(> [data-conversation-header-leading]){padding-left:12px!important;padding-right:12px!important}
  [class*="_composerSeat"]{padding-bottom:env(safe-area-inset-bottom,0px)}
  [data-conversation-scroll]{overscroll-behavior:contain}
  button,[role="button"],[role="treeitem"]{touch-action:manipulation}
  input,textarea,select,[contenteditable="true"]{font-size:max(16px,1em)}
  [data-shortcut-modal="settings"]{flex-direction:column;width:100vw;max-width:100vw;height:100dvh;box-sizing:border-box;border-radius:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px)}
  [data-shortcut-modal="settings"] > nav{width:auto;gap:10px;padding:14px 12px 8px}
  [data-shortcut-modal="settings"] > nav > [class*="_navList"]{flex-direction:row;overflow:auto hidden;scrollbar-width:none}
  [data-shortcut-modal="settings"] > nav [class*="_navCell"],[data-shortcut-modal="settings"] > nav [class*="_navLabel"]{flex:none}
  [data-shortcut-modal="settings"] > [class*="_content"]{min-height:0}
  [data-shortcut-modal="settings"] > [class*="_content"] > [class*="_header"]{position:absolute;top:env(safe-area-inset-top,0px);right:env(safe-area-inset-right,0px);height:auto;padding:12px 12px 0 0}
  [data-shortcut-modal="settings"] > [class*="_content"] > [class*="_options"]{padding:8px 16px calc(16px + env(safe-area-inset-bottom,0px))}
  [data-shortcut-modal="settings"] [class*="_themeCube"]{flex:1 1 0;min-width:0;padding:14px 8px}
  [data-shortcut-modal="settings"] .kivotos-mode-button{width:36px;height:36px}
  [data-shortcut-modal="settings"] .kivotos-mode-option{min-height:44px}
}
@media ${PHONE} and (prefers-reduced-motion:reduce){
  div:has(> [data-shell-overlay]) > [class*="_sidebarCol"]{transition:none}
}`;

/** @returns peer id of the current page, or null on the serving host. */
function currentPeer(): string | null {
  const match = PEER_PATH.exec(window.location.pathname);
  return match === null ? null : decodeURIComponent(match[1]);
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Track the AppFrame's collapsed-sidebar attribute. */
function useSidebarCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    const frame = document.querySelector("[data-shell-overlay]")?.parentElement;
    if (frame === null || frame === undefined) return undefined;
    const read = (): void => setCollapsed(frame.hasAttribute("data-sidebar-collapsed"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(frame, { attributes: true, attributeFilter: ["data-sidebar-collapsed"] });
    return () => observer.disconnect();
  }, []);
  return collapsed;
}

/**
 * dsh's current-Session store (ui-workspace snapshot store, dsh 0.2.0-rc.2):
 * it rewrites this localStorage key whenever the selection changes.
 */
const CURRENT_SESSION_KEY = "dsh.sessions.current";

/** The serving host's merged stream of the other machines' attention (attention-hub.ts). */
const ATTENTION_PATH = "/kivotos/attention";
const ATTENTION_SEEN_PATH = "/kivotos/attention/seen";
/** Read by the namespace script of a mounted page (index.ts injectStorageNamespace). */
const SESSION_FRAGMENT = "#kivotos-session=";
const ATTENTION_RETRY_MIN_MS = 1_000;
const ATTENTION_RETRY_MAX_MS = 60_000;
const NO_ATTENTION: AttentionState = { notify: { waiting: false, finished: false }, peers: [] };

/** The latest `state` event, shared by every switcher on the page. */
let attention = NO_ATTENTION;
const attentionListeners = new Set<() => void>();

function subscribeAttention(listener: () => void): () => void {
  attentionListeners.add(listener);
  return () => attentionListeners.delete(listener);
}

function setAttention(next: AttentionState): void {
  attention = next;
  for (const listener of attentionListeners) listener();
}

/** @returns the Session dsh shows on this page, "" when none. */
function currentSession(): string {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CURRENT_SESSION_KEY) ?? "{}");
    const id: unknown =
      typeof value === "object" && value !== null ? Reflect.get(value, "sessionId") : undefined;
    return typeof id === "string" ? id : "";
  } catch {
    // An unreadable selection means none is open.
    return "";
  }
}

/**
 * Open a mounted machine on one Session. This page's localStorage is its own
 * machine's namespace only, so another machine gets the Session in the URL
 * fragment, which its namespace script stores before dsh starts.
 */
function openSession(peer: string, sessionId: string): void {
  if (peer === currentPeer()) {
    window.localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify({ sessionId }));
    window.location.reload();
    return;
  }
  window.location.assign(
    `/kivotos/peer/${encodeURIComponent(peer)}/${SESSION_FRAGMENT}${encodeURIComponent(sessionId)}`,
  );
}

/**
 * Show one frame that is news as a system notification, unless the window
 * is in front (the switcher shows it there) or its Session is on screen in a
 * visible window. One tag per wait or turn: every tab and every mount of the
 * machine shows the same notification once.
 */
function notifyFrame(
  { peer, frame }: AttentionNotice,
  shown: Map<string, Notification>,
  t: Translate,
): void {
  const tag = `kivotos:${frame.sessionId}:${frame.key}`;
  if (frame.kind === "resolved") {
    shown.get(tag)?.close();
    shown.delete(tag);
    return;
  }
  const waiting = frame.kind === "approval" || frame.kind === "question";
  if (!(waiting ? attention.notify.waiting : attention.notify.finished)) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.hasFocus()) return;
  const onScreen =
    document.visibilityState === "visible" &&
    peer === currentPeer() &&
    frame.sessionId === currentSession();
  if (onScreen) return;
  const name = attention.peers.find((row) => row.id === peer)?.name ?? peer;
  const body = [frame.title || t("attention.untitled"), frame.detail].filter(Boolean).join("\n");
  const notification = new Notification(t(`attention.${frame.kind}`, { name }), { body, tag });
  notification.addEventListener("click", () => {
    window.focus();
    notification.close();
    openSession(peer, frame.sessionId);
  });
  notification.addEventListener("close", () => {
    if (shown.get(tag) === notification) shown.delete(tag);
  });
  shown.set(tag, notification);
}

/**
 * Hold the serving host's attention stream open for this page, with backoff
 * after a failure. `fetch` rather than `EventSource`: the desktop window's
 * `dsh-app://` scheme is registered for the Fetch API and streaming only.
 * @returns the cleanup: closes the stream and the page's notifications.
 */
function followAttention(t: Translate): () => void {
  const abort = new AbortController();
  const shown = new Map<string, Notification>();
  const page = currentPeer();
  let retryMs = ATTENTION_RETRY_MIN_MS;
  let timer: number | undefined;
  let seenSent = false;

  const onState = (next: AttentionState): void => {
    setAttention(next);
    // This page is that machine: its finished turns are seen.
    const finished = next.peers.some((row) => row.id === page && row.finished.length > 0);
    if (!finished) seenSent = false;
    if (!finished || seenSent) return;
    seenSent = true;
    void fetch(ATTENTION_SEEN_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peer: page }),
      signal: abort.signal,
    }).catch(() => undefined);
  };

  const connect = async (): Promise<void> => {
    try {
      const res = await fetch(ATTENTION_PATH, {
        headers: { accept: "text/event-stream" },
        cache: "no-store",
        signal: abort.signal,
      });
      if (!res.ok || res.body === null) throw new Error(String(res.status));
      retryMs = ATTENTION_RETRY_MIN_MS;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      const sse = new SseReader();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        for (const event of sse.push(chunk.value)) {
          if (event.event === "state") onState(JSON.parse(event.data) as AttentionState);
          else if (event.event === "notice")
            notifyFrame(JSON.parse(event.data) as AttentionNotice, shown, t);
        }
      }
    } catch {
      // A lost stream (host restart, sleep) is retried below.
    }
    if (abort.signal.aborted) return;
    timer = window.setTimeout(() => void connect(), retryMs);
    retryMs = Math.min(retryMs * 2, ATTENTION_RETRY_MAX_MS);
  };
  void connect();

  return () => {
    abort.abort();
    window.clearTimeout(timer);
    for (const notification of shown.values()) notification.close();
    setAttention(NO_ATTENTION);
  };
}

/**
 * On a phone the drawer covers the conversation, so opening a Session from
 * it, or starting a new one, should close it, as native apps do; dsh's own
 * layout collapses the sidebar only on a width change. Two signals, because
 * neither covers every case:
 * - a tap on a Session row, which also catches the Session already open.
 *   In dsh 0.2.0-rc.2 Session rows are `[role=treeitem]` without
 *   `aria-expanded`; workspace folders carry it and only toggle.
 * - a change of the current Session, which catches New Session and any
 *   other way dsh switches. The store writes synchronously in dsh's click
 *   handler, and same-document storage writes fire no event, so it is polled.
 * @param active - phone width with the drawer open.
 * @param close - collapses the drawer.
 */
function useCloseDrawerOnSelect(active: boolean, close: () => void): void {
  useEffect(() => {
    if (!active) return undefined;
    const sidebar = document.querySelector('[class*="_sidebarCol"]');
    const onClick = (event: Event): void => {
      const target = event.target as Element | null;
      // Row menus and actions sit inside the row: those keep the drawer open.
      if (target?.closest("button, [role=menuitem]")) return;
      const row = target?.closest("[role=treeitem]");
      if (row && !row.hasAttribute("aria-expanded")) requestAnimationFrame(close);
    };
    sidebar?.addEventListener("click", onClick);
    const opened = window.localStorage.getItem(CURRENT_SESSION_KEY);
    const timer = setInterval(() => {
      if (window.localStorage.getItem(CURRENT_SESSION_KEY) !== opened) close();
    }, 150);
    return () => {
      sidebar?.removeEventListener("click", onClick);
      clearInterval(timer);
    };
  }, [active, close]);
}

/** Monitor glyph (original artwork, currentColor). */
function MachineGlyph(): ReactNode {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x={2.5} y={3.5} width={15} height={10} rx={2} stroke="currentColor" strokeWidth={1.4} />
      <path d="M7 16.5h6M10 13.5v3" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

/** Drawer glyph (original artwork, currentColor). */
function DrawerGlyph(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M2.5 8h11M2.5 12h7"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** QR glyph for the pairing action (original artwork, currentColor). */
function QrGlyph(): ReactNode {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x={3} y={3} width={5.5} height={5.5} rx={1.2} stroke="currentColor" strokeWidth={1.4} />
      <rect
        x={11.5}
        y={3}
        width={5.5}
        height={5.5}
        rx={1.2}
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <rect
        x={3}
        y={11.5}
        width={5.5}
        height={5.5}
        rx={1.2}
        stroke="currentColor"
        strokeWidth={1.4}
      />
      <path
        d="M11.5 11.5h2v2M17 11.5v2M11.5 17h2.5M17 15.5V17"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

interface Machines extends MachineList {
  state: "loading" | "ready" | "failed";
}

const LOADING: Machines = { state: "loading", self: { name: "", os: "" }, machines: [] };

/**
 * Load the serving host's machine list.
 * @param open - whether the list is open; opening refetches.
 */
function useMachines(open: boolean): Machines {
  const [data, setData] = useState(LOADING);
  const loaded = useRef(false);
  useEffect(() => {
    // Once on mount (the trigger shows the current machine's name), then on every open.
    if (!open && loaded.current) return undefined;
    loaded.current = true;
    const abort = new AbortController();
    // Absolute path: the list always comes from the serving host, never a
    // peer, so hops never chain.
    fetch("/kivotos/peers", { signal: abort.signal, headers: { accept: "application/json" } })
      .then((res) =>
        res.ok ? (res.json() as Promise<unknown>) : Promise.reject(new Error(String(res.status))),
      )
      .then((body) => setData({ state: "ready", ...machineListOf(body) }))
      .catch(() => {
        if (!abort.signal.aborted) setData((prev) => ({ ...prev, state: "failed" }));
      });
    return () => abort.abort();
  }, [open]);
  return data;
}

/** The dot of finished turns: red when one of them failed. */
function finishedTone(frames: readonly AttentionFrame[]): "done" | "failed" | undefined {
  if (frames.length === 0) return undefined;
  return frames.some((frame) => frame.kind === "failed") ? "failed" : "done";
}

/** A machine's finished-turn dot and waiting count (decorative: labels carry the text). */
function AttentionMarks({
  waiting,
  tone,
}: {
  waiting: number;
  tone: "done" | "failed" | undefined;
}): ReactNode {
  return (
    <>
      {tone === undefined ? null : (
        <span className="kivotos-attention-dot" data-tone={tone} aria-hidden />
      )}
      {waiting > 0 ? (
        <span className="kivotos-attention-count" aria-hidden>
          {String(waiting)}
        </span>
      ) : null}
    </>
  );
}

interface MachineRowProps {
  /** Peer id, or null for the serving host. */
  id: string | null;
  name: string;
  /** The tag at the end: "Current", the route, or nothing. */
  meta: string;
  /** How the machine is reached, in full: the tooltip. */
  title: string | undefined;
  /** The same next to the tag: the second line, when `note`. */
  status: string | undefined;
  note: boolean;
  /** No link reaches it: shown, dimmed, but not openable. */
  unavailable: boolean;
  current: boolean;
  /** What the machine waits for and finished; undefined for the serving host. */
  attention: PeerAttention | undefined;
  t: Translate;
}

function MachineRow(props: MachineRowProps): ReactNode {
  const { id, name, meta, status, current, unavailable, attention: row, t } = props;
  const waiting = row?.pending.length ?? 0;
  const tone = finishedTone(row?.finished ?? []);
  // The oldest wait, else the latest finished turn.
  const target = row?.pending[0]?.sessionId ?? row?.finished.at(-1)?.sessionId;
  let label = t("machines.open", { name });
  if (unavailable) label = t("machines.unavailable", { name, status: props.title });
  else if (waiting > 0) label = t("machines.openWaiting", { name, count: waiting });
  else if (tone !== undefined) label = t("machines.openFinished", { name });
  const onClick = useCallback(() => {
    if (id !== null && target !== undefined && !(current && target === currentSession())) {
      openSession(id, target);
      return;
    }
    if (current) return;
    window.location.assign(id === null ? "/" : `/kivotos/peer/${encodeURIComponent(id)}/`);
  }, [current, id, target]);
  return (
    <li>
      <button
        type="button"
        className="kivotos-machines-item"
        aria-current={current ? "true" : undefined}
        aria-label={label}
        title={props.title}
        disabled={unavailable}
        onClick={onClick}
      >
        <MachineGlyph />
        <span className="kivotos-machines-text">
          <span className="kivotos-machines-name">{name}</span>
          {props.note && status !== undefined ? (
            <span className="kivotos-machines-status">{status}</span>
          ) : null}
        </span>
        <AttentionMarks waiting={waiting} tone={tone} />
        {meta === "" ? null : <span className="kivotos-machines-meta">{meta}</span>}
      </button>
    </li>
  );
}

/** A peer's row in the switcher: its route as the tag, a second line when it is not plain. */
function PeerRow({
  machine,
  current,
  attention: row,
  now,
  t,
}: {
  machine: MachineInfo;
  current: boolean;
  attention: PeerAttention | undefined;
  now: number;
  t: Translate;
}): ReactNode {
  const status = statusOf(machine, machine.mode);
  let meta = "";
  if (current) meta = t("machines.current");
  else if (machine.route !== null) meta = t(`via.${machine.route}`);
  return (
    <MachineRow
      id={machine.id}
      name={machine.name}
      meta={meta}
      title={statusText(t, machine, now)}
      status={statusText(t, machine, now, true)}
      note={status.kind !== "online" || status.down !== undefined}
      unavailable={machine.route === null && !current}
      current={current}
      attention={row}
      t={t}
    />
  );
}

/** "Pair phone" row at the foot of the machine list. */
function PairEntry({
  ready,
  t,
  onPair,
}: {
  ready: boolean;
  t: Translate;
  onPair: () => void;
}): ReactNode {
  const unavailable = ready ? undefined : t("pair.unavailable");
  return (
    <li className="kivotos-machines-separator">
      <button
        type="button"
        className="kivotos-machines-item"
        disabled={!ready}
        title={unavailable}
        onClick={onPair}
      >
        <QrGlyph />
        <span className="kivotos-machines-name">{t("pair.action")}</span>
      </button>
      {unavailable === undefined ? null : (
        <span className="kivotos-machines-note">{unavailable}</span>
      )}
    </li>
  );
}

/** The board as the switcher shows it. */
interface AttentionSummary {
  rows: Map<string, PeerAttention>;
  /** Distinct waits across machines. */
  waiting: number;
  tone: "done" | "failed" | undefined;
  /** The closed trigger's accessible name. */
  label: string;
}

function useAttentionSummary(t: Translate): AttentionSummary {
  const board = useSyncExternalStore(subscribeAttention, () => attention);
  return useMemo(() => {
    // One machine can be mounted twice (two links); its waits count once.
    const waits = new Set(
      board.peers.flatMap((row) => row.pending.map((frame) => `${frame.sessionId}\n${frame.key}`)),
    );
    const tone = finishedTone(board.peers.flatMap((row) => row.finished));
    let label = t("machines.label");
    if (waits.size > 0) label = t("machines.labelWaiting", { count: waits.size });
    else if (tone !== undefined) label = t("machines.labelFinished");
    const rows = new Map(board.peers.map((row) => [row.id, row]));
    return { rows, waiting: waits.size, tone, label };
  }, [board, t]);
}

/** The closed trigger's marks: dot and count when wide, one dot when narrow. */
function TriggerMarks({
  wide,
  waiting,
  tone,
}: {
  wide: boolean;
  waiting: number;
  tone: "done" | "failed" | undefined;
}): ReactNode {
  if (wide) return <AttentionMarks waiting={waiting} tone={tone} />;
  if (waiting === 0 && tone === undefined) return null;
  return (
    <span
      className="kivotos-attention-dot"
      data-tone={waiting > 0 ? "waiting" : tone}
      aria-hidden
    />
  );
}

/** Machine switcher in the sidebar foot. */
function MachineSwitcher({ wide, t }: { wide: boolean; t: Translate }): ReactNode {
  const [open, setOpen] = useState(false);
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const machines = useMachines(open);
  // A phone is the thing being paired: it has no use for its own pairing code.
  const phone = useMedia(PHONE);
  const peer = currentPeer();
  const summary = useAttentionSummary(t);
  const toggle = useCallback(() => {
    setOpen((value) => !value);
    // Browsers ask for notifications only from a user gesture; this is the feature's own.
    if (
      attention.notify.waiting &&
      attention.peers.length > 0 &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    )
      void Notification.requestPermission();
  }, []);
  const closePair = useCallback(() => {
    setPairUrl(null);
    trigger.current?.focus();
  }, []);
  const showPair = useCallback(() => {
    const url = machines.self.url;
    if (url === undefined) return;
    setOpen(false);
    setPairUrl(url);
  }, [machines.self.url]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const currentName = useMemo(() => {
    if (peer === null) return t("machines.local");
    return machines.machines.find((row) => row.id === peer)?.name ?? peer;
  }, [machines.machines, peer, t]);

  const selfName = machines.self.name || t("machines.local");
  let note: string | null = null;
  if (machines.state === "failed") note = t("machines.failed");
  else if (machines.state === "ready" && machines.machines.length === 0) note = t("machines.empty");
  const pairReady = machines.state === "ready" && Boolean(machines.self.url);
  // Rendered on open and on every list read, which keeps "last seen" current enough.
  const now = Date.now();

  return (
    <div ref={root} className="kivotos-machines">
      <button
        ref={trigger}
        type="button"
        className="kivotos-machines-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={summary.label}
        title={wide ? undefined : currentName}
        data-narrow={wide ? undefined : ""}
        onClick={toggle}
      >
        <MachineGlyph />
        {wide ? <span className="kivotos-machines-label">{currentName}</span> : null}
        <TriggerMarks wide={wide} waiting={summary.waiting} tone={summary.tone} />
        {wide && machines.state === "ready" ? (
          <span className="kivotos-machines-count">{String(machines.machines.length + 1)}</span>
        ) : null}
      </button>
      {open ? (
        <ul className="kivotos-machines-list" aria-label={t("machines.label")}>
          <MachineRow
            id={null}
            name={selfName}
            meta={peer === null ? t("machines.current") : t("machines.local")}
            title={undefined}
            status={undefined}
            note={false}
            unavailable={false}
            current={peer === null}
            attention={undefined}
            t={t}
          />
          {machines.machines.map((row) => (
            <PeerRow
              key={row.id}
              machine={row}
              current={row.id === peer}
              attention={summary.rows.get(row.id)}
              now={now}
              t={t}
            />
          ))}
          {note === null ? null : <li className="kivotos-machines-note">{note}</li>}
          {phone ? null : <PairEntry ready={pairReady} t={t} onPair={showPair} />}
        </ul>
      ) : null}
      {pairUrl !== null ? <PairDialog url={pairUrl} t={t} onClose={closePair} /> : null}
    </div>
  );
}

export const inject = ["slots", "locale", "layout"];

/** Slot props Kivotos injects next to the dsh-supplied ones. */
interface Injected {
  t: Translate;
  toggleSidebar: () => void;
}

/** Drawer toggle before the Session title; CSS shows it only on phones. */
function DrawerToggle({ t, toggleSidebar }: Injected): ReactNode {
  const collapsed = useSidebarCollapsed();
  const label = collapsed ? t("drawer.open") : t("drawer.close");
  return (
    <button
      type="button"
      className="kivotos-drawer-toggle"
      aria-label={label}
      title={label}
      aria-expanded={!collapsed}
      onClick={toggleSidebar}
    >
      <DrawerGlyph />
    </button>
  );
}

/** Phone stylesheet plus the open-drawer backdrop. */
function PhoneShell({ t, toggleSidebar }: Injected): ReactNode {
  const phone = useMedia(PHONE);
  const collapsed = useSidebarCollapsed();
  useCloseDrawerOnSelect(phone && !collapsed, toggleSidebar);
  return (
    <>
      <style>{CSS + SETTINGS_CSS}</style>
      {phone && !collapsed ? (
        <button
          type="button"
          className="kivotos-backdrop"
          aria-label={t("drawer.close")}
          onClick={toggleSidebar}
        />
      ) : null}
    </>
  );
}

/** Where the tailnet listener records client reports (index.ts). */
const TRACE_CLIENT_PATH = "/kivotos/trace/client";
/** Give up waiting for the dsh frame after this long and report anyway. */
const TRACE_REPORT_TIMEOUT_MS = 60_000;
/** After the dsh frame renders, wait this long so the report holds its first data requests. */
const TRACE_REPORT_SETTLE_MS = 5_000;
/**
 * Performance marks, which live as long as the document. dsh re-applies the
 * plugin on every reconnect: the first keeps the frame's real render time, the
 * second stops a later run from reporting the reconnect as a page load.
 */
const TRACE_SHELL_MARK = "kivotos:shell-ready";
const TRACE_REPORTED_MARK = "kivotos:trace-reported";

function marked(name: string): boolean {
  return performance.getEntriesByName(name, "mark").length > 0;
}

/** A resource timing entry, reduced to what explains a slow load. */
interface ResourceReport {
  /** Path with a fingerprint in place of the query (`tracePath`). */
  path: string;
  type: string;
  startMs: number;
  durationMs: number;
  /** Request sent to first response byte; -1 when the browser does not expose it. */
  ttfbMs: number;
  /** Bytes over the network (0 when served from the HTTP cache). */
  transferBytes: number;
  cached: boolean;
}

function resourceReport(entry: PerformanceResourceTiming): ResourceReport {
  const url = new URL(entry.name, window.location.href);
  return {
    path: tracePath(url.pathname.slice(0, 160) + url.search),
    type: entry.initiatorType,
    startMs: Math.round(entry.startTime),
    durationMs: Math.round(entry.duration),
    ttfbMs: entry.responseStart > 0 ? Math.round(entry.responseStart - entry.requestStart) : -1,
    transferBytes: entry.transferSize,
    cached: entry.transferSize === 0 && entry.decodedBodySize > 0,
  };
}

/**
 * On pages the tailnet listener served, report once how this page loaded as
 * the phone saw it: navigation phases, every resource, and when the dsh frame
 * first rendered. The listener writes it to its trace log next to its own
 * timings.
 *
 * The frame is the marker because it exists at every width; Session rows do
 * not exist while the phone drawer is closed.
 * @returns cleanup that cancels a report not yet sent.
 */
function reportLoadTiming(): () => void {
  if (marked(TRACE_REPORTED_MARK)) return () => undefined;
  let frame = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const send = (): void => {
    if (marked(TRACE_REPORTED_MARK)) return;
    performance.mark(TRACE_REPORTED_MARK);
    const shell = performance.getEntriesByName(TRACE_SHELL_MARK, "mark")[0];
    // Entry types are fixed by the type string asked for.
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const report = {
      page: window.location.pathname,
      navigation:
        nav === undefined
          ? null
          : {
              connectMs: Math.round(nav.connectEnd - nav.connectStart),
              ttfbMs: Math.round(nav.responseStart - nav.requestStart),
              responseEndMs: Math.round(nav.responseEnd),
              domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
              loadMs: Math.round(nav.loadEventEnd),
            },
      shellReadyMs: shell === undefined ? null : Math.round(shell.startTime),
      resources: resources.map(resourceReport),
    };
    void fetch(TRACE_CLIENT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => undefined);
  };
  const watch = (): void => {
    if (document.querySelector("[data-shell-overlay]") === null) {
      frame = requestAnimationFrame(watch);
      return;
    }
    if (!marked(TRACE_SHELL_MARK)) performance.mark(TRACE_SHELL_MARK);
    settle = setTimeout(send, TRACE_REPORT_SETTLE_MS);
  };
  frame = requestAnimationFrame(watch);
  const timeout = setTimeout(send, TRACE_REPORT_TIMEOUT_MS);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(settle);
    clearTimeout(timeout);
  };
}
/**
 * Client plugin body: dictionaries and the three slot contributions.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () =>
      ctx.locale.register(NS, {
        zh: { ...ZH, ...SETTINGS_ZH },
        en: { ...EN, ...SETTINGS_EN },
      }),
    "kivotos: dictionaries",
  );
  const t = ctx.locale.bind(NS);
  // Set by the tailnet listener on pages it serves (index.ts TRACE_FLAG).
  if (Reflect.get(globalThis, "__KIVOTOS_TRACE__") === true) {
    ctx.effect(reportLoadTiming, "kivotos: load timing report");
  }
  // The other machines' waits and finished turns: switcher badges and system notifications.
  ctx.effect(() => followAttention(t), "kivotos: attention");
  // One stable function for every render, injected as a slot prop.
  const injected = { toggleSidebar: (): void => ctx.layout.toggleSidebar() };
  const props = (): typeof injected => injected;
  const section = { inApp: IN_APP };
  const sectionProps = (): typeof section => section;

  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      { name: "sidebar.footer.action", id: "kivotos-machines", order: 10, locale: NS },
      MachineSwitcher,
    ),
  );
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "kivotos",
        order: 50,
        label: () => t("settings.nav"),
        locale: NS,
        inject: sectionProps,
      },
      LinksSection,
    ),
  );
  ctx.slots.inject("conversation.header.leading", () =>
    ctx.slots.register(
      { name: "conversation.header.leading", locale: NS, inject: props },
      DrawerToggle,
    ),
  );
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      { name: "shell.overlay", id: "kivotos-phone", locale: NS, inject: props },
      PhoneShell,
    ),
  );
}
