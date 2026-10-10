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
import type { Upstream } from "./proxy.ts";
import { relayAgent, RelayLink, type LinkStatus } from "./relay.ts";
import type { TraceLog } from "./trace.ts";
import { createIdentity, loadIdentity, type Identity } from "./x509.ts";

/** Host header of requests sent through a relay session; nothing resolves it. */
const RELAY_AUTHORITY = "relay.kivotos.invalid";
/** First look for peers this soon after connecting, before the regular interval. */
const FIRST_REFRESH_MS = 1_500;

/** A relay session's caller, in the shape the dsh frontend traces. */
interface Caller {
  ip: string;
  node: string;
  admitMs: number;
  cached: boolean;
}

/** A node of the network this computer can open. */
export interface RelayMount {
  id: string;
  name: string;
  os: string;
  upstream: Upstream;
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
  /** Replace the relay peers mounted in dsh. */
  publish: (peers: RelayMount[]) => void;
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

  private disconnect(): void {
    clearTimeout(this.timer);
    this.link?.stop();
    this.link = undefined;
    this.network = undefined;
    this.peerCount = 0;
    for (const socket of this.sessions) socket.destroy();
    for (const agent of this.agents.values()) agent.destroy();
    this.agents.clear();
    this.options.publish([]);
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

  /** Ask the relay who is online and mount them; reschedules itself. */
  private async refresh(): Promise<void> {
    const link = this.link;
    if (link === undefined) return;
    try {
      const peers = link.status.state === "online" ? await link.peers() : [];
      if (this.link !== link) return;
      const online = new Set(peers.map((peer) => peer.node));
      for (const [node, agent] of this.agents) {
        if (online.has(node)) continue;
        agent.destroy();
        this.agents.delete(node);
      }
      this.peerCount = peers.length;
      this.options.publish(
        peers.map((peer) => {
          let agent = this.agents.get(peer.node);
          if (agent === undefined) {
            agent = relayAgent(link, peer.node);
            this.agents.set(peer.node, agent);
          }
          return {
            id: `relay-${peer.node.slice(0, 16)}`,
            name: peer.name || peer.node.slice(0, 8),
            os: "",
            upstream: {
              host: RELAY_AUTHORITY,
              port: 80,
              authority: RELAY_AUTHORITY,
              hop: true,
              agent,
              relayNode: peer.node,
            },
          };
        }),
      );
    } catch (error) {
      this.options.warn("kivotos: relay peer refresh failed", error);
    } finally {
      if (this.link === link) {
        this.timer = setTimeout(() => void this.refresh(), this.options.refreshSeconds * 1000);
      }
    }
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
    this.disconnect();
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
    this.disconnect();
  }

  dispose(): void {
    this.disposed = true;
    this.disconnect();
  }
}
