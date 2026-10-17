/**
 * Serving-side cache of peer mounts.
 *
 * Opening a peer loads its whole dsh client over the link, about 11 MB in dsh
 * 0.2.1-rc.2, most of it one gzip plugin batch. Responses that never change at
 * their URL are kept under `$DSH_HOME/kivotos/cache/<peer id>/` and answered
 * from disk to every client of this dsh, the desktop window included (its
 * `dsh-app://` pages never reach Chromium's HTTP cache).
 *
 * Stored: a GET without `Range`, not a navigation, from a client that accepts
 * gzip, answered 200 without `Set-Cookie`, with `Vary` at most
 * `Accept-Encoding`, and with `immutable` in its `cache-control` (dsh's
 * revisioned `plugins/??…&rev=…` batches, and content-hashed `assets/`, which
 * the mount marks immutable when the peer sends no `cache-control`). Such a
 * response is the same for every caller of the mount: the hop authenticates as
 * this node, never as the browser.
 *
 * An entry is `<name>.body`, the bytes as received (gzip when the peer
 * compressed them), and `<name>.json`, the status, the replayed headers and the
 * size; `name` hashes the peer, the encoding and the full path with its query.
 * Both are written to temp files, synced and renamed, `.json` last: `.json`
 * marks a complete entry, and `open()` deletes whatever lacks one.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  type FileHandle,
} from "node:fs/promises";
import type {
  ClientRequest,
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream";
import { bootGraphOf } from "./dsh/index-html.ts";
import { HASHED_ASSET, hashedAssetsOf } from "./dsh/web-server.ts";
import {
  forwardHeaders,
  forwardHttp,
  upstreamRequest,
  type BodyTap,
  type CacheOutcome,
  type ForwardOptions,
  type HttpStats,
  type Upstream,
} from "./proxy.ts";
import { tracePath } from "./trace-path.ts";
import type { TraceLog } from "./trace.ts";

/** `cache-control` of a response that never changes at its URL. */
const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * The one encoding variant stored. Every cacheable request from a client that
 * accepts gzip goes upstream with exactly this `accept-encoding` (dsh
 * negotiates only gzip and identity), so all such clients share one entry.
 */
const VARIANT = "gzip";

/** Response headers an entry keeps and a hit replays. */
const KEPT_HEADERS = [
  "content-type",
  "content-encoding",
  "cache-control",
  "vary",
  "etag",
  "last-modified",
  "x-content-type-options",
] as const;

/** Peer ids name directories: one safe path segment (the config's peer id rule). */
const PEER_DIR = /^[A-Za-z0-9_-]{1,64}$/;
const ENTRY_NAME = /^[0-9a-f]{40}$/;

/** A peer that is no longer mounted keeps its entries this long: discovery can miss it for a refresh or two. */
const UNMOUNTED_GRACE_MS = 10 * 60_000;
/** Warm downloads in flight, over all peers. */
const WARM_CONCURRENCY = 2;
/** A mounted peer's index is checked for a new boot graph at most this often. */
const WARM_RECHECK_MS = 10 * 60_000;
/** Largest index page read for warming. */
const WARM_INDEX_MAX_BYTES = 4 * 1024 * 1024;
/** Socket idle time after which a warm request gives up. */
const WARM_TIMEOUT_MS = 60_000;

/** `<name>.json`: what a hit replays. */
interface Meta {
  status: number;
  headers: Record<string, string>;
  /** Body bytes. */
  size: number;
}

interface Entry extends Meta {
  name: string;
  peer: string;
  /** Bytes on disk, body and metadata. */
  bytes: number;
}

interface PeerState {
  mounted: boolean;
  drop?: NodeJS.Timeout;
  /** Boot graph revision the last complete warm prefetched. */
  warmedRev?: string;
  /** `performance.now()` of the last warm check; -Infinity makes the next one due. */
  checkedAt: number;
  warming: boolean;
}

type PrefetchOutcome = CacheOutcome | "error";

/** Settles a flight: with the stored entry, or undefined when nothing was stored. */
type Settle = (entry: Entry | undefined) => void;

/** Options for {@link MountCache}. */
export interface MountCacheOptions {
  /** Cache root, `$DSH_HOME/kivotos/cache`. */
  dir: string;
  /** Cap over all entries; 0 disables the cache and deletes the root. */
  maxBytes: number;
  /** Prefill each mounted peer's boot resources. */
  warm: boolean;
  trace: TraceLog;
  warn: (message: string, error: unknown) => void;
}

/**
 * Whether an `accept-encoding` value admits gzip (RFC 9110 §12.5.3).
 * @param header - the request header.
 * @returns true when gzip, or `*` without an explicit gzip, has a non-zero weight.
 */
export function acceptsGzip(header: string | undefined): boolean {
  if (header === undefined) return false;
  let any = false;
  for (const part of header.split(",")) {
    const [coding = "", ...params] = part.split(";").map((item) => item.trim().toLowerCase());
    const weight = params.find((param) => param.startsWith("q="));
    const allowed = weight === undefined || Number(weight.slice(2)) > 0;
    if (coding === "gzip" || coding === "x-gzip") return allowed;
    if (coding === "*") any = allowed;
  }
  return any;
}

/**
 * The resources a dsh index boots from: the boot graph's batch scripts and
 * the content-hashed build assets the page links.
 * @param html - the peer's index page.
 * @returns the graph revision and the root-relative targets; undefined without a boot graph.
 */
export function bootResources(html: string): { rev: string; targets: string[] } | undefined {
  const { graph } = bootGraphOf(html);
  if (graph === undefined) return undefined;
  const targets = new Set<string>();
  for (const url of graph.urls) {
    const target = rootTarget(url);
    if (target !== undefined) targets.add(target);
  }
  for (const target of hashedAssetsOf(html)) targets.add(target);
  return { rev: graph.rev, targets: [...targets] };
}

/** A document-relative reference against the index at `/`, serialized as a browser requests it. */
function rootTarget(reference: string): string | undefined {
  const url = new URL(reference, "http://peer/");
  return url.origin === "http://peer" ? `${url.pathname}${url.search}` : undefined;
}

function entryName(peer: string, target: string): string {
  return createHash("sha256").update(`${peer}\n${VARIANT}\n${target}`).digest("hex").slice(0, 40);
}

function pathnameOf(target: string): string {
  const at = target.indexOf("?");
  return at === -1 ? target : target.slice(0, at);
}

/**
 * Content-hashed assets the peer sends without caching headers get the immutable ones.
 * @param hashed - the request path is a {@link HASHED_ASSET}.
 * @param upstream - the upstream response.
 * @param headers - the headers the client receives; edited in place.
 */
export function markImmutable(
  hashed: boolean,
  upstream: IncomingMessage,
  headers: OutgoingHttpHeaders,
): void {
  if (hashed && upstream.statusCode === 200 && headers["cache-control"] === undefined) {
    headers["cache-control"] = IMMUTABLE;
  }
}

/** Whether a response is the same for every caller and never changes at its URL. */
function storable(upstream: IncomingMessage, headers: OutgoingHttpHeaders): boolean {
  if (upstream.statusCode !== 200 || upstream.headers["set-cookie"] !== undefined) return false;
  const control = String(headers["cache-control"] ?? "").toLowerCase();
  if (!/\bimmutable\b/.test(control) || /\b(?:no-store|no-cache|private)\b/.test(control)) {
    return false;
  }
  return String(headers.vary ?? "")
    .toLowerCase()
    .split(",")
    .map((name) => name.trim())
    .every((name) => name === "" || name === "accept-encoding");
}

/** Disk cache of peer mount responses, shared by every client of this dsh. */
export class MountCache {
  private readonly options: MountCacheOptions;
  /** By name, least recently used first. */
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  /** Misses being fetched, by entry name. */
  private readonly flights = new Map<string, Promise<Entry | undefined>>();
  private readonly peers = new Map<string, PeerState>();
  /** Settles true once the entries on disk are loaded, false when the cache is off. */
  private ready: Promise<boolean> = Promise.resolve(false);
  private closed = false;
  private slots = WARM_CONCURRENCY;
  private readonly waiting: (() => void)[] = [];
  private readonly warmRequests = new Set<ClientRequest>();

  constructor(options: MountCacheOptions) {
    this.options = options;
  }

  /** Load the entries on disk; never rejects (a failure turns the cache off with a warning). */
  open(): Promise<void> {
    this.ready = this.load().catch((error: unknown) => {
      this.options.warn("kivotos: mount cache unavailable", error);
      return false;
    });
    return this.ready.then(() => undefined);
  }

  /** Stop timers and warm downloads; later requests bypass the cache. */
  close(): void {
    this.closed = true;
    for (const state of this.peers.values()) clearTimeout(state.drop);
    for (const request of this.warmRequests) request.destroy();
    for (const wake of this.waiting.splice(0)) wake();
  }

  /** A peer was mounted: keep its entries, and check its boot graph on the next {@link warm}. */
  mounted(peer: string): void {
    const state = this.state(peer);
    state.mounted = true;
    state.checkedAt = -Infinity;
    clearTimeout(state.drop);
    state.drop = undefined;
  }

  /** A peer is no longer mounted: its entries go after a grace period. */
  unmounted(peer: string): void {
    if (this.closed || this.options.maxBytes === 0) return;
    const state = this.state(peer);
    state.mounted = false;
    clearTimeout(state.drop);
    state.drop = setTimeout(() => void this.dropPeer(peer), UNMOUNTED_GRACE_MS);
    state.drop.unref();
  }

  /**
   * Answer one mount request: from disk, or forwarded and stored when it
   * qualifies. Content-hashed assets are marked immutable either way.
   * @param peer - peer id.
   * @param options - as for `forwardHttp`; the stats `onDone` gets carry the cache outcome.
   */
  forward(
    req: IncomingMessage,
    res: ServerResponse,
    peer: string,
    upstream: Upstream,
    options: ForwardOptions,
  ): void {
    const hashed = HASHED_ASSET.test(pathnameOf(options.path));
    if (
      this.closed ||
      this.options.maxBytes === 0 ||
      !PEER_DIR.test(peer) ||
      req.method !== "GET" ||
      req.headers.range !== undefined ||
      String(req.headers.accept ?? "").includes("text/html") ||
      !acceptsGzip(req.headers["accept-encoding"])
    ) {
      this.pass(req, res, upstream, options, hashed);
      return;
    }
    void this.lookup(req, res, peer, upstream, options, hashed);
  }

  /**
   * Check a mounted peer's boot graph and prefill its batches and assets.
   * Due right after {@link mounted}, then every few minutes; failures reach
   * only the trace.
   * @returns when the check is done (callers run it in the background).
   */
  async warm(peer: string, upstream: Upstream): Promise<void> {
    const state = this.peers.get(peer);
    if (!this.options.warm || this.options.maxBytes === 0 || this.closed) return;
    if (state?.mounted !== true || state.warming) return;
    const now = performance.now();
    if (now - state.checkedAt < WARM_RECHECK_MS) return;
    state.checkedAt = now;
    state.warming = true;
    try {
      await this.runWarm(peer, upstream, state);
    } finally {
      state.warming = false;
    }
  }

  /** Settles once no miss is in flight and every discarded temp file is gone (tests). */
  async idle(): Promise<void> {
    while (this.flights.size > 0) await Promise.all(this.flights.values());
  }

  private async load(): Promise<boolean> {
    const { dir, maxBytes } = this.options;
    if (maxBytes === 0) {
      await rm(dir, { recursive: true, force: true });
      return false;
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const found: { entry: Entry; used: number }[] = [];
    for (const peer of await readdir(dir)) {
      const scanned = PEER_DIR.test(peer) ? await this.scan(peer) : undefined;
      if (scanned === undefined) {
        await rm(path.join(dir, peer), { recursive: true, force: true });
        continue;
      }
      found.push(...scanned);
      // Left from an earlier run: dropped unless the peer is mounted again in time.
      if (this.peers.get(peer)?.mounted !== true) this.unmounted(peer);
    }
    found.sort((a, b) => a.used - b.used);
    for (const { entry } of found) this.admit(entry);
    await this.evict();
    return true;
  }

  /**
   * Read one peer directory; everything that is not a complete entry is deleted.
   * @returns its entries with their last use, or undefined when it is not a directory.
   */
  private async scan(peer: string): Promise<{ entry: Entry; used: number }[] | undefined> {
    const dir = path.join(this.options.dir, peer);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return undefined;
    }
    const found: { entry: Entry; used: number }[] = [];
    const kept = new Set<string>();
    for (const file of files) {
      const name = file.endsWith(".json") ? file.slice(0, -".json".length) : "";
      if (!ENTRY_NAME.test(name)) continue;
      try {
        const raw = await readFile(path.join(dir, file), "utf8");
        const meta = JSON.parse(raw) as Partial<Meta>;
        const body = await stat(path.join(dir, `${name}.body`));
        if (typeof meta.status !== "number" || typeof meta.headers !== "object") continue;
        if (meta.headers === null || body.size !== meta.size) continue;
        const bytes = body.size + Buffer.byteLength(raw);
        const entry = { status: meta.status, headers: meta.headers, size: body.size };
        found.push({ entry: { ...entry, name, peer, bytes }, used: body.mtimeMs });
        kept.add(file).add(`${name}.body`);
      } catch {
        // Unreadable or without a body: deleted below.
      }
    }
    for (const file of files) {
      if (!kept.has(file)) await rm(path.join(dir, file), { recursive: true, force: true });
    }
    return found;
  }

  private state(peer: string): PeerState {
    let state = this.peers.get(peer);
    if (state === undefined) {
      state = { mounted: false, checkedAt: -Infinity, warming: false };
      this.peers.set(peer, state);
    }
    return state;
  }

  private async dropPeer(peer: string): Promise<void> {
    if (this.peers.get(peer)?.mounted !== false) return;
    this.peers.delete(peer);
    for (const entry of this.entries.values()) {
      if (entry.peer === peer) this.forget(entry);
    }
    await rm(path.join(this.options.dir, peer), { recursive: true, force: true }).catch(
      (error: unknown) => this.options.warn("kivotos: mount cache cleanup failed", error),
    );
  }

  private file(peer: string, name: string, suffix: string): string {
    return path.join(this.options.dir, peer, `${name}${suffix}`);
  }

  private admit(entry: Entry): void {
    const old = this.entries.get(entry.name);
    if (old !== undefined) this.forget(old);
    this.entries.set(entry.name, entry);
    this.bytes += entry.bytes;
  }

  private forget(entry: Entry): void {
    if (this.entries.get(entry.name) !== entry) return;
    this.entries.delete(entry.name);
    this.bytes -= entry.bytes;
  }

  /** Most recently used now; the body's mtime carries that across restarts. */
  private touch(entry: Entry): void {
    this.entries.delete(entry.name);
    this.entries.set(entry.name, entry);
    const now = new Date();
    utimes(this.file(entry.peer, entry.name, ".body"), now, now).catch(() => undefined);
  }

  /** Drop least recently used entries until the cap holds. */
  private async evict(): Promise<void> {
    const victims: Entry[] = [];
    for (const entry of this.entries.values()) {
      if (this.bytes <= this.options.maxBytes) break;
      this.forget(entry);
      victims.push(entry);
    }
    for (const entry of victims) {
      // `.json` first: a body left alone by a crash is no entry.
      await rm(this.file(entry.peer, entry.name, ".json"), { force: true }).catch(() => undefined);
      await rm(this.file(entry.peer, entry.name, ".body"), { force: true }).catch(() => undefined);
    }
  }

  private pass(
    req: IncomingMessage,
    res: ServerResponse,
    upstream: Upstream,
    options: ForwardOptions,
    hashed: boolean,
  ): void {
    const { onDone } = options;
    forwardHttp(req, res, upstream, {
      ...options,
      response: (ur, headers) => {
        markImmutable(hashed, ur, headers);
        return undefined;
      },
      onDone: onDone === undefined ? undefined : (stats) => onDone({ ...stats, cache: "bypass" }),
    });
  }

  private async lookup(
    req: IncomingMessage,
    res: ServerResponse,
    peer: string,
    upstream: Upstream,
    options: ForwardOptions,
    hashed: boolean,
  ): Promise<void> {
    if (!(await this.ready)) {
      this.pass(req, res, upstream, options, hashed);
      return;
    }
    const name = entryName(peer, options.path);
    const entry = this.entries.get(name);
    if (entry !== undefined && (await this.serve(entry, res, options.onDone))) return;
    const flight = this.flights.get(name);
    if (flight === undefined) {
      this.lead(req, res, peer, upstream, options, hashed, name);
      return;
    }
    // Another request is fetching this: wait for it instead of fetching twice.
    const stored = await flight;
    if (stored !== undefined && (await this.serve(stored, res, options.onDone))) return;
    if (!res.destroyed) this.pass(req, res, upstream, options, hashed);
  }

  /** Forward a miss, store it when it qualifies, and let concurrent requests wait for it. */
  private lead(
    req: IncomingMessage,
    res: ServerResponse,
    peer: string,
    upstream: Upstream,
    options: ForwardOptions,
    hashed: boolean,
    name: string,
  ): void {
    const settle = this.takeOff(name);
    let outcome: CacheOutcome = "bypass";
    forwardHttp(req, res, upstream, {
      ...options,
      acceptEncoding: VARIANT,
      response: (ur, headers) => {
        markImmutable(hashed, ur, headers);
        const tap = storable(ur, headers)
          ? this.writer(ur.headers["content-length"], peer, name, headers, settle)
          : undefined;
        if (tap === undefined) settle(undefined);
        else outcome = "miss";
        return tap;
      },
      onDone: (stats) => {
        // No tap: the exchange ended before a storable response, or never had one.
        if (outcome === "bypass") settle(undefined);
        options.onDone?.({ ...stats, cache: outcome });
      },
    });
  }

  /** Register a flight for `name`; the returned function settles it once. */
  private takeOff(name: string): Settle {
    const flight = Promise.withResolvers<Entry | undefined>();
    this.flights.set(name, flight.promise);
    let settled = false;
    return (entry) => {
      if (settled) return;
      settled = true;
      if (this.flights.get(name) === flight.promise) this.flights.delete(name);
      flight.resolve(entry);
    };
  }

  /**
   * Answer from disk.
   * @returns false when the body is gone (the entry is then forgotten).
   */
  private async serve(
    entry: Entry,
    res: ServerResponse,
    onDone: ((stats: HttpStats) => void) | undefined,
  ): Promise<boolean> {
    const start = performance.now();
    let file: FileHandle;
    try {
      file = await open(this.file(entry.peer, entry.name, ".body"), "r");
    } catch {
      this.forget(entry);
      return false;
    }
    if (res.destroyed) {
      await file.close();
      return true;
    }
    this.touch(entry);
    const stats: HttpStats = {
      status: entry.status,
      ttfbMs: performance.now() - start,
      totalMs: 0,
      bytesUp: 0,
      bytesDown: 0,
      encoding: entry.headers["content-encoding"] ?? "",
      cacheControl: entry.headers["cache-control"] ?? "",
      aborted: false,
      cache: "hit",
    };
    res.on("close", () => {
      stats.aborted = !res.writableFinished;
      stats.totalMs = performance.now() - start;
      onDone?.(stats);
    });
    res.writeHead(entry.status, { ...entry.headers, "content-length": String(entry.size) });
    const body = file.createReadStream();
    body.on("data", (chunk: string | Buffer) => {
      stats.bytesDown += chunk.length;
    });
    pipeline(body, res, () => undefined);
    return true;
  }

  /**
   * A tap that writes one response to a temp file and commits it as entry
   * `name` when the whole body arrived and reached the client; anything else
   * deletes the temp file. Settles the flight either way.
   * @param length - upstream `content-length`, checked against the bytes received.
   * @returns the tap, or undefined when the response is larger than the cap.
   */
  private writer(
    length: string | undefined,
    peer: string,
    name: string,
    headers: OutgoingHttpHeaders,
    settle: Settle,
  ): BodyTap | undefined {
    const { maxBytes } = this.options;
    const expected = length === undefined ? undefined : Number(length);
    if (expected !== undefined && !(expected <= maxBytes)) return undefined;
    const kept: Record<string, string> = {};
    for (const key of KEPT_HEADERS) {
      const value = headers[key];
      if (value !== undefined) kept[key] = String(value);
    }
    const temp = this.file(peer, name, `.${randomBytes(6).toString("hex")}`);
    let size = 0;
    let failed = false;
    let file: FileHandle | undefined;
    const create = async (): Promise<void> => {
      try {
        await mkdir(path.dirname(temp), { recursive: true, mode: 0o700 });
        file = await open(`${temp}.body.tmp`, "wx", 0o600);
      } catch {
        failed = true;
      }
    };
    let queue = create();
    const write = (chunk: Buffer) => async (): Promise<void> => {
      if (failed || file === undefined) return;
      try {
        const { bytesWritten } = await file.write(chunk);
        if (bytesWritten !== chunk.length) failed = true;
      } catch {
        failed = true;
      }
    };
    const finish = (complete: boolean) => async (): Promise<void> => {
      const whole = complete && !failed && (expected === undefined || size === expected);
      let entry: Entry | undefined;
      try {
        if (whole) await file?.datasync();
        await file?.close();
        if (whole && file !== undefined) {
          entry = await this.commit(peer, name, temp, { status: 200, headers: kept, size });
        }
      } catch {
        entry = undefined;
      }
      if (entry === undefined) {
        await rm(`${temp}.body.tmp`, { force: true }).catch(() => undefined);
        await rm(`${temp}.json.tmp`, { force: true }).catch(() => undefined);
      }
      settle(entry);
    };
    return {
      data: (chunk) => {
        size += chunk.length;
        if (size > maxBytes) failed = true;
        queue = queue.then(write(chunk));
      },
      done: (complete) => {
        queue = queue.then(finish(complete));
      },
    };
  }

  /** Move a complete body into place, then its metadata. */
  private async commit(
    peer: string,
    name: string,
    temp: string,
    meta: Meta,
  ): Promise<Entry | undefined> {
    if (this.closed) return undefined;
    const json = JSON.stringify(meta);
    await rename(`${temp}.body.tmp`, this.file(peer, name, ".body"));
    const file = await open(`${temp}.json.tmp`, "wx", 0o600);
    try {
      await file.writeFile(json);
      await file.datasync();
    } finally {
      await file.close();
    }
    await rename(`${temp}.json.tmp`, this.file(peer, name, ".json"));
    const entry: Entry = { ...meta, name, peer, bytes: meta.size + Buffer.byteLength(json) };
    this.admit(entry);
    await this.evict();
    return this.entries.get(name) === entry ? entry : undefined;
  }

  private async runWarm(peer: string, upstream: Upstream, state: PeerState): Promise<void> {
    const start = performance.now();
    const record = (fields: Record<string, unknown>): void =>
      this.options.trace.record("peer.warm", {
        peer,
        ...fields,
        totalMs: Math.round(performance.now() - start),
      });
    try {
      if (!(await this.ready)) return;
      const boot = bootResources(await this.fetchIndex(upstream));
      if (boot === undefined) {
        record({ error: "no boot graph in the index" });
        return;
      }
      if (boot.rev === state.warmedRev) {
        record({ rev: boot.rev, skipped: true });
        return;
      }
      const outcomes = await Promise.all(
        boot.targets.map((target) => this.prefetch(peer, upstream, target)),
      );
      const count = (outcome: PrefetchOutcome): number =>
        outcomes.filter((value) => value === outcome).length;
      if (!outcomes.includes("error")) state.warmedRev = boot.rev;
      record({
        rev: boot.rev,
        targets: outcomes.length,
        hit: count("hit"),
        miss: count("miss"),
        bypass: count("bypass"),
        errors: count("error"),
      });
    } catch (error) {
      record({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** The peer's index page, as a browser navigation gets it. */
  private fetchIndex(upstream: Upstream): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const headers = forwardHeaders({ accept: "text/html" }, upstream);
    const request = this.track(upstreamRequest(upstream, { method: "GET", path: "/", headers }));
    request.on("error", reject);
    request.on("response", (ur) => {
      if (ur.statusCode !== 200 || ur.headers["content-encoding"] !== undefined) {
        ur.resume();
        reject(new Error(`index answered ${ur.statusCode ?? 0}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      ur.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > WARM_INDEX_MAX_BYTES) request.destroy(new Error("index too large"));
        else chunks.push(chunk);
      });
      ur.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      ur.on("error", reject);
    });
    request.end();
    return promise;
  }

  /** Fetch one boot resource into the cache unless it is there or on its way. */
  private async prefetch(
    peer: string,
    upstream: Upstream,
    target: string,
  ): Promise<PrefetchOutcome> {
    await this.slot();
    try {
      if (this.closed || this.peers.get(peer)?.mounted !== true) return "error";
      const name = entryName(peer, target);
      const entry = this.entries.get(name);
      if (entry !== undefined) {
        this.touch(entry);
        return "hit";
      }
      const flight = this.flights.get(name);
      if (flight !== undefined) return (await flight) === undefined ? "bypass" : "hit";
      return await this.fetchEntry(peer, upstream, target, name);
    } finally {
      this.release();
    }
  }

  private async fetchEntry(
    peer: string,
    upstream: Upstream,
    target: string,
    name: string,
  ): Promise<PrefetchOutcome> {
    const start = performance.now();
    const settle = this.takeOff(name);
    const result = Promise.withResolvers<PrefetchOutcome>();
    let status = 0;
    let bytesDown = 0;
    let error: string | undefined;
    let tapped = false;
    const headers = forwardHeaders({ accept: "*/*", "accept-encoding": VARIANT }, upstream);
    const request = this.track(upstreamRequest(upstream, { method: "GET", path: target, headers }));
    request.on("error", (failure) => {
      error = failure.message;
      // Once the body flows, its tap settles (after deleting the temp file).
      if (tapped) return;
      settle(undefined);
      result.resolve("error");
    });
    request.on("response", (ur) => {
      status = ur.statusCode ?? 0;
      const out: OutgoingHttpHeaders = { ...ur.headers };
      markImmutable(HASHED_ASSET.test(pathnameOf(target)), ur, out);
      const tap = storable(ur, out)
        ? this.writer(ur.headers["content-length"], peer, name, out, (entry) => {
            settle(entry);
            result.resolve(entry === undefined ? "error" : "miss");
          })
        : undefined;
      if (tap === undefined) {
        ur.resume();
        settle(undefined);
        result.resolve("bypass");
        return;
      }
      tapped = true;
      ur.on("data", (chunk: Buffer) => {
        bytesDown += chunk.length;
        tap.data(chunk);
      });
      // A body cut short ends in `close` without `complete`; the tap discards it.
      ur.on("error", () => undefined);
      ur.on("close", () => tap.done(ur.complete));
    });
    request.end();
    const outcome = await result.promise;
    this.options.trace.record("peer.prefetch", {
      peer,
      path: tracePath(target),
      status,
      cache: outcome,
      bytesDown,
      totalMs: Math.round(performance.now() - start),
      error,
    });
    return outcome;
  }

  /** Keep a warm request cancellable by {@link close}, with an idle timeout. */
  private track(request: ClientRequest): ClientRequest {
    this.warmRequests.add(request);
    request.on("close", () => this.warmRequests.delete(request));
    request.setTimeout(WARM_TIMEOUT_MS, () => request.destroy(new Error("timed out")));
    return request;
  }

  private async slot(): Promise<void> {
    while (this.slots <= 0 && !this.closed) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.waiting.push(resolve);
      await promise;
    }
    this.slots -= 1;
  }

  private release(): void {
    this.slots += 1;
    this.waiting.shift()?.();
  }
}
