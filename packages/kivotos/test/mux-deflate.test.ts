import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Config, type KivotosConfig } from "../src/index.ts";
import { forwardUpgrade, type MuxCompression } from "../src/proxy.ts";
import {
  COMPRESS_THRESHOLD,
  deflateMessage,
  encodeFrame,
  FrameReader,
  inflateMessage,
  MuxBridge,
  offersDeflate,
  OPCODE,
  type Message,
  type MuxStats,
} from "../src/ws-mux.ts";

/** A raw WebSocket client: what a browser or a phone does on the mux hop. */
function webSocketClient(options: {
  offer: string | undefined;
  host: string;
  port: number;
  path: string;
}) {
  const messages: Message[] = [];
  let socket: import("node:net").Socket | undefined;
  let extension: string | undefined;
  const reader = new FrameReader(false, (frame) => {
    if (frame.opcode < 8) {
      messages.push({ opcode: frame.opcode, rsv1: frame.rsv1, data: frame.payload });
    }
  });
  return {
    messages,
    extension: () => extension,
    connect: () =>
      new Promise<void>((resolve, reject) => {
        socket = net.connect(options.port, options.host);
        socket.once("error", reject);
        let head = Buffer.alloc(0);
        socket.once("connect", () => {
          socket!.write(
            [
              `GET ${options.path} HTTP/1.1`,
              `Host: ${options.host}:${options.port}`,
              "Upgrade: websocket",
              "Connection: Upgrade",
              `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
              "Sec-WebSocket-Version: 13",
              ...(options.offer === undefined
                ? []
                : [`Sec-WebSocket-Extensions: ${options.offer}`]),
              "",
              "",
            ].join("\r\n"),
          );
        });
        const onData = (chunk: Buffer): void => {
          head = Buffer.concat([head, chunk]);
          const end = head.indexOf("\r\n\r\n");
          if (end < 0) return;
          socket!.off("data", onData);
          const text = head.subarray(0, end).toString("latin1");
          extension = /^sec-websocket-extensions:\s*(.+)$/im.exec(text)?.[1]?.trim();
          socket!.on("data", (rest: Buffer) => reader.push(rest));
          const rest = head.subarray(end + 4);
          if (rest.length > 0) reader.push(rest);
          resolve();
        };
        socket.on("data", onData);
      }),
    send: (data: Buffer, rsv1 = false) => {
      socket?.write(encodeFrame(OPCODE.binary, data, { masked: true, rsv1 }));
    },
    close: () => socket?.destroy(),
    closed: () =>
      new Promise<void>((resolve) => {
        if (socket === undefined || socket.destroyed) return resolve();
        socket.once("close", () => resolve());
        socket.destroy();
      }),
  };
}

/** A WebSocket server standing in for dsh's mux: echoes, compressed or not. */
async function fakeUpstream(acceptDeflate: boolean) {
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const received: Message[] = [];
  const sockets = new Set<Duplex>();
  server.on("upgrade", (req, socket: Duplex) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const key = String(req.headers["sec-websocket-key"]);
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    const negotiated = acceptDeflate && offersDeflate(req.headers["sec-websocket-extensions"]);
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        ...(negotiated ? ["Sec-WebSocket-Extensions: permessage-deflate"] : []),
        "",
        "",
      ].join("\r\n"),
    );
    let pending: Buffer[] = [];
    let opcode: number | undefined;
    const reader = new FrameReader(true, (frame) => {
      if (frame.opcode >= 8) return;
      if (frame.payload.length > 0) pending.push(frame.payload);
      if (!frame.fin) return;
      const data = Buffer.concat(pending);
      pending = [];
      opcode = frame.opcode;
      received.push({ opcode: opcode ?? OPCODE.binary, rsv1: frame.rsv1, data });
      // Echo it back, compressed when the extension was negotiated.
      const reply = frame.rsv1 ? inflateMessage(data) : data;
      const compress = negotiated && reply.length >= COMPRESS_THRESHOLD;
      const body = compress ? deflateMessage(reply) : reply;
      socket.write(encodeFrame(OPCODE.binary, body, { masked: false, rsv1: compress }));
    });
    socket.on("data", (chunk: Buffer) => reader.push(chunk));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    received,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.unref();
    },
  };
}

/** A proxy server whose upgrade handler is Kivotos' forwardUpgrade. */
async function proxy(upstreamPort: number, mux: MuxCompression) {
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const sockets = new Set<Duplex>();
  server.on("upgrade", (req, socket, head) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    forwardUpgrade(
      req,
      socket,
      head,
      { host: "127.0.0.1", port: upstreamPort, authority: `127.0.0.1:${upstreamPort}` },
      req.url ?? "/",
      undefined,
      mux,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.unref();
    },
  };
}

test("frames round-trip with masks, fragmentation and control frames", () => {
  const frames: { opcode: number; payload: string; fin: boolean }[] = [];
  const reader = new FrameReader(true, (frame) =>
    frames.push({ opcode: frame.opcode, payload: frame.payload.toString(), fin: frame.fin }),
  );
  const message = Buffer.from("hello mux");
  const bytes = Buffer.concat([
    encodeFrame(OPCODE.text, message.subarray(0, 4), { masked: true, fin: false }),
    encodeFrame(OPCODE.ping, Buffer.from("p"), { masked: true }),
    encodeFrame(OPCODE.continuation, message.subarray(4), { masked: true }),
  ]);
  // One byte at a time: the parser must not care where a chunk ends.
  for (const byte of bytes) reader.push(Buffer.from([byte]));
  assert.deepEqual(frames, [
    { opcode: OPCODE.text, payload: "hell", fin: false },
    { opcode: OPCODE.ping, payload: "p", fin: true },
    { opcode: OPCODE.continuation, payload: "o mux", fin: true },
  ]);
  assert.throws(() => new FrameReader(false, () => undefined).push(bytes), /mask/);
});

test("permessage-deflate encodes and decodes a message with no context takeover", () => {
  for (const size of [0, 1, 100, 5_000, 300_000]) {
    // Compression only helps repetitive data, as a JSON mux frame is; the
    // round trip itself must hold for anything, so try random bytes too.
    for (const data of [Buffer.alloc(size, 0x41), randomBytes(size)]) {
      assert.deepEqual(inflateMessage(deflateMessage(data)), data, `size ${size}`);
    }
    assert.ok(size < COMPRESS_THRESHOLD || deflateMessage(Buffer.alloc(size, 0x41)).length < size);
  }
  assert.equal(offersDeflate("permessage-deflate; client_max_window_bits"), true);
  assert.equal(offersDeflate("x-webkit-deflate-frame"), false);
  assert.equal(offersDeflate(undefined), false);
});

test(
  "the bridge compresses the client hop only, above the threshold",
  { timeout: 10_000 },
  async () => {
    const big = Buffer.from(JSON.stringify({ type: "snapshot", body: "x".repeat(60_000) }));
    const small = Buffer.from('{"type":"ping"}');
    /** One end of the bridge: what it writes is collected, what it reads is pushed. */
    const endpoint = () => {
      const written: Buffer[] = [];
      const duplex = new Duplex({
        read() {},
        write(chunk: Buffer, _encoding, done) {
          written.push(chunk);
          done();
        },
      });
      return { duplex, written, push: (bytes: Buffer) => duplex.push(bytes) };
    };
    const client = endpoint();
    const upstream = endpoint();
    const bridged = new MuxBridge(client.duplex, upstream.duplex, "client-hop", {
      note: () => undefined,
    });
    bridged.start();
    // Client → upstream: compressed in (masked, rsv1), plain out (masked).
    client.push(encodeFrame(OPCODE.binary, deflateMessage(big), { masked: true, rsv1: true }));
    client.push(encodeFrame(OPCODE.binary, small, { masked: true }));
    // Upstream → client: plain in (unmasked), compressed out when large.
    upstream.push(encodeFrame(OPCODE.binary, big, { masked: false }));
    upstream.push(encodeFrame(OPCODE.binary, small, { masked: false }));
    await sleep(50);
    const toUpstream: Message[] = [];
    new FrameReader(true, (frame) => {
      if (frame.opcode < 8)
        toUpstream.push({ opcode: frame.opcode, rsv1: frame.rsv1, data: frame.payload });
    }).push(Buffer.concat(upstream.written));
    const toClient: Message[] = [];
    new FrameReader(false, (frame) => {
      if (frame.opcode < 8)
        toClient.push({ opcode: frame.opcode, rsv1: frame.rsv1, data: frame.payload });
    }).push(Buffer.concat(client.written));
    assert.equal(toUpstream.length, 2);
    assert.deepEqual(toUpstream[0]?.data, big);
    assert.equal(toUpstream[0]?.rsv1, false);
    assert.equal(toUpstream[1]?.rsv1, false);
    assert.equal(toClient.length, 2);
    assert.equal(toClient[0]?.rsv1, true);
    assert.deepEqual(inflateMessage(toClient[0]!.data), big);
    assert.equal(toClient[1]?.rsv1, false);
    assert.deepEqual(toClient[1]?.data, small);
    bridged.stop();
  },
);

test(
  "forwardUpgrade leaves a Host that negotiates the extension end to end alone",
  { timeout: 10_000 },
  async () => {
    const upstream = await fakeUpstream(true);
    const seen: MuxStats[] = [];
    const front = await proxy(upstream.port, { mode: "auto", onDone: (stats) => seen.push(stats) });
    const client = webSocketClient({
      offer: "permessage-deflate; client_max_window_bits",
      host: "127.0.0.1",
      port: front.port,
      path: "/api/remote.mux",
    });
    await client.connect();
    assert.equal(client.extension(), "permessage-deflate");
    const big = Buffer.from(JSON.stringify({ body: "y".repeat(40_000) }));
    client.send(deflateMessage(big), true);
    await sleep(150);
    // Passed through unchanged: the upstream saw the client's compressed frame.
    assert.equal(upstream.received[0]?.rsv1, true);
    assert.deepEqual(inflateMessage(upstream.received[0]!.data), big);
    // The echo comes back still compressed and intact.
    assert.equal(client.messages[0]?.rsv1, true);
    assert.deepEqual(inflateMessage(client.messages[0]!.data), big);
    await client.closed();
    await front.close();
    await upstream.close();
  },
);

test("an older Host gets the client hop compressed by Kivotos", { timeout: 10_000 }, async () => {
  const upstream = await fakeUpstream(false);
  const done: MuxStats[] = [];
  const front = await proxy(upstream.port, { mode: "auto", onDone: (stats) => done.push(stats) });
  const client = webSocketClient({
    offer: "permessage-deflate; client_max_window_bits",
    host: "127.0.0.1",
    port: front.port,
    path: "/api/remote.mux",
  });
  await client.connect();
  // Kivotos answered the client's offer itself, with context takeover off.
  assert.match(client.extension() ?? "", /server_no_context_takeover/);
  const big = Buffer.from(JSON.stringify({ body: "z".repeat(40_000) }));
  const small = Buffer.from('{"type":"ping"}');
  client.send(deflateMessage(big), true);
  client.send(small);
  await sleep(200);
  // The upstream got plain frames (it has no extension), the big one whole.
  assert.equal(upstream.received[0]?.rsv1, false);
  assert.deepEqual(upstream.received[0]?.data, big);
  assert.deepEqual(upstream.received[1]?.data, small);
  // Back to the client: large compressed by Kivotos, small untouched.
  assert.equal(client.messages[0]?.rsv1, true);
  assert.deepEqual(inflateMessage(client.messages[0]!.data), big);
  assert.equal(client.messages[1]?.rsv1, false);
  assert.deepEqual(client.messages[1]?.data, small);
  await client.closed();
  await front.close();
  await upstream.close();
  assert.ok(done.length >= 0);
});

test("no offer, or the switch off, changes nothing", { timeout: 15_000 }, async () => {
  for (const [offer, mode] of [
    [undefined, "auto"],
    ["permessage-deflate", "off"],
  ] as const) {
    const upstream = await fakeUpstream(true);
    const front = await proxy(upstream.port, { mode });
    const client = webSocketClient({
      offer,
      host: "127.0.0.1",
      port: front.port,
      path: "/api/remote.mux",
    });
    await client.connect();
    // `off` strips the offer, so the Host cannot negotiate either.
    assert.equal(client.extension(), undefined);
    const big = Buffer.from(JSON.stringify({ body: "w".repeat(10_000) }));
    client.send(big);
    await sleep(150);
    assert.deepEqual(upstream.received[0]?.data, big);
    assert.equal(upstream.received[0]?.rsv1, false);
    assert.equal(client.messages[0]?.rsv1, false);
    await client.closed();
    await front.close();
    await upstream.close();
  }
});

test("the switch defaults to auto and validates its values", async () => {
  const config = await Config["~standard"].validate({});
  assert.ok("value" in config);
  const value = (config as { value: KivotosConfig }).value;
  assert.equal(value.muxCompression, "auto");
  const off = await Config["~standard"].validate({ muxCompression: "off" });
  assert.ok("value" in off);
  assert.equal((off as { value: KivotosConfig }).value.muxCompression, "off");
  const bad = await Config["~standard"].validate({ muxCompression: "always" });
  assert.ok("issues" in bad);
});

test("a broken frame closes the bridge instead of throwing", { timeout: 10_000 }, async () => {
  const notes: string[] = [];
  const a = new Duplex({
    read() {},
    write(_c, _e, done) {
      done();
    },
  });
  const b = new Duplex({
    read() {},
    write(_c, _e, done) {
      done();
    },
  });
  const bridged = new MuxBridge(a, b, "client-hop", {
    note: (message) => notes.push(message),
  });
  bridged.start();
  // RSV2 is never negotiated: the parser rejects the frame and the bridge
  // closes both sides instead of letting the error reach the process.
  a.push(Buffer.from([0xb2, 0x01, 0x41]));
  await sleep(30);
  assert.deepEqual(notes, ["kivotos: mux compression stopped"]);
  assert.ok(a.destroyed && b.destroyed);
});
