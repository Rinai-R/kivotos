/**
 * Transport-neutral forwarding used on both sides of a Kivotos link:
 * the tailnet listener forwards into the loopback dsh, and the serving dsh
 * forwards `/kivotos/peer/<id>/*` to a peer's tailnet listener.
 */
import http from "node:http";
import https from "node:https";

/** Request headers that describe the browser's origin, not the forwarded hop. */
const ORIGIN_HEADERS = new Set(["origin", "referer", "cookie", "host", "connection"]);

/**
 * Marks a request a peer mount forwarded. A mount refuses requests that
 * already carry it, so hops never chain (A -> B -> A) or loop.
 */
export const HOP_HEADER = "x-kivotos-hop";

/**
 * @typedef {object} Upstream
 * @property {string} host - address to connect to.
 * @property {number} port - TCP port.
 * @property {boolean} [tls] - connect with TLS.
 * @property {string} [servername] - TLS SNI and certificate name.
 * @property {string} authority - value sent as the Host header.
 * @property {string} [cookie] - Cookie header sent upstream.
 * @property {boolean} [hop] - mark forwarded requests with {@link HOP_HEADER}.
 */

/**
 * Copy request headers minus origin/cookie/fetch-metadata, then pin the upstream authority.
 * Stripping Origin, Referer and Sec-Fetch-* makes the hop a same-origin request upstream;
 * the hop itself is authenticated by the caller before forwarding.
 * @param {http.IncomingHttpHeaders} headers - incoming headers.
 * @param {Upstream} upstream - target.
 * @returns {http.OutgoingHttpHeaders} forwarded headers.
 */
export function forwardHeaders(headers, upstream) {
  /** @type {http.OutgoingHttpHeaders} */
  const out = {};
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
 * @param {string} location - upstream Location header.
 * @param {string} prefix - mount prefix without trailing slash ("" for none).
 * @returns {string} rewritten Location.
 */
export function mountLocation(location, prefix) {
  if (prefix === "" || !location.startsWith("/") || location.startsWith("//")) return location;
  return `${prefix}${location}`;
}

/**
 * @param {Upstream} upstream - target.
 * @param {http.RequestOptions} options - request options.
 * @returns {http.ClientRequest} request.
 */
function request(upstream, options) {
  const base = { ...options, host: upstream.host, port: upstream.port };
  return upstream.tls === true
    ? https.request({ ...base, servername: upstream.servername ?? upstream.host })
    : http.request(base);
}

/**
 * Forward one HTTP exchange to `upstream`. Responses stream (dsh HMR is an
 * EventSource) except uncompressed HTML handed to `options.html`. Upstream
 * cookies are dropped: the browser must not learn the credential the hop holds.
 * @param {http.IncomingMessage} req - incoming request.
 * @param {http.ServerResponse} res - outgoing response.
 * @param {Upstream} upstream - target.
 * @param {object} options - forwarding options.
 * @param {string} options.path - upstream path including query.
 * @param {string} options.prefix - mount prefix for Location rewriting.
 * @param {(html: string) => string} [options.html] - rewrites an uncompressed text/html
 *   response body; such responses are buffered, every other response streams.
 */
export function forwardHttp(req, res, upstream, options) {
  const headers = forwardHeaders(req.headers, upstream);
  // HTML rewriting needs identity bytes; only navigations can carry the index page.
  if (options.html !== undefined && String(req.headers.accept ?? "").includes("text/html")) {
    delete headers["accept-encoding"];
  }
  const up = request(upstream, { method: req.method, path: options.path, headers });
  up.on("response", (ur) => {
    const status = ur.statusCode ?? 502;
    const out = { ...ur.headers };
    delete out["set-cookie"];
    if (typeof out.location === "string")
      out.location = mountLocation(out.location, options.prefix);
    const transform = options.html;
    const type = String(out["content-type"] ?? "");
    if (transform !== undefined && type.startsWith("text/html") && !out["content-encoding"]) {
      /** @type {Buffer[]} */
      const chunks = [];
      ur.on("data", (chunk) => chunks.push(chunk));
      ur.on("end", () => {
        const body = Buffer.from(transform(Buffer.concat(chunks).toString("utf8")), "utf8");
        delete out["transfer-encoding"];
        out["content-length"] = String(body.byteLength);
        res.writeHead(status, ur.statusMessage, out);
        res.end(body);
      });
      ur.on("error", () => res.destroy());
      return;
    }
    res.writeHead(status, ur.statusMessage, out);
    ur.pipe(res);
  });
  up.on("error", () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("kivotos: upstream unreachable");
  });
  res.on("close", () => {
    if (!res.writableFinished) up.destroy();
  });
  // A retried request finds the incoming body already consumed.
  if (req.readableEnded) up.end();
  else req.pipe(up);
}

/**
 * Forward one HTTP upgrade (the dsh gateway WebSocket) and splice the sockets.
 * @param {http.IncomingMessage} req - incoming upgrade request.
 * @param {import("node:stream").Duplex} socket - client socket.
 * @param {Buffer} head - first packet of the upgraded stream.
 * @param {Upstream} upstream - target.
 * @param {string} path - upstream path including query.
 */
export function forwardUpgrade(req, socket, head, upstream, path) {
  const headers = forwardHeaders(req.headers, upstream);
  headers.connection = "Upgrade";
  const up = request(upstream, { method: req.method, path, headers });
  up.on("upgrade", (ur, us, uhead) => {
    let reply = `HTTP/1.1 ${ur.statusCode} ${ur.statusMessage}\r\n`;
    for (let i = 0; i < ur.rawHeaders.length; i += 2) {
      if (ur.rawHeaders[i].toLowerCase() === "set-cookie") continue;
      reply += `${ur.rawHeaders[i]}: ${ur.rawHeaders[i + 1]}\r\n`;
    }
    socket.write(`${reply}\r\n`);
    if (uhead.length > 0) socket.write(uhead);
    if (head.length > 0) us.write(head);
    us.on("error", () => socket.destroy());
    socket.on("error", () => us.destroy());
    us.on("close", () => socket.destroy());
    socket.on("close", () => us.destroy());
    us.pipe(socket).pipe(us);
  });
  up.on("response", (ur) => {
    ur.resume();
    socket.end(`HTTP/1.1 ${ur.statusCode ?? 502} ${ur.statusMessage ?? "Bad Gateway"}\r\n\r\n`);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
  up.end();
}

/**
 * Hostname part of a Host header, lowercased, brackets and trailing dot removed.
 * @param {string | undefined} host - Host header.
 * @returns {string} hostname, or "" when absent.
 */
export function hostnameOf(host) {
  if (host === undefined) return "";
  const bracket = /^\[([^\]]+)\]/.exec(host);
  const name = bracket === null ? host.replace(/:\d+$/, "") : bracket[1];
  return name.toLowerCase().replace(/\.$/, "");
}

/**
 * Normalize a socket remote address: IPv4-mapped IPv6 to dotted IPv4.
 * @param {string | undefined} address - socket.remoteAddress.
 * @returns {string} address.
 */
export function remoteIp(address) {
  if (address === undefined) return "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

/**
 * Write a small JSON response.
 * @param {http.ServerResponse} res - response.
 * @param {number} status - status code.
 * @param {unknown} body - JSON body.
 */
export function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
