import { routeOf, type PhoneProbe } from "../../kivotos/src/machines";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import type { SwitchTarget } from "./bridge";

/**
 * Machines whose page stays loaded, shown or hidden: reopening one shows it
 * at once instead of booting dsh again. A live page costs about 220 MB, so
 * the least recently shown beyond this goes.
 */
export const LIVE_MAX = 2;

/** A Session to open in a machine's page; `seq` tells two requests for the same Session apart. */
export interface OpenRequest {
  sessionId: string;
  seq: number;
}

/** A machine whose WebView is mounted. */
export interface LiveView {
  id: string;
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

/**
 * @returns `views` with `machine` shown: last, loaded again when its door
 *   changed, and the least recently shown beyond {@link LIVE_MAX} dropped.
 */
export function showView(
  views: readonly LiveView[],
  machine: Machine,
  open: OpenRequest | null,
): LiveView[] {
  const known = views.find((view) => view.id === machine.id);
  const door = doorOf(machine);
  const shown: LiveView =
    known !== undefined && known.door === door
      ? { ...known, open }
      : { id: machine.id, generation: (known?.generation ?? 0) + 1, door, open };
  return [...views.filter((view) => view.id !== machine.id), shown].slice(-LIVE_MAX);
}

/**
 * Follow the machine list: a removed machine's page goes, and so does a
 * hidden page whose door changed; the shown one loads again.
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
    const machine = byId.get(view.id);
    if (machine === undefined) continue;
    const door = doorOf(machine);
    if (door === view.door) next.push(view);
    else if (view.id === shown)
      next.push({ id: view.id, generation: view.generation + 1, door, open: null });
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
