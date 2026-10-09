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
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

/** Locale lookup bound to the plugin's namespace. */
type Translate = (key: string, params?: Record<string, unknown>) => string;

/** The slice of the dsh 0.2.1-alpha.1 Client context Kivotos uses. */
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
const PHONE = "(max-width: 767px)";
const PEER_PATH = /^\/kivotos\/peer\/([^/]+)\//;
const ZH = {
  "machines.label": "机器",
  "machines.local": "本机",
  "machines.current": "当前",
  "machines.empty": "未发现其它机器",
  "machines.failed": "无法读取机器列表",
  "machines.open": "打开 {name}",
  "machines.via": "经由 {name}",
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
  "drawer.open": "Open sidebar",
  "drawer.close": "Close sidebar",
};

/**
 * Phone layout. AppFrame and SidebarRoot class names are CSS-module hashes
 * of dsh 0.2.1-alpha.1; selectors match the stable `_<name>` suffix. This
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

interface Machine {
  id: string;
  name: string;
  os: string;
}

interface Machines {
  state: "loading" | "ready" | "failed";
  /** The serving host. */
  self: { name: string; os: string } | null;
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

/** Machine switcher in the sidebar foot. */
function MachineSwitcher({ wide, t }: { wide: boolean; t: Translate }): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const machines = useMachines(open);
  const peer = currentPeer();
  const toggle = useCallback(() => setOpen((value) => !value), []);

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

  return (
    <div ref={root} className="kivotos-machines">
      <button
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
        </ul>
      ) : null}
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

/**
 * Client plugin body: dictionaries and the three slot contributions.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), "kivotos: dictionaries");
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
