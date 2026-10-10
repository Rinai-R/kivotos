/**
 * Trace log: one JSON object per line, one file per day, under
 * `$DSH_HOME/kivotos/logs/trace-YYYY-MM-DD.jsonl`.
 *
 * It records how the tailnet listener serves the phone (and peer mounts):
 * admission, time to first byte, duration and size of every HTTP exchange,
 * every WebSocket and, at the `frames` level, every WebSocket frame. Paths are
 * logged without their query string so no credential ever reaches the file.
 */
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

/** What the trace log records. */
export type TraceLevel = "off" | "requests" | "frames";

/** Days of files kept; older ones are deleted when the log opens. */
const KEEP_DAYS = 7;
/** Per-day cap; past it the day's file gets one `trace.capped` record and nothing more. */
const MAX_BYTES_PER_DAY = 50 * 1024 * 1024;
const FILE = /^trace-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Sink for trace records. A disabled log accepts and drops everything. */
export class TraceLog {
  readonly level: TraceLevel;
  private readonly dir: string;
  private stream: WriteStream | undefined;
  private day = "";
  private written = 0;
  private capped = false;
  /** `open()` finished: the directory exists. Records before that are dropped. */
  private ready = false;
  private nextId = 0;

  constructor(dir: string, level: TraceLevel) {
    this.dir = dir;
    this.level = level;
  }

  /** Whether WebSocket frames are recorded. */
  get frames(): boolean {
    return this.level === "frames";
  }

  /** A short id that ties the records of one exchange together. */
  id(): string {
    this.nextId = (this.nextId + 1) % 1_000_000;
    return this.nextId.toString(36);
  }

  /**
   * Create the directory and delete files older than the retention window.
   * @param now - current time (tests pass a fixed one).
   */
  async open(now = new Date()): Promise<void> {
    if (this.level === "off") return;
    await mkdir(this.dir, { recursive: true });
    const oldest = dayOf(new Date(now.getTime() - KEEP_DAYS * 86_400_000));
    for (const name of await readdir(this.dir)) {
      const day = FILE.exec(name)?.[1];
      if (day !== undefined && day < oldest) await unlink(path.join(this.dir, name));
    }
    this.ready = true;
  }

  /**
   * Append one record. Dropped until `open()` has finished and after `close()`.
   * @param event - dotted event name, e.g. `http`, `ws.frame`.
   * @param fields - JSON-serializable details.
   * @param now - current time (tests pass a fixed one).
   */
  record(event: string, fields: Record<string, unknown>, now = new Date()): void {
    if (!this.ready) return;
    const day = dayOf(now);
    if (day !== this.day) this.rotate(day);
    if (this.capped || this.stream === undefined) return;
    const line = `${JSON.stringify({ ts: now.toISOString(), event, ...fields })}\n`;
    const size = Buffer.byteLength(line);
    if (this.written + size > MAX_BYTES_PER_DAY) {
      this.capped = true;
      this.stream.write(`${JSON.stringify({ ts: now.toISOString(), event: "trace.capped" })}\n`);
      return;
    }
    this.written += size;
    this.stream.write(line);
  }

  /** Flush and close the current file; later records are dropped. */
  close(): Promise<void> {
    this.ready = false;
    const stream = this.stream;
    this.stream = undefined;
    this.day = "";
    if (stream === undefined) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    stream.end(resolve);
    return promise;
  }

  private rotate(day: string): void {
    this.stream?.end();
    this.day = day;
    this.written = 0;
    this.capped = false;
    this.stream = createWriteStream(path.join(this.dir, `trace-${day}.jsonl`), { flags: "a" });
    // A full disk or a removed directory must not take the listener down.
    this.stream.on("error", () => {
      this.capped = true;
    });
  }
}

/** Local calendar day, so a file holds one day as the user reads the clock. */
function dayOf(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Path of a request URL without its query string.
 * @param url - request target, e.g. `/api/x?token=...`.
 * @returns pathname only.
 */
export function tracePath(url: string): string {
  const at = url.indexOf("?");
  return at === -1 ? url : url.slice(0, at);
}

/** One WebSocket frame header as seen on the wire. */
export interface WsFrame {
  /** 0 continuation, 1 text, 2 binary, 8 close, 9 ping, 10 pong. */
  opcode: number;
  fin: boolean;
  /** Payload bytes (still compressed when permessage-deflate is on). */
  length: number;
}

/**
 * Incremental parser of WebSocket frame headers (RFC 6455 §5.2). It only
 * reads headers and skips payloads, so it observes a stream without
 * buffering it. Masked (client) and unmasked (server) frames both parse.
 */
export class WsFrameReader {
  private readonly onFrame: (frame: WsFrame) => void;
  /** Header bytes collected so far (a header can span chunks). */
  private header: number[] = [];
  /** Payload bytes still to skip before the next header. */
  private skip = 0;

  constructor(onFrame: (frame: WsFrame) => void) {
    this.onFrame = onFrame;
  }

  push(chunk: Buffer): void {
    let at = 0;
    while (at < chunk.length) {
      if (this.skip > 0) {
        const step = Math.min(this.skip, chunk.length - at);
        this.skip -= step;
        at += step;
        continue;
      }
      this.header.push(chunk[at]);
      at += 1;
      this.tryHeader();
    }
  }

  private tryHeader(): void {
    const h = this.header;
    if (h.length < 2) return;
    const masked = (h[1] & 0x80) !== 0;
    const short = h[1] & 0x7f;
    // 7-bit length, or a marker for a 16-bit (126) or 64-bit (127) length that follows.
    const extra = ({ 126: 2, 127: 8 } as Record<number, number>)[short] ?? 0;
    const need = 2 + extra + (masked ? 4 : 0);
    if (h.length < need) return;
    let length = short;
    if (extra === 2) length = (h[2] << 8) | h[3];
    else if (extra === 8) {
      length = 0;
      // 2^53 bytes is far beyond any frame; Number keeps exact integers to there.
      for (let i = 2; i < 10; i++) length = length * 256 + h[i];
    }
    this.onFrame({ opcode: h[0] & 0x0f, fin: (h[0] & 0x80) !== 0, length });
    this.header = [];
    this.skip = length;
  }
}
