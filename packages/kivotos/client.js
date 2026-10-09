/**
 * Kivotos Client module.
 *
 * - `sidebar.footer.action`: machine switcher. It lists the serving host and
 *   the peers it mounts under `/kivotos/peer/<id>/`, and navigates between them.
 * - `conversation.header.leading`: drawer toggle, shown only on phones.
 * - `shell.overlay`: drawer backdrop plus the phone layout stylesheet. The
 *   stylesheet renders as a React element, so unmounting the plugin removes it.
 */
window.__ModuleLoader__.load({
  id: "@kivotos/dsh-plugin",
  /** @param {(id: "react") => ReactModule} require - dsh module require. */
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

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
    const EN = {
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

    /** @returns {string | null} peer id of the current page, or null on the serving host. */
    function currentPeer() {
      const match = PEER_PATH.exec(window.location.pathname);
      return match === null ? null : decodeURIComponent(match[1]);
    }

    /**
     * Track a media query.
     * @param {string} query - media query.
     * @returns {boolean} whether it matches.
     */
    function useMedia(query) {
      const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
      useEffect(() => {
        const list = window.matchMedia(query);
        const onChange = () => setMatches(list.matches);
        onChange();
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
      }, [query]);
      return matches;
    }

    /**
     * Track the AppFrame's collapsed-sidebar attribute.
     * @returns {boolean} whether the sidebar is collapsed.
     */
    function useSidebarCollapsed() {
      const [collapsed, setCollapsed] = useState(true);
      useEffect(() => {
        const layer = document.querySelector("[data-shell-overlay]");
        const frame = layer?.parentElement;
        if (frame === null || frame === undefined) return undefined;
        const read = () => setCollapsed(frame.hasAttribute("data-sidebar-collapsed"));
        read();
        const observer = new MutationObserver(read);
        observer.observe(frame, { attributes: true, attributeFilter: ["data-sidebar-collapsed"] });
        return () => observer.disconnect();
      }, []);
      return collapsed;
    }

    /** Monitor glyph (original artwork, currentColor). */
    function MachineGlyph() {
      return h(
        "svg",
        { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true },
        h("rect", {
          x: 2.5,
          y: 3.5,
          width: 15,
          height: 10,
          rx: 2,
          stroke: "currentColor",
          strokeWidth: 1.4,
        }),
        h("path", {
          d: "M7 16.5h6M10 13.5v3",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinecap: "round",
        }),
      );
    }

    /** Drawer glyph (original artwork, currentColor). */
    function DrawerGlyph() {
      return h(
        "svg",
        { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
        h("path", {
          d: "M2.5 4h11M2.5 8h11M2.5 12h7",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinecap: "round",
        }),
      );
    }

    /**
     * @typedef {object} Machines
     * @property {"loading" | "ready" | "failed"} state - load state.
     * @property {{ name: string, os: string } | null} self - the serving host.
     * @property {{ id: string, name: string, os: string }[]} peers - mounted peers.
     */

    /** @type {Machines} */
    const LOADING = { state: "loading", self: null, peers: [] };

    /**
     * Load the serving host's machine list.
     * @param {boolean} open - whether the list is open; opening refetches.
     * @returns {Machines} list.
     */
    function useMachines(open) {
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
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
          .then((body) => setData({ state: "ready", self: body.self, peers: body.peers }))
          .catch(() => {
            if (!abort.signal.aborted) setData((prev) => ({ ...prev, state: "failed" }));
          });
        return () => abort.abort();
      }, [open]);
      return data;
    }

    /**
     * One machine row.
     * @param {{ id: string | null, name: string, meta: string, current: boolean, label: string }} props - row.
     */
    function MachineRow({ id, name, meta, current, label }) {
      const onClick = useCallback(() => {
        if (current) return;
        window.location.assign(id === null ? "/" : `/kivotos/peer/${encodeURIComponent(id)}/`);
      }, [current, id]);
      return h(
        "li",
        null,
        h(
          "button",
          {
            type: "button",
            className: "kivotos-machines-item",
            "aria-current": current ? "true" : undefined,
            "aria-label": label,
            onClick,
          },
          h(MachineGlyph),
          h("span", { className: "kivotos-machines-name" }, name),
          h("span", { className: "kivotos-machines-meta" }, meta),
        ),
      );
    }

    /**
     * Machine switcher in the sidebar foot.
     * @param {{ wide: boolean, t: Translate }} props - slot props.
     */
    function MachineSwitcher({ wide, t }) {
      const [open, setOpen] = useState(false);
      const root = useRef(/** @type {HTMLDivElement | null} */ (null));
      const machines = useMachines(open);
      const peer = currentPeer();
      const toggle = useCallback(() => setOpen((/** @type {boolean} */ value) => !value), []);

      useEffect(() => {
        if (!open) return undefined;
        const onPointer = (/** @type {PointerEvent} */ event) => {
          if (root.current !== null && !root.current.contains(/** @type {Node} */ (event.target)))
            setOpen(false);
        };
        const onKey = (/** @type {KeyboardEvent} */ event) => {
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

      const selfName = machines.self?.name ?? "";
      const rows = [
        h(MachineRow, {
          key: "self",
          id: null,
          name: selfName === "" ? t("machines.local") : selfName,
          meta: peer === null ? t("machines.current") : t("machines.local"),
          current: peer === null,
          label: t("machines.open", { name: selfName === "" ? t("machines.local") : selfName }),
        }),
        ...machines.peers.map((row) =>
          h(MachineRow, {
            key: row.id,
            id: row.id,
            name: row.name,
            meta:
              row.id === peer
                ? t("machines.current")
                : t("machines.via", { name: selfName || t("machines.local") }),
            current: row.id === peer,
            label: t("machines.open", { name: row.name }),
          }),
        ),
      ];
      let note = null;
      if (machines.state === "failed") note = t("machines.failed");
      else if (machines.state === "ready" && machines.peers.length === 0)
        note = t("machines.empty");

      return h(
        "div",
        { ref: root, className: "kivotos-machines" },
        h(
          "button",
          {
            type: "button",
            className: "kivotos-machines-trigger",
            "aria-haspopup": "true",
            "aria-expanded": open,
            "aria-label": t("machines.label"),
            title: wide ? undefined : currentName,
            "data-narrow": wide ? undefined : "",
            onClick: toggle,
          },
          h(MachineGlyph),
          wide ? h("span", { className: "kivotos-machines-label" }, currentName) : null,
          wide && machines.state === "ready"
            ? h("span", { className: "kivotos-machines-count" }, String(machines.peers.length + 1))
            : null,
        ),
        open
          ? h(
              "ul",
              { className: "kivotos-machines-list", "aria-label": t("machines.label") },
              rows,
              note === null ? null : h("li", { className: "kivotos-machines-note" }, note),
            )
          : null,
      );
    }

    return {
      inject: ["slots", "locale", "layout"],
      /** @param {ClientContext} ctx - Client plugin context. */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), "kivotos: dictionaries");
        const toggleSidebar = () => ctx.layout.toggleSidebar();

        /**
         * Drawer toggle before the Session title; CSS shows it only on phones.
         * @param {{ t: Translate }} props - slot props.
         */
        function DrawerToggle({ t }) {
          const collapsed = useSidebarCollapsed();
          const label = collapsed ? t("drawer.open") : t("drawer.close");
          return h(
            "button",
            {
              type: "button",
              className: "kivotos-drawer-toggle",
              "aria-label": label,
              title: label,
              "aria-expanded": !collapsed,
              onClick: toggleSidebar,
            },
            h(DrawerGlyph),
          );
        }

        /**
         * Phone stylesheet plus the open-drawer backdrop.
         * @param {{ t: Translate }} props - slot props.
         */
        function PhoneShell({ t }) {
          const phone = useMedia(PHONE);
          const collapsed = useSidebarCollapsed();
          return h(
            React.Fragment,
            null,
            h("style", null, CSS),
            phone && !collapsed
              ? h("button", {
                  type: "button",
                  className: "kivotos-backdrop",
                  "aria-label": t("drawer.close"),
                  onClick: toggleSidebar,
                })
              : null,
          );
        }

        ctx.slots.inject("sidebar.footer.action", () =>
          ctx.slots.register(
            { name: "sidebar.footer.action", id: "kivotos-machines", order: 10, locale: NS },
            MachineSwitcher,
          ),
        );
        ctx.slots.inject("conversation.header.leading", () =>
          ctx.slots.register({ name: "conversation.header.leading", locale: NS }, DrawerToggle),
        );
        ctx.slots.inject("shell.overlay", () =>
          ctx.slots.register(
            { name: "shell.overlay", id: "kivotos-phone", locale: NS },
            PhoneShell,
          ),
        );
      },
    };
  },
});
