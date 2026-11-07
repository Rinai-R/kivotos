/**
 * A relay for tests: just enough of packages/relay to run members against it,
 * and the ways a real one fails on a bad network, on demand.
 *
 * It speaks the wire protocol over WebSocket (`node`, `accept`, `dial` and
 * `peers` hellos, `ping`/`open` control lines, splicing a dial with its
 * accept), with no admission: any network and token pass.
 */
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";

/** One WebSocket the relay holds. */
export interface RelayConn {
  socket: Socket;
  role?: string;
  node?: string;
  /** Send bytes as one binary message. */
  send(data: Buffer): void;
  /** Cut it the way a crashing relay or a middlebox does: TCP reset, no close frame. */
  reset(): void;
  /** Whether the upgrade was answered (the client's WebSocket is open). */
  upgraded: boolean;
}

export interface FakeRelayOptions {
  /** Hold every WebSocket upgrade this long before answering it. */
  upgradeDelayMs?: number;
  /** Called for every connection once its hello is read; return false to answer nothing. */
  onHello?: (conn: RelayConn, hello: Record<string, unknown>) => boolean | void;
}

export interface FakeRelay {
  url: string;
  conns: RelayConn[];
  /** Resolves when a connection with this role has said hello. */
  hello(role: string): Promise<RelayConn>;
  close(): Promise<void>;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let head: Buffer;
  if (length < 126) head = Buffer.from([0x80 | opcode, length]);
  else if (length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([head, payload]);
}

/** Parse client frames (masked) out of `buffer`; @returns the rest. */
function frames(buffer: Buffer, onMessage: (opcode: number, data: Buffer) => void): Buffer {
  for (;;) {
    if (buffer.length < 2) return buffer;
    const opcode = buffer[0]! & 0x0f;
    let length = buffer[1]! & 0x7f;
    let at = 2;
    if (length === 126) {
      if (buffer.length < 4) return buffer;
      length = buffer.readUInt16BE(2);
      at = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return buffer;
      length = Number(buffer.readBigUInt64BE(2));
      at = 10;
    }
    const masked = (buffer[1]! & 0x80) !== 0;
    const maskAt = at;
    if (masked) at += 4;
    if (buffer.length < at + length) return buffer;
    const data = Buffer.from(buffer.subarray(at, at + length)) as Buffer<ArrayBuffer>;
    if (masked) for (let i = 0; i < data.length; i++) data[i]! ^= buffer[maskAt + (i % 4)]!;
    onMessage(opcode, data);
    buffer = buffer.subarray(at + length);
  }
}

export async function startFakeRelay(options: FakeRelayOptions = {}): Promise<FakeRelay> {
  const conns: RelayConn[] = [];
  const waiting: { role: string; resolve: (conn: RelayConn) => void }[] = [];
  const controls = new Map<string, RelayConn>();
  const pendingDials = new Map<string, RelayConn>();
  const pairs = new Map<RelayConn, RelayConn>();
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const line = (conn: RelayConn, value: unknown): void =>
    conn.send(Buffer.from(`${JSON.stringify(value)}\n`));

  server.on("upgrade", (req, socket: Socket) => {
    socket.on("error", () => socket.destroy());
    const conn: RelayConn = {
      socket,
      send: (data) => {
        if (!socket.destroyed) socket.write(frame(2, data));
      },
      reset: () => socket.resetAndDestroy(),
      upgraded: false,
    };
    conns.push(conn);
    let helloBuffer = Buffer.alloc(0);
    let said = false;
    const onHello = (hello: Record<string, unknown>): void => {
      conn.role = typeof hello.role === "string" ? hello.role : undefined;
      conn.node = typeof hello.node === "string" ? hello.node : undefined;
      for (const wait of waiting.splice(0)) {
        if (wait.role === conn.role) wait.resolve(conn);
        else waiting.push(wait);
      }
      if (options.onHello?.(conn, hello) === false) return;
      if (conn.role === "node" && conn.node !== undefined) {
        controls.set(conn.node, conn);
        line(conn, { ok: true });
      } else if (conn.role === "peers") {
        line(conn, {
          ok: true,
          peers: [...controls.keys()].map((node) => ({ node, name: node.slice(0, 6) })),
        });
      } else if (conn.role === "dial") {
        const control = controls.get(String(hello.target));
        if (control === undefined) {
          line(conn, { ok: false, error: "offline" });
          return;
        }
        const id = randomUUID();
        pendingDials.set(id, conn);
        line(control, { type: "open", conn: id, from: conn.node });
      } else if (conn.role === "accept") {
        const dial = pendingDials.get(String(hello.conn));
        if (dial === undefined) return;
        pendingDials.delete(String(hello.conn));
        pairs.set(conn, dial);
        pairs.set(dial, conn);
        line(conn, { ok: true });
        line(dial, { ok: true });
      }
    };
    const onMessage = (opcode: number, data: Buffer): void => {
      if (opcode === 8) {
        socket.end(frame(8, Buffer.alloc(0)));
        return;
      }
      if (opcode === 9) {
        socket.write(frame(10, data));
        return;
      }
      if (opcode !== 2) return;
      if (said) {
        pairs.get(conn)?.send(data);
        return;
      }
      helloBuffer = Buffer.concat([helloBuffer, data]);
      const end = helloBuffer.indexOf(10);
      if (end < 0) return;
      said = true;
      const rest = helloBuffer.subarray(end + 1);
      onHello(JSON.parse(helloBuffer.subarray(0, end).toString("utf8")) as Record<string, unknown>);
      if (rest.length > 0) pairs.get(conn)?.send(rest);
    };
    socket.once("close", () => {
      const other = pairs.get(conn);
      if (other !== undefined && !other.socket.destroyed)
        other.socket.end(frame(8, Buffer.alloc(0)));
      if (conn.node !== undefined && controls.get(conn.node) === conn) controls.delete(conn.node);
    });
    const answer = (): void => {
      if (socket.destroyed) return;
      const key = String(req.headers["sec-websocket-key"]);
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      conn.upgraded = true;
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      let buffer: Buffer = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        buffer = frames(Buffer.concat([buffer, chunk]) as Buffer<ArrayBuffer>, onMessage);
      });
    };
    if (options.upgradeDelayMs === undefined) answer();
    else setTimeout(answer, options.upgradeDelayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/v1/connect`,
    conns,
    hello: (role) => new Promise((resolve) => waiting.push({ role, resolve })),
    close: async () => {
      for (const conn of conns) conn.socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
