import { routeOf, type PhoneProbe } from "../../kivotos/src/machines";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import type { ListedMachine, SwitchTarget } from "./bridge";

/**
 * Pages that stay loaded, shown or hidden: showing one again is instant
 * instead of booting dsh again. A live page costs about 220 MB, so the
 * least recently shown beyond this goes; a peer's page counts like any.
 */
export const LIVE_MAX = 3;

/** Peers' pages loaded ahead of a switch: with the page shown, they fit {@link LIVE_MAX}. */
export const PRELOAD_MAX = LIVE_MAX - 1;

/** A Session to open in a page; `seq` tells two requests for the same Session apart. */
export interface OpenRequest {
  sessionId: string;
  seq: number;
}

/**
 * A mounted WebView: one of the phone's machines, or a machine its computer
 * mounts (a peer the phone has no row for), loaded through the same door.
 */
export interface LiveView {
  /** `<machine id>`, or `<machine id>#<peer id>` for a peer of it. */
  key: string;
  /** The phone's machine whose door the page loads through. */
  machine: string;
  /** The peer the page shows, as its computer mounts it (`/kivotos/peer/<id>/`); null for the machine itself. */
  peer: { id: string; name: string } | null;
  /** Part of the WebView's key: a new one loads the page again. */
  generation: number;
  /** {@link doorOf} when the page was loaded. */
  door: string;
  /** A Session to open in it; null for whatever it shows. */
  open: OpenRequest | null;
  /** Loaded ahead ({@link preloadView}) and not shown since: the first to go. */
  preloaded: boolean;
}

/**
 * What the machine's door is opened with (the native `Machine` but its name):
 * when it changes the door is reopened, maybe on another port, so the page
 * loaded through the old one must go.
 */
export function doorOf(machine: Machine): string {
  const { url, node, relay, mode } = machine;
  return JSON.stringify([url, node, relay?.endpoint, relay?.key, relay?.node, mode]);
}

/** @returns the key of the page of a machine, or of a peer it mounts. */
export function keyOf(machineId: string, peer: LiveView["peer"]): string {
  return peer === null ? machineId : `${machineId}#${peer.id}`;
}

/** @returns the path a view loads on its machine's door. */
export function pathOf(view: LiveView): string {
  return view.peer === null ? "/" : `/kivotos/peer/${encodeURIComponent(view.peer.id)}/`;
}

/**
 * @returns `views` with the page of `machine`, or of its `peer`, shown: last,
 *   loaded again when its door changed, and the least recently shown beyond
 *   {@link LIVE_MAX} dropped.
 */
export function showView(
  views: readonly LiveView[],
  machine: Machine,
  peer: LiveView["peer"],
  open: OpenRequest | null,
): LiveView[] {
  const key = keyOf(machine.id, peer);
  const known = views.find((view) => view.key === key);
  const door = doorOf(machine);
  const shown: LiveView =
    known !== undefined && known.door === door
      ? { ...known, open, preloaded: false }
      : {
          key,
          machine: machine.id,
          peer,
          generation: (known?.generation ?? 0) + 1,
          door,
          open,
          preloaded: false,
        };
  return [...views.filter((view) => view.key !== key), shown].slice(-LIVE_MAX);
}

/**
 * Load the page of `machine`, or of its `peer`, hidden, ahead of a switch to
 * it. It goes first in the order (never shown), and makes room beyond
 * {@link LIVE_MAX} only from pages outside `keep` (the page on screen, pages
 * shown lately, the other pages of this preload), pages loaded ahead first.
 * @returns the new views; `views` itself when the page is loaded already;
 *   null when there is no room for it.
 */
export function preloadView(
  views: readonly LiveView[],
  machine: Machine,
  peer: LiveView["peer"],
  keep: ReadonlySet<string>,
): LiveView[] | null {
  const key = keyOf(machine.id, peer);
  if (views.some((view) => view.key === key)) return views as LiveView[];
  const next: LiveView[] = [
    {
      key,
      machine: machine.id,
      peer,
      generation: 1,
      door: doorOf(machine),
      open: null,
      preloaded: true,
    },
    ...views,
  ];
  if (next.length <= LIVE_MAX) return next;
  const free = (view: LiveView): boolean => view.key !== key && !keep.has(view.key);
  const victim = next.find((view) => free(view) && view.preloaded) ?? next.find(free);
  return victim === undefined ? null : next.filter((view) => view !== victim);
}

/**
 * Follow the machine list: the pages of a removed machine go (its peers'
 * too), and so do hidden pages whose door changed; the shown one loads again.
 * @returns the new views, or `views` itself when nothing changed.
 */
export function followMachines(
  views: LiveView[],
  machines: readonly Machine[],
  shown: string | null,
): LiveView[] {
  const byId = new Map(machines.map((machine) => [machine.id, machine]));
  const next: LiveView[] = [];
  for (const view of views) {
    const machine = byId.get(view.machine);
    if (machine === undefined) continue;
    const door = doorOf(machine);
    if (door === view.door) next.push(view);
    else if (view.key === shown)
      next.push({ ...view, generation: view.generation + 1, door, open: null });
  }
  const changed = next.length !== views.length || next.some((view, index) => view !== views[index]);
  return changed ? next : views;
}

/** @returns the `host:port` of a listener base URL, or undefined. */
function authorityOf(url: string): string | undefined {
  if (url === "") return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * The phone's row for a machine a computer's switcher names: the same node,
 * else the same tailnet listener. Null when the phone has none, or when its
 * last probe found no link to it, where only the computer's mount can open it.
 */
export function machineForTarget(
  machines: readonly Machine[],
  target: SwitchTarget,
  probe: PhoneProbe | null,
): Machine | null {
  const byNode =
    target.node === undefined
      ? undefined
      : machines.find((row) => (row.relay?.node ?? row.node) === target.node);
  const machine =
    byNode ??
    (target.address === undefined
      ? undefined
      : machines.find((row) => authorityOf(row.url) === target.address));
  if (machine === undefined) return null;
  const links = probe?.machines.find((entry) => entry.id === machine.id);
  if (links !== undefined && routeOf(links, machine.mode ?? "auto") === null) return null;
  return machine;
}

/**
 * Where a page's switcher sends the phone: the phone's own row for the
 * target ({@link machineForTarget}), else the target as the page's computer
 * mounts it, through that computer's door. "This computer" (`id` null) on a
 * peer's page is the computer's own page.
 * @returns the page to show, or null when there is none (the page goes by itself).
 */
export function switchTarget(
  machines: readonly Machine[],
  probe: PhoneProbe | null,
  from: LiveView,
  target: SwitchTarget,
): { machine: Machine; peer: LiveView["peer"] } | null {
  const parent = machines.find((machine) => machine.id === from.machine);
  if (parent === undefined) return null;
  const row = target.id === null ? null : machineForTarget(machines, target, probe);
  if (row !== null && row.id !== parent.id) return { machine: row, peer: null };
  if (target.id === null || row !== null)
    return from.peer === null ? null : { machine: parent, peer: null };
  if (target.id === from.peer?.id) return null;
  return { machine: parent, peer: { id: target.id, name: target.name } };
}

/**
 * The pages to load ahead from a phone row's page `from`: where its switcher
 * would send the phone ({@link switchTarget}) for the machines its computer
 * lists with a route, the ones this phone switched to from it lately first
 * (`recent`, mount ids, most recent first), else the first listed. Never
 * `from` itself, and at most {@link PRELOAD_MAX}.
 *
 * A machine the phone has its own row for is loaded through that row only
 * when `probe`, the phone's latest probe and only when it is fresh, found a
 * route to it; else through the computer's mount, which the computer just
 * listed with a route.
 */
export function preloadTargets(
  machines: readonly Machine[],
  probe: PhoneProbe | null,
  from: LiveView,
  listed: readonly ListedMachine[],
  recent: readonly string[],
): { machine: Machine; peer: LiveView["peer"] }[] {
  const parent = machines.find((machine) => machine.id === from.machine);
  if (parent === undefined || from.peer !== null) return [];
  const online = listed.filter((entry) => entry.online);
  const byId = new Map(online.map((entry) => [entry.target.id, entry]));
  const lately = recent.flatMap((id) => byId.get(id) ?? []);
  const targets: { machine: Machine; peer: LiveView["peer"] }[] = [];
  const keys = new Set([from.key]);
  for (const { target } of lately.length > 0 ? lately : online) {
    if (target.id === null) continue;
    let to = switchTarget(machines, probe, from, target);
    if (to === null) continue;
    if (to.peer === null) {
      const row = to.machine;
      const links = probe?.machines.find((entry) => entry.id === row.id);
      if (links === undefined || routeOf(links, row.mode ?? "auto") === null)
        to = { machine: parent, peer: { id: target.id, name: target.name } };
    }
    const key = keyOf(to.machine.id, to.peer);
    if (keys.has(key)) continue;
    keys.add(key);
    targets.push(to);
    if (targets.length === PRELOAD_MAX) break;
  }
  return targets;
}
