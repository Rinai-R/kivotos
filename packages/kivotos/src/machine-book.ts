/**
 * The machines this computer knows, merged across its links.
 *
 * Each link reports what it sees on every refresh (`update`): the tailnet
 * (static peers and same-user nodes, probed) and the relay network (online
 * members, probed through the relay). The book merges the entries of one
 * Kivotos node into one machine, picks its route, and remembers machines
 * after their link stops listing them, so a machine that goes away stays
 * listed as offline instead of vanishing. Pure: the caller probes, stores
 * and mounts.
 */
import {
  routeOf,
  VIAS,
  type LinkReason,
  type LinkState,
  type MachineInfo,
  type MachineLink,
  type Via,
} from "./machines.ts";

/** One entry a link reports on a refresh. */
export interface Sighting<T> {
  /** Unique within the link: `static:<id>`, `tailnet:<node id>`, `relay:<node>`. */
  key: string;
  /** Mount id while the Kivotos node id is unknown (a static peer's id, a tailnet node id). */
  id: string;
  /** Kivotos node id, from the peer's hello or the relay. */
  node?: string;
  name: string;
  os: string;
  state: LinkState;
  reason?: LinkReason;
  address?: string;
  /** When the link itself last saw it (the tailnet's LastSeen of an offline node). */
  lastSeen?: number;
  /** Configured, not discovered: listed while configured, however long ago it was seen. */
  pinned?: boolean;
  /** Where requests go; set when `state` is online. */
  target?: T;
}

/** How a link shows the remembered entries it does not report now. */
export interface Absent {
  state: LinkState;
  reason?: LinkReason;
}

/** What the book keeps of an entry between refreshes and restarts. */
export interface Remembered {
  via: Via;
  key: string;
  id: string;
  node?: string;
  name: string;
  os: string;
  address?: string;
  lastSeen?: number;
  pinned?: boolean;
}

/** A machine with where its route goes. */
export interface BookMachine<T> extends MachineInfo {
  target?: T;
}

const OFFLINE: Absent = { state: "offline" };

/** Order of a link's candidate entries: the one that works first. */
const STATE_RANK: Record<LinkState, number> = { online: 0, unreachable: 1, denied: 2, offline: 3 };

/**
 * Probe failures ranked by what they tell the user: a refusal or a wrong
 * service beats a failure to connect at all.
 */
const REASON_RANK: Partial<Record<LinkReason, number>> = {
  forbidden: 0,
  "not-kivotos": 1,
  tls: 2,
  "no-listener": 3,
  timeout: 4,
  network: 5,
};

/** @returns the mount id of a Kivotos node: `node-` and 96 bits of its id. */
export function machineIdOf(node: string): string {
  return `node-${node.slice(0, 16)}`;
}

/** How one `/kivotos/hello` attempt ended without reaching Kivotos. */
export interface HelloOutcome {
  /** HTTP status, when an answer came. */
  status?: number;
  /** Node.js error code of the connection failure. */
  code?: string;
}

/** @returns why a hello attempt that did not reach Kivotos failed. */
export function probeFailure(outcome: HelloOutcome): LinkReason {
  const { status, code = "" } = outcome;
  if (status === 403 || status === 421) return "forbidden";
  if (status !== undefined) return "not-kivotos";
  if (code === "ECONNREFUSED") return "no-listener";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
  if (/^(ERR_TLS|ERR_SSL|CERT_|EPROTO$|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_)/.test(code)) return "tls";
  return "network";
}

/** @returns the more telling of two failure reasons (several attempts of one probe). */
export function tellingReason(a: LinkReason, b: LinkReason): LinkReason {
  return (REASON_RANK[b] ?? 9) < (REASON_RANK[a] ?? 9) ? b : a;
}

function later(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  return b === undefined || a >= b ? a : b;
}

interface Candidate<T> {
  entry: Remembered;
  sighting: Sighting<T> | undefined;
  link: MachineLink;
}

export class MachineBook<T> {
  private readonly memory = new Map<string, Remembered>();
  private readonly current = new Map<Via, Map<string, Sighting<T>>>();
  private readonly absent = new Map<Via, Absent>();
  private readonly retentionMs: number;

  /** @param retentionMs - how long a machine no link reports stays listed after it was last seen. */
  constructor(retentionMs: number) {
    this.retentionMs = retentionMs;
  }

  /** Load entries an earlier run kept; malformed ones and ones seen since are skipped. */
  restore(entries: unknown): void {
    if (!Array.isArray(entries)) return;
    for (const raw of entries as unknown[]) {
      const entry = rememberedOf(raw);
      if (entry === undefined) continue;
      const slot = `${entry.via}\n${entry.key}`;
      if (!this.memory.has(slot)) this.memory.set(slot, entry);
    }
  }

  /** What to keep for the next run. */
  entries(): Remembered[] {
    return [...this.memory.values()];
  }

  /** Whether a link's entry has ever been a Kivotos machine. */
  knows(via: Via, key: string): boolean {
    const entry = this.memory.get(`${via}\n${key}`);
    return entry !== undefined && (entry.node !== undefined || entry.lastSeen !== undefined);
  }

  /**
   * Replace what one link sees now.
   * @param absent - how this link's remembered entries that it does not report show.
   */
  update(via: Via, sightings: readonly Sighting<T>[], now: number, absent = OFFLINE): void {
    const current = new Map<string, Sighting<T>>();
    for (const sighting of sightings) {
      current.set(sighting.key, sighting);
      this.remember(via, sighting, now);
    }
    this.current.set(via, current);
    this.absent.set(via, absent);
    for (const [slot, entry] of this.memory) {
      if (entry.via !== via || current.has(entry.key)) continue;
      // A pinned entry the link no longer reports was removed from the config.
      if (entry.pinned === true || !this.retained(entry, now)) this.memory.delete(slot);
    }
  }

  /** Fold a sighting into what is kept: what it does not say, an earlier one may have. */
  private remember(via: Via, sighting: Sighting<T>, now: number): void {
    const slot = `${via}\n${sighting.key}`;
    const old = this.memory.get(slot);
    const entry: Remembered = {
      via,
      key: sighting.key,
      id: sighting.id,
      name: sighting.name || (old?.name ?? ""),
      os: sighting.os || (old?.os ?? ""),
    };
    const node = sighting.node ?? old?.node;
    if (node !== undefined) entry.node = node;
    const address = sighting.address ?? old?.address;
    if (address !== undefined) entry.address = address;
    const online = sighting.state === "online" ? now : undefined;
    const seen = later(later(old?.lastSeen, sighting.lastSeen), online);
    if (seen !== undefined) entry.lastSeen = seen;
    if (sighting.pinned === true) entry.pinned = true;
    this.memory.set(slot, entry);
  }

  /** Drop everything a link knew (this computer left the relay network). */
  forget(via: Via): void {
    for (const [slot, entry] of this.memory) if (entry.via === via) this.memory.delete(slot);
    this.current.delete(via);
    this.absent.delete(via);
  }

  private retained(entry: Remembered, now: number): boolean {
    return entry.lastSeen !== undefined && now - entry.lastSeen <= this.retentionMs;
  }

  /** @returns every machine, one per Kivotos node, sorted by name. */
  machines(now: number): BookMachine<T>[] {
    const groups = new Map<string, Candidate<T>[]>();
    for (const entry of this.memory.values()) {
      const sighting = this.current.get(entry.via)?.get(entry.key);
      if (sighting === undefined && entry.pinned !== true && !this.retained(entry, now)) continue;
      const id = entry.node === undefined ? entry.id : machineIdOf(entry.node);
      const link = this.linkOf(entry, sighting);
      const group = groups.get(id);
      if (group === undefined) groups.set(id, [{ entry, sighting, link }]);
      else group.push({ entry, sighting, link });
    }
    const machines = [...groups].map(([id, group]) => machineOf(id, group));
    return machines.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  private linkOf(entry: Remembered, sighting: Sighting<T> | undefined): MachineLink {
    const shown = sighting ?? this.absent.get(entry.via) ?? OFFLINE;
    const link: MachineLink = { via: entry.via, state: shown.state };
    if (shown.reason !== undefined) link.reason = shown.reason;
    if (entry.lastSeen !== undefined) link.lastSeen = entry.lastSeen;
    const address = sighting?.address ?? entry.address;
    if (address !== undefined) link.address = address;
    return link;
  }
}

/** Better candidate first: working, reported now, configured. */
function byUse<T>(a: Candidate<T>, b: Candidate<T>): number {
  return (
    STATE_RANK[a.link.state] - STATE_RANK[b.link.state] ||
    Number(a.sighting === undefined) - Number(b.sighting === undefined) ||
    Number(a.entry.pinned !== true) - Number(b.entry.pinned !== true)
  );
}

function machineOf<T>(id: string, group: Candidate<T>[]): BookMachine<T> {
  const best = new Map<Via, Candidate<T>>();
  for (const candidate of [...group].sort(byUse)) {
    if (!best.has(candidate.entry.via)) best.set(candidate.entry.via, candidate);
  }
  const links = VIAS.flatMap((via) => {
    const candidate = best.get(via);
    return candidate === undefined ? [] : [candidate.link];
  });
  // Names: a configured one first, then what the machine says over the tailnet, then the relay.
  const named = [...group].sort(
    (a, b) =>
      Number(a.entry.pinned !== true) - Number(b.entry.pinned !== true) ||
      VIAS.indexOf(a.entry.via) - VIAS.indexOf(b.entry.via),
  );
  const route = routeOf(links);
  const machine: BookMachine<T> = {
    id,
    name: named.find((candidate) => candidate.entry.name !== "")?.entry.name ?? id,
    os: named.find((candidate) => candidate.entry.os !== "")?.entry.os ?? "",
    route,
    links,
  };
  const node = group.find((candidate) => candidate.entry.node !== undefined)?.entry.node;
  if (node !== undefined) machine.node = node;
  const target = route === null ? undefined : best.get(route)?.sighting?.target;
  if (target !== undefined) machine.target = target;
  return machine;
}

function rememberedOf(raw: unknown): Remembered | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const { via, key, id, node, name, os, address, lastSeen, pinned } = value;
  if (via !== "tailscale" && via !== "relay") return undefined;
  if (typeof key !== "string" || typeof id !== "string") return undefined;
  const entry: Remembered = {
    via,
    key,
    id,
    name: typeof name === "string" ? name : "",
    os: typeof os === "string" ? os : "",
  };
  if (typeof node === "string") entry.node = node;
  if (typeof address === "string") entry.address = address;
  if (typeof lastSeen === "number" && Number.isFinite(lastSeen)) entry.lastSeen = lastSeen;
  if (pinned === true) entry.pinned = true;
  return entry;
}
