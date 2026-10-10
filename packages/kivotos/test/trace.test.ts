import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { forwardHttp, type HttpStats } from "../src/proxy.ts";
import { TraceLog, tracePath, WsFrameReader, type WsFrame } from "../src/trace.ts";

/** A WebSocket frame header for `length` payload bytes, optionally masked. */
function header(opcode: number, length: number, masked: boolean): Buffer {
  const mask = masked ? 0x80 : 0;
  let head: number[];
  if (length < 126) head = [0x80 | opcode, mask | length];
  else if (length < 65536) head = [0x80 | opcode, mask | 126, length >> 8, length & 0xff];
  else {
    head = [0x80 | opcode, mask | 127];
    for (let shift = 56; shift >= 0; shift -= 8) head.push(Math.floor(length / 2 ** shift) & 0xff);
  }
  if (masked) head.push(1, 2, 3, 4);
  return Buffer.from(head);
}

function frame(opcode: number, length: number, masked = false): Buffer {
  return Buffer.concat([header(opcode, length, masked), Buffer.alloc(length, 0x61)]);
}

test("WsFrameReader reads every frame however the stream is chunked", () => {
  // 7-bit, 16-bit and 64-bit lengths; a masked client frame; a close frame.
  const stream = Buffer.concat([frame(1, 5), frame(2, 300, true), frame(2, 70_000), frame(8, 2)]);
  const expected: WsFrame[] = [
    { opcode: 1, fin: true, length: 5 },
    { opcode: 2, fin: true, length: 300 },
    { opcode: 2, fin: true, length: 70_000 },
    { opcode: 8, fin: true, length: 2 },
  ];
  for (const size of [1, 3, 7, 4096, stream.length]) {
    const seen: WsFrame[] = [];
    const reader = new WsFrameReader((found) => seen.push(found));
    for (let at = 0; at < stream.length; at += size) reader.push(stream.subarray(at, at + size));
    assert.deepEqual(seen, expected, `chunk size ${size}`);
  }
});

test("tracePath never keeps the query string", () => {
  // The query can carry a login token; it must not reach the trace file.
  assert.equal(tracePath("/?token=secret"), "/");
  assert.equal(tracePath("/api/remote.mux?session=a&token=b"), "/api/remote.mux");
  assert.equal(tracePath("/assets/app.js"), "/assets/app.js");
});

test("TraceLog writes one JSON line per record and drops files past retention", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kivotos-trace-"));
  try {
    await writeFile(path.join(dir, "trace-2026-01-01.jsonl"), "{}\n");
    await writeFile(path.join(dir, "trace-2026-03-09.jsonl"), "{}\n");
    await writeFile(path.join(dir, "notes.txt"), "kept\n");
    const now = new Date(2026, 2, 10, 12);
    const log = new TraceLog(dir, "requests");
    await log.open(now);
    log.record("http", { path: "/", status: 200 }, now);
    await log.close();

    assert.deepEqual((await readdir(dir)).toSorted(), [
      "notes.txt",
      "trace-2026-03-09.jsonl",
      "trace-2026-03-10.jsonl",
    ]);
    const lines = (await readFile(path.join(dir, "trace-2026-03-10.jsonl"), "utf8"))
      .trim()
      .split("\n");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      ts: now.toISOString(),
      event: "http",
      path: "/",
      status: 200,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A server on an ephemeral loopback port; returns its port and a closer. */
async function serve(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return { port: address.port, close: () => server.close() };
}

/** Forward one request through a hop to `upstreamPort`; resolves with the hop's stats. */
async function hop(
  upstreamPort: number,
  body?: string,
): Promise<{ stats: HttpStats; text: string }> {
  let done!: (stats: HttpStats) => void;
  const stats = new Promise<HttpStats>((resolve) => {
    done = resolve;
  });
  const front = await serve((req, res) => {
    forwardHttp(
      req,
      res,
      { host: "127.0.0.1", port: upstreamPort, authority: `127.0.0.1:${upstreamPort}` },
      { path: req.url ?? "/", prefix: "", onDone: done },
    );
  });
  try {
    const res = await fetch(`http://127.0.0.1:${front.port}/x`, {
      method: body === undefined ? "GET" : "POST",
      body,
    });
    return { text: await res.text(), stats: await stats };
  } finally {
    front.close();
  }
}

test("forwardHttp reports status, sizes and first-byte time of the exchange", async () => {
  const upstream = await serve((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "cache-control": "no-store" });
      res.end("hello world");
    });
  });
  try {
    const { text, stats } = await hop(upstream.port, "abcdef");
    assert.equal(text, "hello world");
    assert.equal(stats.status, 200);
    assert.equal(stats.bytesUp, 6);
    assert.equal(stats.bytesDown, 11);
    assert.equal(stats.cacheControl, "no-store");
    assert.equal(stats.aborted, false);
    assert.ok(stats.ttfbMs >= 0 && stats.ttfbMs <= stats.totalMs);
  } finally {
    upstream.close();
  }
});

test("forwardHttp reports an unreachable upstream as 502 with the error", async () => {
  const closed = await serve(() => undefined);
  closed.close();
  const { stats } = await hop(closed.port);
  assert.equal(stats.status, 502);
  assert.equal(stats.ttfbMs, -1);
  assert.match(stats.error ?? "", /ECONNREFUSED/);
});
