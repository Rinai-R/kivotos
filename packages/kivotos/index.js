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
import { mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import {
  forwardHttp,
  forwardUpgrade,
  HOP_HEADER,
  hostnameOf,
  remoteIp,
  sendJson,
} from "./proxy.js";
import { issueCert, readStatus, whois } from "./tailscale.js";

export const name = "kivotos";
export const inject = ["webServer", "connection"];

const VERSION = "0.1.0";
const PEER_PREFIX = "/kivotos/peer";
const HELLO_PATH = "/kivotos/hello";
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

/**
 * @typedef {object} StaticPeer
 * @property {string} id - URL-safe peer id.
 * @property {string} name - display name.
 * @property {string} host - address of the peer's tailnet listener.
 * @property {number} port - listener port.
 * @property {boolean} [tls] - listener speaks HTTPS.
 * @property {string} [servername] - TLS certificate name.
 */

/**
 * @typedef {object} KivotosConfig
 * @property {boolean} listen - run the tailnet listener.
 * @property {string} listenHost - bind address; "" = this node's Tailscale IPv4.
 * @property {number} port - tailnet listener port (all peers share it).
 * @property {"auto" | "on" | "off"} tls - HTTPS on the listener.
 * @property {boolean} discover - probe tailnet nodes of the same user.
 * @property {StaticPeer[]} staticPeers - peers added without discovery.
 * @property {boolean} allowSelf - admit requests from this node's own address.
 * @property {string} tailscale - tailscale CLI path.
 * @property {number} refreshSeconds - peer discovery interval.
 */

/** @type {KivotosConfig} */
const DEFAULTS = {
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

/**
 * @param {Record<string, unknown>} input - raw row.
 * @param {(message: string, key: string) => void} issue - issue sink.
 * @returns {StaticPeer[]} peers.
 */
function staticPeersOf(input, issue) {
  const raw = input.staticPeers ?? [];
  if (!Array.isArray(raw)) {
    issue("must be an array", "staticPeers");
    return [];
  }
  return raw.map((entry, index) => {
    const peer = /** @type {Record<string, unknown>} */ (entry ?? {});
    const key = `staticPeers.${index}`;
    if (typeof peer.id !== "string" || !PEER_ID.test(peer.id))
      issue("id must match [A-Za-z0-9_-]{1,64}", key);
    if (typeof peer.host !== "string" || peer.host === "") issue("host is required", key);
    if (!Number.isInteger(peer.port)) issue("port must be an integer", key);
    /** @type {StaticPeer} */
    const parsed = {
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
 * @param {unknown} value - raw config.
 * @returns {{ value: KivotosConfig } | { issues: { message: string, path: string[] }[] }} result.
 */
function validate(value) {
  const input = /** @type {Record<string, unknown>} */ (value ?? {});
  /** @type {{ message: string, path: string[] }[]} */
  const issues = [];
  /** @type {(message: string, key: string) => void} */
  const issue = (message, key) => {
    issues.push({ message, path: key.split(".") });
  };
  /** @type {Record<string, unknown>} */
  const out = { ...DEFAULTS };
  for (const key of ["listen", "discover", "allowSelf"]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] === "boolean") out[key] = input[key];
    else issue("must be a boolean", key);
  }
  for (const key of ["listenHost", "tailscale"]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] === "string") out[key] = input[key];
    else issue("must be a string", key);
  }
  /** @type {[string, number, number][]} */
  const ranges = [
    ["port", 1, 65535],
    ["refreshSeconds", 5, 3600],
  ];
  for (const [key, min, max] of ranges) {
    if (input[key] === undefined) continue;
    const n = input[key];
    if (Number.isInteger(n) && Number(n) >= min && Number(n) <= max) out[key] = n;
    else issue(`must be an integer in ${min}..${max}`, key);
  }
  if (input.tls !== undefined) {
    if (input.tls === "auto" || input.tls === "on" || input.tls === "off") out.tls = input.tls;
    else issue('must be "auto", "on" or "off"', "tls");
  }
  out.staticPeers = staticPeersOf(input, issue);
  if (issues.length > 0) return { issues };
  return { value: /** @type {KivotosConfig} */ (out) };
}

export const Config = { "~standard": { version: 1, vendor: "kivotos", validate } };

/**
 * Insert the ownsHost transport global right after the opening head tag.
 * A page served through a Kivotos hop belongs to the same tailnet user as the
 * host, so it gets the operator surface (host-persisted settings) that a
 * loopback page gets.
 * @param {string} html - index html.
 * @returns {string} html with the global.
 */
export function injectOwnsHost(html) {
  return injectHead(html, OWNS_HOST);
}

/**
 * Give a mounted peer page its own localStorage namespace. Every peer UI is
 * served from the host page's origin, and dsh persists client stores
 * (current Session, layout, drafts) in localStorage by fixed keys, so
 * without a namespace two machines' UIs overwrite each other's state.
 * @param {string} html - peer index html.
 * @param {string} peerId - URL-safe peer id.
 * @returns {string} html with the namespace installed before any app script.
 */
export function injectStorageNamespace(html, peerId) {
  // `<` is escaped so the id cannot close the script element, whatever the caller validated.
  const prefix = JSON.stringify(`kivotos:${peerId}:`).replaceAll("<", "\\u003c");
  const script = `<script>(()=>{const s=window.localStorage,p=${prefix},own=()=>{const k=[];for(let i=0;i<s.length;i++){const n=s.key(i);if(n!==null&&n.startsWith(p))k.push(n.slice(p.length))}return k};const v={getItem:k=>s.getItem(p+k),setItem:(k,x)=>s.setItem(p+k,String(x)),removeItem:k=>s.removeItem(p+k),key:i=>own()[i]??null,clear:()=>{for(const k of own())s.removeItem(p+k)},get length(){return own().length}};Object.defineProperty(window,"localStorage",{configurable:true,get:()=>v})})()</script>`;
  return injectHead(html, script);
}

/**
 * @param {string} html - document.
 * @param {string} markup - markup to place first in head.
 * @returns {string} document with markup.
 */
function injectHead(html, markup) {
  const open = /<head(?:\s[^>]*)?>/i.exec(html);
  if (open === null) return `${markup}${html}`;
  const at = open.index + open[0].length;
  return `${html.slice(0, at)}${markup}${html.slice(at)}`;
}

/** @param {string} html - index html. @returns {string} html with a safe-area viewport. */
export function coverViewport(html) {
  return html.replace(VIEWPORT_FROM, VIEWPORT_TO);
}

/**
 * Make a mounted peer page fetch its web manifest with credentials. Browsers
 * request a manifest link without cookies, dsh serves it publicly, but every
 * path under a peer mount sits behind the dsh connection fence, so the
 * uncredentialed fetch would answer 401.
 * @param {string} html - peer index html.
 * @returns {string} html whose manifest link carries credentials.
 */
export function credentialedManifest(html) {
  return html.replace(MANIFEST_FROM, MANIFEST_TO);
}

/** @returns {string} dsh home (cert storage lives under it). */
function dshHome() {
  return process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
}

/** Re-login interval for the loopback cookie, far inside dsh's 30-day cookie lifetime. */
const LOGIN_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Login cookie for the loopback dsh, obtained in-process through the
 * connection's token exchange and refreshed after an upstream 401.
 */
class LoopbackSession {
  /** @param {any} ctx - plugin context. */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {Promise<string> | undefined} */
    this.cookie = undefined;
    this.issuedAt = 0;
  }

  /** @returns {string} loopback authority of the dsh webServer. */
  get authority() {
    return `127.0.0.1:${this.ctx.webServer.port}`;
  }

  /** @returns {Promise<string>} Cookie header value. */
  get() {
    // dsh cookies carry an absolute lifetime. Logging in again well inside it
    // keeps a long-running host from answering one request with 401 when the
    // cached cookie lapses; the 401 invalidation covers shorter configured lifetimes.
    if (Date.now() - this.issuedAt > LOGIN_TTL_MS) this.cookie = undefined;
    if (this.cookie === undefined) {
      this.issuedAt = Date.now();
      this.cookie = this.login().catch((error) => {
        this.cookie = undefined;
        throw error;
      });
    }
    return this.cookie;
  }

  /** Drop the cached cookie so the next request logs in again. */
  invalidate() {
    this.cookie = undefined;
  }

  /** @returns {Promise<string>} fresh cookie. */
  async login() {
    const url = this.ctx.connection.authenticatedUrl(`http://${this.authority}/`);
    const res = await fetch(url, { redirect: "manual" });
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    if (cookie === undefined || cookie === "") {
      throw new Error(`kivotos: loopback login returned ${res.status} without a cookie`);
    }
    return cookie;
  }
}

/**
 * The listener's admission: tailnet identity, own user, expected authority.
 */
class Admission {
  /**
   * @param {KivotosConfig} config - plugin config.
   * @param {import("./tailscale.js").TailnetStatus} status - tailnet snapshot at start.
   * @param {string} bindHost - listener bind address.
   */
  constructor(config, status, bindHost) {
    this.config = config;
    this.status = status;
    this.hosts = new Set([bindHost, ...status.self.ips, status.self.dnsName].filter(Boolean));
    /** @type {Map<string, { at: number, ok: boolean }>} */
    this.cache = new Map();
  }

  /**
   * @param {http.IncomingMessage} req - request.
   * @returns {Promise<number | undefined>} rejection status, or undefined when admitted.
   */
  async check(req) {
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

  /** @param {string} ip - remote address. @returns {Promise<boolean>} same tailnet user. */
  async identify(ip) {
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
 * Whether a request's browser markers are same-origin: no cross-site
 * Fetch-Metadata, and an Origin (when attached) naming the request authority.
 * @param {http.IncomingHttpHeaders} headers - request headers.
 * @returns {boolean} false for a request a foreign page initiated.
 */
export function sameSite(headers) {
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

/**
 * Resolve the listener's TLS material per `config.tls`.
 * @param {KivotosConfig} config - plugin config.
 * @param {import("./tailscale.js").TailnetStatus} status - tailnet snapshot.
 * @returns {Promise<{ cert: Buffer, key: Buffer } | undefined>} material, or undefined for HTTP.
 */
async function listenerTls(config, status) {
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
 * @param {any} ctx - plugin context.
 * @param {KivotosConfig} config - plugin config.
 * @param {import("./tailscale.js").TailnetStatus} status - tailnet snapshot.
 * @returns {Promise<() => Promise<void>>} disposer.
 */
async function startListener(ctx, config, status) {
  const bindHost = config.listenHost || status.self.ips.find((ip) => !ip.includes(":"));
  if (bindHost === undefined) throw new Error("kivotos: this node has no Tailscale IPv4 address");
  const admission = new Admission(config, status, bindHost);
  const session = new LoopbackSession(ctx);
  const tls = await listenerTls(config, status);

  /** @param {string} cookie - loopback cookie. */
  const upstream = (cookie) => ({
    host: "127.0.0.1",
    port: ctx.webServer.port,
    authority: session.authority,
    cookie,
  });

  /**
   * @param {http.IncomingMessage} req - request.
   * @param {http.ServerResponse} res - response.
   */
  const onRequest = async (req, res) => {
    const rejection = await admission.check(req);
    if (rejection !== undefined) {
      res.writeHead(rejection, { "content-type": "text/plain; charset=utf-8" });
      res.end("kivotos: not admitted");
      return;
    }
    const url = req.url ?? "/";
    if (new URL(url, "http://x").pathname === HELLO_PATH) {
      sendJson(res, 200, { kivotos: VERSION, name: status.self.name, os: status.self.os });
      return;
    }
    const cookie = await session.get();
    res.on("finish", () => {
      if (res.statusCode === 401) session.invalidate();
    });
    forwardHttp(req, res, upstream(cookie), { path: url, prefix: "", html: injectOwnsHost });
  };

  /**
   * @param {http.IncomingMessage} req - upgrade request.
   * @param {import("node:stream").Duplex} socket - client socket.
   * @param {Buffer} head - first packet.
   */
  const onUpgrade = async (req, socket, head) => {
    const rejection = await admission.check(req);
    if (rejection !== undefined) {
      socket.end(`HTTP/1.1 ${rejection} Rejected\r\n\r\n`);
      return;
    }
    forwardUpgrade(req, socket, head, upstream(await session.get()), req.url ?? "/");
  };

  const server = tls === undefined ? http.createServer() : https.createServer(tls);
  /** @type {Set<import("node:stream").Duplex>} */
  const sockets = new Set();
  const fail = (/** @type {unknown} */ error) =>
    ctx.logger.warn("kivotos: listener request failed", error);
  server.on("request", (req, res) => {
    onRequest(req, res).catch((error) => {
      fail(error);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });
  server.on("upgrade", (req, socket, head) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    onUpgrade(req, socket, head).catch((error) => {
      fail(error);
      socket.destroy();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, bindHost, () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });
  server.on("error", (error) => ctx.logger.warn("kivotos: listener error", error));
  ctx.logger.info(
    `kivotos: listening on ${tls === undefined ? "http" : "https"}://${bindHost}:${config.port}`,
  );
  return () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
    });
}

/**
 * @typedef {object} Peer
 * @property {string} id - URL-safe id.
 * @property {string} name - display name.
 * @property {string} os - operating system ("" when unknown).
 * @property {import("./proxy.js").Upstream} upstream - listener address.
 */

/**
 * Probe one tailnet node's Kivotos listener.
 * @param {import("./tailscale.js").TailnetNode} node - candidate.
 * @param {number} port - listener port.
 * @returns {Promise<Peer | undefined>} the peer, or undefined when it runs no listener.
 */
async function probe(node, port) {
  const ip = node.ips.find((address) => !address.includes(":"));
  if (ip === undefined) return undefined;
  const id = node.id.replace(/[^A-Za-z0-9_-]/g, "") || ip.replaceAll(".", "-");
  const candidates = [
    ...(node.dnsName === ""
      ? []
      : [{ tls: true, servername: node.dnsName, authority: `${node.dnsName}:${port}` }]),
    { tls: false, authority: `${ip}:${port}` },
  ];
  for (const candidate of candidates) {
    const upstream = { host: ip, port, hop: true, ...candidate };
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

/**
 * @param {import("./proxy.js").Upstream} upstream - target.
 * @param {string} pathname - path.
 * @returns {Promise<Record<string, unknown> | undefined>} parsed body, undefined on any failure.
 */
function getJson(upstream, pathname) {
  return new Promise((resolve) => {
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
      /** @type {Buffer[]} */
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve(res.statusCode === 200 ? parseJson(Buffer.concat(chunks)) : undefined),
      );
      res.on("error", () => resolve(undefined));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(undefined));
  });
}

/**
 * @param {Buffer} bytes - response body.
 * @returns {Record<string, unknown> | undefined} parsed object, undefined when not JSON.
 */
function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    // A non-JSON 200 is some other service on the port: not a peer.
    return undefined;
  }
}

/**
 * Peer registry plus the per-peer webServer routes.
 */
class PeerRoutes {
  /**
   * @param {any} ctx - plugin context.
   * @param {KivotosConfig} config - plugin config.
   */
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    /** @type {Map<string, { peer: Peer, dispose: () => void }>} */
    this.mounted = new Map();
    /** @type {{ name: string, os: string }} */
    this.self = { name: os.hostname(), os: process.platform };
  }

  /**
   * Answer a dsh-side request through the connection fence.
   * @param {http.IncomingMessage} req - request.
   * @param {http.ServerResponse} res - response.
   * @returns {boolean} true when rejected.
   */
  rejected(req, res) {
    const rejection = this.ctx.connection.requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  }

  /** @param {Peer[]} peers - the current peer set. */
  reconcile(peers) {
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

  /** @param {Peer} peer - peer to mount. */
  mount(peer) {
    const prefix = `${PEER_PREFIX}/${peer.id}`;
    const entry = { peer, dispose: () => {} };
    const disposeHttp = this.ctx.webServer.register({
      kind: "prefix",
      path: prefix,
      handler: (
        /** @type {http.IncomingMessage} */ req,
        /** @type {http.ServerResponse} */ res,
      ) => {
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
      handler: (
        /** @type {http.IncomingMessage} */ req,
        /** @type {import("node:stream").Duplex} */ socket,
        /** @type {Buffer} */ head,
      ) => {
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

  /** @returns {() => void} disposer of the peers route. */
  registerList() {
    return this.ctx.webServer.register({
      kind: "exact",
      path: PEERS_PATH,
      handler: (
        /** @type {http.IncomingMessage} */ req,
        /** @type {http.ServerResponse} */ res,
      ) => {
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

  dispose() {
    for (const entry of this.mounted.values()) entry.dispose();
    this.mounted.clear();
  }
}

/**
 * @param {import("./proxy.js").Upstream} a - upstream.
 * @param {import("./proxy.js").Upstream} b - upstream.
 * @returns {boolean} same target.
 */
function sameUpstream(a, b) {
  return a.host === b.host && a.port === b.port && a.tls === b.tls && a.authority === b.authority;
}

/**
 * @param {KivotosConfig} config - plugin config.
 * @param {import("./tailscale.js").TailnetStatus} status - tailnet snapshot.
 * @returns {Promise<Peer[]>} reachable peers, static first.
 */
async function discover(config, status) {
  /** @type {Peer[]} */
  const peers = config.staticPeers.map((peer) => ({
    id: peer.id,
    name: peer.name,
    os: "",
    upstream: {
      host: peer.host,
      port: peer.port,
      hop: true,
      tls: peer.tls === true,
      ...(peer.servername === undefined ? {} : { servername: peer.servername }),
      authority: `${peer.tls === true && peer.servername !== undefined ? peer.servername : peer.host}:${peer.port}`,
    },
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

/**
 * @param {any} ctx - plugin context.
 * @param {KivotosConfig} config - validated config.
 */
export function apply(ctx, config) {
  ctx.effect(() => ctx.webServer.tapIndex(coverViewport), "kivotos: viewport-fit=cover");

  ctx.effect(() => {
    const routes = new PeerRoutes(ctx, config);
    const disposeList = routes.registerList();
    let stopped = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @type {Promise<() => Promise<void>> | undefined} */
    let listener;

    const refresh = async () => {
      try {
        const status = await readStatus(config.tailscale);
        if (stopped) return;
        routes.self = { name: status.self.name, os: status.self.os };
        if (config.listen && listener === undefined) {
          listener = startListener(ctx, config, status);
          listener.catch((error) => {
            ctx.logger.warn("kivotos: tailnet listener failed to start", error);
            listener = undefined;
          });
        }
        const peers = await discover(config, status);
        if (!stopped) routes.reconcile(peers);
      } catch (error) {
        ctx.logger.warn("kivotos: tailnet refresh failed", error);
        if (!stopped && config.staticPeers.length > 0) {
          routes.reconcile(await discover({ ...config, discover: false }, emptyStatus()));
        }
      } finally {
        if (!stopped) timer = setTimeout(refresh, config.refreshSeconds * 1000);
      }
    };
    void refresh();

    return async () => {
      stopped = true;
      clearTimeout(timer);
      disposeList();
      routes.dispose();
      const stop = await listener?.catch(() => undefined);
      await stop?.();
    };
  }, "kivotos: tailnet listener and peer routes");
}

/** @returns {import("./tailscale.js").TailnetStatus} status with no nodes. */
function emptyStatus() {
  const self = { id: "", name: "", dnsName: "", os: "", online: true, userId: 0, ips: [] };
  return { self, peers: [], certDomains: [] };
}
