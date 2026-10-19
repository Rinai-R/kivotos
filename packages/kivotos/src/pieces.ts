/**
 * Piece manifests: what one of this computer's dsh plugin batches is made of,
 * so the phone can put a batch together from pieces it already holds instead
 * of downloading the whole ~9 MB body again.
 *
 * A batch's URL changes whenever one of its rows' files changes (dsh revisions
 * rows by file metadata), but most of its bytes do not. A manifest names, for
 * every row, where it is served on its own, how many bytes it adds to the
 * batch and their SHA-256, then the batch's own last line, total size and
 * SHA-256. Every manifest is checked against the bytes the loopback dsh
 * serves before it is offered: when the rows do not add up to the batch byte
 * for byte, there is none, and the phone downloads the batch whole.
 */
import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { bootGraphOf } from "./dsh/index-html.ts";
import { PLUGIN_BATCH, splitMapLine } from "./dsh/web-server.ts";
import type { BodyAnswer } from "./proxy.ts";

/** The bytes one row adds to a batch. */
export interface Piece {
  /** Root-relative target serving the row on its own; its body starts with the piece. */
  path: string;
  bytes: number;
  sha256: string;
}

/** A batch as its pieces: their bytes in order, then {@link tail}, are the batch body. */
export interface PieceManifest {
  /** The batch, root-relative, as requested. */
  batch: string;
  /** The body's size and SHA-256, not content-encoded. */
  bytes: number;
  sha256: string;
  /** The response headers dsh sends with the batch. */
  contentType: string;
  cacheControl: string;
  pieces: Piece[];
  /** What follows the pieces: the batch's source-map line. */
  tail: string;
}

/** Why there is no manifest; `transient` when asking again may find one. */
export interface NoManifest {
  reason: string;
  transient: boolean;
}

/** A GET of a whole body on the loopback dsh, not content-encoded. */
export type LocalGet = (path: string, headers: IncomingHttpHeaders) => Promise<BodyAnswer>;

/** Batches whose outcome is kept: about three generations of one graph. */
const KEPT = 16;

/** Manifests of this computer's batches, each computed once. */
export class PieceManifests {
  private readonly get: LocalGet;
  /** Outcomes that hold for good, by batch; insertion order is age. */
  private readonly known = new Map<string, Promise<PieceManifest | NoManifest>>();

  constructor(get: LocalGet) {
    this.get = get;
  }

  /**
   * @param batch - root-relative batch target, as the phone requested it.
   * @returns its manifest, or why there is none.
   */
  manifest(batch: string): Promise<PieceManifest | NoManifest> {
    const known = this.known.get(batch);
    if (known !== undefined) return known;
    const outcome = this.compute(batch).catch(
      (error: unknown): NoManifest => ({
        reason: error instanceof Error ? error.message : String(error),
        transient: true,
      }),
    );
    // A batch URL names the same bytes for as long as this dsh runs, so a
    // manifest, or rows that do not add up, hold for good; the rest is asked again.
    this.known.set(batch, outcome);
    void outcome.then((settled) => {
      if ("reason" in settled && settled.transient) this.known.delete(batch);
      return undefined;
    });
    for (const key of this.known.keys()) {
      if (this.known.size <= KEPT) break;
      this.known.delete(key);
    }
    return outcome;
  }

  private async compute(batch: string): Promise<PieceManifest | NoManifest> {
    if (!PLUGIN_BATCH.test(batch)) return { reason: "not a plugin batch", transient: false };
    const index = await this.get("/", { accept: "text/html" });
    if (index.status !== 200) throw new Error(`the index answered ${index.status}`);
    const graph = bootGraphOf(index.body.toString("utf8")).graph;
    let rows: readonly string[] | undefined;
    for (const [url, own] of graph?.rows ?? []) if (rootTarget(url) === batch) rows = own;
    // Not memoised: a caller could fill the memo with made-up batches.
    if (rows === undefined) return { reason: "not a batch of the current graph", transient: true };
    const whole = await this.get(batch, { accept: "*/*" });
    if (whole.status !== 200) throw new Error(`the batch answered ${whole.status}`);
    const split = splitMapLine(whole.body);
    if (split === undefined)
      return { reason: "the batch has no source-map line", transient: false };
    const pieces: Piece[] = [];
    let offset = 0;
    for (const url of rows) {
      const path = rootTarget(url);
      if (path === undefined) return { reason: `row ${url} is not served here`, transient: false };
      const own = await this.get(path, { accept: "*/*" });
      if (own.status !== 200) throw new Error(`row ${path} answered ${own.status}`);
      const piece = splitMapLine(own.body)?.rows;
      if (
        piece === undefined ||
        !split.rows.subarray(offset, offset + piece.length).equals(piece)
      ) {
        return { reason: `row ${path} is not the batch's bytes at ${offset}`, transient: false };
      }
      pieces.push({ path, bytes: piece.length, sha256: sha256(piece) });
      offset += piece.length;
    }
    if (offset !== split.rows.length) {
      return { reason: "the rows do not add up to the batch", transient: false };
    }
    return {
      batch,
      bytes: whole.body.length,
      sha256: sha256(whole.body),
      contentType: String(whole.headers["content-type"] ?? ""),
      cacheControl: String(whole.headers["cache-control"] ?? ""),
      pieces,
      tail: split.tail.toString("utf8"),
    };
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A document-relative graph URL against the index at `/`, as a request target. */
function rootTarget(reference: string): string | undefined {
  const url = new URL(reference, "http://dsh/");
  return url.origin === "http://dsh" ? `${url.pathname}${url.search}` : undefined;
}
