/**
 * The member's side of the relay: streams through the relay, the TLS session
 * two members run over a stream, and the link that keeps this computer
 * online in its network.
 *
 * The relay is untrusted. It is shown the network id and relay token and
 * nothing else; a stream is used only after both members have checked each
 * other's certificate and federation proof inside TLS.
 */
import http from "node:http";
import { Duplex } from "node:stream";
import tls from "node:tls";
import { nodeIdOf, PROOF_BYTES, proofMatches, proofOf, type Network } from "./federation.ts";
import type { Identity } from "./x509.ts";

/** Protocol version of packages/relay/wire. */
const WIRE_VERSION = 2;
/** Longest time to reach the relay, or to finish TLS and proofs on a stream. */
const HANDSHAKE_MS = 20_000;
/** The relay pings every 20 s; a control connection silent this long is dead. */
const CONTROL_SILENCE_MS = 70_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Pause writing while the WebSocket holds more than this unsent. */
const SEND_HIGH_WATER = 1 << 20;
/** Longest relay reply line: a full node list (wire.MaxLine). */
const MAX_LINE = 16 << 10;

/** The relay answered a hello with an error code (wire.ErrCode*). */
export class RelayRefused extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`relay refused: ${code}`);
    this.code = code;
  }
}

/** A node of the network that is online, as the relay reports it. */
export interface RelayPeer {
  node: string;
  name: string;
}

interface Reply {
  ok?: boolean;
  error?: string;
  peers?: { node?: unknown; name?: unknown }[];
}

/**
 * Open a WebSocket as one byte stream: binary messages in both directions,
 * boundaries ignored.
 */
function webSocketStream(url: string): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    let opened = false;
    const stream = new Duplex({
      read() {},
      write(chunk: Buffer, _encoding, done) {
        const drained = (): void => {
          if (ws.readyState !== WebSocket.OPEN) done(new Error("relay connection closed"));
          else if (ws.bufferedAmount > SEND_HIGH_WATER) setTimeout(drained, 20);
          else done();
        };
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
        drained();
      },
      final(done) {
        ws.close(1000);
        done();
      },
      destroy(error, done) {
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
        done(error);
      },
    });
    ws.addEventListener("open", () => {
      opened = true;
      resolve(stream);
    });
    ws.addEventListener("message", (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) stream.push(Buffer.from(event.data));
      else stream.destroy(new Error("relay sent a text message"));
    });
    ws.addEventListener("close", () => {
      if (opened) stream.push(null);
      else reject(new Error(`cannot reach the relay at ${url}`));
    });
    ws.addEventListener("error", () => {
      if (opened) stream.destroy(new Error("relay connection failed"));
      else reject(new Error(`cannot reach the relay at ${url}`));
    });
  });
}

/** Run `work` against a deadline; `onTimeout` releases what it holds. */
async function within<T>(
  ms: number,
  what: string,
  onTimeout: () => void,
  work: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${what} timed out`));
    }, ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve once `stream` can supply what `take` wants; reject if it ends first. */
function readFrom<T>(stream: Duplex, take: () => T | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    const settle = (finish: () => void): void => {
      stream.off("readable", onReadable);
      stream.off("end", onEnd);
      stream.off("close", onEnd);
      stream.off("error", onError);
      finish();
    };
    const onReadable = (): void => {
      try {
        const value = take();
        if (value !== undefined) settle(() => resolve(value));
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    };
    const onEnd = (): void => settle(() => reject(new Error("connection closed")));
    const onError = (error: Error): void => settle(() => reject(error));
    stream.on("readable", onReadable);
    stream.on("end", onEnd);
    stream.on("close", onEnd);
    stream.on("error", onError);
    onReadable();
  });
}

/**
 * Read one JSON line. Bytes behind the newline go back into the stream: on an
 * accepted stream the other member's TLS hello can arrive with the reply.
 */
function readLine(stream: Duplex): Promise<unknown> {
  let held = Buffer.alloc(0);
  return readFrom(stream, () => {
    for (;;) {
      const chunk: unknown = stream.read();
      if (!Buffer.isBuffer(chunk)) return undefined;
      held = Buffer.concat([held, chunk]);
      const end = held.indexOf(10);
      if (end >= 0) {
        const rest = held.subarray(end + 1);
        if (rest.length > 0) stream.unshift(rest);
        return JSON.parse(held.subarray(0, end).toString("utf8")) as unknown;
      }
      if (held.length > MAX_LINE) throw new Error("relay line too long");
    }
  });
}

function readExact(stream: Duplex, length: number): Promise<Buffer> {
  return readFrom(stream, () => {
    const chunk: unknown = stream.read(length);
    return Buffer.isBuffer(chunk) && chunk.length === length ? chunk : undefined;
  });
}

function writeLine(stream: Duplex, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

function asReply(value: unknown): Reply {
  return typeof value === "object" && value !== null ? value : {};
}

/**
 * Open a stream to the relay and say hello.
 * @param fields - role and its fields (wire.Hello).
 * @returns the stream, positioned after the relay's OK reply, and that reply.
 */
async function hello(
  network: Network,
  fields: Record<string, string>,
): Promise<{ stream: Duplex; reply: Reply }> {
  const stream = await within(
    HANDSHAKE_MS,
    "connecting to the relay",
    () => {},
    webSocketStream(network.relay),
  );
  try {
    writeLine(stream, { v: WIRE_VERSION, network: network.id, token: network.token, ...fields });
    const reply = asReply(
      await within(HANDSHAKE_MS, "the relay's reply", () => stream.destroy(), readLine(stream)),
    );
    if (reply.ok !== true) throw new RelayRefused(reply.error ?? "unknown");
    return { stream, reply };
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function secured(socket: tls.TLSSocket, event: "secure" | "secureConnect"): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once(event, () => resolve());
    socket.once("error", reject);
    socket.once("close", () => reject(new Error("connection closed during the TLS handshake")));
  });
}

function peerNode(socket: tls.TLSSocket): string {
  const certificate = socket.getPeerCertificate(true);
  // An absent certificate is reported as an empty object.
  if (!Buffer.isBuffer(certificate.raw)) throw new Error("the other member sent no certificate");
  return nodeIdOf(certificate.raw);
}

/**
 * Dialing side of a member-to-member session over a stream: TLS 1.3 with
 * both certificates, the target's certificate pinned by its node id, then the
 * federation proofs.
 * @param target - node id the stream was opened to.
 * @returns the session, ready for application bytes.
 */
export async function secureDial(
  stream: Duplex,
  network: Network,
  identity: Identity,
  target: string,
): Promise<tls.TLSSocket> {
  const socket = tls.connect({
    socket: stream,
    key: identity.keyPem,
    cert: identity.certPem,
    minVersion: "TLSv1.3",
    // Certificates are self-signed; identity is the pinned node id plus the proof.
    rejectUnauthorized: false,
  });
  const run = async (): Promise<tls.TLSSocket> => {
    await secured(socket, "secureConnect");
    const serverNode = peerNode(socket);
    if (serverNode !== target) throw new Error("the relay connected a different node");
    const clientNode = nodeIdOf(identity.certDer);
    socket.write(proofOf(network.proofKey, "client", serverNode, clientNode));
    const proof = await readExact(socket, PROOF_BYTES);
    if (!proofMatches(proof, proofOf(network.proofKey, "server", serverNode, clientNode))) {
      throw new Error("the node is not a member of this network");
    }
    return socket;
  };
  try {
    return await within(HANDSHAKE_MS, "securing the stream", () => socket.destroy(), run());
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

/**
 * Accepting side of a member-to-member session over a stream.
 * @returns the session and the node id of the member that dialed.
 */
export async function secureAccept(
  stream: Duplex,
  network: Network,
  identity: Identity,
): Promise<{ socket: tls.TLSSocket; from: string }> {
  const socket = new tls.TLSSocket(stream, {
    isServer: true,
    secureContext: tls.createSecureContext({
      key: identity.keyPem,
      cert: identity.certPem,
      minVersion: "TLSv1.3",
    }),
    requestCert: true,
    // Certificates are self-signed; the proof below is what admits the member.
    rejectUnauthorized: false,
  });
  const run = async (): Promise<{ socket: tls.TLSSocket; from: string }> => {
    await secured(socket, "secure");
    const clientNode = peerNode(socket);
    const serverNode = nodeIdOf(identity.certDer);
    const proof = await readExact(socket, PROOF_BYTES);
    if (!proofMatches(proof, proofOf(network.proofKey, "client", serverNode, clientNode))) {
      throw new Error("the dialing side is not a member of this network");
    }
    socket.write(proofOf(network.proofKey, "server", serverNode, clientNode));
    return { socket, from: clientNode };
  };
  try {
    return await within(HANDSHAKE_MS, "securing the stream", () => socket.destroy(), run());
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

/** Where the link to the relay stands. */
export interface LinkStatus {
  /**
   * - `connecting`: not yet answered.
   * - `online`: visible to the network.
   * - `denied`: the relay does not know this network or its token.
   * - `unreachable`: the relay cannot be reached, or dropped the connection.
   */
  state: "connecting" | "online" | "denied" | "unreachable";
  /** Why, when not online. */
  error?: string;
}

/**
 * Keeps this computer online in its network: holds the control connection,
 * reconnects with backoff, and turns every "open" into a secured session
 * handed to `onSession`.
 */
export class RelayLink {
  status: LinkStatus = { state: "connecting" };
  readonly node: string;
  private readonly network: Network;
  private readonly identity: Identity;
  private readonly name: string;
  private readonly onSession: (socket: tls.TLSSocket, from: string) => void;
  private readonly warn: (message: string, error: unknown) => void;
  private stopped = false;
  private control: Duplex | undefined;
  private wake: (() => void) | undefined;

  constructor(
    network: Network,
    identity: Identity,
    name: string,
    onSession: (socket: tls.TLSSocket, from: string) => void,
    warn: (message: string, error: unknown) => void,
  ) {
    this.network = network;
    this.identity = identity;
    this.name = name;
    this.onSession = onSession;
    this.warn = warn;
    this.node = nodeIdOf(identity.certDer);
  }

  start(): void {
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.control?.destroy();
    this.wake?.();
  }

  private async run(): Promise<void> {
    let delay = RECONNECT_MIN_MS;
    while (!this.stopped) {
      try {
        await this.serve(() => {
          delay = RECONNECT_MIN_MS;
        });
      } catch (error) {
        if (this.stopped) return;
        const denied = error instanceof RelayRefused && error.code === "denied";
        this.status = {
          state: denied ? "denied" : "unreachable",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const pause = Promise.withResolvers<void>();
      const timer = setTimeout(pause.resolve, delay);
      this.wake = pause.resolve;
      await pause.promise;
      clearTimeout(timer);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    }
  }

  /** One control connection, from hello to its end; always ends by throwing. */
  private async serve(onOnline: () => void): Promise<never> {
    const { stream } = await hello(this.network, {
      role: "node",
      node: this.node,
      name: this.name.slice(0, 64),
    });
    if (this.stopped) {
      stream.destroy();
      throw new Error("stopped");
    }
    this.control = stream;
    this.status = { state: "online" };
    onOnline();
    let silence = setTimeout(() => stream.destroy(), CONTROL_SILENCE_MS);
    try {
      for (;;) {
        const message = asControl(await readLine(stream));
        clearTimeout(silence);
        silence = setTimeout(() => stream.destroy(), CONTROL_SILENCE_MS);
        if (message.type === "ping") writeLine(stream, { type: "pong" });
        else if (message.type === "open" && message.conn !== undefined)
          void this.accept(message.conn);
      }
    } finally {
      clearTimeout(silence);
      stream.destroy();
      this.control = undefined;
    }
  }

  private async accept(conn: string): Promise<void> {
    try {
      const { stream } = await hello(this.network, { role: "accept", node: this.node, conn });
      const { socket, from } = await secureAccept(stream, this.network, this.identity);
      this.onSession(socket, from);
    } catch (error) {
      // A non-member that reached the relay ends here, as does a dropped stream.
      this.warn("kivotos: relay stream not accepted", error);
    }
  }

  /** @returns the other nodes of the network that are online. */
  async peers(): Promise<RelayPeer[]> {
    const { stream, reply } = await hello(this.network, { role: "peers", node: this.node });
    stream.destroy();
    const peers: RelayPeer[] = [];
    for (const peer of reply.peers ?? []) {
      if (typeof peer.node !== "string" || peer.node === this.node) continue;
      peers.push({ node: peer.node, name: typeof peer.name === "string" ? peer.name : "" });
    }
    return peers;
  }

  /** @returns a secured session to another node of the network. */
  async dial(target: string): Promise<tls.TLSSocket> {
    const { stream } = await hello(this.network, { role: "dial", node: this.node, target });
    return secureDial(stream, this.network, this.identity, target);
  }
}

function asControl(value: unknown): { type?: string; conn?: string } {
  if (typeof value !== "object" || value === null) return {};
  const type: unknown = Reflect.get(value, "type");
  const conn: unknown = Reflect.get(value, "conn");
  return {
    type: typeof type === "string" ? type : undefined,
    conn: typeof conn === "string" ? conn : undefined,
  };
}

/**
 * An HTTP agent whose connections are secured sessions to one node. Sessions
 * are kept alive and reused: each new one costs a relay rendezvous and a TLS
 * handshake.
 */
export function relayAgent(link: RelayLink, target: string): http.Agent {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 6 });
  // Node accepts an agent that delivers its socket through the callback and
  // returns nothing; the declared type only describes the synchronous form.
  const connect = (
    _options: unknown,
    callback: (error: Error | null, socket?: Duplex) => void,
  ): void => {
    void (async () => {
      let socket: Duplex;
      try {
        socket = await link.dial(target);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      callback(null, socket);
    })();
  };
  Reflect.set(agent, "createConnection", connect);
  return agent;
}
