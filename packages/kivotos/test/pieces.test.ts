import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { AttentionTracker } from "../src/attention.ts";
import type { HostContext } from "../src/dsh.ts";
import { Frontend } from "../src/index.ts";
import { TraceLog } from "../src/trace.ts";

const IMMUTABLE = "public, max-age=31536000, immutable";
const TYPE = "text/javascript; charset=utf-8";
/** Three plugin rows: their bundles as dsh-client-modules reads them (with their own trailers). */
const BUNDLES: Record<string, string> = {
  a: 'window.__ModuleLoader__.load({ id: "a" });\n//# sourceMappingURL=client.js.map',
  b: `window.__ModuleLoader__.load({ id: "b", s: "${"b".repeat(5000)}" });\n`,
  c: 'window.__ModuleLoader__.load({ id: "c" })\n//# sourceMappingURL=client.js.map\n',
};
const REV: Record<string, string> = { a: "0a0a0a0a0a0a", b: "0b0b0b0b0b0b", c: "0c0c0c0c0c0c" };
const BATCH = "/plugins/??b/client.js,c/client.js&rev=4d15464a3e7f";

/** A batch body the way dsh 0.2.1-rc.2 writes it (`buildComboScript`); `join` between rows is a deviation. */
function script(ids: string[], rev: string, join = ""): Buffer {
  const rows = ids.map((id) => {
    let source = BUNDLES[id].replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, "");
    if (!source.endsWith("\n")) source += "\n";
    return `${source};\n`;
  });
  const map = `??${ids.map((id) => `${id}/client.js.map`).join(",")}&rev=${rev}`;
  return Buffer.from(`${rows.join(join)}//# sourceMappingURL=${map}\n`);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function get(port: number, target: string): Promise<Reply> {
  const { promise, resolve, reject } = Promise.withResolvers<Reply>();
  const req = http.get({ host: "127.0.0.1", port, path: target, agent: false }, (res) => {
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

async function listen(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
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

interface Lab {
  /** Port of the tailnet frontend. */
  port: number;
  /** Request targets the loopback dsh served. */
  seen: string[];
  close(): Promise<void>;
}

/**
 * A tailnet frontend in front of a loopback dsh serving one graph with a
 * bootstrap batch `a` and the application batch {@link BATCH}; `join` alters
 * how the application batch is put together.
 */
async function lab(join = ""): Promise<Lab> {
  const graph = {
    rev: "648d7a5e9214",
    entries: ["a", "b", "c"].map((id) => ({
      id,
      url: `plugins/??${id}/client.js&rev=${REV[id]}`,
      rev: REV[id],
    })),
    batches: [
      { phase: "bootstrap", url: "plugins/??a/client.js&rev=ee2d123b611b", entries: ["a"] },
      { phase: "application", url: BATCH.slice(1), entries: ["b", "c"] },
    ],
  };
  const bodies = new Map<string, Buffer>([
    ["/plugins/??a/client.js&rev=ee2d123b611b", script(["a"], "ee2d123b611b")],
    [BATCH, script(["b", "c"], "4d15464a3e7f", join)],
    ...["a", "b", "c"].map((id): [string, Buffer] => [
      `/plugins/??${id}/client.js&rev=${REV[id]}`,
      script([id], REV[id]),
    ]),
  ]);
  const index = `<!doctype html><html><head><script>globalThis["__DSH_BOOT__"] = ${JSON.stringify(graph)}</script></head><body></body></html>`;
  const seen: string[] = [];
  const dsh = await listen((req, res) => {
    const url = req.url ?? "/";
    seen.push(url);
    if (url === "/?token=t") {
      res.writeHead(200, { "set-cookie": "dsh=login; Path=/" });
      res.end();
      return;
    }
    if (req.headers.cookie !== "dsh=login") {
      res.writeHead(401);
      res.end();
      return;
    }
    const body = url === "/" ? Buffer.from(index) : bodies.get(url);
    if (body === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    // dsh's gzip middleware compresses for every client that accepts it.
    const gzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
    res.writeHead(200, {
      "content-type": url === "/" ? "text/html; charset=utf-8" : TYPE,
      ...(url === "/" ? {} : { "cache-control": IMMUTABLE }),
      vary: "Accept-Encoding",
      ...(gzip ? { "content-encoding": "gzip" } : {}),
    });
    res.end(gzip ? gzipSync(body) : body);
  });
  const ctx: HostContext = {
    webServer: {
      port: dsh.port,
      register: () => () => undefined,
      registerUpgrade: () => () => undefined,
      tapIndex: () => () => undefined,
    },
    connection: {
      requestRejection: () => undefined,
      authenticatedUrl: (base) => `${base}?token=t`,
    },
    logger: { info: () => undefined, warn: () => undefined },
    effect: () => undefined,
    get: () => undefined,
    on: () => () => undefined,
  };
  const dir = await mkdtemp(path.join(os.tmpdir(), "kivotos-pieces-"));
  const frontend = new Frontend(ctx, new AttentionTracker(), new TraceLog(dir, "off"), () => ({
    name: "lab",
    os: "test",
  }));
  const listener = await listen((req, res) => {
    void frontend.request(req, res, { ip: "100.64.0.2", node: "", admitMs: 0, cached: false });
  });
  return {
    port: listener.port,
    seen,
    close: async () => {
      listener.close();
      dsh.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function manifestTarget(batch: string): string {
  return `/kivotos/pieces?batch=${encodeURIComponent(batch)}`;
}

test("a batch is its manifest's pieces, then its tail, byte for byte", async () => {
  const machine = await lab();
  try {
    const reply = await get(machine.port, manifestTarget(BATCH));
    assert.equal(reply.status, 200);
    const manifest = JSON.parse(reply.body.toString("utf8")) as {
      batch: string;
      bytes: number;
      sha256: string;
      contentType: string;
      cacheControl: string;
      pieces: { path: string; bytes: number; sha256: string }[];
      tail: string;
    };
    const whole = (await get(machine.port, BATCH)).body;
    assert.equal(manifest.batch, BATCH);
    assert.equal(manifest.bytes, whole.length);
    assert.equal(manifest.sha256, sha256(whole));
    assert.equal(manifest.contentType, TYPE);
    assert.equal(manifest.cacheControl, IMMUTABLE);
    // What the phone does: each piece is the start of its row's own body.
    const parts: Buffer[] = [];
    for (const piece of manifest.pieces) {
      const own = (await get(machine.port, piece.path)).body.subarray(0, piece.bytes);
      assert.equal(sha256(own), piece.sha256, piece.path);
      parts.push(own);
    }
    parts.push(Buffer.from(manifest.tail));
    assert.deepEqual(Buffer.concat(parts), whole);
    // A row's piece does not depend on the batch it is in.
    const b = manifest.pieces[0];
    assert.equal(b.path, `/plugins/??b/client.js&rev=${REV.b}`);
    assert.equal(b.sha256, sha256(script(["b"], "000000000000").subarray(0, b.bytes)));
    // Computed once: a second phone asking reads nothing more from dsh.
    const reads = machine.seen.length;
    assert.equal((await get(machine.port, manifestTarget(BATCH))).status, 200);
    assert.equal(machine.seen.length, reads);
  } finally {
    await machine.close();
  }
});

test("no manifest for a batch whose rows do not add up to it", async () => {
  // A dsh that writes something between rows: the phone must fetch it whole.
  const machine = await lab("\n");
  try {
    assert.equal((await get(machine.port, manifestTarget(BATCH))).status, 404);
    assert.equal(
      (await get(machine.port, manifestTarget("/plugins/??a/client.js&rev=ee2d123b611b"))).status,
      200,
    );
  } finally {
    await machine.close();
  }
});

test("no manifest for what is not a batch of the current graph", async () => {
  const machine = await lab();
  try {
    for (const batch of [
      "/plugins/??b/client.js,c/client.js&rev=000000000000",
      "/assets/index-5SrrfWpU.js",
      "",
    ]) {
      assert.equal((await get(machine.port, manifestTarget(batch))).status, 404, batch);
    }
  } finally {
    await machine.close();
  }
});
