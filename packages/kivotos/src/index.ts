/**
 * Kivotos Host plugin: federates dsh hosts over Tailscale.
 *
 * Two halves run in every dsh:
 * - the tailnet listener binds this node's Tailscale address, admits only
 *   requests whose `tailscale whois` user equals this node's user, and
 *   forwards the whole dsh surface (HTTP + gateway WebSocket) into the
 *   loopback webServer with an in-process login cookie;
 * - the peer routes mount every discovered peer's listener under
 *   `/kivotos/peer/<id>/` on the local webServer, behind dsh's own
 *   connection fence, so the browser opens the peer's complete UI.
 */
import { mkdir, readFile } from "node:fs/promises";
import http from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { AttentionTracker, type AttentionFrame } from "./attention.ts";
import type { HostContext } from "./dsh.ts";
import {
  forwardHttp,
  forwardUpgrade,
  HOP_HEADER,
  hostnameOf,
  remoteIp,
  sendJson,
  type Upstream,
} from "./proxy.ts";
import { issueCert, readStatus, whois, type TailnetNode, type TailnetStatus } from "./tailscale.ts";

export const name = "kivotos";
export const inject = ["webServer", "connection"];

const VERSION = "0.1.2";
const PEER_PREFIX = "/kivotos/peer";
const HELLO_PATH = "/kivotos/hello";
const EVENTS_PATH = "/kivotos/events";
const PENDING_PATH = "/kivotos/events/pending";
/** SSE comment interval; keeps NAT and mobile radios from dropping an idle stream. */
const HEARTBEAT_MS = 25_000;
const PEERS_PATH = "/kivotos/peers";
const MUX_PATH = "/api/remote.mux";
const OWNS_HOST =
  "<script>globalThis.__DSH_TRANSPORT__=Object.assign(globalThis.__DSH_TRANSPORT__||{},{ownsHost:true})</script>";
const VIEWPORT_FROM = '<meta name="viewport" content="width=device-width, initial-scale=1" />';
const VIEWPORT_TO =
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />';
const MANIFEST_FROM = '<link rel="manifest" href="./manifest.webmanifest" />';
const MANIFEST_TO =
  '<link rel="manifest" href="./manifest.webmanifest" crossorigin="use-credentials" />';
const PEER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Re-login interval for the loopback cookie, far inside dsh's 30-day cookie lifetime. */
const LOGIN_TTL_MS = 12 * 60 * 60 * 1000;

/** A peer configured without discovery. */
export interface StaticPeer {
  /** URL-safe peer id. */
  id: string;
  name: string;
  /** Address of the peer's tailnet listener. */
  host: string;
  port: number;
  /** The listener speaks HTTPS. */
  tls?: boolean;
  /** TLS certificate name. */
  servername?: string;
}

/** Validated plugin config. */
export interface KivotosConfig {
  /** Run the tailnet listener. */
  listen: boolean;
  /** Bind address; "" = this node's Tailscale IPv4. */
  listenHost: string;
  /** Tailnet listener port, shared by all peers. */
  port: number;
  tls: "auto" | "on" | "off";
  /** Probe tailnet nodes of the same user. */
  discover: boolean;
  staticPeers: StaticPeer[];
  /** Admit requests from this node's own address. */
  allowSelf: boolean;
  /** tailscale CLI path. */
  tailscale: string;
  /** Peer discovery interval. */
  refreshSeconds: number;
}

interface ConfigIssue {
  message: string;
  path: string[];
}

const DEFAULTS: KivotosConfig = {
  listen: true,
  listenHost: "",
  port: 7380,
  tls: "auto",
  discover: true,
  staticPeers: [],
  allowSelf: false,
  tailscale: "tailscale",
  refreshSeconds: 30,
};

function staticPeersOf(
  input: Record<string, unknown>,
  issue: (message: string, key: string) => void,
): StaticPeer[] {
  const raw = input.staticPeers ?? [];
  if (!Array.isArray(raw)) {
    issue("must be an array", "staticPeers");
    return [];
  }
  return raw.map((entry: unknown, index) => {
    const peer = (entry ?? {}) as Record<string, unknown>;
    const key = `staticPeers.${index}`;
    if (typeof peer.id !== "string" || !PEER_ID.test(peer.id))
      issue("id must match [A-Za-z0-9_-]{1,64}", key);
    if (typeof peer.host !== "string" || peer.host === "") issue("host is required", key);
    if (!Number.isInteger(peer.port)) issue("port must be an integer", key);
    const parsed: StaticPeer = {
      id: String(peer.id),
      name: typeof peer.name === "string" ? peer.name : String(peer.id),
      host: String(peer.host),
      port: Number(peer.port),
      tls: peer.tls === true,
    };
    if (typeof peer.servername === "string") parsed.servername = peer.servername;
    return parsed;
  });
}

/**
 * Validate a config row and fill defaults (Standard Schema v1, synchronous).
 * @param value - raw config.
 * @returns the filled config, or every issue found.
 */
function validate(value: unknown): { value: KivotosConfig } | { issues: ConfigIssue[] } {
  const input = (value ?? {}) as Record<string, unknown>;
  const issues: ConfigIssue[] = [];
  const issue = (message: string, key: string): void => {
    issues.push({ message, path: key.split(".") });
  };
  const out: KivotosConfig = { ...DEFAULTS };
  for (const key of ["listen", "discover", "allowSelf"] as const) {
    const given = input[key];
    if (given === undefined) continue;
    if (typeof given === "boolean") out[key] = given;
    else issue("must be a boolean", key);
  }
  for (const key of ["listenHost", "tailscale"] as const) {
    const given = input[key];
    if (given === undefined) continue;
    if (typeof given === "string") out[key] = given;
    else issue("must be a string", key);
  }
  const ranges = [
    ["port", 1, 65535],
    ["refreshSeconds", 5, 3600],
  ] as const;
  for (const [key, min, max] of ranges) {
    const given = input[key];
    if (given === undefined) continue;
    if (typeof given === "number" && Number.isInteger(given) && given >= min && given <= max)
      out[key] = given;
    else issue(`must be an integer in ${min}..${max}`, key);
  }
  if (input.tls !== undefined) {
    if (input.tls === "auto" || input.tls === "on" || input.tls === "off") out.tls = input.tls;
    else issue('must be "auto", "on" or "off"', "tls");
  }
  out.staticPeers = staticPeersOf(input, issue);
  if (issues.length > 0) return { issues };
  return { value: out };
}

export const Config = { "~standard": { version: 1, vendor: "kivotos", validate } } as const;

/**
 * Insert the ownsHost transport global right after the opening head tag.
 * A page served through a Kivotos hop belongs to the same tailnet user as the
 * host, so it gets the operator surface (host-persisted settings) that a
 * loopback page gets.
 * @param html - index html.
 * @returns html with the global.
 */
export function injectOwnsHost(html: string): string {
  return injectHead(html, OWNS_HOST);
}

/**
 * Give a mounted peer page its own localStorage namespace. Every peer UI is
 * served from the host page's origin, and dsh persists client stores
 * (current Session, layout, drafts) in localStorage by fixed keys, so
 * without a namespace two machines' UIs overwrite each other's state.
 * @param html - peer index html.
 * @param peerId - URL-safe peer id.
 * @returns html with the namespace installed before any app script.
 */
export function injectStorageNamespace(html: string, peerId: string): string {
  // `<` is escaped so the id cannot close the script element, whatever the caller validated.
  const prefix = JSON.stringify(`kivotos:${peerId}:`).replaceAll("<", "\\u003c");
  const script = `<script>(()=>{const s=window.localStorage,p=${prefix},own=()=>{const k=[];for(let i=0;i<s.length;i++){const n=s.key(i);if(n!==null&&n.startsWith(p))k.push(n.slice(p.length))}return k};const v={getItem:k=>s.getItem(p+k),setItem:(k,x)=>s.setItem(p+k,String(x)),removeItem:k=>s.removeItem(p+k),key:i=>own()[i]??null,clear:()=>{for(const k of own())s.removeItem(p+k)},get length(){return own().length}};Object.defineProperty(window,"localStorage",{configurable:true,get:()=>v})})()</script>`;
  return injectHead(html, script);
}

function injectHead(html: string, markup: string): string {
  const open = /<head(?:\s[^>]*)?>/i.exec(html);
  if (open === null) return `${markup}${html}`;
  const at = open.index + open[0].length;
  return `${html.slice(0, at)}${markup}${html.slice(at)}`;
}

/**
 * Let the page draw under the phone's safe areas (notch, home indicator).
 * @param html - index html.
 * @returns html with a safe-area viewport.
 */
export function coverViewport(html: string): string {
  return html.replace(VIEWPORT_FROM, VIEWPORT_TO);
}

/**
 * Make a mounted peer page fetch its web manifest with credentials. Browsers
 * request a manifest link without cookies, dsh serves it publicly, but every
 * path under a peer mount sits behind the dsh connection fence, so the
 * uncredentialed fetch would answer 401.
 * @param html - peer index html.
 * @returns html whose manifest link carries credentials.
 */
export function credentialedManifest(html: string): string {
  return html.replace(MANIFEST_FROM, MANIFEST_TO);
}

/**
 * Whether a request's browser markers are same-origin: no cross-site
 * Fetch-Metadata, and an Origin (when attached) naming the request authority.
 * @param headers - request headers.
 * @returns false for a request a foreign page initiated.
 */
export function sameSite(headers: IncomingHttpHeaders): boolean {
  if (headers["sec-fetch-site"] === "cross-site") return false;
  const origin = headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === new URL(`http://${headers.host}`).host;
  } catch {
    // The literal "null" (sandboxed frames, file: pages) is an opaque origin.
    return false;
  }
}

/** dsh home; certificate storage lives under it. */
function dshHome(): string {
  return process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
}

/**
 * Login cookie for the loopback dsh, obtained in-process through the
 * connection's token exchange and refreshed by age and after an upstream 401.
 */
class LoopbackSession {
  private readonly ctx: HostContext;
  private cookie: Promise<string> | undefined;
  private issuedAt = 0;

  constructor(ctx: HostContext) {
    this.ctx = ctx;
  }

  /** Loopback authority of the dsh webServer. */
  get authority(): string {
    return `127.0.0.1:${this.ctx.webServer.port}`;
  }

  /** @returns Cookie header value. */
  get(): Promise<string> {
    // dsh cookies carry an absolute lifetime. Logging in again well inside it
    // keeps a long-running host from answering one request with 401 when the
    // cached cookie lapses; the 401 invalidation covers shorter configured lifetimes.
    if (Date.now() - this.issuedAt > LOGIN_TTL_MS) this.cookie = undefined;
    if (this.cookie === undefined) {
      this.issuedAt = Date.now();
      this.cookie = this.login().catch((error: unknown) => {
        this.cookie = undefined;
        throw error;
      });
    }
    return this.cookie;
  }

  /** Drop the cached cookie so the next request logs in again. */
  invalidate(): void {
    this.cookie = undefined;
  }

  private async login(): Promise<string> {
    const url = this.ctx.connection.authenticatedUrl(`http://${this.authority}/`);
    const res = await fetch(url, { redirect: "manual" });
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    if (cookie === undefined || cookie === "") {
      throw new Error(`kivotos: loopback login returned ${res.status} without a cookie`);
    }
    return cookie;
  }
}

/** The listener's admission: expected authority, same-site, own tailnet user. */
class Admission {
  private readonly config: KivotosConfig;
  private readonly status: TailnetStatus;
  private readonly hosts: Set<string>;
  private readonly cache = new Map<string, { at: number; ok: boolean }>();

  constructor(config: KivotosConfig, status: TailnetStatus, bindHost: string) {
    this.config = config;
    this.status = status;
    this.hosts = new Set([bindHost, ...status.self.ips, status.self.dnsName].filter(Boolean));
  }

  /** @returns rejection status, or undefined when admitted. */
  async check(req: IncomingMessage): Promise<number | undefined> {
    // DNS rebinding: a browser reaching this listener under any other name is
    // not talking to this node on purpose.
    if (!this.hosts.has(hostnameOf(req.headers.host))) return 421;
    // Cross-site requests: forwarding strips Origin and Fetch-Metadata, so the
    // loopback dsh cannot apply its own fence to this hop. Without this check
    // any web page open in a tailnet browser could drive dsh, because a
    // WebSocket handshake is not subject to CORS.
    if (!sameSite(req.headers)) return 403;
    const ip = remoteIp(req.socket.remoteAddress);
    if (!this.config.allowSelf && this.status.self.ips.includes(ip)) return 403;
    return (await this.identify(ip)) ? undefined : 403;
  }

  private async identify(ip: string): Promise<boolean> {
    const now = Date.now();
    const hit = this.cache.get(ip);
    if (hit !== undefined && now - hit.at < 60_000) return hit.ok;
    const who = await whois(this.config.tailscale, ip);
    const ok = who !== undefined && who.userId === this.status.self.userId;
    this.cache.set(ip, { at: now, ok });
    return ok;
  }
}

/**
 * Resolve the listener's TLS material per `config.tls`.
 * @returns material, or undefined for plain HTTP.
 */
async function listenerTls(
  config: KivotosConfig,
  status: TailnetStatus,
): Promise<{ cert: Buffer; key: Buffer } | undefined> {
  const domain = status.self.dnsName;
  const available = domain !== "" && status.certDomains.includes(domain);
  if (config.tls === "off" || (config.tls === "auto" && !available)) return undefined;
  if (!available)
    throw new Error("kivotos: tls is on but the tailnet has no HTTPS certificate domain");
  const dir = path.join(dshHome(), "kivotos", "tls");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const certFile = path.join(dir, `${domain}.crt`);
  const keyFile = path.join(dir, `${domain}.key`);
  await issueCert(config.tailscale, domain, certFile, keyFile);
  return { cert: await readFile(certFile), key: await readFile(keyFile) };
}

/**
 * Start the tailnet listener.
 * @returns its pairing URL (when reachable over the tailnet) and disposer.
 */
async function startListener(
  ctx: HostContext,
  config: KivotosConfig,
  status: TailnetStatus,
  attention: AttentionTracker,
  onFailure: () => void,
): Promise<{ url?: string; dispose: () => Promise<void> }> {
  const bindHost = config.listenHost || status.self.ips.find((ip) => !ip.includes(":"));
  if (bindHost === undefined) throw new Error("kivotos: this node has no Tailscale IPv4 address");
  const admission = new Admission(config, status, bindHost);
  const session = new LoopbackSession(ctx);
  const tls = await listenerTls(config, status);

  const upstream = (cookie: string): Upstream => ({
    host: "127.0.0.1",
    port: ctx.webServer.port,
    authority: session.authority,
    cookie,
  });

  const onRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rejection = await admission.check(req);
    if (rejection !== undefined) {
      res.writeHead(rejection, { "content-type": "text/plain; charset=utf-8" });
      res.end("kivotos: not admitted");
      return;
    }
    const url = req.url ?? "/";
    const parsed = new URL(url, "http://x");
    if (parsed.pathname === HELLO_PATH) {
      sendJson(res, 200, { kivotos: VERSION, name: status.self.name, os: status.self.os });
      return;
    }
    if (parsed.pathname === PENDING_PATH) {
      sendJson(res, 200, { frames: attention.pending() });
      return;
    }
    if (parsed.pathname === EVENTS_PATH) {
      // A cursor from another Host process says nothing about this one: replay all.
      const sameEpoch = parsed.searchParams.get("epoch") === attention.epoch;
      const after = sameEpoch ? Number(parsed.searchParams.get("after") ?? "0") : 0;
      streamAttention(req, res, attention, after);
      return;
    }
    const cookie = await session.get();
    res.on("finish", () => {
      if (res.statusCode === 401) session.invalidate();
    });
    forwardHttp(req, res, upstream(cookie), { path: url, prefix: "", html: injectOwnsHost });
  };

  const onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    const rejection = await admission.check(req);
    if (rejection !== undefined) {
      socket.end(`HTTP/1.1 ${rejection} Rejected\r\n\r\n`);
      return;
    }
    forwardUpgrade(req, socket, head, upstream(await session.get()), req.url ?? "/");
  };

  const server = tls === undefined ? http.createServer() : https.createServer(tls);
  const sockets = new Set<Duplex>();
  const fail = (error: unknown): void => {
    ctx.logger.warn("kivotos: listener request failed", error);
  };
  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    onRequest(req, res).catch((error: unknown) => {
      fail(error);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    onUpgrade(req, socket, head).catch((error: unknown) => {
      fail(error);
      socket.destroy();
    });
  });
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(config.port, bindHost, () => {
    server.off("error", listening.reject);
    listening.resolve();
  });
  await listening.promise;
  server.on("error", (error) => {
    ctx.logger.warn("kivotos: listener error", error);
    onFailure();
  });
  const address = server.address();
  const bound = address !== null && typeof address !== "string" ? address.address : "";
  const tailnetIp = bound === "0.0.0.0" ? status.self.ips.find((ip) => !ip.includes(":")) : bound;
  const octets = tailnetIp?.split(".").map(Number);
  const reachable =
    tailnetIp !== undefined &&
    status.self.ips.includes(tailnetIp) &&
    octets?.length === 4 &&
    octets[0] === 100 &&
    octets[1] >= 64 &&
    octets[1] <= 127 &&
    octets.slice(2).every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  let url: string | undefined;
  if (reachable) {
    if (tls === undefined) url = `http://${tailnetIp}:${config.port}`;
    else if (status.self.dnsName.endsWith(".ts.net"))
      url = `https://${status.self.dnsName}:${config.port}`;
  }
  ctx.logger.info(
    `kivotos: listening on ${tls === undefined ? "http" : "https"}://${bindHost}:${config.port}`,
  );
  return {
    url,
    dispose: () => {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      return closed.promise;
    },
  };
}

/**
 * Serve the attention stream as Server-Sent Events: frames after `afterId`
 * first, then live frames, with heartbeat comments. Runs only behind the
 * tailnet listener's admission.
 */
function streamAttention(
  req: IncomingMessage,
  res: ServerResponse,
  attention: AttentionTracker,
  afterId: number,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (frame: AttentionFrame): void => {
    res.write(`id: ${frame.id}\nevent: attention\ndata: ${JSON.stringify(frame)}\n\n`);
  };
  for (const frame of attention.since(Number.isFinite(afterId) ? afterId : 0)) send(frame);
  const unsubscribe = attention.subscribe(send);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  const stop = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("close", stop);
  res.on("close", stop);
}

/** A mounted peer. */
interface Peer {
  /** URL-safe id. */
  id: string;
  name: string;
  /** Operating system ("" when unknown). */
  os: string;
  /** The peer's tailnet listener. */
  upstream: Upstream;
}

/**
 * Probe one tailnet node's Kivotos listener.
 * @returns the peer, or undefined when it runs no listener.
 */
async function probe(node: TailnetNode, port: number): Promise<Peer | undefined> {
  const ip = node.ips.find((address) => !address.includes(":"));
  if (ip === undefined) return undefined;
  const id = node.id.replace(/[^A-Za-z0-9_-]/g, "") || ip.replaceAll(".", "-");
  const candidates: Pick<Upstream, "tls" | "servername" | "authority">[] = [
    ...(node.dnsName === ""
      ? []
      : [{ tls: true, servername: node.dnsName, authority: `${node.dnsName}:${port}` }]),
    { tls: false, authority: `${ip}:${port}` },
  ];
  for (const candidate of candidates) {
    const upstream: Upstream = { host: ip, port, hop: true, ...candidate };
    const hello = await getJson(upstream, HELLO_PATH);
    if (hello?.kivotos !== undefined) {
      return {
        id,
        name: String(hello.name ?? node.name),
        os: String(hello.os ?? node.os),
        upstream,
      };
    }
  }
  return undefined;
}

/** @returns the parsed body, undefined on any failure. */
function getJson(
  upstream: Upstream,
  pathname: string,
): Promise<Record<string, unknown> | undefined> {
  const { promise, resolve } = Promise.withResolvers<Record<string, unknown> | undefined>();
  const options = {
    host: upstream.host,
    port: upstream.port,
    path: pathname,
    headers: { host: upstream.authority, accept: "application/json" },
    timeout: 3_000,
  };
  const req =
    upstream.tls === true
      ? https.get({ ...options, servername: upstream.servername })
      : http.get(options);
  req.on("response", (res) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () =>
      resolve(res.statusCode === 200 ? parseJson(Buffer.concat(chunks)) : undefined),
    );
    res.on("error", () => resolve(undefined));
  });
  req.on("timeout", () => req.destroy());
  req.on("error", () => resolve(undefined));
  return promise;
}

function parseJson(bytes: Buffer): Record<string, unknown> | undefined {
  try {
    return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    // A non-JSON 200 is some other service on the port: not a peer.
    return undefined;
  }
}

/** Peer registry plus the per-peer webServer routes. */
class PeerRoutes {
  private readonly mounted = new Map<string, { peer: Peer; dispose: () => void }>();
  private readonly ctx: HostContext;
  self: { name: string; os: string; url?: string } = { name: os.hostname(), os: process.platform };

  constructor(ctx: HostContext) {
    this.ctx = ctx;
  }

  /** Answer a dsh-side request through the connection fence; true when rejected. */
  private rejected(req: IncomingMessage, res: ServerResponse): boolean {
    const rejection = this.ctx.connection.requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  }

  reconcile(peers: Peer[]): void {
    const next = new Map(peers.map((peer) => [peer.id, peer]));
    for (const [id, entry] of this.mounted) {
      const peer = next.get(id);
      if (peer !== undefined && sameUpstream(peer.upstream, entry.peer.upstream)) {
        entry.peer = peer;
        continue;
      }
      entry.dispose();
      this.mounted.delete(id);
    }
    for (const peer of peers) {
      if (!this.mounted.has(peer.id)) this.mount(peer);
    }
  }

  private mount(peer: Peer): void {
    const prefix = `${PEER_PREFIX}/${peer.id}`;
    const entry = { peer, dispose: (): void => {} };
    const disposeHttp = this.ctx.webServer.register({
      kind: "prefix",
      path: prefix,
      handler: (req, res) => {
        if (this.rejected(req, res)) return;
        const url = new URL(req.url ?? "/", "http://x");
        if (url.pathname === prefix) {
          res.writeHead(308, { location: `${prefix}/${url.search}` });
          res.end();
          return;
        }
        if (req.headers[HOP_HEADER] !== undefined) {
          res.writeHead(508, { "content-type": "text/plain; charset=utf-8" });
          res.end("kivotos: peer hops do not chain");
          return;
        }
        const rest = `${url.pathname.slice(prefix.length)}${url.search}`;
        forwardHttp(req, res, entry.peer.upstream, {
          path: rest,
          prefix,
          html: (body) => credentialedManifest(injectStorageNamespace(body, peer.id)),
        });
      },
    });
    const disposeUpgrade = this.ctx.webServer.registerUpgrade({
      path: `${prefix}${MUX_PATH}`,
      handler: (req, socket, head) => {
        const rejection = this.ctx.connection.requestRejection(req);
        if (rejection !== undefined) {
          socket.end(`HTTP/1.1 ${rejection} Rejected\r\n\r\n`);
          return;
        }
        if (req.headers[HOP_HEADER] !== undefined) {
          socket.end("HTTP/1.1 508 Loop Detected\r\n\r\n");
          return;
        }
        const search = new URL(req.url ?? "/", "http://x").search;
        forwardUpgrade(req, socket, head, entry.peer.upstream, `${MUX_PATH}${search}`);
      },
    });
    entry.dispose = () => {
      disposeUpgrade();
      disposeHttp();
    };
    this.mounted.set(peer.id, entry);
  }

  /** @returns disposer of the peers route. */
  registerList(): () => void {
    return this.ctx.webServer.register({
      kind: "exact",
      path: PEERS_PATH,
      handler: (req, res) => {
        if (this.rejected(req, res)) return;
        const peers = [...this.mounted.values()].map(({ peer }) => ({
          id: peer.id,
          name: peer.name,
          os: peer.os,
        }));
        sendJson(res, 200, { self: this.self, peers });
      },
    });
  }

  dispose(): void {
    for (const entry of this.mounted.values()) entry.dispose();
    this.mounted.clear();
  }
}

function sameUpstream(a: Upstream, b: Upstream): boolean {
  return a.host === b.host && a.port === b.port && a.tls === b.tls && a.authority === b.authority;
}

function staticUpstream(peer: StaticPeer): Upstream {
  const upstream: Upstream = {
    host: peer.host,
    port: peer.port,
    hop: true,
    tls: peer.tls === true,
    authority: `${peer.tls === true && peer.servername !== undefined ? peer.servername : peer.host}:${peer.port}`,
  };
  if (peer.servername !== undefined) upstream.servername = peer.servername;
  return upstream;
}

/** @returns reachable peers, static first. */
async function discover(config: KivotosConfig, status: TailnetStatus): Promise<Peer[]> {
  const peers: Peer[] = config.staticPeers.map((peer) => ({
    id: peer.id,
    name: peer.name,
    os: "",
    upstream: staticUpstream(peer),
  }));
  if (!config.discover) return peers;
  const taken = new Set(peers.map((peer) => peer.id));
  const candidates = status.peers.filter(
    (node) => node.online && node.userId === status.self.userId,
  );
  const found = await Promise.all(candidates.map((node) => probe(node, config.port)));
  for (const peer of found) {
    if (peer === undefined || taken.has(peer.id)) continue;
    taken.add(peer.id);
    peers.push(peer);
  }
  return peers;
}

function emptyStatus(): TailnetStatus {
  const self = { id: "", name: "", dnsName: "", os: "", online: true, userId: 0, ips: [] };
  return { self, peers: [], certDomains: [] };
}

/**
 * Plugin body: the viewport tap, the tailnet listener, and the peer routes.
 * @param ctx - plugin context.
 * @param config - validated config.
 */
export function apply(ctx: HostContext, config: KivotosConfig): void {
  ctx.effect(() => ctx.webServer.tapIndex(coverViewport), "kivotos: viewport-fit=cover");

  // Every Session's appends, browser-opened or not: the source of the phone's notifications.
  // ctx.on owns its listener's lifetime: it is removed when the plugin unloads.
  const attention = new AttentionTracker((session) =>
    ctx.get("sessionProjections")?.stateOf(session, "title"),
  );
  ctx.on("session/event", (session, event) => attention.observe(session, event));
  ctx.on("session/disposed", (session) => attention.forget(session.id));

  ctx.effect(() => {
    const routes = new PeerRoutes(ctx);
    const disposeList = routes.registerList();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: Promise<{ url?: string; dispose: () => Promise<void> }> | undefined;

    const refresh = async (): Promise<void> => {
      try {
        const status = await readStatus(config.tailscale);
        if (stopped) return;
        routes.self = { ...routes.self, name: status.self.name, os: status.self.os };
        if (config.listen && listener === undefined) {
          const starting = startListener(ctx, config, status, attention, () => {
            routes.self.url = undefined;
          });
          listener = starting;
          void (async () => {
            try {
              const { url } = await starting;
              if (!stopped) routes.self.url = url;
            } catch (error) {
              ctx.logger.warn("kivotos: tailnet listener failed to start", error);
              listener = undefined;
            }
          })();
        }
        const peers = await discover(config, status);
        if (!stopped) routes.reconcile(peers);
      } catch (error) {
        ctx.logger.warn("kivotos: tailnet refresh failed", error);
        if (!stopped && config.staticPeers.length > 0) {
          routes.reconcile(await discover({ ...config, discover: false }, emptyStatus()));
        }
      } finally {
        if (!stopped) timer = setTimeout(() => void refresh(), config.refreshSeconds * 1000);
      }
    };
    void refresh();

    return async () => {
      stopped = true;
      clearTimeout(timer);
      disposeList();
      routes.dispose();
      const started = await listener?.catch(() => undefined);
      await started?.dispose();
    };
  }, "kivotos: tailnet listener and peer routes");
}
