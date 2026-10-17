/**
 * dsh 0.2.1-rc.2's host-local "Open In" controls, as a peer page hides them.
 *
 * The controls launch an application (Finder, an editor, a terminal) on the
 * machine that serves the page. On a page served through a Kivotos peer mount
 * that machine is the other one: the user sits at the serving machine, so the
 * action opens something on a computer they are not using, and a phone cannot
 * reach it at all. The peer page therefore hides every control instead of
 * offering an action it cannot mean. The remote terminal stays available.
 *
 * The attributes are UI hooks, not CSS-module classes: `data-open-target` is
 * the split button, `data-open-path` its document-preview form, and
 * `data-open-path-unpreviewable` the empty-state control. A renamed attribute
 * only stops the hide; it cannot break the page, and the nightly check
 * (scripts/dsh-compat.mjs) reports it first.
 *
 * No Node imports: the Client bundle includes this module.
 */

/** Attributes placed on the controls the host opens applications from. */
export const OPEN_CONTROL_ATTRIBUTES = [
  "data-open-target",
  "data-open-path",
  "data-open-path-unpreviewable",
] as const;

/**
 * @returns the rule that hides every host-local open control on a peer page.
 *   `PhoneShell` adds it beside the plugin's other styles; the attribute is
 *   set only while a peer mount is on screen.
 */
export function hidePeerOpenInApp(): string {
  return `${OPEN_CONTROL_ATTRIBUTES.map((attribute) => `html[data-kivotos-peer] [${attribute}]`).join(",")}{display:none!important}`;
}

/** Strings the nightly check expects in dsh's bundles (scripts/dsh-compat.mjs). */
export const MARKERS = OPEN_CONTROL_ATTRIBUTES;
