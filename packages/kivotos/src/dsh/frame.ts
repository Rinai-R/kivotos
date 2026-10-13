/**
 * dsh 0.2.0-rc.2's rendered frame, as the phone stylesheet repositions it.
 *
 * dsh ships no phone layout and no slot owns the frame grid, so the phone
 * stylesheet reads dsh internals: CSS-module class suffixes (`_sidebarCol`,
 * matched as `[class*="_sidebarCol"]`, since the prefix is a build hash) and
 * data attributes. This is a deliberate, version-pinned exception to "do not
 * read another plugin's DOM" (CLAUDE.md).
 *
 * The stylesheet is three groups, one per coupling point, and each is built
 * from the same {@link PARTS} its probe checks:
 *
 * - `phone-layout`: the frame grid becomes a drawer (ui-layout AppFrame);
 * - `phone-conversation`: header, composer and scroller spacing
 *   (ui-conversation ConversationRoot);
 * - `phone-settings`: the Settings panel fills the screen with its sections
 *   as a scrolling tab row (ui-settings SettingsPanel).
 *
 * A group whose probe failed is withheld; dsh's own layout stays.
 *
 * No Node imports: the Client bundle includes this module.
 */
import { changed, missing, ok, usable, type CompatReport, type Probe } from "./compat.ts";

const suffix = (name: string): string => `[class*="_${name}"]`;

/** Every piece of dsh markup the phone stylesheet and the drawer rely on. */
export const PARTS = {
  /** AppFrame's overlay layer; the frame is its parent. */
  overlay: "[data-shell-overlay]",
  sidebarCol: suffix("sidebarCol"),
  centerCol: suffix("centerCol"),
  rightbarCol: suffix("rightbarCol"),
  /** Drag handle, a frame child only while the sidebar is expanded. */
  handle: suffix("handle"),
  /** SidebarRoot, two levels inside the sidebar column. */
  sidebarRoot: suffix("root"),
  /** Set on the frame while the sidebar is collapsed. */
  collapsed: "data-sidebar-collapsed",
  /** The slot container of `conversation.header.leading`, inside the header. */
  headerLeading: "[data-conversation-header-leading]",
  header: suffix("header"),
  composer: "[data-composer-seat]",
  composerSeat: suffix("composerSeat"),
  content: "[data-conversation-content]",
  scroll: "[data-conversation-scroll]",
  settings: '[data-shortcut-modal="settings"]',
  navList: suffix("navList"),
  navCell: suffix("navCell"),
  navLabel: suffix("navLabel"),
  settingsContent: suffix("content"),
  options: suffix("options"),
  /** Theme picker cells, on the General section only: cosmetic, not judged. */
  themeCube: suffix("themeCube"),
  /** A Session row in the sidebar tree; workspace folders carry aria-expanded. */
  treeItem: "[role=treeitem]",
} as const;

const P = PARTS;
/** The frame, found by its overlay child. */
const FRAME = `div:has(> ${P.overlay})`;

/** The element reads a probe makes; `Element` satisfies it. */
export interface FrameNode {
  readonly parentElement: FrameNode | null;
  readonly children: ArrayLike<FrameNode>;
  readonly tagName: string;
  matches(selectors: string): boolean;
  querySelector(selectors: string): FrameNode | null;
}

/** The page read a probe makes; `Document` satisfies it. */
export interface FramePage {
  querySelector(selectors: string): FrameNode | null;
}

function child(node: FrameNode, selector: string): FrameNode | undefined {
  return Array.from(node.children).find((each) => each.matches(selector));
}

/**
 * The frame grid the drawer layout positions. Point `phone-layout`; undefined
 * until dsh has rendered its frame.
 * @param page - the page dsh rendered.
 */
export function probePhoneLayout(page: FramePage): Probe | undefined {
  const overlay = page.querySelector(P.overlay);
  if (overlay === null) return undefined;
  const frame = overlay.parentElement;
  if (frame === null) return missing(`${P.overlay} has no frame around it`);
  const absent = (["sidebarCol", "centerCol", "rightbarCol"] as const).filter(
    (column) => child(frame, P[column]) === undefined,
  );
  if (absent.length > 0) return changed(`the frame has no ${absent.join(", ")} column`);
  const sidebar = child(frame, P.sidebarCol);
  const root = Array.from(sidebar?.children ?? []).some(
    (inner) => child(inner, P.sidebarRoot) !== undefined,
  );
  if (!root) return changed(`the sidebar column has no ${P.sidebarRoot} two levels in`);
  return ok("the AppFrame matches the pinned grid");
}

/**
 * The conversation's header, composer and scroller. Point
 * `phone-conversation`; judged once a conversation view is on the page.
 * @param page - the page dsh rendered.
 */
export function probePhoneConversation(page: FramePage): Probe | undefined {
  const leading = page.querySelector(P.headerLeading);
  const composer = page.querySelector(P.composer);
  const content = page.querySelector(P.content);
  if (leading === null || composer === null || content === null) return undefined;
  const wrong: string[] = [];
  if (leading.parentElement?.matches(P.header) !== true)
    wrong.push(`header leading outside ${P.header}`);
  if (!composer.matches(P.composerSeat)) wrong.push(`composer seat without ${P.composerSeat}`);
  if (content.querySelector(P.scroll) === null) wrong.push(`conversation without ${P.scroll}`);
  if (wrong.length > 0) return changed(wrong.join("; "));
  return ok("the conversation matches the pinned markup");
}

/**
 * The Settings panel. Point `phone-settings`; judged while the panel is open.
 * @param page - the page dsh rendered.
 */
export function probePhoneSettings(page: FramePage): Probe | undefined {
  const panel = page.querySelector(P.settings);
  if (panel === null) return undefined;
  const nav = child(panel, "nav");
  const content = child(panel, P.settingsContent);
  const absent: string[] = [];
  if (nav === undefined) absent.push("nav");
  else {
    if (child(nav, P.navList) === undefined) absent.push(`nav > ${P.navList}`);
    if (nav.querySelector(P.navCell) === null) absent.push(P.navCell);
    if (nav.querySelector(P.navLabel) === null) absent.push(P.navLabel);
  }
  if (content === undefined) absent.push(P.settingsContent);
  else {
    if (child(content, P.header) === undefined) absent.push(`${P.settingsContent} > ${P.header}`);
    if (child(content, P.options) === undefined) absent.push(`${P.settingsContent} > ${P.options}`);
  }
  if (absent.length > 0) return changed(`the Settings panel has no ${absent.join(", ")}`);
  return ok("the Settings panel matches the pinned markup");
}

const LAYOUT_CSS = (phone: string): string => `
@media ${phone}{
  html{--dsh-frame-top-clearance:env(safe-area-inset-top,0px);--dsh-frame-overlay-top:calc(env(safe-area-inset-top,0px) + 12px);--dsh-frame-chrome-top:env(safe-area-inset-top,0px)}
  html,body{overscroll-behavior:none}
  ${FRAME}{grid-template-columns:0 minmax(0,1fr) 0!important;height:100dvh;box-sizing:border-box;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px);transition:none!important}
  ${FRAME} > ${P.handle}{display:none}
  ${FRAME} > ${P.centerCol}{grid-column:2;grid-row:1}
  ${FRAME} > ${P.rightbarCol}{grid-column:3;grid-row:1}
  ${FRAME} > ${P.sidebarCol}{position:fixed;inset:0 auto 0 0;z-index:30;box-sizing:border-box;width:min(86vw,320px);padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);box-shadow:var(--dsw-shadow-lv3);transition:transform var(--ds-transition-duration-slow,240ms) var(--ds-ease-in-out,ease)}
  ${FRAME}[${P.collapsed}] > ${P.sidebarCol}{transform:translateX(calc(-100% - 24px));box-shadow:none}
  ${FRAME} > ${P.sidebarCol} > * > ${P.sidebarRoot}{width:100%!important}
  ${P.headerLeading} .kivotos-drawer-toggle{display:inline-flex}
}
@media ${phone} and (prefers-reduced-motion:reduce){
  ${FRAME} > ${P.sidebarCol}{transition:none}
}`;

const CONVERSATION_CSS = (phone: string): string => `
@media ${phone}{
  ${P.header}:has(> ${P.headerLeading}){padding-left:12px!important;padding-right:12px!important}
  ${P.composerSeat}{padding-bottom:env(safe-area-inset-bottom,0px)}
  ${P.scroll}{overscroll-behavior:contain}
}`;

const SETTINGS_CSS = (phone: string): string => `
@media ${phone}{
  ${P.settings}{flex-direction:column;width:100vw;max-width:100vw;height:100dvh;box-sizing:border-box;border-radius:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px)}
  ${P.settings} > nav{width:auto;gap:10px;padding:14px 12px 8px}
  ${P.settings} > nav > ${P.navList}{flex-direction:row;overflow:auto hidden;scrollbar-width:none}
  ${P.settings} > nav ${P.navCell},${P.settings} > nav ${P.navLabel}{flex:none}
  ${P.settings} > ${P.settingsContent}{min-height:0}
  ${P.settings} > ${P.settingsContent} > ${P.header}{position:absolute;top:env(safe-area-inset-top,0px);right:env(safe-area-inset-right,0px);height:auto;padding:12px 12px 0 0}
  ${P.settings} > ${P.settingsContent} > ${P.options}{padding:8px 16px calc(16px + env(safe-area-inset-bottom,0px))}
  ${P.settings} ${P.themeCube}{flex:1 1 0;min-width:0;padding:14px 8px}
  ${P.settings} .kivotos-mode-button{width:36px;height:36px}
  ${P.settings} .kivotos-mode-option{min-height:44px}
}`;

/** Phone rules on plain elements: they rely on no dsh markup. */
const TOUCH_CSS = (phone: string): string => `
@media ${phone}{
  button,[role="button"],[role="treeitem"]{touch-action:manipulation}
  input,textarea,select,[contenteditable="true"]{font-size:max(16px,1em)}
}`;

/**
 * The phone stylesheet, without the groups whose probe failed.
 * @param report - the page's compat report.
 * @param phone - the media query that means a phone.
 * @returns CSS text.
 */
export function phoneStylesheet(report: CompatReport, phone: string): string {
  let css = TOUCH_CSS(phone);
  if (usable(report, "phone-layout")) css += LAYOUT_CSS(phone);
  if (usable(report, "phone-conversation")) css += CONVERSATION_CSS(phone);
  if (usable(report, "phone-settings")) css += SETTINGS_CSS(phone);
  return css;
}

/** @returns whether dsh has rendered its frame on the page. */
export function shellRendered(page: FramePage): boolean {
  return page.querySelector(P.overlay) !== null;
}

/**
 * Follow whether the sidebar is collapsed.
 * @param onChange - called with the state now and on every change.
 * @returns the cleanup; a page without the frame calls nothing.
 */
export function watchSidebarCollapsed(onChange: (collapsed: boolean) => void): () => void {
  const frame = document.querySelector(P.overlay)?.parentElement;
  if (frame === null || frame === undefined) return () => undefined;
  const read = (): void => onChange(frame.hasAttribute(P.collapsed));
  read();
  const observer = new MutationObserver(read);
  observer.observe(frame, { attributes: true, attributeFilter: [P.collapsed] });
  return () => observer.disconnect();
}

/**
 * Call back when a tap in the sidebar opens a Session: a tap on a Session
 * row, not on a row's own buttons or menu, and not on a workspace folder.
 * @param onOpen - called after the tap.
 * @returns the cleanup.
 */
export function onSessionRowTap(onOpen: () => void): () => void {
  const sidebar = document.querySelector(P.sidebarCol);
  const onClick = (event: Event): void => {
    const target = event.target as Element | null;
    if (target?.closest("button, [role=menuitem]")) return;
    const row = target?.closest(P.treeItem);
    if (row && !row.hasAttribute("aria-expanded")) requestAnimationFrame(onOpen);
  };
  sidebar?.addEventListener("click", onClick);
  return () => sidebar?.removeEventListener("click", onClick);
}

/** Strings the nightly check expects in dsh's bundles (scripts/dsh-compat.mjs). */
export const MARKERS = Object.values(PARTS)
  .filter((part) => part !== PARTS.treeItem)
  .map(
    (part) => /^\[class\*="(_\w+)"\]$/.exec(part)?.[1] ?? /^\[?([\w-]+)/.exec(part)?.[1] ?? part,
  );
