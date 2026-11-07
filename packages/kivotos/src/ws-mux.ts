/**
 * WebSocket framing and permessage-deflate for the remote mux (#mux-deflate).
 *
 * Kivotos owns both ends of `/api/remote.mux`, so it can give a hop
 * compression that its other end does not do itself: the browser/phone hop of
 * a page served through the tailnet listener or a relay session, where the
 * other end (dsh 0.2.2-rc.1) already negotiates the extension end to end, is
 * left alone; an older dsh Host, whose gateway has no compression
 * (`websocketCompression` arrived in 0.2.2), gets the client hop compressed
 * here. Nothing is ever compressed twice: when both ends negotiated the
 * extension the bytes are pumped unchanged.
 *
 * permessage-deflate, as implemented: per message, context takeover off on
 * both sides, window 15. A message smaller than {@link COMPRESS_THRESHOLD} is
 * sent uncompressed, so the small JSON frames of an interactive RPC round trip
 * never pay for a deflate header, and a mux message is compressed whole (the
 * message boundary is what the extension works on), which adds no latency the
 * WebSocket itself did not already impose: a client could not use a partial
 * message either.
 *
 * Where the plaintext boundary is: kivotos terminates the mux only on a hop
 * whose bytes it already holds — the loopback `dsh` it serves, the tailnet
 * listener (WireGuard), or a relay session (kivotos-to-kivotos TLS 1.3). The
 * relay still sees ciphertext; kivotos never re-encrypts, and the inner TLS is
 * untouched. Compression happens inside those protected hops.
 */
import { constants, deflateRawSync, inflateRawSync } from "node:zlib";
import type { Duplex } from "node:stream";

/** The extension token as it appears in a header. */
export const DEFLATE_EXTENSION = "permessage-deflate";

/**
 * Messages at least this long are compressed: about dsh's own gateway
 * threshold (1024), chosen so a small RPC frame is never made bigger.
 */
export const COMPRESS_THRESHOLD = 1024;

/** The deflate trailer permessage-deflate strips from each message. */
const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);

/** One WebSocket frame as it arrives. */
export interface Frame {
  fin: boolean;
  opcode: number;
  rsv1: boolean;
  masked: boolean;
  payload: Buffer;
}

/** One reassembled data message. */
export interface Message {
  opcode: number;
  rsv1: boolean;
  data: Buffer;
}

export const OPCODE = { continuation: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 } as const;

/**
 * Parse frames from one end of a WebSocket, incrementally.
 *
 * `masked` says whether frames from this end carry a mask (a client sends
 * masked frames, a server does not). Control frames interleave with a
 * fragmented message and are handed over as they come.
 */
export class FrameReader {
  private buffer: Buffer<ArrayBuffer> = Buffer.alloc(0);
  private readonly masked: boolean;
  private readonly onFrame: (frame: Frame) => void;

  constructor(masked: boolean, onFrame: (frame: Frame) => void) {
    this.masked = masked;
    this.onFrame = onFrame;
  }

  /** @throws on a frame that breaks framing; the caller closes both sides. */
  push(chunk: Buffer): void {
    this.buffer =
      this.buffer.length === 0
        ? (chunk as Buffer<ArrayBuffer>)
        : (Buffer.concat([this.buffer, chunk]) as Buffer<ArrayBuffer>);
    for (;;) {
      const frame = this.parse();
      if (frame === undefined) return;
      this.onFrame(frame);
    }
  }

  private parse(): Frame | undefined {
    const buffer = this.buffer;
    if (buffer.length < 2) return undefined;
    const fin = (buffer[0]! & 0x80) !== 0;
    const rsv = buffer[0]! & 0x70;
    const opcode = buffer[0]! & 0x0f;
    const masked = (buffer[1]! & 0x80) !== 0;
    if (masked !== this.masked) throw new Error("relay frame mask does not match its side");
    // RSV2 and RSV3 are never negotiated; only RSV1 (deflate) is.
    if ((rsv & 0x30) !== 0) throw new Error("relay frame uses a reserved bit");
    let length = buffer[1]! & 0x7f;
    let at = 2;
    if (length === 126) {
      if (buffer.length < 4) return undefined;
      length = buffer.readUInt16BE(2);
      at = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return undefined;
      const large = buffer.readBigUInt64BE(2);
      if (large > BigInt(64 << 20)) throw new Error("relay frame is larger than 64 MB");
      length = Number(large);
      at = 10;
    }
    const maskAt = at;
    if (masked) at += 4;
    if (buffer.length < at + length) return undefined;
    const payload = Buffer.from(buffer.subarray(at, at + length)) as Buffer<ArrayBuffer>;
    if (masked) {
      const mask = buffer.subarray(maskAt, maskAt + 4);
      for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!;
    }
    this.buffer = buffer.subarray(at + length) as Buffer<ArrayBuffer>;
    return { fin, opcode, rsv1: (rsv & 0x40) !== 0, masked, payload };
  }
}

/** @returns one frame as bytes; `masked` for a client to a server. */
export function encodeFrame(
  opcode: number,
  payload: Buffer,
  options: { masked: boolean; fin?: boolean; rsv1?: boolean },
): Buffer {
  const fin = options.fin ?? true;
  const length = payload.length;
  let headSize = 10;
  if (length < 126) headSize = 2;
  else if (length < 65536) headSize = 4;
  const head = Buffer.alloc(headSize);
  head[0] = (fin ? 0x80 : 0) | (options.rsv1 === true ? 0x40 : 0) | (opcode & 0x0f);
  const masked = options.masked ? 0x80 : 0;
  let at = 2;
  if (length < 126) head[1] = masked | length;
  else if (length < 65536) {
    head[1] = masked | 126;
    head.writeUInt16BE(length, 2);
    at = 4;
  } else {
    head[1] = masked | 127;
    head.writeBigUInt64BE(BigInt(length), 2);
    at = 10;
  }
  if (!options.masked) return Buffer.concat([head, payload]);
  const mask = Buffer.from([1, 2, 3, 4].map(() => Math.floor(Math.random() * 256)));
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i]! ^= mask[i % 4]!;
  return Buffer.concat([head.subarray(0, at), mask, body]);
}

/** @returns `data` as one deflate message payload (trailer stripped). */
export function deflateMessage(data: Buffer): Buffer {
  const out = deflateRawSync(data, {
    level: 1,
    finishFlush: constants.Z_SYNC_FLUSH,
  });
  return out.length >= TRAILER.length && out.subarray(-4).equals(TRAILER)
    ? Buffer.from(out.subarray(0, out.length - 4))
    : Buffer.from(out);
}

/** @returns one deflate message payload, inflated. */
export function inflateMessage(data: Buffer): Buffer {
  if (data.length === 0) return Buffer.alloc(0);
  return inflateRawSync(Buffer.concat([data, TRAILER]), { finishFlush: constants.Z_SYNC_FLUSH });
}

/** Whether a header value offers or accepts the extension. */
export function offersDeflate(value: string | string[] | undefined): boolean {
  if (value === undefined) return false;
  const text = Array.isArray(value) ? value.join(",") : value;
  return text.split(",").some((entry) => entry.trim().toLowerCase().startsWith(DEFLATE_EXTENSION));
}

/** The extension value kivotos answers a client with when it compresses the client hop. */
export const SERVER_EXTENSION =
  "permessage-deflate; server_no_context_takeover; client_no_context_takeover";

/** One reassembled message, split back into frames as needed. */
class MessageReader {
  private readonly onMessage: (message: Message) => void;
  private opcode: number | undefined;
  private rsv1 = false;
  private parts: Buffer[] = [];
  private readonly onControl: (frame: Frame) => void;

  constructor(onMessage: (message: Message) => void, onControl: (frame: Frame) => void) {
    this.onMessage = onMessage;
    this.onControl = onControl;
  }

  frame(frame: Frame): void {
    if (frame.opcode >= OPCODE.close) {
      this.onControl(frame);
      return;
    }
    if (frame.opcode !== OPCODE.continuation) {
      if (this.opcode !== undefined) throw new Error("relay message started before the last ended");
      this.opcode = frame.opcode;
      this.rsv1 = frame.rsv1;
    } else if (this.opcode === undefined) {
      throw new Error("relay continuation without a message");
    }
    if (frame.payload.length > 0) this.parts.push(frame.payload);
    if (!frame.fin) return;
    const message: Message = {
      opcode: this.opcode ?? OPCODE.binary,
      rsv1: this.rsv1,
      data: Buffer.concat(this.parts),
    };
    this.opcode = undefined;
    this.rsv1 = false;
    this.parts = [];
    this.onMessage(message);
  }
}

/** How one hop is encoded; the other hop is the counterpart. */
export interface Hop {
  /** Frames from this side are masked (a client) or not (a server). */
  incoming: "client" | "server";
  /** Whether this hop's messages may arrive with RSV1 set (compressed). */
  inflate: boolean;
  /** Whether messages to this side are compressed. */
  deflate: boolean;
}

/** What the bridge did, for the trace log. */
export interface MuxStats {
  /** The mode: both compressed end to end, or only the client hop compressed. */
  mode: "end-to-end" | "client-hop" | "off";
  messagesIn: number;
  messagesOut: number;
  bytesIn: number;
  bytesOut: number;
  /** Messages compressed on the way out. */
  compressed: number;
}

export interface BridgeOptions {
  /** Compress messages of the downstream (upstream → client) direction above this size. */
  thresholdBytes?: number;
  /** Receives a failure; the bridge closes both sides. */
  note: (message: string, error: unknown) => void;
  /** Called once when the bridge stops. */
  done?: (stats: MuxStats) => void;
}

/**
 * Pump frames between the two ends, inflating what arrives compressed and
 * compressing what leaves toward the side that negotiated it.
 *
 * Only used when one hop negotiated the extension and the other did not;
 * when both did, `forwardUpgrade` pumps bytes unchanged and this never runs.
 */
export class MuxBridge {
  private readonly client: Duplex;
  private readonly upstream: Duplex;
  private readonly options: BridgeOptions;
  private readonly clientHop: Hop;
  private readonly upstreamHop: Hop;
  private readonly stats: MuxStats;
  private stopped = false;

  constructor(
    client: Duplex,
    upstream: Duplex,
    mode: "end-to-end" | "client-hop" | "off",
    options: BridgeOptions,
  ) {
    this.client = client;
    this.upstream = upstream;
    this.options = options;
    this.stats = { mode, messagesIn: 0, messagesOut: 0, bytesIn: 0, bytesOut: 0, compressed: 0 };
    // The client → upstream direction: the client hop may be compressed.
    // The upstream → client direction: the upstream hop may be compressed.
    this.clientHop = {
      incoming: "client",
      inflate: mode === "client-hop",
      deflate: mode === "client-hop",
    };
    this.upstreamHop = { incoming: "server", inflate: false, deflate: false };
  }

  start(): void {
    const clients = new MessageReader(
      (message) => this.forward(message, this.clientHop, this.upstreamHop, this.upstream),
      (frame) => this.control(frame, this.client, false),
    );
    const upstreams = new MessageReader(
      (message) => this.forward(message, this.upstreamHop, this.clientHop, this.client),
      (frame) => this.control(frame, this.upstream, true),
    );
    const clientFrames = new FrameReader(true, (frame) => {
      this.stats.bytesIn += frame.payload.length;
      this.guarded(() => clients.frame(frame));
    });
    const upstreamFrames = new FrameReader(false, (frame) => {
      this.guarded(() => upstreams.frame(frame));
    });
    this.client.on("data", (chunk: Buffer) => this.guarded(() => clientFrames.push(chunk)));
    this.upstream.on("data", (chunk: Buffer) => this.guarded(() => upstreamFrames.push(chunk)));
    this.client.on("end", () => this.stop());
    this.upstream.on("end", () => this.stop());
    this.client.on("error", () => this.stop());
    this.upstream.on("error", () => this.stop());
    this.client.on("close", () => this.stop());
    this.upstream.on("close", () => this.stop());
  }

  /** One data message one way: decode for `from`, encode for `to`. */
  private forward(message: Message, from: Hop, to: Hop, sink: Duplex): void {
    let data = message.data;
    if (from.inflate && message.rsv1) data = inflateMessage(data);
    this.stats.messagesIn++;
    const opcode = message.opcode;
    let rsv1 = false;
    if (to.deflate && data.length >= (this.options.thresholdBytes ?? COMPRESS_THRESHOLD)) {
      const compressed = deflateMessage(data);
      if (compressed.length < data.length) {
        data = compressed;
        rsv1 = true;
        this.stats.compressed++;
      }
    }
    this.stats.messagesOut++;
    this.stats.bytesOut += data.length;
    const frame = encodeFrame(opcode, data, {
      masked: to.incoming !== "client",
      rsv1,
    });
    this.write(sink, frame, to.incoming === "client" ? this.upstream : this.client);
  }

  /** Control frames pass through untouched; a close ends both sides. */
  private control(frame: Frame, sink: Duplex, towardClient: boolean): void {
    const masked = !towardClient;
    this.write(sink, encodeFrame(frame.opcode, frame.payload, { masked }), sink);
    if (frame.opcode === OPCODE.close) this.stop();
  }

  private write(sink: Duplex, bytes: Buffer, source: Duplex): void {
    if (this.stopped) return;
    if (!sink.write(bytes)) {
      source.pause();
      sink.once("drain", () => source.resume());
    }
  }

  private guarded(work: () => void): void {
    try {
      work();
    } catch (error) {
      this.options.note("kivotos: mux compression stopped", error);
      this.stop();
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.options.done?.(this.stats);
    this.client.destroy();
    this.upstream.destroy();
  }
}
