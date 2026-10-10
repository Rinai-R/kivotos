/**
 * Kivotos Client module.
 *
 * - `sidebar.footer.action`: machine switcher. It lists the serving host and
 *   the peers it mounts under `/kivotos/peer/<id>/`, and navigates between them.
 * - `conversation.header.leading`: drawer toggle, shown only on phones.
 * - `shell.overlay`: drawer backdrop plus the phone layout stylesheet. The
 *   stylesheet renders as a React element, so unmounting the plugin removes it.
 *
 * Built by scripts/build.mjs into the `window.__ModuleLoader__.load` form dsh
 * expects, with `react` taken from dsh's module require.
 */
// The classic JSX transform compiles to React.createElement; the bundle takes
// react from dsh's module require, so this is the instance dsh renders with.
import QrCode from "qrcode-generator";
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

/** Locale lookup bound to the plugin's namespace. */
type Translate = (key: string, params?: Record<string, unknown>) => string;

/** The slice of the dsh 0.2.0-rc.2 Client context Kivotos uses. */
interface ClientContext {
  effect(factory: () => () => void, label?: string): void;
  locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void;
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
  "machines.via": "经由 {name}",
  "pair.action": "配对手机",
  "pair.unavailable": "此机器的远程连接尚未就绪",
  "pair.title": "配对手机",
  "pair.instructions": "用手机上的 Kivotos 扫描此二维码，或手动输入下方地址。",
  "pair.qr": "用于配对手机的二维码",
  "pair.address": "配对地址",
  "pair.close": "关闭",
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
  "machines.via": "via {name}",
  "pair.action": "Pair phone",
  "pair.unavailable": "This machine's remote listener is not ready",
  "pair.title": "Pair phone",
  "pair.instructions":
    "Scan this code in Kivotos on your phone, or enter the address below manually.",
  "pair.qr": "QR code to pair your phone",
  "pair.address": "Pairing address",
  "pair.close": "Close",
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
.kivotos-machines-trigger[data-narrow]{justify-content:center;width:40px;padding:0;margin:0}
.kivotos-machines-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kivotos-machines-count{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
.kivotos-machines-list{position:absolute;left:0;bottom:calc(100% + 4px);z-index:30;box-sizing:border-box;width:max(100%,240px);max-height:min(60vh,420px);overflow-y:auto;margin:0;padding:6px;list-style:none;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel)}
.kivotos-machines-item{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.kivotos-machines-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-machines-item[aria-current="true"]{background:var(--dsw-alias-interactive-bg-hover);cursor:default}
.kivotos-machines-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kivotos-machines-meta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kivotos-machines-note{padding:8px;color:var(--dsw-alias-label-tertiary);font-size:13px}
.kivotos-machines-separator{border-top:1px solid var(--dsw-alias-interactive-bg-hover);margin-top:4px;padding-top:4px}
.kivotos-machines-separator .kivotos-machines-note{display:block}
.kivotos-machines-item:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.kivotos-machines-item:disabled:hover{background:transparent}
.kivotos-pair{box-sizing:border-box;width:min(92vw,380px);max-height:90dvh;overflow:auto;margin:auto;padding:24px;border:1px solid var(--dsw-alias-interactive-bg-hover);border-radius:var(--dsw-radius-md);background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-panel);font:inherit}
.kivotos-pair::backdrop{background:var(--dsw-alias-bg-mask-1)}
.kivotos-pair-title{margin:0 0 12px;font-size:18px}
.kivotos-pair-instructions{margin:0 0 18px;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1.5}
.kivotos-pair-qr{display:block;box-sizing:border-box;width:min(100%,260px);height:auto;margin:0 auto 18px;padding:10px;border-radius:8px;background:#fff}
.kivotos-pair-address{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}
.kivotos-pair-url{display:block;margin-top:6px;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:14px;user-select:all}
.kivotos-pair-close{display:block;margin:24px 0 0 auto;min-height:40px;padding:6px 16px;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.kivotos-pair-close:hover{filter:brightness(1.1)}
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

interface Machine {
  id: string;
  name: string;
  os: string;
}

interface Machines {
  state: "loading" | "ready" | "failed";
  /** The serving host. */
  self: { name: string; os: string; url?: string } | null;
  /** Peers it mounts. */
  peers: Machine[];
}

const LOADING: Machines = { state: "loading", self: null, peers: [] };

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
        res.ok
          ? (res.json() as Promise<Omit<Machines, "state">>)
          : Promise.reject(new Error(String(res.status))),
      )
      .then((body) => setData({ state: "ready", self: body.self, peers: body.peers }))
      .catch(() => {
        if (!abort.signal.aborted) setData((prev) => ({ ...prev, state: "failed" }));
      });
    return () => abort.abort();
  }, [open]);
  return data;
}

interface MachineRowProps {
  /** Peer id, or null for the serving host. */
  id: string | null;
  name: string;
  meta: string;
  current: boolean;
  label: string;
}

function MachineRow({ id, name, meta, current, label }: MachineRowProps): ReactNode {
  const onClick = useCallback(() => {
    if (current) return;
    window.location.assign(id === null ? "/" : `/kivotos/peer/${encodeURIComponent(id)}/`);
  }, [current, id]);
  return (
    <li>
      <button
        type="button"
        className="kivotos-machines-item"
        aria-current={current ? "true" : undefined}
        aria-label={label}
        onClick={onClick}
      >
        <MachineGlyph />
        <span className="kivotos-machines-name">{name}</span>
        <span className="kivotos-machines-meta">{meta}</span>
      </button>
    </li>
  );
}

/** Native modal keeps keyboard focus and Escape inside the dialog, even in the phone drawer. */
function PairDialog({
  url,
  t,
  onClose,
}: {
  url: string;
  t: Translate;
  onClose: () => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const dismiss = useCallback(() => dialog.current?.close(), []);

  const qr = useMemo(() => {
    const code = QrCode(0, "M");
    code.addData(`kivotos://pair?url=${encodeURIComponent(url)}`);
    code.make();
    const count = code.getModuleCount();
    const dark: string[] = [];
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (code.isDark(row, col)) dark.push(`M${col + 4} ${row + 4}h1v1h-1z`);
      }
    }
    return { size: count + 8, path: dark.join("") };
  }, [url]);

  return (
    <dialog
      ref={dialog}
      className="kivotos-pair"
      aria-labelledby="kivotos-pair-title"
      aria-describedby="kivotos-pair-instructions"
      onClose={onClose}
    >
      <h2 id="kivotos-pair-title" className="kivotos-pair-title">
        {t("pair.title")}
      </h2>
      <p id="kivotos-pair-instructions" className="kivotos-pair-instructions">
        {t("pair.instructions")}
      </p>
      <svg
        className="kivotos-pair-qr"
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        role="img"
        aria-label={t("pair.qr")}
        shapeRendering="crispEdges"
      >
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={qr.path} fill="#000" />
      </svg>
      <p className="kivotos-pair-address">
        {t("pair.address")}
        <code className="kivotos-pair-url">{url}</code>
      </p>
      <button type="button" className="kivotos-pair-close" autoFocus onClick={dismiss}>
        {t("pair.close")}
      </button>
    </dialog>
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
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const closePair = useCallback(() => {
    setPairUrl(null);
    trigger.current?.focus();
  }, []);
  const showPair = useCallback(() => {
    const url = machines.self?.url;
    if (url === undefined) return;
    setOpen(false);
    setPairUrl(url);
  }, [machines.self?.url]);

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
    return machines.peers.find((row) => row.id === peer)?.name ?? peer;
  }, [machines.peers, peer, t]);

  const selfName = machines.self?.name || t("machines.local");
  let note: string | null = null;
  if (machines.state === "failed") note = t("machines.failed");
  else if (machines.state === "ready" && machines.peers.length === 0) note = t("machines.empty");
  const pairReady = machines.state === "ready" && Boolean(machines.self?.url);

  return (
    <div ref={root} className="kivotos-machines">
      <button
        ref={trigger}
        type="button"
        className="kivotos-machines-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t("machines.label")}
        title={wide ? undefined : currentName}
        data-narrow={wide ? undefined : ""}
        onClick={toggle}
      >
        <MachineGlyph />
        {wide ? <span className="kivotos-machines-label">{currentName}</span> : null}
        {wide && machines.state === "ready" ? (
          <span className="kivotos-machines-count">{String(machines.peers.length + 1)}</span>
        ) : null}
      </button>
      {open ? (
        <ul className="kivotos-machines-list" aria-label={t("machines.label")}>
          <MachineRow
            id={null}
            name={selfName}
            meta={peer === null ? t("machines.current") : t("machines.local")}
            current={peer === null}
            label={t("machines.open", { name: selfName })}
          />
          {machines.peers.map((row) => (
            <MachineRow
              key={row.id}
              id={row.id}
              name={row.name}
              meta={row.id === peer ? t("machines.current") : t("machines.via", { name: selfName })}
              current={row.id === peer}
              label={t("machines.open", { name: row.name })}
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
      <style>{CSS}</style>
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
  /** Path without query. */
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
  return {
    path: new URL(entry.name, window.location.href).pathname.slice(0, 160),
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
  ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), "kivotos: dictionaries");
  // Set by the tailnet listener on pages it serves (index.ts TRACE_FLAG).
  if (Reflect.get(globalThis, "__KIVOTOS_TRACE__") === true) {
    ctx.effect(reportLoadTiming, "kivotos: load timing report");
  }
  // One stable function for every render, injected as a slot prop.
  const injected = { toggleSidebar: (): void => ctx.layout.toggleSidebar() };
  const props = (): typeof injected => injected;

  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      { name: "sidebar.footer.action", id: "kivotos-machines", order: 10, locale: NS },
      MachineSwitcher,
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
