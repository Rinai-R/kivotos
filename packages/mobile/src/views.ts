import { routeOf, type PhoneProbe } from "../../kivotos/src/machines";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import type { SwitchTarget } from "./bridge";

/**
 * Pages that stay loaded, shown or hidden: showing one again is instant
 * instead of booting dsh again. A live page costs about 220 MB, so the
 * least recently shown beyond this goes; a peer's page counts like any.
 */
export const LIVE_MAX = 3;

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
      ? { ...known, open }
      : { key, machine: machine.id, peer, generation: (known?.generation ?? 0) + 1, door, open };
  return [...views.filter((view) => view.key !== key), shown].slice(-LIVE_MAX);
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
