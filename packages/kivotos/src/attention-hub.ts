/**
 * The other machines' attention, gathered on this Host for its own pages.
 *
 * Every peer this Host mounts already serves its attention frames on its
 * tailnet listener (or relay session) as `/kivotos/events`. The hub holds one
 * subscription per mounted peer, folds the frames into one {@link AttentionBoard}
 * and serves the result on this Host's webServer as `/kivotos/attention`, so a
 * page needs one connection, not one per machine, and a frame that reaches it
 * through two mounts of the same machine is told once. This Host's own
 * Sessions are on that board too: the machine switcher shows them on the
 * current machine's row, and a finished turn in a Session that is not on
 * screen is visible without opening it.
 */
import type { ClientRequest, IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { AttentionFrame, AttentionTracker } from "./attention.ts";
import type { Via } from "./machines.ts";
import { forwardHeaders, upstreamRequest, type Upstream } from "./proxy.ts";
import { SseReader } from "./sse.ts";
import type { TraceLog } from "./trace.ts";

/** Finished or failed turns kept per machine until it is opened. */
const FINISHED_PER_PEER = 20;
/** Identities remembered for de-duplication (settled waits, told turns). */
const REMEMBERED = 2000;
/** The peer sends a comment every 25 s; silence beyond this means a dead link. */
const FEED_IDLE_MS = 70_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;
/** SSE comment interval towards the page. */
const HEARTBEAT_MS = 25_000;
const EVENTS_PATH = "/kivotos/events";

/** The board row of this Host's own Sessions; machine ids are never this. */
export const SELF_ID = "self";

/** One machine's row on the board. */
export interface PeerAttention {
  id: string;
  name: string;
  /** Approvals and questions still waiting, oldest first. */
  pending: AttentionFrame[];
  /** Finished and failed turns since the machine was last opened, oldest first. */
  finished: AttentionFrame[];
}

interface Waiting {
  frame: AttentionFrame;
  /** Mounts that reported it; the same machine can be mounted through two links. */
  peers: Set<string>;
}

/** Insertion-ordered set that forgets its oldest members past `limit`. */
function remember(set: Set<string>, value: string, limit = REMEMBERED): void {
  set.delete(value);
  set.add(value);
  if (set.size > limit) set.delete(set.values().next().value as string);
}

/**
 * What every mounted peer is waiting for or has finished. Frames are told
 * once by their identity (Session id plus key, which is unique across
 * machines), whichever mount delivers them first; `resolved` from any mount
 * settles a wait for good.
 */
export class AttentionBoard {
  /** Open waits by `sessionId\nkey`, oldest first. */
  private readonly waiting = new Map<string, Waiting>();
  private readonly finished = new Map<string, AttentionFrame[]>();
  /** Waits that were resolved: a late copy from a slower mount must not reopen them. */
  private readonly settled = new Set<string>();
  /** Turns already told, by `kind\nsessionId\nkey`. */
  private readonly told = new Set<string>();
  /** The Host process each peer's frames came from. */
  private readonly epochs = new Map<string, string>();
  /** Grows on every change of {@link view}. */
  version = 0;

  /**
   * Note the Host process a peer's stream speaks for. When it changed, that
   * process is gone and so are the waits it reported.
   */
  epoch(peer: string, epoch: string): void {
    const known = this.epochs.get(peer);
    if (known === epoch) return;
    this.epochs.set(peer, epoch);
    if (known !== undefined) this.release(peer);
  }

  /**
   * Fold one frame a peer's stream delivered.
   * @param live - the frame happened while this Host was following the peer;
   *   frames replayed from the peer's history update the board but are not news.
   * @returns the frame when it is news for the page (a new wait or turn to
   *   announce, or a `resolved` that withdraws one), undefined otherwise.
   */
  receive(peer: string, frame: AttentionFrame, live: boolean): AttentionFrame | undefined {
    this.epoch(peer, frame.epoch);
    const id = `${frame.sessionId}\n${frame.key}`;
    switch (frame.kind) {
      case "approval":
      case "question": {
        if (this.settled.has(id)) return undefined;
        const open = this.waiting.get(id);
        if (open !== undefined) {
          if (!open.peers.has(peer)) {
            open.peers.add(peer);
            this.version += 1;
          }
          return undefined;
        }
        this.waiting.set(id, { frame, peers: new Set([peer]) });
        this.version += 1;
        return live ? frame : undefined;
      }
      case "resolved":
        remember(this.settled, id);
        if (!this.waiting.delete(id)) return undefined;
        this.version += 1;
        return frame;
      case "done":
      case "failed": {
        const turn = `${frame.kind}\n${id}`;
        if (this.told.has(turn)) return undefined;
        remember(this.told, turn);
        if (!live) return undefined;
        const list = this.finished.get(peer) ?? [];
        list.push(frame);
        if (list.length > FINISHED_PER_PEER) list.shift();
        this.finished.set(peer, list);
        this.version += 1;
        return frame;
      }
      default:
        return undefined;
    }
  }

  /** The machine was opened: its finished turns are no longer news. */
  seen(peer: string): void {
    if (this.finished.delete(peer)) this.version += 1;
  }

  /**
   * Replay frames that happened before this board started listening,
   * without making any of them news: open waits, settled waits and the
   * finished turns a row should start with.
   */
  seed(peer: string, frames: readonly AttentionFrame[]): void {
    for (const frame of frames) {
      if (frame.kind !== "done" && frame.kind !== "failed") {
        this.receive(peer, frame, false);
        continue;
      }
      const turn = `${frame.kind}\n${frame.sessionId}\n${frame.key}`;
      if (this.told.has(turn)) continue;
      remember(this.told, turn);
      const list = this.finished.get(peer) ?? [];
      list.push(frame);
      if (list.length > FINISHED_PER_PEER) list.shift();
      this.finished.set(peer, list);
      this.version += 1;
    }
  }

  /** The peer is no longer mounted. */
  drop(peer: string): void {
    this.release(peer);
    this.epochs.delete(peer);
    if (this.finished.delete(peer)) this.version += 1;
  }

  /** @returns the rows of the given peers, in that order. */
  view(peers: readonly { id: string; name: string }[]): PeerAttention[] {
    const open = [...this.waiting.values()];
    return peers.map(({ id, name }) => ({
      id,
      name,
      pending: open.filter((wait) => wait.peers.has(id)).map((wait) => wait.frame),
      finished: this.finished.get(id) ?? [],
    }));
  }

  /** Forget the waits only this peer reported. */
  private release(peer: string): void {
    for (const [id, open] of this.waiting) {
      if (!open.peers.delete(peer)) continue;
      if (open.peers.size === 0) this.waiting.delete(id);
      this.version += 1;
    }
  }
}

/** What `/kivotos/attention` tells a page. */
export type HubEvent = { type: "state" } | { type: "notice"; peer: string; frame: AttentionFrame };

/** Which frames the pages raise system notifications for (plugin config). */
export interface NotifyConfig {
  /** Approvals and questions. */
  waiting: boolean;
  /** Finished and failed turns. */
  finished: boolean;
}

/** The data of a `state` event on `/kivotos/attention`. */
export interface AttentionState {
  notify: NotifyConfig;
  /** One row per mounted peer. */
  peers: PeerAttention[];
}

/** The data of a `notice` event: a frame that is news, and the mount that delivered it. */
export interface AttentionNotice {
  peer: string;
  frame: AttentionFrame;
}

/** A mounted peer as the hub follows it. */
export interface FollowedPeer {
  id: string;
  name: string;
  upstream: Upstream;
  /** The link {@link upstream} goes through, for the trace. */
  via: Via;
}

/** One peer's `/kivotos/events` subscription, reconnecting until stopped. */
class PeerFeed {
  private readonly hub: AttentionHub;
  private readonly peer: () => FollowedPeer;
  private epoch = "";
  private after = 0;
  private retryMs = RETRY_MIN_MS;
  private timer: NodeJS.Timeout | undefined;
  private request: ClientRequest | undefined;
  private stopped = false;

  constructor(hub: AttentionHub, peer: () => FollowedPeer) {
    this.hub = hub;
    this.peer = peer;
  }

  start(): void {
    const { id, upstream, via } = this.peer();
    const query = `epoch=${encodeURIComponent(this.epoch)}&after=${this.after}`;
    const headers = forwardHeaders({ accept: "text/event-stream" }, upstream);
    const opened = performance.now();
    let frames = 0;
    let status = 0;
    let error: string | undefined;
    const request = upstreamRequest(upstream, {
      method: "GET",
      path: `${EVENTS_PATH}?${query}`,
      headers,
    });
    this.request = request;
    request.setTimeout(FEED_IDLE_MS, () => request.destroy(new Error("idle")));
    request.on("response", (res) => {
      status = res.statusCode ?? 0;
      if (status !== 200) {
        res.resume();
        return;
      }
      res.setEncoding("utf8");
      const reader = new SseReader();
      // Frames before the peer's `live` marker are its history, replayed after our cursor.
      let live = false;
      res.on("data", (chunk: string) => {
        for (const event of reader.push(chunk)) {
          if (event.event === "live") {
            live = true;
            this.retryMs = RETRY_MIN_MS;
            const epoch = parseRecord(event.data)?.epoch;
            if (typeof epoch === "string") this.hub.epoch(id, epoch);
            continue;
          }
          if (event.event !== "attention") continue;
          const frame = parseFrame(event.data);
          if (frame === undefined) continue;
          frames += 1;
          this.epoch = frame.epoch;
          this.after = frame.id;
          this.hub.receive(id, frame, live);
        }
      });
    });
    request.on("error", (failure) => {
      error = failure.message;
    });
    request.on("close", () => {
      this.request = undefined;
      this.hub.traceFeed({
        peer: id,
        via,
        status,
        frames,
        durationMs: Math.round(performance.now() - opened),
        error,
      });
      if (this.stopped) return;
      this.timer = setTimeout(() => this.start(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    });
    request.end();
  }

  /** Drop the stream and open it again through the peer's upstream now, after the shortest retry. */
  reconnect(): void {
    if (this.stopped) return;
    this.retryMs = RETRY_MIN_MS;
    // The close handler opens it again; without a request, a retry is waiting.
    if (this.request !== undefined) this.request.destroy();
    else {
      clearTimeout(this.timer);
      this.start();
    }
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.request?.destroy();
  }
}

function parseRecord(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    // A malformed event from a peer is skipped, never thrown into the stream.
    return undefined;
  }
}

const KINDS: Record<AttentionFrame["kind"], true> = {
  approval: true,
  question: true,
  done: true,
  failed: true,
  resolved: true,
};

/** @returns the frame, or undefined when the data is not one. */
function parseFrame(text: string): AttentionFrame | undefined {
  const value = parseRecord(text);
  if (value === undefined) return undefined;
  const { id, epoch, kind, sessionId, title, key, detail, time } = value;
  if (typeof id !== "number" || typeof epoch !== "string" || !Object.hasOwn(KINDS, String(kind)))
    return undefined;
  if (typeof sessionId !== "string" || sessionId === "" || typeof key !== "string")
    return undefined;
  return {
    id,
    epoch,
    kind: kind as AttentionFrame["kind"],
    sessionId,
    title: typeof title === "string" ? title : "",
    key,
    detail: typeof detail === "string" ? detail : "",
    time: typeof time === "number" ? time : 0,
  };
}

/** Follows every mounted peer's attention stream and serves the board. */
export class AttentionHub {
  private readonly board = new AttentionBoard();
  private readonly feeds = new Map<string, { feed: PeerFeed; peer: () => FollowedPeer }>();
  /** Pages holding `/kivotos/attention` open. */
  private readonly pages = new Set<ServerResponse>();
  private readonly trace: TraceLog;
  private readonly notify: NotifyConfig;
  /** This Host's own attention, folded into the ${SELF_ID} row. */
  private readonly local:
    | { tracker: AttentionTracker; name: () => string; unsubscribe: () => void }
    | undefined;
  private announced = 0;
  private scheduled = false;

  /**
   * @param local - this Host's own attention, which the board shows as
   *   {@link SELF_ID}; its name is read when a page asks for the board.
   */
  constructor(
    trace: TraceLog,
    notify: NotifyConfig,
    local?: { tracker: AttentionTracker; name: () => string },
  ) {
    this.trace = trace;
    this.notify = notify;
    if (local === undefined) return;
    this.board.epoch(SELF_ID, local.tracker.epoch);
    this.board.seed(SELF_ID, local.tracker.since(0));
    const unsubscribe = local.tracker.subscribe((frame) => this.receive(SELF_ID, frame, true));
    this.local = { ...local, unsubscribe };
  }

  /**
   * Start following a mounted peer.
   * @param peer - reads the peer's current id, name and upstream.
   */
  follow(peer: () => FollowedPeer): void {
    const { id } = peer();
    if (this.feeds.has(id)) return;
    const feed = new PeerFeed(this, peer);
    this.feeds.set(id, { feed, peer });
    feed.start();
  }

  /** Stop following a peer that is no longer mounted, and drop its rows. */
  unfollow(id: string): void {
    this.feeds.get(id)?.feed.stop();
    this.feeds.delete(id);
    this.board.drop(id);
    this.changed();
  }

  /** A followed peer's route changed: follow it through the new link now. */
  reconnect(id: string): void {
    this.feeds.get(id)?.feed.reconnect();
  }

  /** A page opened this machine. */
  seen(id: string): void {
    this.board.seen(id);
    this.changed();
  }

  /** @internal Called by a feed. */
  epoch(peer: string, epoch: string): void {
    this.board.epoch(peer, epoch);
    this.changed();
  }

  /** @internal Called by a feed. */
  receive(peer: string, frame: AttentionFrame, live: boolean): void {
    const notice = this.board.receive(peer, frame, live);
    if (notice !== undefined) this.emit({ type: "notice", peer, frame: notice });
    this.changed();
  }

  /** @internal Called by a feed when its connection ends. */
  traceFeed(fields: Record<string, unknown>): void {
    this.trace.record("peer.events", fields);
  }

  /** The board as a page reads it. */
  state(): AttentionState {
    const peers = [...this.feeds.values()].map(({ peer }) => peer());
    const rows =
      this.local === undefined ? peers : [{ id: SELF_ID, name: this.local.name() }, ...peers];
    return { notify: this.notify, peers: this.board.view(rows) };
  }

  /**
   * Serve the board to one page as Server-Sent Events: a `state` event now
   * and after every change, a `notice` event for each frame that is news.
   */
  serve(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(this.format({ type: "state" }));
    this.pages.add(res);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    const stop = (): void => {
      clearInterval(heartbeat);
      this.pages.delete(res);
    };
    req.on("close", stop);
    res.on("close", stop);
  }

  /** Stop every feed and end every page's stream. */
  close(): void {
    this.local?.unsubscribe();
    for (const { feed } of this.feeds.values()) feed.stop();
    this.feeds.clear();
    for (const page of this.pages) page.end();
    this.pages.clear();
  }

  private format(event: HubEvent): string {
    const data = event.type === "state" ? this.state() : { peer: event.peer, frame: event.frame };
    return `event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  private emit(event: HubEvent): void {
    if (this.pages.size === 0) return;
    const chunk = this.format(event);
    for (const page of this.pages) page.write(chunk);
  }

  /** Send one `state` per burst of changes. */
  private changed(): void {
    if (this.board.version === this.announced || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.announced = this.board.version;
      this.emit({ type: "state" });
    });
  }
}
