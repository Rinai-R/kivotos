import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { MountCache } from "../src/cache.ts";
import type { HttpStats, Upstream } from "../src/proxy.ts";
import { TraceLog } from "../src/trace.ts";

const PEER = "peer-a";
const BATCH = "/plugins/??a/client.js,b/client.js&rev=1f2e3d4c5b6a";
const IMMUTABLE = "public, max-age=31536000, immutable";
const SOURCE = Buffer.from("globalThis.loaded = true;\n".repeat(400));
const SCRIPT = gzipSync(SOURCE);

/** A server on an ephemeral loopback port; returns its port and a closer. */
async function serve(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  const server = http.createServer(handler);
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return {
    port: address.port,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** One raw GET: exact request headers, body bytes as sent. */
function get(port: number, target: string, headers: http.OutgoingHttpHeaders): Promise<Reply> {
  const { promise, resolve, reject } = Promise.withResolvers<Reply>();
  const req = http.get({ host: "127.0.0.1", port, path: target, headers, agent: false }, (res) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () =>
      resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
    );
    res.on("error", reject);
  });
  req.on("error", reject);
  return promise;
}

interface Lab {
  cache: MountCache;
  dir: string;
  upstream: Upstream;
  /** Port of the mount. */
  port: number;
  /** Requests the upstream received. */
  seen: { url: string; headers: http.IncomingHttpHeaders }[];
  /** Requests the mount received. */
  arrived: () => number;
  /** GET through the mount; a gzip-accepting browser by default. */
  get(target: string, headers?: http.OutgoingHttpHeaders): Promise<Reply>;
  /** The mount's stats of the next finished exchange. */
  stats(): Promise<HttpStats>;
  close(): Promise<void>;
}

/** A peer mount in front of `handler`, cached under `dir` (a fresh one by default). */
async function lab(
  handler: http.RequestListener,
  options: { maxBytes?: number; warm?: boolean; dir?: string } = {},
): Promise<Lab> {
  const dir = options.dir ?? (await mkdtemp(path.join(os.tmpdir(), "kivotos-cache-")));
  const seen: Lab["seen"] = [];
  const origin = await serve((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    handler(req, res);
  });
  const upstream = { host: "127.0.0.1", port: origin.port, authority: `127.0.0.1:${origin.port}` };
  const cache = new MountCache({
    dir,
    maxBytes: options.maxBytes ?? 1024 * 1024,
    warm: options.warm ?? false,
    trace: new TraceLog(dir, "off"),
    warn: (message, error) => assert.fail(`${message}: ${String(error)}`),
  });
  await cache.open();
  cache.mounted(PEER);
  const finished: HttpStats[] = [];
  // Every pending stats() call waits here; a finished exchange wakes them all.
  const waiters: (() => void)[] = [];
  let arrived = 0;
  const front = await serve((req, res) => {
    arrived += 1;
    cache.forward(req, res, PEER, upstream, {
      path: req.url ?? "/",
      prefix: "",
      onDone: (stats) => {
        finished.push(stats);
        for (const wake of waiters.splice(0)) wake();
      },
    });
  });
  const stats = async (): Promise<HttpStats> => {
    while (finished.length === 0) {
      const next = Promise.withResolvers<void>();
      waiters.push(next.resolve);
      await next.promise;
    }
    return finished.shift() as HttpStats;
  };
  return {
    cache,
    dir,
    upstream,
    port: front.port,
    seen,
    arrived: () => arrived,
    stats,
    get: (target, headers = { "accept-encoding": "gzip, deflate, br" }) =>
      get(front.port, target, headers),
    close: async () => {
      cache.close();
      front.close();
      origin.close();
      if (options.dir === undefined) await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Answers like dsh's plugin route: an immutable script, gzip when asked for. */
const plugins: http.RequestListener = (req, res) => {
  const gzip = String(req.headers["accept-encoding"] ?? "").includes("gzip");
  res.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": IMMUTABLE,
    vary: "Accept-Encoding",
    ...(gzip ? { "content-encoding": "gzip" } : {}),
  });
  res.end(gzip ? SCRIPT : SOURCE);
};

/** Names of the files under `dir`, recursively. */
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

test("an immutable response is fetched once, then answered from disk", async () => {
  const mount = await lab(plugins);
  try {
    const first = await mount.get(BATCH);
    assert.equal((await mount.stats()).cache, "miss");
    const second = await mount.get(BATCH);
    const stats = await mount.stats();
    assert.equal(stats.cache, "hit");
    assert.equal(mount.seen.length, 1);
    assert.deepEqual(first.body, SCRIPT);
    assert.deepEqual(second.body, SCRIPT);
    assert.equal(second.headers["content-encoding"], "gzip");
    assert.equal(second.headers["cache-control"], IMMUTABLE);
    assert.equal(second.headers["content-length"], String(SCRIPT.length));
    assert.equal(stats.bytesDown, SCRIPT.length);
  } finally {
    await mount.close();
  }
});

test("concurrent misses for one URL reach the upstream once", async () => {
  const all = Promise.withResolvers<void>();
  const mount = await lab((req, res) => {
    void all.promise.then(() => plugins(req, res));
  });
  try {
    const replies = Promise.all([mount.get(BATCH), mount.get(BATCH), mount.get(BATCH)]);
    // Hold the upstream until all three reached the mount.
    while (mount.arrived() < 3) {
      const tick = Promise.withResolvers<void>();
      setImmediate(tick.resolve);
      await tick.promise;
    }
    all.resolve();
    for (const reply of await replies) assert.deepEqual(reply.body, SCRIPT);
    const outcomes = await Promise.all([mount.stats(), mount.stats(), mount.stats()]);
    assert.equal(mount.seen.length, 1);
    assert.deepEqual(outcomes.map((stats) => stats.cache).sort(), ["hit", "hit", "miss"]);
  } finally {
    await mount.close();
  }
});

test("responses that differ per caller or may change are never stored", async () => {
  const mount = await lab((req, res) => {
    if (req.url === "/api/session/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("[]");
    } else if (req.url === "/plugins/??cookie&rev=1") {
      res.writeHead(200, { "cache-control": IMMUTABLE, "set-cookie": "sid=1" });
      res.end("cookie");
    } else if (req.url === "/plugins/??vary&rev=1") {
      res.writeHead(200, { "cache-control": IMMUTABLE, vary: "Cookie" });
      res.end("vary");
    } else plugins(req, res);
  });
  try {
    for (const target of [
      "/api/session/list",
      "/plugins/??cookie&rev=1",
      "/plugins/??vary&rev=1",
    ]) {
      const reply = await mount.get(target);
      await mount.get(target);
      assert.equal(reply.headers["set-cookie"], undefined);
      assert.equal((await mount.stats()).cache, "bypass", target);
      assert.equal((await mount.stats()).cache, "bypass", target);
    }
    assert.equal(mount.seen.length, 6);
    // A stored URL asked for with a range goes upstream as it is.
    await mount.get(BATCH);
    await mount.stats();
    await mount.cache.idle();
    await mount.get(BATCH, { "accept-encoding": "gzip", range: "bytes=0-9" });
    assert.equal((await mount.stats()).cache, "bypass");
    assert.equal(mount.seen.length, 8);
  } finally {
    await mount.close();
  }
});

test("an exchange cut short, upstream or by the client, stores nothing", async () => {
  let mode: "cut" | "hold" | "whole" = "cut";
  const release = Promise.withResolvers<void>();
  const endLater = async (res: http.ServerResponse): Promise<void> => {
    await release.promise;
    res.end(SOURCE.subarray(100));
  };
  const mount = await lab((_req, res) => {
    res.writeHead(200, { "cache-control": IMMUTABLE, "content-type": "text/javascript" });
    if (mode === "whole") {
      res.end(SOURCE);
      return;
    }
    res.write(SOURCE.subarray(0, 100), () => {
      if (mode === "cut") res.socket?.destroy();
      else void endLater(res);
    });
  });
  try {
    await assert.rejects(mount.get(BATCH));
    assert.equal((await mount.stats()).cache, "miss");
    await mount.cache.idle();
    assert.deepEqual(await files(path.join(mount.dir, PEER)), []);

    mode = "hold";
    const gone = Promise.withResolvers<void>();
    const req = http.get(
      { host: "127.0.0.1", port: mount.port, path: BATCH, agent: false },
      (res) =>
        res.once("data", () => {
          req.destroy();
          gone.resolve();
        }),
    );
    req.on("error", () => undefined);
    await gone.promise;
    assert.equal((await mount.stats()).aborted, true);
    release.resolve();
    await mount.cache.idle();
    assert.deepEqual(await files(path.join(mount.dir, PEER)), []);

    mode = "whole";
    const reply = await mount.get(BATCH);
    assert.equal((await mount.stats()).cache, "miss");
    assert.deepEqual(reply.body, SOURCE);
    assert.equal(mount.seen.length, 3);
  } finally {
    await mount.close();
  }
});

test("entries survive a restart; files that are not a complete entry are deleted", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kivotos-cache-"));
  try {
    const before = await lab(plugins, { dir });
    await before.get(BATCH);
    await before.stats();
    await before.cache.idle();
    await before.close();
    const peerDir = path.join(dir, PEER);
    const stored = (await files(peerDir)).sort();
    assert.equal(stored.length, 2);
    const orphan = "0".repeat(40);
    const short = "1".repeat(40);
    await writeFile(path.join(peerDir, `${orphan}.body`), "no metadata");
    await writeFile(path.join(peerDir, `${orphan}.4a5b.body.tmp`), "half");
    await writeFile(path.join(peerDir, `${short}.body`), "abc");
    await writeFile(
      path.join(peerDir, `${short}.json`),
      JSON.stringify({ status: 200, headers: {}, size: 999 }),
    );

    const after = await lab(plugins, { dir });
    try {
      const reply = await after.get(BATCH);
      assert.equal((await after.stats()).cache, "hit");
      assert.equal(after.seen.length, 0);
      assert.deepEqual(reply.body, SCRIPT);
      assert.deepEqual((await files(peerDir)).sort(), stored);
    } finally {
      await after.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the size cap evicts the least recently used entry", async () => {
  const body = Buffer.alloc(1000, 0x61);
  // Each entry is the 1000-byte body plus about 120 bytes of metadata: two fit, three do not.
  const mount = await lab(
    (_req, res) => {
      res.writeHead(200, { "cache-control": IMMUTABLE, "content-type": "text/javascript" });
      res.end(body);
    },
    { maxBytes: 2500 },
  );
  const fetch = async (target: string): Promise<HttpStats["cache"]> => {
    await mount.get(target);
    const { cache } = await mount.stats();
    await mount.cache.idle();
    return cache;
  };
  try {
    assert.equal(await fetch("/plugins/??a&rev=1"), "miss");
    assert.equal(await fetch("/plugins/??b&rev=1"), "miss");
    assert.equal(await fetch("/plugins/??a&rev=1"), "hit");
    assert.equal(await fetch("/plugins/??c&rev=1"), "miss");
    assert.equal(await fetch("/plugins/??a&rev=1"), "hit");
    assert.equal(await fetch("/plugins/??b&rev=1"), "miss");
    assert.equal((await files(path.join(mount.dir, PEER))).length, 4);
  } finally {
    await mount.close();
  }
});

test("every gzip client shares one entry; others go upstream with their own encoding", async () => {
  const mount = await lab(plugins);
  try {
    await mount.get(BATCH, { "accept-encoding": "br;q=1, gzip;q=0.8, deflate" });
    assert.equal((await mount.stats()).cache, "miss");
    assert.equal(mount.seen[0]?.headers["accept-encoding"], "gzip");
    const shared = await mount.get(BATCH, { "accept-encoding": "gzip" });
    assert.equal((await mount.stats()).cache, "hit");
    assert.deepEqual(shared.body, SCRIPT);
    // A client that does not take gzip never gets the stored gzip bytes.
    const plain = await mount.get(BATCH, { "accept-encoding": "identity" });
    assert.equal((await mount.stats()).cache, "bypass");
    assert.deepEqual(plain.body, SOURCE);
    await mount.get(BATCH, { "accept-encoding": "gzip;q=0, deflate" });
    assert.equal((await mount.stats()).cache, "bypass");
    assert.equal(mount.seen.at(-1)?.headers["accept-encoding"], "gzip;q=0, deflate");
    assert.equal(mount.seen.length, 3);
  } finally {
    await mount.close();
  }
});

test("content-hashed assets without caching headers are served immutable and stored", async () => {
  const mount = await lab((req, res) => {
    res.writeHead(req.url === "/assets/gone-5SrrfWpU.js" ? 404 : 200, {
      "content-type": "text/javascript",
    });
    res.end("asset");
  });
  try {
    // Without gzip the client bypasses the cache but still gets the header.
    const plain = await mount.get("/assets/index-5SrrfWpU.js", {});
    assert.equal(plain.headers["cache-control"], IMMUTABLE);
    await mount.stats();
    await mount.get("/assets/index-5SrrfWpU.js");
    await mount.stats();
    await mount.cache.idle();
    const hit = await mount.get("/assets/index-5SrrfWpU.js");
    assert.equal((await mount.stats()).cache, "hit");
    assert.equal(hit.headers["cache-control"], IMMUTABLE);
    for (const target of ["/assets/vue-language.js", "/assets/gone-5SrrfWpU.js"]) {
      const reply = await mount.get(target);
      assert.equal(reply.headers["cache-control"], undefined, target);
      assert.equal((await mount.stats()).cache, "bypass", target);
    }
  } finally {
    await mount.close();
  }
});

test("warming prefetches the boot graph's batches and the linked assets", async () => {
  const graph = {
    rev: "g1",
    entries: [],
    batches: [
      { phase: "bootstrap", url: "plugins/??a/client.js&rev=b1", rev: "b1", entries: ["a"] },
      {
        phase: "application",
        url: "plugins/??b/client.js,c/client.js&rev=b2",
        rev: "b2",
        entries: ["b", "c"],
      },
    ],
  };
  const index = [
    "<!doctype html><html><head>",
    `<script>globalThis["__DSH_BOOT__"] = ${JSON.stringify(graph)}</script>`,
    '<script type="module" crossorigin src="./assets/index-5SrrfWpU.js"></script>',
    '<link rel="stylesheet" crossorigin href="./assets/index-BPHePDI_.css">',
    '<link rel="icon" href="./favicon.svg">',
    "</head><body></body></html>",
  ].join("\n");
  const mount = await lab(
    (req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(index);
      } else if (req.url?.startsWith("/assets/") === true) {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end("asset");
      } else plugins(req, res);
    },
    { warm: true },
  );
  const boot = [
    "/plugins/??a/client.js&rev=b1",
    "/plugins/??b/client.js,c/client.js&rev=b2",
    "/assets/index-5SrrfWpU.js",
    "/assets/index-BPHePDI_.css",
  ];
  try {
    await mount.cache.warm(PEER, mount.upstream);
    assert.deepEqual(mount.seen.map((request) => request.url).sort(), ["/", ...boot].sort());
    for (const target of boot) {
      await mount.get(target);
      assert.equal((await mount.stats()).cache, "hit", target);
    }
    assert.equal(mount.seen.length, 5);
  } finally {
    await mount.close();
  }
});
