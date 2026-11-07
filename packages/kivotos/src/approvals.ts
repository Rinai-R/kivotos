/**
 * Answering an approval from the phone (#notification-approval).
 *
 * A notification offers 允许本次 / 拒绝 only when the approval maps to an exact
 * tool call: `approval/request` carries `callId` for the call it is deciding,
 * and the frame names that same call. Anything else — a question, an approval
 * with no call, a request that another answerer already took — gets a plain
 * reminder and the decision stays in the session's own page.
 *
 * The desk is the last answerer in dsh's chain. The UI answerers run first
 * (`next()`), so a browser that is open answers as usual; only when none did
 * (`unavailable`) and the ask names an exact call does the desk hold it for
 * the phone. An aborted request settles `cancelled` at once, so a turn never
 * waits on a phone that is not there for longer than the asker allows.
 */
import { randomUUID } from "node:crypto";
import type { ApprovalOutcome } from "./dsh.ts";

/** The slice of `approval/request` the desk reads. */
export interface ApprovalAsk {
  readonly id: string;
  readonly toolName: string;
  readonly callId?: string;
  readonly reason?: string;
}

/** One held ask. */
interface Held {
  callId: string;
  toolName: string;
  detail: string;
  decide: (outcome: ApprovalOutcome) => void;
  /** Unguessable token handed to clients; never the dsh id, which other answers may reuse. */
  token: string;
}

/** What the desk answers a decision with. */
export type DecideResult = "allowed-once" | "rejected" | "unknown" | "closed";

/**
 * The one answer that the phone can make, as the frame carries it.
 * Present only when the notification may show buttons.
 */
export interface Approvable {
  /** Opaque token for `POST /kivotos/approve`. */
  token: string;
  /** The exact tool call this decides. */
  callId: string;
  toolName: string;
}

/** How long a held ask stays decidable after it was raised (the phone may be asleep). */
export const APPROVAL_TTL_MS = 10 * 60_000;

export class ApprovalDesk {
  private readonly held = new Map<string, Held>();
  private readonly ttlMs: number;
  private stopped = false;

  constructor(ttlMs: number = APPROVAL_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Answer one `approval/request` as the last answerer.
   * @param ask - the request event, with the asker's abort signal.
   * @param next - the answerers before this one.
   * @returns the outcome, from another answerer, the phone, or fail-closed.
   */
  async ask(
    ask: ApprovalAsk & { readonly signal?: AbortSignal },
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    const earlier = await next();
    if (earlier !== "unavailable") return earlier;
    const signal = ask.signal;
    if (this.stopped || ask.callId === undefined || signal?.aborted === true) return earlier;
    return this.hold(ask, signal);
  }

  /** Hold one ask until the phone decides, it expires, or the asker aborts. */
  private hold(ask: ApprovalAsk, signal: AbortSignal | undefined): Promise<ApprovalOutcome> {
    const callId = ask.callId ?? "";
    const token = randomUUID();
    const { promise, resolve } = Promise.withResolvers<ApprovalOutcome>();
    // One settle: the first outcome wins, and every later call is a no-op.
    let finish = resolve;
    const settle = (outcome: ApprovalOutcome): void => {
      const once = finish;
      finish = (): void => undefined;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      this.held.delete(token);
      once(outcome);
    };
    const abort = (): void => settle("cancelled");
    // Not unref'd: the deadline must be able to fire even when nothing else
    // holds the event loop (the ask would otherwise wait forever).
    const timer = setTimeout(() => settle("unavailable"), this.ttlMs);
    signal?.addEventListener("abort", abort, { once: true });
    this.held.set(token, {
      callId,
      toolName: ask.toolName,
      detail: ask.reason ?? ask.toolName,
      decide: settle,
      token,
    });
    return promise;
  }

  /**
   * The notification button's answer.
   * @param token - the frame's token.
   * @param decision - allow this once, or reject.
   * @returns the outcome, `unknown` for a token this desk no longer holds.
   */
  decide(token: string, decision: "allow" | "deny"): DecideResult {
    const entry = this.held.get(token);
    if (entry === undefined) return "unknown";
    entry.decide(decision === "allow" ? "allowed-once" : "rejected");
    return decision === "allow" ? "allowed-once" : "rejected";
  }

  /** The held ask for that exact tool call, when the notification may offer buttons. */
  approvable(callId: string | undefined): Approvable | undefined {
    if (callId === undefined) return undefined;
    for (const entry of this.held.values()) {
      if (entry.callId === callId) return { token: entry.token, callId, toolName: entry.toolName };
    }
    return undefined;
  }

  /** Settle every held ask as `cancelled` (plugin unload). */
  dispose(): void {
    this.stopped = true;
    for (const entry of this.held.values()) entry.decide("cancelled");
    this.held.clear();
  }
}
