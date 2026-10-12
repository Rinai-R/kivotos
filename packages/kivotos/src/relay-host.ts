/**
 * This computer's membership in a relay network: the stored federation key
 * and node identity, the link that keeps it online, the sessions other
 * members open to it, and the peers it can open in turn.
 */
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import {
  inviteOf,
  networkOf,
  nodeIdOf,
  parseInvite,
  registrationOf,
  type Network,
} from "./federation.ts";
import { machineIdOf, probeFailure, type Absent, type Sighting } from "./machine-book.ts";
import { getJson, type Upstream } from "./proxy.ts";
import { relayAgent, RelayLink, type LinkStatus, type RelayPeer } from "./relay.ts";
import type { TraceLog } from "./trace.ts";
import { createIdentity, loadIdentity, type Identity } from "./x509.ts";

/** Host header of requests sent through a relay session; nothing resolves it. */
const RELAY_AUTHORITY = "relay.kivotos.invalid";
/** First look for peers this soon after connecting, before the regular interval. */
const FIRST_REFRESH_MS = 1_500;
/** Longest wait for a member's `/kivotos/hello` through the relay. */
const PROBE_TIMEOUT_MS = 5_000;

/** How the members not online now show while this computer's own relay link is down. */
function absentOf(state: Exclude<LinkStatus["state"], "online">): Absent {
  if (state === "denied") return { state: "denied" };
  return {
    state: "unreachable",
    reason: state === "connecting" ? "relay-connecting" : "relay-unreachable",
  };
}

/** A relay session's caller, in the shape the dsh frontend traces. */
interface Caller {
  ip: string;
  node: string;
  admitMs: number;
  cached: boolean;
}

/** What the settings page shows about the relay link. */
export interface RelayView {
  joined: boolean;
  /** This computer's node id in any network it joins. */
  node: string;
  relay?: string;
  networkId?: string;
  /** What the relay operator registers once: `kivotos-relay network add <this>`. */
  registration?: string;
  /** Link that lets another device join; it contains the federation key. */
  invite?: string;
  state?: LinkStatus["state"];
  error?: string;
  /** Other nodes online in the network. */
  peers: number;
}

export interface RelayHostOptions {
  /** Directory for `identity.json` and `relay.json`. */
  dir: string;
  /** This computer's display name. */
  name: () => string;
  refreshSeconds: number;
  /** Serves dsh to an admitted caller (the Frontend). */
  serve: {
    request(req: IncomingMessage, res: ServerResponse, who: Caller): Promise<void>;
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, who: Caller): Promise<void>;
  };
  /**
   * Replace the relay network's machines in this computer's list.
   * @param absent - how remembered members not online now show; null: forget
   *   them all (this computer left the network).
   */
  publish: (sightings: Sighting<Upstream>[], absent: Absent | null) => void;
  warn: (message: string, error: unknown) => void;
  trace: TraceLog;
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return undefined;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) throw new Error(`${file} is not an object`);
  return Object.fromEntries(Object.entries(parsed));
}

/** Write a file only its owner can read: it holds a private key or the federation key. */
async function writePrivate(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(file, 0o600);
}

export class RelayHost {
  private readonly options: RelayHostOptions;
  /** Parses HTTP on the sessions members open to this computer; never listens. */
  private readonly server = http.createServer();
  private readonly sessions = new Set<TLSSocket>();
  private readonly callers = new WeakMap<object, string>();
  private readonly agents = new Map<string, http.Agent>();
  private identity: Identity | undefined;
  private network: Network | undefined;
  private link: RelayLink | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private peerCount = 0;
  private disposed = false;

  constructor(options: RelayHostOptions) {
    this.options = options;
    const { serve, warn } = options;
    this.server.on("request", (req: IncomingMessage, res: ServerResponse) => {
      serve.request(req, res, this.caller(req)).catch((error: unknown) => {
        warn("kivotos: relay request failed", error);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
    });
    this.server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      socket.on("error", () => socket.destroy());
      serve.upgrade(req, socket, head, this.caller(req)).catch((error: unknown) => {
        warn("kivotos: relay upgrade failed", error);
        socket.destroy();
      });
    });
  }

  private caller(req: IncomingMessage): Caller {
    const node = this.callers.get(req.socket) ?? "";
    return { ip: "relay", node, admitMs: 0, cached: true };
  }

  private get identityFile(): string {
    return path.join(this.options.dir, "identity.json");
  }

  private get networkFile(): string {
    return path.join(this.options.dir, "relay.json");
  }

  /** Load the node identity (creating it once) and rejoin the stored network. */
  async start(): Promise<void> {
    const stored = await readJson(this.identityFile);
    if (typeof stored?.keyPem === "string" && typeof stored.certPem === "string") {
      this.identity = loadIdentity(stored.keyPem, stored.certPem);
    } else {
      this.identity = createIdentity();
      const { keyPem, certPem } = this.identity;
      await writePrivate(this.identityFile, { keyPem, certPem });
    }
    const membership = await readJson(this.networkFile);
    if (typeof membership?.relay === "string" && typeof membership.secret === "string") {
      this.connect(networkOf(membership.relay, membership.secret));
    }
  }

  private connect(network: Network): void {
    if (this.identity === undefined || this.disposed) return;
    this.network = network;
    const link = new RelayLink(
      network,
      this.identity,
      this.options.name(),
      (socket, from) => this.serveSession(socket, from),
      this.options.warn,
    );
    this.link = link;
    link.start();
    this.options.trace.record("relay.start", { relay: network.relay, network: network.id });
    this.timer = setTimeout(() => void this.refresh(), FIRST_REFRESH_MS);
  }

  /** @param forget - this computer left the network: its members leave the machine list. */
  private disconnect(forget: boolean): void {
    clearTimeout(this.timer);
    this.link?.stop();
    this.link = undefined;
    this.network = undefined;
    this.peerCount = 0;
    for (const socket of this.sessions) socket.destroy();
    for (const agent of this.agents.values()) agent.destroy();
    this.agents.clear();
    if (forget) this.options.publish([], null);
  }

  /** A member opened a secured session to this computer: speak HTTP on it. */
  private serveSession(socket: TLSSocket, from: string): void {
    if (this.link === undefined) {
      socket.destroy();
      return;
    }
    this.sessions.add(socket);
    this.callers.set(socket, from);
    socket.once("close", () => this.sessions.delete(socket));
    socket.on("error", () => socket.destroy());
    this.options.trace.record("relay.session", { from });
    this.server.emit("connection", socket);
  }

  /** Ask the relay who is online, say hello to each, and publish them; reschedules itself. */
  private async refresh(): Promise<void> {
    const link = this.link;
    const network = this.network;
    if (link === undefined || network === undefined) return;
    try {
      const state = link.status.state;
      if (state !== "online") {
        this.peerCount = 0;
        this.options.publish([], absentOf(state));
        return;
      }
      const peers = await link.peers();
      if (this.link !== link) return;
      const online = new Set(peers.map((peer) => peer.node));
      for (const [node, agent] of this.agents) {
        if (online.has(node)) continue;
        agent.destroy();
        this.agents.delete(node);
      }
      this.peerCount = peers.length;
      const sightings = await Promise.all(peers.map((peer) => this.probe(link, network, peer)));
      if (this.link === link) this.options.publish(sightings, { state: "offline" });
    } catch (error) {
      this.options.warn("kivotos: relay peer refresh failed", error);
      if (this.link === link) this.options.publish([], absentOf("unreachable"));
    } finally {
      if (this.link === link) {
        this.timer = setTimeout(() => void this.refresh(), this.options.refreshSeconds * 1000);
      }
    }
  }

  /** A member online in the relay: reachable when its Kivotos answers through a secured session. */
  private async probe(
    link: RelayLink,
    network: Network,
    peer: RelayPeer,
  ): Promise<Sighting<Upstream>> {
    let agent = this.agents.get(peer.node);
    if (agent === undefined) {
      agent = relayAgent(link, peer.node);
      this.agents.set(peer.node, agent);
    }
    const upstream: Upstream = {
      host: RELAY_AUTHORITY,
      port: 80,
      authority: RELAY_AUTHORITY,
      hop: true,
      agent,
      relayNode: peer.node,
    };
    const answer = await getJson(upstream, "/kivotos/hello", PROBE_TIMEOUT_MS);
    const hello = answer.body?.kivotos === undefined ? undefined : answer.body;
    const sighting: Sighting<Upstream> = {
      key: `relay:${peer.node}`,
      id: machineIdOf(peer.node),
      node: peer.node,
      name: typeof hello?.name === "string" && hello.name !== "" ? hello.name : peer.name,
      os: typeof hello?.os === "string" ? hello.os : "",
      address: network.relay,
      state: hello === undefined ? "unreachable" : "online",
    };
    if (hello === undefined) sighting.reason = probeFailure(answer);
    else sighting.target = upstream;
    this.options.trace.record("relay.probe", {
      node: peer.node,
      ok: hello !== undefined,
      reason: sighting.reason,
    });
    return sighting;
  }

  view(): RelayView {
    const node = this.identity === undefined ? "" : nodeIdOf(this.identity.certDer);
    const network = this.network;
    if (network === undefined) return { joined: false, node, peers: 0 };
    return {
      joined: true,
      node,
      relay: network.relay,
      networkId: network.id,
      registration: registrationOf(network),
      invite: inviteOf(network),
      state: this.link?.status.state,
      error: this.link?.status.error,
      peers: this.peerCount,
    };
  }

  private async rejoin(network: Network): Promise<void> {
    await writePrivate(this.networkFile, { relay: network.relay, secret: network.secret });
    this.disconnect(true);
    this.connect(network);
  }

  /** Start a new network on the relay at `relay`. */
  create(relay: string): Promise<void> {
    return this.rejoin(networkOf(relay));
  }

  /** Join the network an invite link describes. */
  join(invite: string): Promise<void> {
    return this.rejoin(parseInvite(invite));
  }

  /** Leave the network and forget its key. */
  async leave(): Promise<void> {
    await rm(this.networkFile, { force: true });
    this.disconnect(true);
  }

  dispose(): void {
    this.disposed = true;
    // Unloading keeps the members in machines.json for the next start.
    this.disconnect(false);
  }
}
