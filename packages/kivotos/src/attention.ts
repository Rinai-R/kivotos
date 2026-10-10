/**
 * Attention events: approvals, user questions, and finished turns, derived
 * from the durable `session/event` feed of every Session on this Host —
 * including Sessions no browser has open — and fanned out to subscribers
 * (the Android app's event stream).
 *
 * Built only from logged events, so it needs no dsh service beyond the event
 * feed. The shapes follow dsh 0.2.0-rc.2 (`@deepseek-ai/dsh-session` and
 * `@deepseek-ai/dsh-user-approval` / `-user-questions`).
 */

/** What a frame tells the phone. */
export type AttentionKind = "approval" | "question" | "done" | "failed" | "resolved";

/** One frame of the attention stream. */
export interface AttentionFrame {
  /** Monotonic frame number within one {@link epoch}, for client-side de-duplication. */
  id: number;
  /** Identifies this Host process; ids restart from 1 when it changes. */
  epoch: string;
  kind: AttentionKind;
  sessionId: string;
  /** Current session title ("" before the first title). */
  title: string;
  /**
   * Waiting-item identity: the approval request id or the question call id.
   * A later `resolved` frame carries the same key; `done`/`failed` carry `turn:<n>`.
   */
  key: string;
  /** Human text: the approval reason or tool, the question, or the failure. */
  detail: string;
  time: number;
}

/** The slice of a dsh Session event the tracker reads. */
export interface SessionEventLike {
  type: string;
  time: number;
  data: unknown;
}

/** The slice of a dsh Session the tracker reads. */
export interface SessionLike {
  readonly id: string;
}

interface SessionState {
  title: string;
  /** Open approvals by request id. */
  approvals: Map<string, string>;
  /** Open questions by tool call id. */
  questions: Map<string, string>;
}

const ASK_USER_QUESTION = "ask_user_question";
/** Frames a reconnecting subscriber may replay. */
const HISTORY = 200;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The first question's text from logged `ask_user_question` arguments.
 * @param argumentsText - raw JSON arguments of the `tool/call`.
 * @returns the question text, or "" when unreadable.
 */
export function firstQuestion(argumentsText: string): string {
  try {
    const questions = record(JSON.parse(argumentsText)).questions;
    if (!Array.isArray(questions)) return "";
    const first = record(questions[0]);
    return text(first.header) || text(first.question);
  } catch {
    // Malformed model arguments never reached the tool: nothing to show.
    return "";
  }
}

/** Reads a Session's current title; returns undefined when unknown. */
export type TitleOf = (session: SessionLike) => string | null | undefined;

/** Derives attention frames from Session events and fans them out. */
export class AttentionTracker {
  private readonly titleOf: TitleOf;
  private readonly sessions = new Map<string, SessionState>();
  private readonly subscribers = new Set<(frame: AttentionFrame) => void>();
  private readonly history: AttentionFrame[] = [];
  private next = 1;
  /** Frame ids are only comparable within one Host process. */
  readonly epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * @param titleOf - current title of a session the tracker joined mid-log
   *   (its earlier `session/title` events happened before the plugin started).
   */
  constructor(titleOf: TitleOf = () => undefined) {
    this.titleOf = titleOf;
  }

  /** Frames still waiting for a decision or answer, across all sessions. */
  pending(): AttentionFrame[] {
    return this.history.filter(
      (frame) =>
        (frame.kind === "approval" &&
          this.sessions.get(frame.sessionId)?.approvals.has(frame.key)) ||
        (frame.kind === "question" && this.sessions.get(frame.sessionId)?.questions.has(frame.key)),
    );
  }

  /** @returns frames newer than `afterId`, oldest first. */
  since(afterId: number): AttentionFrame[] {
    return this.history.filter((frame) => frame.id > afterId);
  }

  /** @returns unsubscribe. */
  subscribe(listener: (frame: AttentionFrame) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Forget a session that left the store. */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Fold one appended Session event.
   * @param session - the session whose log grew.
   * @param event - the appended event.
   */
  observe(session: SessionLike, event: SessionEventLike): void {
    const state = this.state(session);
    const data = record(event.data);
    switch (event.type) {
      case "session/title":
        state.title = text(data.title);
        return;
      case "approval/asked": {
        const id = text(data.id);
        const detail = text(data.reason) || text(data.toolName);
        state.approvals.set(id, detail);
        this.emit("approval", session.id, id, detail, event.time);
        return;
      }
      case "approval/decided": {
        const id = text(data.id);
        if (!state.approvals.delete(id)) return;
        // 'unavailable' means no answerer was connected: the ask never waited.
        this.emit("resolved", session.id, id, text(data.outcome), event.time);
        return;
      }
      case "tool/call": {
        if (data.name !== ASK_USER_QUESTION) return;
        const callId = text(data.callId);
        const detail = firstQuestion(text(data.arguments));
        state.questions.set(callId, detail);
        this.emit("question", session.id, callId, detail, event.time);
        return;
      }
      case "tool/result": {
        const callId = text(record(data.message).toolCallId);
        if (!state.questions.has(callId)) return;
        // A pending result means the timed tool returned while the question
        // stays open for a late reply; anything else settles it.
        if (isPendingResult(record(data.message).content)) return;
        state.questions.delete(callId);
        this.emit("resolved", session.id, callId, "", event.time);
        return;
      }
      case "user/message": {
        const source = record(data.source);
        if (source.kind !== "user-question-reply") return;
        const callId = text(source.callId);
        if (!state.questions.delete(callId)) return;
        this.emit("resolved", session.id, callId, "", event.time);
        return;
      }
      case "turn/end":
        this.turnEnded(session.id, data, event.time);
        return;
      default:
    }
  }

  /**
   * A finished turn: success is `done`, a failure is `failed`. A user stop and
   * the closers the loop never emits live (crash recovery, fork seeds) are not news.
   */
  private turnEnded(sessionId: string, data: Record<string, unknown>, time: number): void {
    const reason = record(data.reason);
    const kind = text(reason.kind);
    if (kind === "interrupted" || kind === "forked" || kind === "aborted") return;
    const key = `turn:${String(data.turn)}`;
    if (kind === "completed" || kind === "max-tokens") this.emit("done", sessionId, key, "", time);
    else this.emit("failed", sessionId, key, text(record(reason.error).message) || kind, time);
  }

  private state(session: SessionLike): SessionState {
    let state = this.sessions.get(session.id);
    if (state === undefined) {
      state = { title: this.titleOf(session) ?? "", approvals: new Map(), questions: new Map() };
      this.sessions.set(session.id, state);
    }
    return state;
  }

  private emit(
    kind: AttentionKind,
    sessionId: string,
    key: string,
    detail: string,
    time: number,
  ): void {
    const frame: AttentionFrame = {
      id: this.next++,
      epoch: this.epoch,
      kind,
      sessionId,
      title: this.sessions.get(sessionId)?.title ?? "",
      key,
      detail,
      time,
    };
    this.history.push(frame);
    if (this.history.length > HISTORY) this.history.shift();
    for (const listener of this.subscribers) listener(frame);
  }
}

function isPendingResult(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  const block = content.map(record).find((item) => item.type === "text");
  if (block === undefined) return false;
  try {
    return record(JSON.parse(text(block.text))).pending === true;
  } catch {
    // A non-JSON result text is a failure message, never the pending payload.
    return false;
  }
}
