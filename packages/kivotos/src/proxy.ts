/**
 * Transport-neutral forwarding used on both sides of a Kivotos link:
 * the tailnet listener forwards into the loopback dsh, and the serving dsh
 * forwards `/kivotos/peer/<id>/*` to a peer's tailnet listener.
 */
import http from "node:http";
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  RequestOptions,
  ServerResponse,
} from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import type { Duplex } from "node:stream";
import { WsFrameReader, type WsFrame } from "./trace.ts";

/** Request headers that describe the browser's origin, not the forwarded hop. */
const ORIGIN_HEADERS = new Set(["origin", "referer", "cookie", "host", "connection"]);

/**
 * Marks a request a peer mount forwarded. A mount refuses requests that
 * already carry it, so hops never chain (A -> B -> A) or loop.
 */
export const HOP_HEADER = "x-kivotos-hop";

/** Where a hop forwards to. */
export interface Upstream {
  /** Address to connect to. */
  host: string;
  port: number;
  /** Connect with TLS. */
  tls?: boolean;
  /** TLS SNI and certificate name. */
  servername?: string;
  /** Value sent as the Host header. */
  authority: string;
  /** Cookie header sent upstream. */
  cookie?: string;
  /** Mark forwarded requests with {@link HOP_HEADER}. */
  hop?: boolean;
  /**
   * Supplies the connections instead of dialing `host:port`: a relay peer's
   * agent, whose connections are secured sessions to `relayNode`.
   */
  agent?: http.Agent;
  /** Node id a relay peer's agent connects to. */
  relayNode?: string;
}

/** Options for {@link forwardHttp}. */
export interface ForwardOptions {
  /** Upstream path including query. */
  path: string;
  /** Mount prefix for Location rewriting ("" for none). */
  prefix: string;
  /** Rewrites an uncompressed text/html body; such responses are buffered, all others stream. */
  html?: (html: string) => string;
  /** Called once when the exchange ends, however it ends. */
  onDone?: (stats: HttpStats) => void;
}

/** How one forwarded HTTP exchange went. */
export interface HttpStats {
  /** Status sent to the client (502 when the upstream failed). */
  status: number;
  /** Request start to upstream response headers; -1 without a response. */
  ttfbMs: number;
  /** Request start to the last byte sent, or to the abort. */
  totalMs: number;
  /** Request body bytes forwarded upstream. */
  bytesUp: number;
  /** Response body bytes sent to the client. */
  bytesDown: number;
  /** Upstream `content-encoding` ("" when none). */
  encoding: string;
  /** Upstream `cache-control` ("" when none). */
  cacheControl: string;
  /** The client went away before the response finished. */
  aborted: boolean;
  /** Upstream connection error, when there was one. */
  error?: string;
}

/** Observer of one forwarded WebSocket. */
export interface UpgradeTrace {
  /** One frame header in either direction; omit to skip frame parsing. */
  frame?: (direction: "up" | "down", frame: WsFrame) => void;
  /** Called once when the socket closes or the handshake fails. */
  close: (stats: UpgradeStats) => void;
}

/** How one forwarded WebSocket went. */
export interface UpgradeStats {
  /** Upstream handshake status (101 on success). */
  status: number;
  /** Request start to upstream handshake reply; -1 without one. */
  handshakeMs: number;
  /** Request start to close. */
  durationMs: number;
  /** Bytes from the client to the upstream after the handshake. */
  bytesUp: number;
  /** Bytes from the upstream to the client after the handshake. */
  bytesDown: number;
  error?: string;
}

/**
 * Copy request headers minus origin/cookie/fetch-metadata, then pin the upstream authority.
 * Stripping Origin, Referer and Sec-Fetch-* makes the hop a same-origin request upstream;
 * the hop itself is authenticated by the caller before forwarding.
 * @param headers - incoming headers.
 * @param upstream - target.
 * @returns forwarded headers.
 */
export function forwardHeaders(
  headers: IncomingHttpHeaders,
  upstream: Upstream,
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || ORIGIN_HEADERS.has(name) || name.startsWith("sec-fetch-")) continue;
    out[name] = value;
  }
  out.host = upstream.authority;
  if (upstream.cookie !== undefined) out.cookie = upstream.cookie;
  if (upstream.hop === true) out[HOP_HEADER] = "1";
  return out;
}

/**
 * Rewrite a root-relative redirect into the mount prefix; absolute URLs and
 * path-relative values pass through.
 * @param location - upstream Location header.
 * @param prefix - mount prefix without trailing slash ("" for none).
 * @returns rewritten Location.
 */
export function mountLocation(location: string, prefix: string): string {
  if (prefix === "" || !location.startsWith("/") || location.startsWith("//")) return location;
  return `${prefix}${location}`;
}

function request(upstream: Upstream, options: RequestOptions): ClientRequest {
  const base = { ...options, host: upstream.host, port: upstream.port, agent: upstream.agent };
  return upstream.tls === true
    ? https.request({ ...base, servername: upstream.servername ?? upstream.host })
    : http.request(base);
}

/**
 * Forward one HTTP exchange to `upstream`. Responses stream (dsh HMR is an
 * EventSource) except uncompressed HTML handed to `options.html`. Upstream
 * cookies are dropped: the browser must not learn the credential the hop holds.
 * @param req - incoming request.
 * @param res - outgoing response.
 * @param upstream - target.
 * @param options - path, mount prefix, optional HTML rewrite.
 */
export function forwardHttp(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: Upstream,
  options: ForwardOptions,
): void {
  const start = performance.now();
  const stats: HttpStats = {
    status: 0,
    ttfbMs: -1,
    totalMs: 0,
    bytesUp: 0,
    bytesDown: 0,
    encoding: "",
    cacheControl: "",
    aborted: false,
  };
  const headers = forwardHeaders(req.headers, upstream);
  // HTML rewriting needs identity bytes; only navigations can carry the index page.
  if (options.html !== undefined && String(req.headers.accept ?? "").includes("text/html")) {
    delete headers["accept-encoding"];
  }
  const up = request(upstream, { method: req.method, path: options.path, headers });
  up.on("response", (ur) => {
    const status = ur.statusCode ?? 502;
    stats.status = status;
    stats.ttfbMs = performance.now() - start;
    stats.encoding = String(ur.headers["content-encoding"] ?? "");
    stats.cacheControl = String(ur.headers["cache-control"] ?? "");
    const out = { ...ur.headers };
    delete out["set-cookie"];
    if (typeof out.location === "string")
      out.location = mountLocation(out.location, options.prefix);
    const transform = options.html;
    const type = String(out["content-type"] ?? "");
    if (transform !== undefined && type.startsWith("text/html") && !out["content-encoding"]) {
      const chunks: Buffer[] = [];
      ur.on("data", (chunk: Buffer) => chunks.push(chunk));
      ur.on("end", () => {
        const body = Buffer.from(transform(Buffer.concat(chunks).toString("utf8")), "utf8");
        delete out["transfer-encoding"];
        out["content-length"] = String(body.byteLength);
        stats.bytesDown = body.byteLength;
        res.writeHead(status, ur.statusMessage, out);
        res.end(body);
      });
      ur.on("error", () => res.destroy());
      return;
    }
    if (options.onDone !== undefined) {
      ur.on("data", (chunk: Buffer) => {
        stats.bytesDown += chunk.length;
      });
    }
    res.writeHead(status, ur.statusMessage, out);
    ur.pipe(res);
  });
  up.on("error", (error) => {
    stats.error = error.message;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    stats.status = 502;
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("kivotos: upstream unreachable");
  });
  res.on("close", () => {
    if (!res.writableFinished) {
      stats.aborted = true;
      up.destroy();
    }
    if (options.onDone !== undefined) {
      stats.totalMs = performance.now() - start;
      options.onDone(stats);
    }
  });
  if (options.onDone !== undefined) {
    req.on("data", (chunk: Buffer) => {
      stats.bytesUp += chunk.length;
    });
  }
  // A retried request finds the incoming body already consumed.
  if (req.readableEnded) up.end();
  else req.pipe(up);
}

/**
 * Forward one HTTP upgrade (the dsh gateway WebSocket) and splice the sockets.
 * @param req - incoming upgrade request.
 * @param socket - client socket.
 * @param head - first packet of the upgraded stream.
 * @param upstream - target.
 * @param path - upstream path including query.
 * @param trace - optional observer of the socket's life and frames.
 */
export function forwardUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  upstream: Upstream,
  path: string,
  trace?: UpgradeTrace,
): void {
  const start = performance.now();
  const stats: UpgradeStats = {
    status: 0,
    handshakeMs: -1,
    durationMs: 0,
    bytesUp: 0,
    bytesDown: 0,
  };
  let closed = false;
  const finish = (): void => {
    if (closed || trace === undefined) return;
    closed = true;
    stats.durationMs = performance.now() - start;
    trace.close(stats);
  };
  const headers = forwardHeaders(req.headers, upstream);
  headers.connection = "Upgrade";
  const up = request(upstream, { method: req.method, path, headers });
  up.on("upgrade", (ur, us, uhead) => {
    stats.status = ur.statusCode ?? 101;
    stats.handshakeMs = performance.now() - start;
    let reply = `HTTP/1.1 ${ur.statusCode} ${ur.statusMessage}\r\n`;
    for (let i = 0; i < ur.rawHeaders.length; i += 2) {
      if (ur.rawHeaders[i].toLowerCase() === "set-cookie") continue;
      reply += `${ur.rawHeaders[i]}: ${ur.rawHeaders[i + 1]}\r\n`;
    }
    if (trace !== undefined) {
      const onFrame = trace.frame;
      const upFrames = onFrame && new WsFrameReader((frame) => onFrame("up", frame));
      const downFrames = onFrame && new WsFrameReader((frame) => onFrame("down", frame));
      const countUp = (chunk: Buffer): void => {
        stats.bytesUp += chunk.length;
        upFrames?.push(chunk);
      };
      const countDown = (chunk: Buffer): void => {
        stats.bytesDown += chunk.length;
        downFrames?.push(chunk);
      };
      if (head.length > 0) countUp(head);
      if (uhead.length > 0) countDown(uhead);
      socket.on("data", countUp);
      us.on("data", countDown);
    }
    socket.write(`${reply}\r\n`);
    if (uhead.length > 0) socket.write(uhead);
    if (head.length > 0) us.write(head);
    us.on("error", (error) => {
      stats.error ??= error.message;
      socket.destroy();
    });
    socket.on("error", () => us.destroy());
    us.on("close", () => {
      socket.destroy();
      finish();
    });
    socket.on("close", () => {
      us.destroy();
      finish();
    });
    us.pipe(socket).pipe(us);
  });
  up.on("response", (ur) => {
    stats.status = ur.statusCode ?? 502;
    stats.handshakeMs = performance.now() - start;
    ur.resume();
    socket.end(`HTTP/1.1 ${ur.statusCode ?? 502} ${ur.statusMessage ?? "Bad Gateway"}\r\n\r\n`);
    finish();
  });
  up.on("error", (error) => {
    stats.error ??= error.message;
    stats.status ||= 502;
    socket.destroy();
    finish();
  });
  socket.on("error", () => up.destroy());
  up.end();
}

/**
 * Hostname part of a Host header, lowercased, brackets and trailing dot removed.
 * @param host - Host header.
 * @returns hostname, or "" when absent.
 */
export function hostnameOf(host: string | undefined): string {
  if (host === undefined) return "";
  const bracket = /^\[([^\]]+)\]/.exec(host);
  const name = bracket === null ? host.replace(/:\d+$/, "") : bracket[1];
  return name.toLowerCase().replace(/\.$/, "");
}

/**
 * Normalize a socket remote address: IPv4-mapped IPv6 to dotted IPv4.
 * @param address - socket.remoteAddress.
 * @returns address, or "" when absent.
 */
export function remoteIp(address: string | undefined): string {
  if (address === undefined) return "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

/**
 * Write a small JSON response.
 * @param res - response.
 * @param status - status code.
 * @param body - JSON body.
 */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
