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
import { createPortal } from "react-dom";
import type { AttentionNotice, AttentionState, PeerAttention } from "./attention-hub.ts";
import type { AttentionFrame } from "./attention.ts";
import {
  compatReportOf,
  COMPAT_GLOBAL,
  failedPoints,
  mergeCompat,
  PageVerdicts,
  usable,
  type CompatPoint,
  type CompatReport,
} from "./dsh/compat.ts";
import { DESKTOP_SCHEME, desktopBridge, probeDesktopBridge } from "./dsh/desktop.ts";
import {
  onSessionRowTap,
  phoneStylesheet,
  probePhoneConversation,
  probePhoneLayout,
  probePhoneSettings,
  shellRendered,
  watchSidebarCollapsed,
} from "./dsh/frame.ts";
import {
  currentSession,
  probeSessionStore,
  rawSelection,
  selectSession,
  SESSION_FRAGMENT,
} from "./dsh/sessions.ts";
import type { MachineInfo } from "./machines.ts";
import {
  LinksSection,
  machineListOf,
  PairDialog,
  SETTINGS_CSS,
  SETTINGS_EN,
  SETTINGS_ZH,
  machineSummary,
  machineTip,
  type MachineSummary,
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
  "machines.local": "本机",
  "machines.selfCurrent": "本机 · 当前",
  "machines.ready": "{where} · {count} 台可用",
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
  "compat.notice": "dsh 的内部结构有变，Kivotos 已停用：{features}。",
  "compat.separator": "、",
  "compat.dismiss": "知道了",
  "compat.viewport": "手机安全区域布局",
  "compat.manifest": "被挂载机器的 Web 清单",
  "compat.bootGraph": "被挂载机器的缓存预热",
  "compat.desktopBoot": "桌面应用中的其它机器",
  "compat.phoneLayout": "手机抽屉布局",
  "compat.phoneConversation": "手机上的会话页边距",
  "compat.phoneSettings": "手机全屏设置页",
  "compat.sessionStore": "按会话打开机器",
  "machines.blockedDesktop": "已停用：桌面应用的启动方式已变化",
};
const EN: Record<keyof typeof ZH, string> = {
  "machines.local": "This computer",
  "machines.selfCurrent": "This computer · Current",
  "machines.ready": "{where} · {count} ready",
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
  "compat.notice": "Part of dsh changed, so Kivotos turned off: {features}.",
  "compat.separator": ", ",
  "compat.dismiss": "Dismiss",
  "compat.viewport": "Safe-area layout on phones",
  "compat.manifest": "The web manifest of a mounted machine",
  "compat.bootGraph": "Cache warm-up for a mounted machine",
  "compat.desktopBoot": "Other machines in the desktop app",
  "compat.phoneLayout": "The phone drawer layout",
  "compat.phoneConversation": "Conversation spacing on phones",
  "compat.phoneSettings": "Full-screen Settings on phones",
  "compat.sessionStore": "Opening a machine on a Session",
  "machines.blockedDesktop": "Off: the desktop app's boot changed",
};

/** The machine switcher, the drawer toggle and the backdrop: Kivotos' own markup. */
const BASE_CSS = `
.kivotos-machines{position:relative;display:flex;width:100%;margin:8px 0 0}
.kivotos-machines-trigger{display:flex;align-items:center;gap:10px;box-sizing:border-box;width:calc(100% + 4px);min-height:48px;margin:0 -2px;padding:6px 10px 6px 14px;border:none;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px;text-align:left;cursor:pointer;overflow:hidden}
.kivotos-machines-trigger:hover,.kivotos-machines-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-machines-trigger[data-narrow]{position:relative;justify-content:center;width:40px;min-height:42px;padding:0;margin:0}
.kivotos-machines-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kivotos-machines-chevron{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary);transition:transform 120ms}
.kivotos-machines-trigger[aria-expanded="true"] .kivotos-machines-chevron{transform:rotate(180deg)}
.kivotos-machines-list{position:absolute;left:0;bottom:calc(100% + 4px);z-index:30;box-sizing:border-box;width:max(100%,240px);max-height:min(60vh,420px);overflow-y:auto;margin:0;padding:4px;list-style:none;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent)}
.kivotos-machines-heading{padding:6px 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px}
.kivotos-machines-item{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:36px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.kivotos-machines-item > .kivotos-dot,.kivotos-machines-trigger > .kivotos-dot{margin:0 3px}
.kivotos-machines-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-machines-item[aria-current="true"]{background:var(--dsw-alias-interactive-bg-hover);cursor:default}
.kivotos-machines-text{display:flex;flex:1;flex-direction:column;min-width:0}
.kivotos-machines-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kivotos-machines-status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
.kivotos-machines-meta{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kivotos-machines-note{padding:8px;color:var(--dsw-alias-label-tertiary);font-size:13px}
.kivotos-machines-separator{border-top:0.5px solid var(--dsw-alias-border-l2);margin-top:4px;padding-top:4px}
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
.kivotos-backdrop{position:fixed;inset:0;z-index:29;border:none;padding:0;background:var(--dsw-alias-bg-mask-1);cursor:default}`;

/**
 * The notice a failed point raises: dsh's own toast (ui-primitives Toast,
 * markup and CSS copied under `kivotos-`), rendered into `document.body` like
 * dsh's, so no stacking context traps it under a modal. It holds for
 * {@link COMPAT_HOLD_MS} with a Dismiss action, then fades; the host log keeps
 * the record.
 */
/** How long the notice stays at full opacity: it names features, so it reads longer than dsh's 3 s. */
const COMPAT_HOLD_MS = 8_000;
/** The notice's fade; the `kivotos-compat-fade` duration below. */
const COMPAT_FADE_MS = 1_000;
const COMPAT_CSS = `
.kivotos-compat{position:fixed;top:calc(40px + env(safe-area-inset-top,0px));left:50%;z-index:1100;pointer-events:none;display:flex;align-items:center;gap:10px;box-sizing:border-box;width:max-content;max-width:min(640px,calc(100vw - 48px));padding:12px 16px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);font-size:14px;line-height:22px;box-shadow:var(--dsw-shadow-lv3);transform:translateX(-50%);animation:kivotos-compat-in 160ms ease-out,kivotos-compat-fade ${COMPAT_FADE_MS}ms ease ${COMPAT_HOLD_MS}ms forwards}
.kivotos-compat-icon{display:grid;place-items:center;flex:none;color:var(--dsw-alias-state-warn-label)}
.kivotos-compat-text{min-width:0}
.kivotos-compat-action{display:inline;padding:0;margin-inline:3px;border:0;background:none;color:var(--dsw-alias-link);font:inherit;cursor:pointer;pointer-events:auto}
.kivotos-compat-action:hover{opacity:.8}
@keyframes kivotos-compat-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes kivotos-compat-fade{to{opacity:0;visibility:hidden}}
@media (prefers-reduced-motion:reduce){.kivotos-compat{animation:kivotos-compat-fade ${COMPAT_FADE_MS}ms ease ${COMPAT_HOLD_MS}ms forwards}}
`;
/**
 * Where a point's feature does anything: the notice names a failure only
 * there. The phone layout and the safe-area viewport change nothing on a
 * computer, and the desktop guard only runs inside the desktop app.
 */
const FELT_ON: Record<CompatPoint, (phone: boolean, desktop: boolean) => boolean> = {
  viewport: (phone) => phone,
  manifest: () => true,
  "boot-graph": () => true,
  "desktop-boot": (_phone, desktop) => desktop,
  "phone-layout": (phone) => phone,
  "phone-conversation": (phone) => phone,
  "phone-settings": (phone) => phone,
  "session-store": () => true,
};
/** This tab's last announced failures, so a navigation does not repeat the notice. */
const COMPAT_SHOWN_KEY = "kivotos:compat-shown";

/** The locale key naming each coupling point in the notice. */
const COMPAT_KEYS: Record<CompatPoint, keyof typeof EN> = {
  viewport: "compat.viewport",
  manifest: "compat.manifest",
  "boot-graph": "compat.bootGraph",
  "desktop-boot": "compat.desktopBoot",
  "phone-layout": "compat.phoneLayout",
  "phone-conversation": "compat.phoneConversation",
  "phone-settings": "compat.phoneSettings",
  "session-store": "compat.sessionStore",
};

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

/** Track whether dsh's sidebar is collapsed (dsh/frame.ts). */
function useSidebarCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => watchSidebarCollapsed(setCollapsed), []);
  return collapsed;
}

/** The serving host's merged stream of the other machines' attention (attention-hub.ts). */
const ATTENTION_PATH = "/kivotos/attention";
const ATTENTION_SEEN_PATH = "/kivotos/attention/seen";
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

/** The latest dsh compatibility report, shared by the page's Kivotos surfaces. */
let compat: CompatReport = {};
const compatListeners = new Set<() => void>();

function subscribeCompat(listener: () => void): () => void {
  compatListeners.add(listener);
  return () => compatListeners.delete(listener);
}

function setCompat(next: CompatReport): void {
  compat = next;
  for (const listener of compatListeners) listener();
}

/** @returns the page's compat report; a point that was not probed is absent. */
function useCompat(): CompatReport {
  return useSyncExternalStore(subscribeCompat, () => compat);
}

/** The page probes, by the point each judges (dsh/frame.ts, dsh/sessions.ts). */
const PAGE_PROBES = {
  "phone-layout": () => probePhoneLayout(document),
  "phone-conversation": () => probePhoneConversation(document),
  "phone-settings": () => probePhoneSettings(document),
  "session-store": () => probeSessionStore(window.localStorage, document),
} satisfies Partial<Record<CompatPoint, () => unknown>>;
/** The Session store changes without touching the DOM: read it this often as well. */
const STORE_RECHECK_MS = 2_000;

/**
 * Settle the page's side of the coupling points. The host's results ride in
 * on the page; these judge what only the browser sees, as dsh renders it: the
 * frame, an open conversation, the Settings panel when it opens, the Session
 * store once a Session is shown. Each is read after the DOM changes, in the
 * next frame, until {@link PageVerdicts} has settled it; then the observer
 * stops.
 * @returns the cleanup.
 */
function watchCompat(): () => void {
  const host = compatReportOf(Reflect.get(globalThis, COMPAT_GLOBAL));
  const verdicts = new PageVerdicts();
  let desktop: CompatReport = {};
  let frame = 0;
  const publish = (): void => setCompat(mergeCompat(mergeCompat(host, desktop), verdicts.report()));
  const open = (): CompatPoint[] =>
    (Object.keys(PAGE_PROBES) as (keyof typeof PAGE_PROBES)[]).filter(
      (point) => !verdicts.isSettled(point),
    );
  const read = (): void => {
    frame = 0;
    const readings: CompatReport = {};
    for (const point of open()) {
      const probe = PAGE_PROBES[point as keyof typeof PAGE_PROBES]();
      if (probe !== undefined) readings[point] = probe;
    }
    if (verdicts.read(readings)) publish();
    if (open().length === 0) stop();
    // A failure waits for the next frame's reading to agree.
    else if (Object.keys(readings).some((point) => !verdicts.isSettled(point as CompatPoint)))
      schedule();
  };
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(read);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const timer = window.setInterval(schedule, STORE_RECHECK_MS);
  const stop = (): void => {
    observer.disconnect();
    window.clearInterval(timer);
    cancelAnimationFrame(frame);
    frame = 0;
  };
  publish();
  schedule();
  // Only the desktop window has a shell to ask, and its answer is final.
  if (window.location.protocol === DESKTOP_SCHEME) {
    void (async () => {
      desktop = { "desktop-boot": await probeDesktopBridge(desktopBridge()) };
      publish();
    })();
  }
  return stop;
}

/**
 * Open a mounted machine on one Session. This page's localStorage is its own
 * machine's namespace only, so another machine gets the Session in the URL
 * fragment, which its namespace script stores before dsh starts.
 *
 * `session-store` not being `ok` means dsh no longer reads the key Kivotos
 * writes (compat.ts): the machine opens at its own current Session instead of
 * at this one, rather than reloading to the same page forever.
 * @param peer - peer id of the machine to open.
 * @param sessionId - the Session to open on it.
 */
function openSession(peer: string, sessionId: string): void {
  if (!usable(compat, "session-store")) {
    openMachine(peer);
    return;
  }
  if (peer === currentPeer()) {
    selectSession(window.localStorage, sessionId);
    window.location.reload();
    return;
  }
  window.location.assign(
    `/kivotos/peer/${encodeURIComponent(peer)}/${SESSION_FRAGMENT}${encodeURIComponent(sessionId)}`,
  );
}

/**
 * Open a machine at whatever it was last showing.
 * @param peer - peer id, or null for the serving host.
 */
function openMachine(peer: string | null): void {
  if (peer === currentPeer()) {
    window.location.reload();
    return;
  }
  window.location.assign(peer === null ? "/" : `/kivotos/peer/${encodeURIComponent(peer)}/`);
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
    frame.sessionId === currentSession(window.localStorage);
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
 * - a tap on a Session row, which also catches the Session already open
 *   (dsh/frame.ts `onSessionRowTap`).
 * - a change of the current Session, which catches New Session and any
 *   other way dsh switches. The store writes synchronously in dsh's click
 *   handler, and same-document storage writes fire no event, so it is polled.
 * @param active - phone width with the drawer open.
 * @param close - collapses the drawer.
 */
function useCloseDrawerOnSelect(active: boolean, close: () => void): void {
  useEffect(() => {
    if (!active) return undefined;
    const stopTaps = onSessionRowTap(close);
    const opened = rawSelection(window.localStorage);
    const timer = setInterval(() => {
      if (rawSelection(window.localStorage) !== opened) close();
    }, 150);
    return () => {
      stopTaps();
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
    <svg width={16} height={16} viewBox="0 0 20 20" fill="none" aria-hidden>
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

/** Chevron of the switcher's trigger; it turns over while the menu is open (original artwork). */
function ChevronGlyph(): ReactNode {
  return (
    <svg
      className="kivotos-machines-chevron"
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
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
  /** The dot: how the machine is reached now. */
  state: MachineSummary["state"];
  /** Right-aligned: "This computer", the route, unstable, or why there is none. */
  meta: string;
  /** How the machine is reached, in full: the tooltip and, when it cannot open, the accessible name. */
  title: string | undefined;
  /** No link reaches it: shown, but not openable. */
  unavailable: boolean;
  /** Why opening it is off for now (a failed probe); undefined when it can open. */
  blocked: string | undefined;
  current: boolean;
  /** What the machine waits for and finished; undefined for the serving host. */
  attention: PeerAttention | undefined;
  t: Translate;
}

function MachineRow(props: MachineRowProps): ReactNode {
  const { id, name, state, meta, current, attention: row, t } = props;
  const waiting = row?.pending.length ?? 0;
  const tone = finishedTone(row?.finished ?? []);
  // The oldest wait, else the latest finished turn.
  const target = row?.pending[0]?.sessionId ?? row?.finished.at(-1)?.sessionId;
  const unavailable = props.unavailable || props.blocked !== undefined;
  const title = props.blocked ?? props.title;
  let label = t("machines.open", { name });
  if (unavailable) label = t("machines.unavailable", { name, status: title });
  else if (waiting > 0) label = t("machines.openWaiting", { name, count: waiting });
  else if (tone !== undefined) label = t("machines.openFinished", { name });
  const onClick = useCallback(() => {
    if (
      id !== null &&
      target !== undefined &&
      !(current && target === currentSession(window.localStorage))
    ) {
      openSession(id, target);
      return;
    }
    if (current) return;
    openMachine(id);
  }, [current, id, target]);
  return (
    <li>
      <button
        type="button"
        className="kivotos-machines-item"
        aria-current={current ? "true" : undefined}
        aria-label={label}
        title={title}
        disabled={unavailable}
        onClick={onClick}
      >
        <span className="kivotos-dot" data-state={state} aria-hidden />
        <span className="kivotos-machines-name">{name}</span>
        <AttentionMarks waiting={waiting} tone={tone} />
        <span className="kivotos-machines-meta">{meta}</span>
      </button>
    </li>
  );
}

/** A peer's row in the switcher: one line, its route, unstable, or why it cannot open. */
function PeerRow({
  machine,
  current,
  attention: row,
  blocked,
  now,
  t,
}: {
  machine: MachineInfo;
  current: boolean;
  attention: PeerAttention | undefined;
  /** Why opening this machine is off (a failed probe); undefined when it can open. */
  blocked: string | undefined;
  now: number;
  t: Translate;
}): ReactNode {
  const summary = machineSummary(t, machine, now);
  return (
    <MachineRow
      id={machine.id}
      name={machine.name}
      state={summary.state}
      meta={summary.text}
      title={machineTip(t, machine, now)}
      unavailable={machine.route === null && !current}
      blocked={blocked}
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

/** The switcher's trigger: when wide, the current machine's dot, name and where it is, and a chevron. */
function SwitcherTrigger({
  triggerRef,
  wide,
  open,
  label,
  name,
  state,
  status,
  waiting,
  tone,
  onClick,
}: {
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  wide: boolean;
  open: boolean;
  /** The accessible name, with what waits. */
  label: string;
  name: string;
  state: MachineSummary["state"];
  /** "This computer · 4 ready"; null until the list is read. */
  status: string | null;
  waiting: number;
  tone: "done" | "failed" | undefined;
  onClick: () => void;
}): ReactNode {
  if (!wide) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="kivotos-machines-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        title={name}
        data-narrow=""
        onClick={onClick}
      >
        <MachineGlyph />
        <TriggerMarks wide={false} waiting={waiting} tone={tone} />
      </button>
    );
  }
  return (
    <button
      ref={triggerRef}
      type="button"
      className="kivotos-machines-trigger"
      aria-haspopup="true"
      aria-expanded={open}
      aria-label={label}
      onClick={onClick}
    >
      <span className="kivotos-dot" data-state={state} aria-hidden />
      <span className="kivotos-machines-text">
        <span className="kivotos-machines-label">{name}</span>
        {status === null ? null : <span className="kivotos-machines-status">{status}</span>}
      </span>
      <TriggerMarks wide waiting={waiting} tone={tone} />
      <ChevronGlyph />
    </button>
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
  const report = useCompat();
  // Inside the desktop window a mounted machine's page is only safe while the
  // guard's handshake still answers what it rebases the page's streams onto
  // (compat.ts, `desktop-boot`): opening one anyway takes the window down.
  const blockedPeer =
    window.location.protocol === DESKTOP_SCHEME && !usable(report, "desktop-boot")
      ? t("machines.blockedDesktop")
      : undefined;
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

  const currentMachine = useMemo(
    () => (peer === null ? undefined : machines.machines.find((row) => row.id === peer)),
    [machines.machines, peer],
  );
  const selfName = machines.self.name || t("machines.local");
  const currentName = peer === null ? selfName : (currentMachine?.name ?? peer);
  let note: string | null = null;
  if (machines.state === "failed") note = t("machines.failed");
  else if (machines.state === "ready" && machines.machines.length === 0) note = t("machines.empty");
  const pairReady = machines.state === "ready" && Boolean(machines.self.url);
  // Rendered on open and on every list read, which keeps "last seen" current enough.
  const now = Date.now();
  // This computer and every machine a link reaches.
  const ready = 1 + machines.machines.filter((row) => row.route !== null).length;
  const current: MachineSummary =
    currentMachine === undefined
      ? { state: "online", text: t("machines.local") }
      : machineSummary(t, currentMachine, now);

  return (
    <div ref={root} className="kivotos-machines">
      <SwitcherTrigger
        triggerRef={trigger}
        wide={wide}
        open={open}
        label={summary.label}
        name={currentName}
        state={current.state}
        status={
          machines.state === "ready"
            ? t("machines.ready", { where: current.text, count: ready })
            : null
        }
        waiting={summary.waiting}
        tone={summary.tone}
        onClick={toggle}
      />
      {open ? (
        <ul className="kivotos-machines-list" aria-label={t("machines.label")}>
          <li className="kivotos-machines-heading" aria-hidden>
            {t("machines.label")}
          </li>
          <MachineRow
            id={null}
            name={selfName}
            state="online"
            meta={peer === null ? t("machines.selfCurrent") : t("machines.local")}
            title={undefined}
            unavailable={false}
            blocked={undefined}
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
              blocked={blockedPeer}
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

/**
 * Drawer toggle before the Session title; CSS shows it only on phones.
 *
 * The phone stylesheet is what makes this button visible, and it is withheld
 * when the frame it positions is not there (compat.ts, `phone-layout`): the
 * button would be a control for a layout that no longer exists.
 */
function DrawerToggle({ t, toggleSidebar }: Injected): ReactNode {
  const collapsed = useSidebarCollapsed();
  const report = useCompat();
  if (!usable(report, "phone-layout")) return null;
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

/**
 * Kivotos' stylesheet, the phone layout it only applies when the frame it
 * positions is there, and the open-drawer backdrop.
 */
function PhoneShell({ t, toggleSidebar }: Injected): ReactNode {
  const phone = useMedia(PHONE);
  const collapsed = useSidebarCollapsed();
  const report = useCompat();
  const layout = usable(report, "phone-layout");
  useCloseDrawerOnSelect(layout && phone && !collapsed, toggleSidebar);
  return (
    <>
      <style>{BASE_CSS + SETTINGS_CSS}</style>
      <style>{phoneStylesheet(report, PHONE)}</style>
      {layout && phone && !collapsed ? (
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

/** Warning glyph (original artwork, currentColor). */
function WarningGlyph(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 2.2 14.3 13H1.7L8 2.2Z"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <path d="M8 6.4v3.2" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      <circle cx={8} cy={11.3} r={0.8} fill="currentColor" />
    </svg>
  );
}

/**
 * What a failed point costs: one toast naming each part of Kivotos that is
 * off, once per tab for each set of failures, and only the parts this device
 * would have used ({@link FELT_ON}). The probe's own
 * reason is a diagnostic: it goes to the console and, for the host's probes,
 * the host's log.
 */
function CompatNotice({ t }: { t: Translate }): ReactNode {
  const report = useCompat();
  const phone = useMedia(PHONE);
  const failed = useMemo(() => failedPoints(report), [report]);
  const shown = useMemo(() => {
    const desktop = window.location.protocol === DESKTOP_SCHEME;
    return failed.map(({ point }) => point).filter((point) => FELT_ON[point](phone, desktop));
  }, [failed, phone]);
  const signature = shown.join(",");
  const [visible, setVisible] = useState("");
  const logged = useRef<CompatReport | null>(null);
  useEffect(() => {
    if (logged.current === report) return;
    logged.current = report;
    for (const { point, probe } of failed) console.warn(`kivotos: dsh ${point}: ${probe.reason}`);
  }, [report, failed]);
  useEffect(() => {
    if (signature === "") return undefined;
    // sessionStorage is this tab's, and no dsh store lives there.
    if (window.sessionStorage.getItem(COMPAT_SHOWN_KEY) === signature) return undefined;
    window.sessionStorage.setItem(COMPAT_SHOWN_KEY, signature);
    setVisible(signature);
    const timer = window.setTimeout(() => setVisible(""), COMPAT_HOLD_MS + COMPAT_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [signature]);
  const dismiss = useCallback(() => setVisible(""), []);
  if (visible === "" || visible !== signature) return null;
  const features = shown.map((point) => t(COMPAT_KEYS[point])).join(t("compat.separator"));
  return createPortal(
    <>
      <style>{COMPAT_CSS}</style>
      <div className="kivotos-compat" role="status">
        <span className="kivotos-compat-icon">
          <WarningGlyph />
        </span>
        <span className="kivotos-compat-text">
          {t("compat.notice", { features })}
          <button type="button" className="kivotos-compat-action" onClick={dismiss}>
            {t("compat.dismiss")}
          </button>
        </span>
      </div>
    </>,
    document.body,
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
    if (!shellRendered(document)) {
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
  // What dsh still looks like: which Kivotos features stay on (compat.ts).
  ctx.effect(watchCompat, "kivotos: dsh compatibility probes");
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
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register({ name: "shell.overlay", id: "kivotos-compat", locale: NS }, CompatNotice),
  );
}
