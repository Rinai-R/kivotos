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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Duplex } from "node:stream";
import { AttentionHub } from "./attention-hub.ts";
import { AttentionTracker, type AttentionFrame } from "./attention.ts";
import { HASHED_ASSET, markImmutable, MountCache } from "./cache.ts";
import type { HostContext } from "./dsh.ts";
import {
  MachineBook,
  probeFailure,
  tellingReason,
  type Absent,
  type BookMachine,
  type Sighting,
} from "./machine-book.ts";
import type { LinkReason, MachineInfo, Via } from "./machines.ts";
import {
  forwardHttp,
  forwardUpgrade,
  getJson,
  HOP_HEADER,
  hostnameOf,
  remoteIp,
  sendJson,
  type HttpStats,
  type Upstream,
  type UpgradeTrace,
} from "./proxy.ts";
import { RelayHost } from "./relay-host.ts";
import { issueCert, readStatus, whois, type TailnetNode, type TailnetStatus } from "./tailscale.ts";
import { tracePath } from "./trace-path.ts";
import { TraceLog, type TraceLevel } from "./trace.ts";

export const name = "kivotos";
export const inject = ["webServer", "connection"];

const VERSION = "0.1.5";
const PEER_PREFIX = "/kivotos/peer";
const HELLO_PATH = "/kivotos/hello";
const EVENTS_PATH = "/kivotos/events";
const PENDING_PATH = "/kivotos/events/pending";
/** SSE comment interval; keeps NAT and mobile radios from dropping an idle stream. */
const HEARTBEAT_MS = 25_000;
const PEERS_PATH = "/kivotos/peers";
/** Which ways this computer is reachable, for the settings page. */
const LINKS_PATH = "/kivotos/links";
/** Create, join or leave a relay network. */
const RELAY_PATH = "/kivotos/relay";
/** Largest body accepted on {@link RELAY_PATH}. */
const RELAY_BODY_MAX_BYTES = 4096;
/** The other machines' attention, merged for this Host's pages (attention-hub.ts). */
const ATTENTION_PATH = "/kivotos/attention";
/** A page says it opened a machine: its finished turns are no longer news. */
const ATTENTION_SEEN_PATH = "/kivotos/attention/seen";
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
/** Where a page posts its own load timings (see client.tsx); see {@link registerTraceClientRoute}. */
const TRACE_CLIENT_PATH = "/kivotos/trace/client";
/** Largest client timing report accepted. */
const TRACE_CLIENT_MAX_BYTES = 256 * 1024;
/** Tells the client module, on pages the tailnet listener served, to report its load timings. */
const TRACE_FLAG = "<script>globalThis.__KIVOTOS_TRACE__=true</script>";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Earliest re-probe of the tailnet after a refresh, when a mount's request failed. */
const RECHECK_MIN_MS = 5_000;

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
  /**
   * Days a machine stays listed (as offline) after no link reports it any
   * more: it left the relay network's online list, or the tailnet dropped it.
   * Static peers stay while configured; the tailnet lists its own offline nodes.
   */
  offlineDays: number;
  /** Trace log: off, every HTTP exchange and WebSocket, or also every WebSocket frame. */
  trace: TraceLevel;
  /** Size cap of the peer mount cache (`$DSH_HOME/kivotos/cache/`); 0 turns it off. */
  cacheMegabytes: number;
  /** Prefill the mount cache with a peer's boot resources when it is mounted. */
  cacheWarm: boolean;
  /** System notifications on this Host's pages for other machines' approvals and questions. */
  notify: boolean;
  /** Also notify finished and failed turns of other machines. */
  notifyFinished: boolean;
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
  offlineDays: 7,
  trace: "requests",
  // One dsh 0.2.0-rc.2 page load stores about 6 MB (gzip); every launch of a
  // peer's dsh revisions its plugin batches anew. 256 MB holds some 40 such
  // sets, a few launches of every peer in a household tailnet, before the
  // least recently used go.
  cacheMegabytes: 256,
  cacheWarm: true,
  notify: true,
  notifyFinished: true,
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
  for (const key of [
    "listen",
    "discover",
    "allowSelf",
    "cacheWarm",
    "notify",
    "notifyFinished",
  ] as const) {
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
    ["offlineDays", 1, 365],
    ["cacheMegabytes", 0, 10240],
  ] as const;
  for (const [key, min, max] of ranges) {
    const given = input[key];
    if (given === undefined) continue;
    if (typeof given === "number" && Number.isInteger(given) && given >= min && given <= max)
      out[key] = given;
    else issue(`must be an integer in ${min}..${max}`, key);
  }
  out.tls = choiceOf(input, "tls", ["auto", "on", "off"], out.tls, issue);
  out.trace = choiceOf(input, "trace", ["off", "requests", "frames"], out.trace, issue);
  out.staticPeers = staticPeersOf(input, issue);
  if (issues.length > 0) return { issues };
  return { value: out };
}

/**
 * One string option with a fixed set of values.
 * @returns the given value, or `fallback` when absent or invalid (invalid also files an issue).
 */
function choiceOf<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
  issue: (message: string, key: string) => void,
): T {
  const given = input[key];
  if (given === undefined) return fallback;
  if (allowed.includes(given as T)) return given as T;
  issue(`must be ${allowed.map((value) => `"${value}"`).join(", ")}`, key);
  return fallback;
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
 *
 * A navigation to `#kivotos-session=<id>` also makes that Session the
 * current one before dsh restores it, then drops the fragment: this is how a
 * page on another machine opens this one on a Session (client.tsx), since
 * from there it can reach only its own namespace.
 * @param html - peer index html.
 * @param peerId - URL-safe peer id.
 * @returns html with the namespace installed before any app script.
 */
export function injectStorageNamespace(html: string, peerId: string): string {
  // `<` is escaped so the id cannot close the script element, whatever the caller validated.
  const prefix = JSON.stringify(`kivotos:${peerId}:`).replaceAll("<", "\\u003c");
  const script = `<script>(()=>{const s=window.localStorage,p=${prefix},own=()=>{const k=[];for(let i=0;i<s.length;i++){const n=s.key(i);if(n!==null&&n.startsWith(p))k.push(n.slice(p.length))}return k};const v={getItem:k=>s.getItem(p+k),setItem:(k,x)=>s.setItem(p+k,String(x)),removeItem:k=>s.removeItem(p+k),key:i=>own()[i]??null,clear:()=>{for(const k of own())s.removeItem(p+k)},get length(){return own().length}};Object.defineProperty(window,"localStorage",{configurable:true,get:()=>v});const o=/^#kivotos-session=([^&]+)$/.exec(location.hash);if(o!==null){try{s.setItem(p+"dsh.sessions.current",JSON.stringify({sessionId:decodeURIComponent(o[1])}))}catch{}history.replaceState(history.state,"",location.pathname+location.search)}})()</script>`;
  return injectHead(html, script);
}

/**
 * Keep the desktop app's own boot out of a mounted peer page.
 *
 * The dsh desktop shell (0.2.0-rc.2) exposes `dshDesktopBoot` to every page of
 * its `dsh-app://app` origin, and dsh's web entry, finding it, fetches the boot
 * rows of the local Host and applies them to the page: the local
 * `__ModuleLoader__` registration facade replaces the page's, and the
 * transport points the page's WebSocket at the local Host. On a peer's page
 * that races the peer's own boot. Bundles that execute after the replacement
 * register with the local facade, the page's module system never sees them,
 * and the window dies with "web boot: N entries did not activate"; when the
 * boot wins instead, the page's streams belong to the wrong machine.
 *
 * The guard runs before every other page script. It takes the desktop
 * handshake itself, keeps only its Host origin and rebases the WebSocket under
 * this mount, so the streams reach the peer through it. It holds the page's
 * boot until the handshake settles, and refuses the web entry's own transport,
 * which stops the entry before it applies the local rows. Without
 * `dshDesktopBoot` (browser, phone) it does nothing.
 * @param html - peer index html.
 * @param prefix - the mount's path prefix, e.g. `/kivotos/peer/<id>`.
 * @returns html with the guard first in its head.
 */
export function guardDesktopBoot(html: string, prefix: string): string {
  // `<` is escaped so the prefix cannot close the script element.
  const mount = JSON.stringify(`${prefix}/`).replaceAll("<", "\\u003c");
  const script = `<script>(()=>{const d=globalThis.dshDesktopBoot;if(typeof d!=="object"||d===null||typeof d.ready!=="function")return;const m=${mount},b=Promise.withResolvers();let t=globalThis.__DSH_TRANSPORT__;Object.defineProperty(globalThis,"__DSH_TRANSPORT__",{configurable:true,enumerable:true,get:()=>t,set(n){if(n!==t&&typeof n==="object"&&n!==null&&"streamBaseUrl" in n)throw new Error("kivotos: a mounted machine's page keeps its own boot");t=n}});globalThis.__DSH_BOOT_READY__={promise:b.promise,resolve(){},reject(){}};d.ready().then(r=>{t={...t,ownsHost:true,streamBaseUrl:new URL(m,r.streamBaseUrl).href};b.resolve()},b.reject)})()</script>`;
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
  private readonly trace: TraceLog;
  private cookie: Promise<string> | undefined;
  private issuedAt = 0;

  constructor(ctx: HostContext, trace: TraceLog) {
    this.ctx = ctx;
    this.trace = trace;
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
    const start = performance.now();
    const url = this.ctx.connection.authenticatedUrl(`http://${this.authority}/`);
    const res = await fetch(url, { redirect: "manual" });
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    const ok = cookie !== undefined && cookie !== "";
    this.trace.record("login", { status: res.status, ok, ms: ms(performance.now() - start) });
    if (!ok) throw new Error(`kivotos: loopback login returned ${res.status} without a cookie`);
    return cookie;
  }
}

/** Who a request comes from, and how long admitting it took. */
interface Verdict {
  /** Rejection status; undefined when admitted. */
  status?: number;
  /** Why it was rejected. */
  reason?: string;
  ip: string;
  /** Tailnet node name ("" when unknown). */
  node: string;
  /** Admission time; mostly `tailscale whois` on a cache miss. */
  admitMs: number;
  /** The whois answer came from the cache. */
  cached: boolean;
}

interface Identity {
  ok: boolean;
  node: string;
}

/** The listener's admission: expected authority, same-site, own tailnet user. */
class Admission {
  private readonly config: KivotosConfig;
  private readonly status: TailnetStatus;
  private readonly hosts: Set<string>;
  /**
   * Pending or settled whois per address. A page load fires dozens of
   * requests at once; they share one lookup instead of one process each.
   */
  private readonly cache = new Map<string, { at: number; who: Promise<Identity> }>();

  constructor(config: KivotosConfig, status: TailnetStatus, bindHost: string) {
    this.config = config;
    this.status = status;
    this.hosts = new Set([bindHost, ...status.self.ips, status.self.dnsName].filter(Boolean));
  }

  async check(req: IncomingMessage): Promise<Verdict> {
    const start = performance.now();
    const ip = remoteIp(req.socket.remoteAddress);
    const verdict = (status: number, reason: string, node = ""): Verdict => ({
      status,
      reason,
      ip,
      node,
      admitMs: ms(performance.now() - start),
      cached: false,
    });
    // DNS rebinding: a browser reaching this listener under any other name is
    // not talking to this node on purpose.
    if (!this.hosts.has(hostnameOf(req.headers.host))) return verdict(421, "host");
    // Cross-site requests: forwarding strips Origin and Fetch-Metadata, so the
    // loopback dsh cannot apply its own fence to this hop. Without this check
    // any web page open in a tailnet browser could drive dsh, because a
    // WebSocket handshake is not subject to CORS.
    if (!sameSite(req.headers)) return verdict(403, "cross-site");
    if (!this.config.allowSelf && this.status.self.ips.includes(ip)) return verdict(403, "self");
    const { who, cached } = this.identify(ip);
    const identity = await who;
    if (!identity.ok) return { ...verdict(403, "user", identity.node), cached };
    return { ip, node: identity.node, admitMs: ms(performance.now() - start), cached };
  }

  private identify(ip: string): { who: Promise<Identity>; cached: boolean } {
    const now = Date.now();
    const hit = this.cache.get(ip);
    if (hit !== undefined && now - hit.at < 60_000) return { who: hit.who, cached: true };
    const who = whois(this.config.tailscale, ip).then(
      (found): Identity => ({
        ok: found !== undefined && found.userId === this.status.self.userId,
        node: found?.node ?? "",
      }),
    );
    this.cache.set(ip, { at: now, who });
    return { who, cached: false };
  }
}

/** Milliseconds rounded for the trace. */
function ms(value: number): number {
  return Math.round(value);
}

/** HTTP stats with times rounded, ready for a trace record. */
function roundStats(stats: HttpStats): Record<string, unknown> {
  return { ...stats, ttfbMs: ms(stats.ttfbMs), totalMs: ms(stats.totalMs) };
}

/**
 * Trace observer for one forwarded WebSocket: a `ws` record on close and,
 * at the `frames` level, a `ws.frame` record per frame header.
 * @param trace - log.
 * @param base - fields shared by every record of this socket (id, path, peer...).
 * @returns observer, or undefined when tracing is off.
 */
function socketTrace(trace: TraceLog, base: Record<string, unknown>): UpgradeTrace | undefined {
  if (trace.level === "off") return undefined;
  const id = base.id;
  const opened = performance.now();
  return {
    frame: trace.frames
      ? (dir, frame) =>
          trace.record("ws.frame", {
            id,
            dir,
            op: frame.opcode,
            fin: frame.fin,
            len: frame.length,
            atMs: ms(performance.now() - opened),
          })
      : undefined,
    close: (stats) =>
      trace.record("ws", {
        ...base,
        ...stats,
        handshakeMs: ms(stats.handshakeMs),
        durationMs: ms(stats.durationMs),
      }),
  };
}

/**
 * Read a small JSON request body.
 * @param req - request.
 * @param limit - largest body accepted.
 * @returns parsed JSON, or undefined when too large or not JSON.
 */
async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
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

/** A remote caller some link has admitted, as the trace describes it. */
interface Caller {
  /** Source address, or "relay" for a relay session. */
  ip: string;
  /** Tailnet node name or relay node id ("" when unknown). */
  node: string;
  admitMs: number;
  cached: boolean;
}

/**
 * Serves this computer's dsh to a remote caller: Kivotos' own routes first,
 * everything else forwarded to the loopback dsh. The tailnet listener and the
 * relay link share it; each admits the caller its own way before calling in.
 */
export class Frontend {
  private readonly session: LoopbackSession;
  private readonly ctx: HostContext;
  private readonly attention: AttentionTracker;
  private readonly trace: TraceLog;
  private readonly self: () => SelfView;

  constructor(
    ctx: HostContext,
    attention: AttentionTracker,
    trace: TraceLog,
    self: () => SelfView,
  ) {
    this.ctx = ctx;
    this.attention = attention;
    this.trace = trace;
    this.self = self;
    this.session = new LoopbackSession(ctx, trace);
  }

  private upstream(cookie: string): Upstream {
    return {
      host: "127.0.0.1",
      port: this.ctx.webServer.port,
      authority: this.session.authority,
      cookie,
    };
  }

  async request(req: IncomingMessage, res: ServerResponse, who: Caller): Promise<void> {
    const { trace, attention, session } = this;
    const id = trace.id();
    const url = req.url ?? "/";
    const base = {
      id,
      method: req.method,
      path: tracePath(url),
      ip: who.ip,
      node: who.node,
      admitMs: who.admitMs,
      cached: who.cached,
    };
    const parsed = new URL(url, "http://x");
    if (parsed.pathname === HELLO_PATH) {
      trace.record("http", { ...base, status: 200, local: true });
      const self = this.self();
      // The node id lets a caller that also reaches this computer through a
      // relay network tell that both are one machine.
      sendJson(res, 200, { kivotos: VERSION, name: self.name, os: self.os, node: self.node });
      return;
    }
    if (parsed.pathname === PENDING_PATH) {
      trace.record("http", { ...base, status: 200, local: true });
      sendJson(res, 200, { frames: attention.pending() });
      return;
    }
    if (parsed.pathname === EVENTS_PATH) {
      // A cursor from another Host process says nothing about this one: replay all.
      const sameEpoch = parsed.searchParams.get("epoch") === attention.epoch;
      const after = sameEpoch ? Number(parsed.searchParams.get("after") ?? "0") : 0;
      trace.record("sse.open", base);
      const opened = performance.now();
      streamAttention(req, res, attention, after, (frames) =>
        trace.record("sse.close", { id, frames, durationMs: ms(performance.now() - opened) }),
      );
      return;
    }
    if (parsed.pathname === TRACE_CLIENT_PATH && req.method === "POST") {
      const report = await readJsonBody(req, TRACE_CLIENT_MAX_BYTES);
      if (report !== undefined) trace.record("client", { ...base, report });
      res.writeHead(204);
      res.end();
      return;
    }
    const loginStart = performance.now();
    const cookie = await session.get();
    const loginMs = ms(performance.now() - loginStart);
    res.on("finish", () => {
      if (res.statusCode === 401) session.invalidate();
    });
    // Content-hashed Vite assets come without caching headers; marked immutable
    // here as on peer mounts, the phone's and the browser's caches keep them.
    const hashed = HASHED_ASSET.test(parsed.pathname);
    forwardHttp(req, res, this.upstream(cookie), {
      path: url,
      prefix: "",
      response: (ur, headers) => {
        markImmutable(hashed, ur, headers);
        return undefined;
      },
      // Pages served here get the flag that makes the client module report its timings.
      html:
        trace.level === "off"
          ? injectOwnsHost
          : (html: string) => injectHead(html, OWNS_HOST + TRACE_FLAG),
      onDone:
        trace.level === "off"
          ? undefined
          : (stats) => trace.record("http", { ...base, loginMs, ...roundStats(stats) }),
    });
  }

  async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, who: Caller): Promise<void> {
    const url = req.url ?? "/";
    const base = {
      id: this.trace.id(),
      path: tracePath(url),
      ip: who.ip,
      node: who.node,
      admitMs: who.admitMs,
    };
    this.trace.record("ws.open", base);
    const upstream = this.upstream(await this.session.get());
    forwardUpgrade(req, socket, head, upstream, url, socketTrace(this.trace, base));
  }
}

/**
 * Start the tailnet listener.
 * @returns its pairing URL (when reachable over the tailnet) and disposer.
 */
async function startListener(
  ctx: HostContext,
  config: KivotosConfig,
  status: TailnetStatus,
  frontend: Frontend,
  trace: TraceLog,
  onFailure: () => void,
): Promise<{ url?: string; dispose: () => Promise<void> }> {
  const bindHost = config.listenHost || status.self.ips.find((ip) => !ip.includes(":"));
  if (bindHost === undefined) throw new Error("kivotos: this node has no Tailscale IPv4 address");
  const admission = new Admission(config, status, bindHost);
  const tls = await listenerTls(config, status);

  const onRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const who = await admission.check(req);
    if (who.status !== undefined) {
      trace.record("http", {
        id: trace.id(),
        method: req.method,
        path: tracePath(req.url ?? "/"),
        ip: who.ip,
        node: who.node,
        admitMs: who.admitMs,
        cached: who.cached,
        status: who.status,
        reason: who.reason,
      });
      res.writeHead(who.status, { "content-type": "text/plain; charset=utf-8" });
      res.end("kivotos: not admitted");
      return;
    }
    await frontend.request(req, res, who);
  };

  const onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    const who = await admission.check(req);
    if (who.status !== undefined) {
      trace.record("ws", {
        id: trace.id(),
        path: tracePath(req.url ?? "/"),
        ip: who.ip,
        node: who.node,
        admitMs: who.admitMs,
        status: who.status,
        reason: who.reason,
      });
      socket.end(`HTTP/1.1 ${who.status} Rejected\r\n\r\n`);
      return;
    }
    await frontend.upgrade(req, socket, head, who);
  };

  trace.record("listener.start", { host: bindHost, port: config.port, tls: tls !== undefined });
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
 * first, then a `live` event carrying the epoch, then live frames, with
 * heartbeat comments. The marker tells a reader which frames are history (a
 * Host following its peers, `attention-hub.ts`); the app parses only frame
 * data and skips it. Runs only behind a link's admission.
 */
function streamAttention(
  req: IncomingMessage,
  res: ServerResponse,
  attention: AttentionTracker,
  afterId: number,
  onClose: (framesSent: number) => void,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  let sent = 0;
  const send = (frame: AttentionFrame): void => {
    sent += 1;
    res.write(`id: ${frame.id}\nevent: attention\ndata: ${JSON.stringify(frame)}\n\n`);
  };
  for (const frame of attention.since(Number.isFinite(afterId) ? afterId : 0)) send(frame);
  res.write(`event: live\ndata: ${JSON.stringify({ epoch: attention.epoch })}\n\n`);
  const unsubscribe = attention.subscribe(send);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
    unsubscribe();
    onClose(sent);
  };
  req.on("close", stop);
  res.on("close", stop);
}

/** A mounted peer: a machine with a working route. */
interface Peer {
  /** URL-safe id. */
  id: string;
  name: string;
  /** Operating system ("" when unknown). */
  os: string;
  /** How to reach the peer's Kivotos now. */
  upstream: Upstream;
  /** The link {@link upstream} goes through. */
  via: Via;
}

/** What this computer tells its peers (`/kivotos/hello`) and its pages (`/kivotos/peers`). */
interface SelfView {
  name: string;
  os: string;
  /** Pairing URL of the tailnet listener, once it listens. */
  url?: string;
  /** Kivotos node id, once the identity is loaded. */
  node?: string;
}

/** Longest wait for one `/kivotos/hello` answer. */
const PROBE_TIMEOUT_MS = 3_000;
/** Tailscale OS names of devices that never run dsh with Kivotos. */
const HANDHELD_OS = /^(android|ios|ipados)$/i;

/** What probing an entry found. */
interface Probed {
  upstream?: Upstream;
  hello?: Record<string, unknown>;
  reason?: LinkReason;
}

/**
 * Ask each candidate address for `/kivotos/hello`, in order.
 * @returns the first that answers as Kivotos, else the most telling failure.
 */
async function probeHello(candidates: readonly Upstream[]): Promise<Probed> {
  let reason: LinkReason | undefined;
  for (const upstream of candidates) {
    const answer = await getJson(upstream, HELLO_PATH, PROBE_TIMEOUT_MS);
    if (answer.body?.kivotos !== undefined) return { upstream, hello: answer.body };
    const failure = probeFailure(answer);
    reason = reason === undefined ? failure : tellingReason(reason, failure);
  }
  return { reason: reason ?? "network" };
}

/** A tailnet entry, from what probing it found. */
function tailnetSighting(
  base: Omit<Sighting<Upstream>, "state">,
  probed: Probed,
): Sighting<Upstream> {
  const { upstream, hello } = probed;
  if (upstream === undefined || hello === undefined)
    return { ...base, state: "unreachable", reason: probed.reason };
  const sighting: Sighting<Upstream> = {
    ...base,
    os: base.os || (typeof hello.os === "string" ? hello.os : ""),
    state: "online",
    target: upstream,
  };
  if (typeof hello.node === "string" && hello.node !== "") sighting.node = hello.node;
  return sighting;
}

/** @returns a tailnet node's sighting: its listener over HTTPS (MagicDNS name), else HTTP. */
async function probeTailnetNode(
  node: TailnetNode,
  base: Omit<Sighting<Upstream>, "state">,
  ip: string,
  port: number,
  trace: TraceLog,
): Promise<Sighting<Upstream>> {
  const plain: Upstream = { host: ip, port, hop: true, tls: false, authority: `${ip}:${port}` };
  const candidates: Upstream[] =
    node.dnsName === ""
      ? [plain]
      : [
          {
            host: ip,
            port,
            hop: true,
            tls: true,
            servername: node.dnsName,
            authority: `${node.dnsName}:${port}`,
          },
          plain,
        ];
  const start = performance.now();
  const probed = await probeHello(candidates);
  trace.record("probe", {
    node: node.name,
    ok: probed.upstream !== undefined,
    tls: probed.upstream?.tls === true,
    reason: probed.reason,
    ms: ms(performance.now() - start),
  });
  return tailnetSighting(base, probed);
}

/** Answer a dsh-side request through the connection fence; true when rejected. */
function rejected(ctx: HostContext, req: IncomingMessage, res: ServerResponse): boolean {
  const rejection = ctx.connection.requestRejection(req);
  if (rejection === undefined) return false;
  res.statusCode = rejection;
  res.end();
  return true;
}

/** The machines this computer knows, their mounts, and the per-peer webServer routes. */
class PeerRoutes {
  private readonly mounted = new Map<string, { peer: Peer; dispose: () => void }>();
  private readonly ctx: HostContext;
  private readonly trace: TraceLog;
  private readonly cache: MountCache;
  private readonly attention: AttentionHub;
  private readonly book: MachineBook<Upstream>;
  /** `machines.json`: the book, kept across restarts. */
  private readonly file: string;
  /** Loading, then every write, in order. */
  private saving: Promise<void> = Promise.resolve();
  private saved = "";
  self: SelfView = { name: os.hostname(), os: process.platform };
  /** Whether this computer is on the tailnet, and its address there. */
  tailnet: { joined: boolean; address?: string } = { joined: false };
  /** Called when a request through a Tailscale route could not connect. */
  onTailnetFailure: (() => void) | undefined;

  constructor(
    ctx: HostContext,
    trace: TraceLog,
    cache: MountCache,
    attention: AttentionHub,
    options: { file: string; retentionMs: number },
  ) {
    this.ctx = ctx;
    this.trace = trace;
    this.cache = cache;
    this.attention = attention;
    this.file = options.file;
    this.book = new MachineBook(options.retentionMs);
  }

  /** Read the machines an earlier run knew; writes wait for it. */
  load(): void {
    this.saving = (async () => {
      let text: string;
      try {
        text = await readFile(this.file, "utf8");
      } catch {
        // First run: nothing known yet.
        return;
      }
      try {
        const stored: unknown = JSON.parse(text);
        if (typeof stored === "object" && stored !== null)
          this.book.restore(Reflect.get(stored, "machines"));
        this.saved = text;
      } catch (error) {
        this.ctx.logger.warn("kivotos: machines.json unreadable; starting over", error);
      }
    })();
  }

  /** Whether a tailnet entry has been a Kivotos machine before. */
  knows(key: string): boolean {
    return this.book.knows("tailscale", key);
  }

  /**
   * Replace what one link sees now, mount the machines that have a route,
   * and let the cache warm the peers that are due.
   * @param absent - how this link's remembered machines that it does not
   *   report show; null forgets them (this computer left the relay network).
   */
  update(via: Via, sightings: readonly Sighting<Upstream>[], absent: Absent | null): void {
    const now = Date.now();
    if (absent === null) this.book.forget(via);
    else {
      // A static peer may point at this computer itself.
      const own = this.self.node;
      const others = sightings.filter((sighting) => own === undefined || sighting.node !== own);
      this.book.update(via, others, now, absent);
    }
    this.reconcile(this.book.machines(now));
    for (const { peer } of this.mounted.values()) void this.cache.warm(peer.id, peer.upstream);
    this.save();
  }

  private reconcile(machines: BookMachine<Upstream>[]): void {
    const next = new Map<string, Peer>();
    for (const machine of machines) {
      const { id, route, target } = machine;
      if (route !== null && target !== undefined)
        next.set(id, { id, name: machine.name, os: machine.os, upstream: target, via: route });
    }
    for (const [id, entry] of this.mounted) {
      const peer = next.get(id);
      // A new route keeps the mount: same machine, same cache, same attention feed,
      // which reads the upstream anew on its next connection.
      if (peer !== undefined) {
        entry.peer = peer;
        continue;
      }
      entry.dispose();
      this.mounted.delete(id);
    }
    for (const peer of next.values()) {
      if (!this.mounted.has(peer.id)) this.mount(peer);
    }
  }

  /** Write the book when it changed; times to the minute, so a refresh alone rewrites nothing. */
  private save(): void {
    this.saving = this.saving
      .then(() => this.write())
      .catch((error: unknown) => this.ctx.logger.warn("kivotos: machines.json not saved", error));
  }

  private async write(): Promise<void> {
    const text = JSON.stringify({ machines: this.book.entries() }, toTheMinute, 2);
    if (text === this.saved) return;
    this.saved = text;
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, text);
  }

  private mount(peer: Peer): void {
    const prefix = `${PEER_PREFIX}/${peer.id}`;
    const entry = { peer, dispose: (): void => {} };
    const disposeHttp = this.ctx.webServer.register({
      kind: "prefix",
      path: prefix,
      handler: (req, res) => {
        if (rejected(this.ctx, req, res)) return;
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
        const base = {
          id: this.trace.id(),
          peer: peer.id,
          method: req.method,
          path: tracePath(rest),
        };
        this.cache.forward(req, res, peer.id, entry.peer.upstream, {
          path: rest,
          prefix,
          html: (body) =>
            credentialedManifest(injectStorageNamespace(guardDesktopBoot(body, prefix), peer.id)),
          onDone: (stats) => {
            // No answer through the tailnet: look again now rather than at the next refresh,
            // so the relay takes over within seconds.
            if (stats.ttfbMs < 0 && stats.error !== undefined && entry.peer.via === "tailscale")
              this.onTailnetFailure?.();
            if (this.trace.level !== "off")
              this.trace.record("peer.http", { ...base, ...roundStats(stats) });
          },
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
        const base = { id: this.trace.id(), peer: peer.id, path: MUX_PATH };
        this.trace.record("peer.ws.open", base);
        forwardUpgrade(
          req,
          socket,
          head,
          entry.peer.upstream,
          `${MUX_PATH}${search}`,
          socketTrace(this.trace, base),
        );
      },
    });
    entry.dispose = () => {
      disposeUpgrade();
      disposeHttp();
      this.cache.unmounted(peer.id);
      this.attention.unfollow(peer.id);
    };
    this.mounted.set(peer.id, entry);
    this.cache.mounted(peer.id);
    this.attention.follow(() => entry.peer);
  }

  /** @returns disposer of the peers route. */
  registerList(): () => void {
    return this.ctx.webServer.register({
      kind: "exact",
      path: PEERS_PATH,
      handler: (req, res) => {
        if (rejected(this.ctx, req, res)) return;
        const machines = this.book.machines(Date.now()).map((machine) => infoOf(machine));
        // `peers`, the mounted machines only, is what clients before `machines` read.
        const peers = [...this.mounted.values()].map(({ peer }) => ({
          id: peer.id,
          name: peer.name,
          os: peer.os,
          via: peer.via,
        }));
        sendJson(res, 200, { self: this.self, peers, machines });
      },
    });
  }

  dispose(): void {
    for (const entry of this.mounted.values()) entry.dispose();
    this.mounted.clear();
  }
}

/** A machine as `/kivotos/peers` lists it: without where its route goes. */
function infoOf(machine: BookMachine<Upstream>): MachineInfo {
  const { id, route, links } = machine;
  const info: MachineInfo = { id, name: machine.name, os: machine.os, route, links };
  if (machine.node !== undefined) info.node = machine.node;
  return info;
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

/** JSON replacer for `machines.json`: last-seen times to the minute. */
function toTheMinute(key: string, value: unknown): unknown {
  return key === "lastSeen" && typeof value === "number" ? value - (value % 60_000) : value;
}

/** Whether an address is a Tailscale one (100.64.0.0/10 or fd7a:115c:a1e0::/48). */
function tailnetAddress(host: string): boolean {
  if (host.toLowerCase().startsWith("fd7a:115c:a1e0:")) return true;
  const octets = host.split(".").map(Number);
  return octets.length === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

/** What one tailnet refresh saw. */
interface TailnetSeen {
  sightings: Sighting<Upstream>[];
  absent: Absent;
}

/** @returns a static peer's sighting; off the tailnet, a tailnet address fails for that reason. */
async function probeStatic(
  peer: StaticPeer,
  onTailnet: boolean,
  trace: TraceLog,
): Promise<Sighting<Upstream>> {
  const start = performance.now();
  const probed = await probeHello([staticUpstream(peer)]);
  trace.record("probe", {
    node: peer.id,
    ok: probed.upstream !== undefined,
    reason: probed.reason,
    ms: ms(performance.now() - start),
  });
  if (!onTailnet && probed.reason !== undefined && tailnetAddress(peer.host))
    probed.reason = "not-on-tailnet";
  const base = {
    key: `static:${peer.id}`,
    id: peer.id,
    name: peer.name,
    os: "",
    address: `${peer.host}:${peer.port}`,
    pinned: true,
  };
  return tailnetSighting(base, probed);
}

/**
 * The tailnet side of the machine list: every static peer, and with
 * discovery the same user's computers. An online node is probed; an offline
 * one is reported only when it has been a Kivotos machine before.
 * @param status - undefined when `tailscale status` failed.
 * @param knows - whether a tailnet entry has been a Kivotos machine.
 */
async function discover(
  config: KivotosConfig,
  status: TailnetStatus | undefined,
  knows: (key: string) => boolean,
  trace: TraceLog,
): Promise<TailnetSeen> {
  const onTailnet = status?.running === true;
  const probes = config.staticPeers.map((peer) => probeStatic(peer, onTailnet, trace));
  for (const node of onTailnet && config.discover ? status.peers : []) {
    const ip = node.ips.find((address) => !address.includes(":"));
    if (ip === undefined || node.userId !== status?.self.userId || HANDHELD_OS.test(node.os))
      continue;
    const key = `tailnet:${node.id}`;
    const base = {
      key,
      id: node.id.replace(/[^A-Za-z0-9_-]/g, "") || ip.replaceAll(".", "-"),
      name: node.name,
      os: node.os,
      address: `${ip}:${config.port}`,
    };
    if (node.online) probes.push(probeTailnetNode(node, base, ip, config.port, trace));
    else if (knows(key))
      probes.push(Promise.resolve({ ...base, state: "offline", lastSeen: node.lastSeen }));
  }
  const absent: Absent = onTailnet
    ? { state: "offline" }
    : { state: "unreachable", reason: "not-on-tailnet" };
  return { sightings: await Promise.all(probes), absent };
}

/**
 * Register the settings page's routes for the links.
 * @returns their disposer.
 */
function registerLinkRoutes(
  ctx: HostContext,
  config: KivotosConfig,
  routes: PeerRoutes,
  relay: RelayHost,
): () => void {
  const links = (): unknown => ({
    tailscale: {
      url: routes.self.url ?? null,
      name: routes.self.name,
      joined: routes.tailnet.joined,
      address: routes.tailnet.address ?? null,
      listen: config.listen,
    },
    relay: relay.view(),
  });
  const disposeLinks = ctx.webServer.register({
    kind: "exact",
    path: LINKS_PATH,
    handler: (req, res) => {
      if (rejected(ctx, req, res)) return;
      sendJson(res, 200, links());
    },
  });
  const disposeRelay = ctx.webServer.register({
    kind: "exact",
    path: RELAY_PATH,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return;
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        res.end();
        return;
      }
      const body = await readJsonBody(req, RELAY_BODY_MAX_BYTES);
      const field = (key: string): string => {
        const value: unknown =
          typeof body === "object" && body !== null ? Reflect.get(body, key) : undefined;
        return typeof value === "string" ? value : "";
      };
      try {
        const action = field("action");
        if (action === "create") await relay.create(field("relay"));
        else if (action === "join") await relay.join(field("invite"));
        else if (action === "leave") await relay.leave();
        else throw new Error("unknown action");
        sendJson(res, 200, links());
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    },
  });
  return () => {
    disposeRelay();
    disposeLinks();
  };
}

/**
 * Accept the load-timing reports of mounted pages. The client module posts to
 * the absolute {@link TRACE_CLIENT_PATH}: a page the tailnet listener served
 * reaches the listener's own handler, but a peer page mounted in this dsh (the
 * desktop app, a browser on this computer) posts to this webServer instead.
 * The report's `page` names the mount.
 * @returns the route's disposer.
 */
function registerTraceClientRoute(ctx: HostContext, trace: TraceLog): () => void {
  return ctx.webServer.register({
    kind: "exact",
    path: TRACE_CLIENT_PATH,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return;
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        res.end();
        return;
      }
      const report = await readJsonBody(req, TRACE_CLIENT_MAX_BYTES);
      if (report !== undefined) {
        trace.record("client", { id: trace.id(), method: req.method, via: "webServer", report });
      }
      res.writeHead(204);
      res.end();
    },
  });
}

/**
 * Serve the other machines' attention to this Host's pages: the merged
 * stream, and the page's note that it opened a machine. Absolute paths on
 * this webServer, like {@link PEERS_PATH}: a peer page mounted here reads this
 * Host's board, never one through the mount, so nothing chains.
 * @returns the routes' disposer.
 */
function registerAttentionRoutes(ctx: HostContext, hub: AttentionHub): () => void {
  const disposeStream = ctx.webServer.register({
    kind: "exact",
    path: ATTENTION_PATH,
    handler: (req, res) => {
      if (rejected(ctx, req, res)) return;
      hub.serve(req, res);
    },
  });
  const disposeSeen = ctx.webServer.register({
    kind: "exact",
    path: ATTENTION_SEEN_PATH,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return;
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        res.end();
        return;
      }
      const body = await readJsonBody(req, 1024);
      const peer: unknown =
        typeof body === "object" && body !== null ? Reflect.get(body, "peer") : undefined;
      if (typeof peer === "string") hub.seen(peer);
      res.writeHead(204);
      res.end();
    },
  });
  return () => {
    disposeSeen();
    disposeStream();
  };
}

/**
 * Plugin body: the viewport tap, the links (tailnet listener, relay), and the
 * peer routes. The links are independent: a computer can be in a tailnet and
 * in a relay network at once, and is reachable through either.
 * @param ctx - plugin context.
 * @param config - validated config.
 */
export function apply(ctx: HostContext, config: KivotosConfig): void {
  ctx.effect(() => ctx.webServer.tapIndex(coverViewport), "kivotos: viewport-fit=cover");

  const trace = new TraceLog(path.join(dshHome(), "kivotos", "logs"), config.trace);
  ctx.effect(() => {
    trace
      .open()
      .catch((error: unknown) => ctx.logger.warn("kivotos: trace log unavailable", error));
    return () => trace.close();
  }, "kivotos: trace log");

  // Every Session's appends, browser-opened or not: the source of the phone's notifications.
  // ctx.on owns its listener's lifetime: it is removed when the plugin unloads.
  const attention = new AttentionTracker((session) =>
    ctx.get("sessionProjections")?.stateOf(session, "title"),
  );
  ctx.on("session/event", (session, event) => attention.observe(session, event));
  ctx.on("session/disposed", (session) => attention.forget(session.id));

  const cache = new MountCache({
    dir: path.join(dshHome(), "kivotos", "cache"),
    maxBytes: config.cacheMegabytes * 1024 * 1024,
    warm: config.cacheWarm,
    trace,
    warn: (message, error) => ctx.logger.warn(message, error),
  });
  ctx.effect(() => {
    void cache.open();
    return () => cache.close();
  }, "kivotos: mount cache");

  // Constructing these registers nothing; the effects below do.
  const hub = new AttentionHub(trace, {
    waiting: config.notify,
    finished: config.notify && config.notifyFinished,
  });
  const routes = new PeerRoutes(ctx, trace, cache, hub, {
    file: path.join(dshHome(), "kivotos", "machines.json"),
    retentionMs: config.offlineDays * DAY_MS,
  });
  const frontend = new Frontend(ctx, attention, trace, () => routes.self);
  const relay = new RelayHost({
    dir: path.join(dshHome(), "kivotos"),
    name: () => routes.self.name,
    refreshSeconds: config.refreshSeconds,
    serve: frontend,
    publish: (sightings, absent) => routes.update("relay", sightings, absent),
    warn: (message, error) => ctx.logger.warn(message, error),
    trace,
  });

  ctx.effect(() => {
    routes.load();
    const disposeList = routes.registerList();
    const disposeLinks = registerLinkRoutes(ctx, config, routes, relay);
    const disposeTrace = registerTraceClientRoute(ctx, trace);
    const disposeAttention = registerAttentionRoutes(ctx, hub);
    return () => {
      disposeAttention();
      disposeTrace();
      disposeLinks();
      disposeList();
      routes.dispose();
      hub.close();
    };
  }, "kivotos: peer and link routes");

  ctx.effect(() => {
    // The node identity exists from the first start, joined or not: the
    // tailnet listener advertises it so the two links of a machine merge.
    void (async () => {
      try {
        await relay.start();
        routes.self.node = relay.view().node;
      } catch (error) {
        ctx.logger.warn("kivotos: relay link failed to start", error);
      }
    })();
    return () => relay.dispose();
  }, "kivotos: relay link");

  ctx.effect(() => {
    let stopped = false;
    let running = false;
    let lastRun = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: Promise<{ url?: string; dispose: () => Promise<void> }> | undefined;

    const listen = (status: TailnetStatus): void => {
      if (!config.listen || listener !== undefined) return;
      const starting = startListener(ctx, config, status, frontend, trace, () => {
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
    };

    const refresh = async (): Promise<void> => {
      running = true;
      try {
        let status: TailnetStatus | undefined;
        try {
          status = await readStatus(config.tailscale);
        } catch (error) {
          ctx.logger.warn("kivotos: tailnet status unavailable", error);
        }
        if (stopped) return;
        if (status !== undefined) {
          routes.self = { ...routes.self, name: status.self.name, os: status.self.os };
          listen(status);
        }
        const address = status?.self.ips.find((ip) => !ip.includes(":"));
        routes.tailnet = { joined: status?.running === true, address };
        const seen = await discover(config, status, (key) => routes.knows(key), trace);
        if (!stopped) routes.update("tailscale", seen.sightings, seen.absent);
      } catch (error) {
        ctx.logger.warn("kivotos: tailnet refresh failed", error);
      } finally {
        running = false;
        lastRun = performance.now();
        if (!stopped) timer = setTimeout(() => void refresh(), config.refreshSeconds * 1000);
      }
    };
    void refresh();
    // A mount's request found the tailnet route dead: probe now, not at the next refresh.
    routes.onTailnetFailure = () => {
      if (stopped || running || performance.now() - lastRun < RECHECK_MIN_MS) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 0);
    };

    return async () => {
      stopped = true;
      routes.onTailnetFailure = undefined;
      clearTimeout(timer);
      const started = await listener?.catch(() => undefined);
      await started?.dispose();
    };
  }, "kivotos: tailnet listener");
}
