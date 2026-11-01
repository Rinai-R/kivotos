/**
 * One model of the links (Tailscale, own relay) and of the machines reached
 * through them, so the computer and the phone say the same thing.
 *
 * The plugin serves it on `/kivotos/peers` (`machine-book.ts` builds it), the
 * client module's switcher and Settings show it, and the phone app
 * (packages/mobile) imports this file for the same vocabulary and for its own
 * machine list. No imports and no platform API: Node, the browser bundle and
 * React Native all compile it.
 */

/** A way of reaching a machine. */
export type Via = "tailscale" | "relay";

/** The links, in the order a Tailscale-first machine tries them: the direct one first, the relay as the detour. */
export const VIAS: readonly Via[] = ["tailscale", "relay"];

/** What a machine prefers until one is chosen: Tailscale first, the relay when it fails. */
export const DEFAULT_ROUTE_MODE: RouteMode = "tailscale";

/**
 * Which link a machine should use first, chosen per machine on the device
 * that dials it:
 * - `tailscale`: the direct tailnet listener, and the relay when it fails (the default).
 * - `relay`: the relay first, and the tailnet listener when it fails.
 *
 * Neither is exclusive: the other link takes over when the preferred one does
 * not work. A machine with one link has nothing to choose: that link is used,
 * and the mode is kept for when the other appears.
 */
export type RouteMode = Via;

export const ROUTE_MODES: readonly RouteMode[] = VIAS;

/** @returns whether `value` is one of the two priorities. */
export function isRouteMode(value: unknown): value is RouteMode {
  return value === "tailscale" || value === "relay";
}

/**
 * @returns the mode a stored value names: the legacy `auto`, and anything
 *   else this version does not know, is the default (Tailscale first).
 */
export function storedMode(value: unknown): RouteMode {
  return value === "relay" ? "relay" : DEFAULT_ROUTE_MODE;
}

/** @returns the links in the order `mode` tries them: its preferred one, then the other. */
export function routeOrder(mode: RouteMode): readonly Via[] {
  return mode === "relay" ? ["relay", "tailscale"] : VIAS;
}

/**
 * Where one link to a machine stands:
 * - `online`: it reaches the machine's Kivotos now.
 * - `offline`: the link says the machine is not there (tailnet offline, not in
 *   the relay network's online list).
 * - `unreachable`: the machine should be there but the attempt failed (`reason`).
 * - `denied`: the relay refused this device's network.
 */
export type LinkState = "online" | "offline" | "unreachable" | "denied";

/** Why a link is `unreachable`. */
export type LinkReason =
  /** Nothing listens on the Kivotos port (connection refused). */
  | "no-listener"
  /** Something answered, but not Kivotos. */
  | "not-kivotos"
  /** The machine's listener refused this device (another tailnet user). */
  | "forbidden"
  | "timeout"
  | "tls"
  /** The TLS handshake with the relay was reset: a hosting provider may block its domain. */
  | "tls-reset"
  /** Any other connection failure. */
  | "network"
  /** This device is not on the tailnet. */
  | "not-on-tailnet"
  /** This device's own relay connection is not up yet. */
  | "relay-connecting"
  /** This device cannot reach the relay. */
  | "relay-unreachable";

/** One link to a machine. */
export interface MachineLink {
  via: Via;
  state: LinkState;
  reason?: LinkReason;
  /** Last time this link reached the machine, in ms since the epoch. */
  lastSeen?: number;
  /** The tailnet listener's `host:port`, or the relay's address. */
  address?: string;
  /**
   * Still shown online, but its latest checks failed: it is given a few
   * more before it counts as down, so one slow answer does not flip it.
   */
  unstable?: true;
}

/** A machine as `/kivotos/peers` lists it: one entry whatever links reach it. */
export interface MachineInfo {
  /** Mount id: `/kivotos/peer/<id>/`. */
  id: string;
  name: string;
  /** Operating system ("" when unknown). */
  os: string;
  /** Kivotos node id (SHA-256 of its certificate), when known. */
  node?: string;
  /** Which link it prefers; the other one is the fallback. */
  mode: RouteMode;
  /** The link requests go through now ({@link routeOf}); null when none works. */
  route: Via | null;
  /** One per link, in {@link VIAS} order. */
  links: MachineLink[];
}

/**
 * @returns the link requests go through: the first online link in the mode's
 *   order (its preferred one, else the fallback); null when none works.
 */
export function routeOf(machine: Pick<MachineInfo, "links">, mode: RouteMode): Via | null {
  for (const via of routeOrder(mode)) {
    if (machine.links.some((link) => link.via === via && link.state === "online")) return via;
  }
  return null;
}

/** Why a link does not work now: its reason when unreachable, else its state. */
export type LinkDown = LinkReason | Exclude<LinkState, "online">;

/** @returns why `link` does not work now; undefined while it is online (unstable included). */
export function downOf(link: MachineLink): LinkDown | undefined {
  if (link.state === "online") return undefined;
  return link.state === "unreachable" ? (link.reason ?? "unreachable") : link.state;
}

/** One choice of a machine's mode control: a link to prefer. */
export interface ModeOption {
  mode: RouteMode;
  /** The link this choice prefers; the other link is its fallback. */
  link: MachineLink;
}

/**
 * The choices a machine's mode control offers: prefer Tailscale, or prefer the
 * relay, each falling back to the other link. None for a machine with one
 * link, which has nothing to choose.
 */
export function modeOptions(machine: Pick<MachineInfo, "links">): ModeOption[] {
  const tailscale = machine.links.find((link) => link.via === "tailscale");
  const relay = machine.links.find((link) => link.via === "relay");
  if (tailscale === undefined || relay === undefined) return [];
  return [
    { mode: "tailscale", link: tailscale },
    { mode: "relay", link: relay },
  ];
}

/** @returns the latest time any link reached the machine. */
export function lastSeenOf(links: readonly MachineLink[]): number | undefined {
  let latest: number | undefined;
  for (const link of links) {
    if (link.lastSeen !== undefined && (latest === undefined || link.lastSeen > latest))
      latest = link.lastSeen;
  }
  return latest;
}

/** What a machine's row says, before translation. */
export type MachineStatus =
  /** Reached through `via`; `down` is a preferred link that does not work now. */
  | { kind: "online"; via: Via; down?: MachineLink }
  /** Reached through `via`, whose link missed its latest checks (`MachineLink.unstable`). */
  | { kind: "unstable"; via: Via; down?: MachineLink }
  | { kind: "offline"; lastSeen?: number }
  | { kind: "unreachable"; link: MachineLink; lastSeen?: number }
  | { kind: "denied"; lastSeen?: number };

/**
 * One status per machine: the route when a link works (unstable when that
 * link missed its latest checks; `down` when it is the fallback, the preferred
 * link having failed); otherwise "offline" when a link says the machine is
 * away (the plainest explanation), else the first failed attempt's reason, in
 * the mode's order.
 */
export function statusOf(machine: Pick<MachineInfo, "links">, mode: RouteMode): MachineStatus {
  const order = routeOrder(mode);
  const route = routeOf(machine, mode);
  if (route !== null) {
    const used = machine.links.find((link) => link.via === route && link.state === "online");
    const kind = used?.unstable === true ? "unstable" : "online";
    const preferred = machine.links.find((link) => link.via === order[0]);
    const down = preferred !== undefined && preferred.state !== "online" ? preferred : undefined;
    return down === undefined ? { kind, via: route } : { kind, via: route, down };
  }
  const links = order.flatMap((via) => machine.links.filter((link) => link.via === via));
  const lastSeen = lastSeenOf(links);
  const unreachable = links.find((link) => link.state === "unreachable");
  if (links.length === 0 || links.some((link) => link.state === "offline"))
    return { kind: "offline", lastSeen };
  if (unreachable !== undefined) return { kind: "unreachable", link: unreachable, lastSeen };
  return { kind: "denied", lastSeen };
}

/** A past time as the UI words it. */
export type Ago = { unit: "now" } | { unit: "minutes" | "hours" | "days"; count: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** @returns how long ago `time` was: minutes below an hour, hours below two days, then days. */
export function agoOf(time: number, now: number): Ago {
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) return { unit: "now" };
  if (elapsed < HOUR_MS) return { unit: "minutes", count: Math.floor(elapsed / MINUTE_MS) };
  if (elapsed < 2 * DAY_MS) return { unit: "hours", count: Math.floor(elapsed / HOUR_MS) };
  return { unit: "days", count: Math.floor(elapsed / DAY_MS) };
}

// The phone's machine list (packages/mobile). The app stores what it was
// given (a listener URL, a relay invite) and learns the rest from probes.

/** A machine as the phone stores it (`Machine` in the app's native module). */
export interface PhoneMachine {
  /** Stable for the machine's life in the list: its door port, cache and cursors hang on it. */
  id: string;
  name: string;
  /** Tailnet listener base URL; "" when only a relay reaches the machine. */
  url: string;
  /** Kivotos node id, when known (from `/kivotos/hello` or the relay). */
  node?: string;
  /** Set when a relay network the phone joined reaches the machine. */
  relay?: { endpoint: string; key: string; node: string };
  /** How the phone reaches it; absent means the default (Tailscale first). */
  mode?: RouteMode;
}

/** A machine's links as one native probe found them (`Links.kt`). */
export interface PhoneMachineProbe {
  id: string;
  /** Node id its `/kivotos/hello` advertised. */
  node?: string;
  links: MachineLink[];
  /** Its `/kivotos/events` stream: connected, failing, or not held (notifications off). */
  stream: "live" | "down" | "off";
}

/** A relay network as one native probe found it. */
export interface PhoneNetworkProbe {
  endpoint: string;
  key: string;
  /** The network's id on the relay (public). */
  id: string;
  /** The phone has no standing relay connection: `online` means the relay answered now. */
  state: "online" | "denied" | "unreachable";
  error?: string;
  /** Why the relay is unreachable, when the phone can tell (`tls-reset`). */
  reason?: LinkReason;
  /** Computers of the network online now. */
  peers: { node: string; name: string }[];
}

export interface PhoneProbe {
  /** The phone has a network with internet access. */
  online: boolean;
  machines: PhoneMachineProbe[];
  networks: PhoneNetworkProbe[];
}

function nodeOfPhone(machine: PhoneMachine): string | undefined {
  return machine.relay?.node ?? machine.node;
}

/** Whether two entries are the same computer: same id, node or listener URL. */
function samePhoneMachine(a: PhoneMachine, b: PhoneMachine): boolean {
  if (a.id === b.id) return true;
  const node = nodeOfPhone(a);
  if (node !== undefined && node === nodeOfPhone(b)) return true;
  return a.url !== "" && a.url === b.url;
}

/** `into` with what `from` adds (a URL, a relay, a node); `into` keeps its id, name and mode. */
function mergePhone(into: PhoneMachine, from: PhoneMachine): PhoneMachine {
  const url = into.url === "" ? from.url : into.url;
  const relay = into.relay ?? from.relay;
  const node = nodeOfPhone(into) ?? nodeOfPhone(from);
  const mode = into.mode ?? from.mode;
  if (url === into.url && relay === into.relay && node === into.node && mode === into.mode)
    return into;
  const merged: PhoneMachine = { id: into.id, name: into.name, url };
  if (node !== undefined) merged.node = node;
  if (relay !== undefined) merged.relay = relay;
  if (mode !== undefined) merged.mode = mode;
  return merged;
}

/**
 * Add machines, folding each into an entry for the same computer when there
 * is one (a URL and a relay invite for one computer make one machine).
 * @returns the new list, or `known` itself when nothing changed.
 */
export function addPhoneMachines(
  known: readonly PhoneMachine[],
  incoming: readonly PhoneMachine[],
): PhoneMachine[] {
  const next = [...known];
  let changed = false;
  for (const machine of incoming) {
    const index = next.findIndex((other) => samePhoneMachine(other, machine));
    if (index < 0) {
      next.push(machine);
      changed = true;
      continue;
    }
    const merged = mergePhone(next[index], machine);
    if (merged === next[index]) continue;
    next[index] = merged;
    changed = true;
  }
  const collapsed = collapsePhone(next);
  return changed || collapsed !== next ? collapsed : (known as PhoneMachine[]);
}

/** Merge entries of one node that were added separately; the first keeps its id. */
function collapsePhone(list: PhoneMachine[]): PhoneMachine[] {
  const out: PhoneMachine[] = [];
  let changed = false;
  for (const machine of list) {
    const node = nodeOfPhone(machine);
    const index = node === undefined ? -1 : out.findIndex((other) => nodeOfPhone(other) === node);
    if (index < 0) out.push(machine);
    else {
      out[index] = mergePhone(out[index], machine);
      changed = true;
    }
  }
  return changed ? out : list;
}

/** Leave a relay network: machines only it reached go; the others keep their tailnet URL and mode. */
export function leavePhoneNetwork(list: readonly PhoneMachine[], key: string): PhoneMachine[] {
  const out: PhoneMachine[] = [];
  for (const machine of list) {
    if (machine.relay?.key !== key) {
      out.push(machine);
      continue;
    }
    if (machine.url === "") continue;
    const { relay: _left, ...kept } = machine;
    out.push({ ...kept, node: machine.relay.node });
  }
  return out;
}

/**
 * @returns the list with one machine's mode set; the default (Tailscale
 *   first) is stored as no mode.
 */
export function setPhoneMode(
  list: readonly PhoneMachine[],
  id: string,
  mode: RouteMode,
): PhoneMachine[] {
  const index = list.findIndex((machine) => machine.id === id);
  if (index < 0) return [...list];
  const next = [...list];
  const { mode: _old, ...rest } = list[index];
  next[index] = mode === DEFAULT_ROUTE_MODE ? rest : { ...rest, mode };
  return next;
}

/**
 * Fold a probe into the list: node ids the tailnet listeners advertised,
 * computers that came online in a joined network, and their renames.
 * @returns the new list, or `list` itself when nothing changed.
 */
export function applyPhoneProbe(list: readonly PhoneMachine[], probe: PhoneProbe): PhoneMachine[] {
  const learned = new Map(probe.machines.map((machine) => [machine.id, machine.node]));
  let next = list.map((machine) => {
    const node = learned.get(machine.id);
    if (node === undefined || nodeOfPhone(machine) !== undefined) return machine;
    // A tailnet-only entry: nothing else to carry over but its mode.
    const learnt: PhoneMachine = { id: machine.id, name: machine.name, url: machine.url, node };
    if (machine.mode !== undefined) learnt.mode = machine.mode;
    return learnt;
  });
  let changed = next.some((machine, index) => machine !== list[index]);
  for (const network of probe.networks) {
    for (const peer of network.peers) {
      const index = next.findIndex((machine) => machine.relay?.node === peer.node);
      const name = peer.name || peer.node.slice(0, 8);
      if (index >= 0) {
        if (next[index].name === name || next[index].url !== "") continue;
        next[index] = { ...next[index], name };
        changed = true;
        continue;
      }
      const relay = { endpoint: network.endpoint, key: network.key, node: peer.node };
      const added = addPhoneMachines(next, [{ id: `relay:${peer.node}`, name, url: "", relay }]);
      if (added !== next) changed = true;
      next = added;
    }
  }
  const collapsed = collapsePhone(next);
  return changed || collapsed !== next ? collapsed : (list as PhoneMachine[]);
}

/** Failures that mean "no route to the machine at all", as a phone off the tailnet sees. */
const NO_ROUTE: Partial<Record<LinkReason, true>> = { timeout: true, network: true };

/**
 * Whether the phone itself is probably off the tailnet: it has a network, and
 * every machine it reaches over Tailscale failed with no route. The phone
 * cannot see another app's VPN, so this is the signal it has.
 */
export function tailnetDownOnPhone(probe: PhoneProbe): boolean {
  if (!probe.online) return false;
  const links = probe.machines.flatMap((machine) =>
    machine.links.filter((link) => link.via === "tailscale"),
  );
  return (
    links.length > 0 &&
    links.every(
      (link) =>
        link.state === "unreachable" && link.reason !== undefined && NO_ROUTE[link.reason] === true,
    )
  );
}
