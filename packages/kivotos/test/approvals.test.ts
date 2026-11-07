import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { AttentionTracker } from "../src/attention.ts";
import { ApprovalDesk } from "../src/approvals.ts";
import { serveApprove } from "../src/index.ts";
import type { ApprovalOutcome } from "../src/dsh.ts";

const ASK = {
  id: "approval-1",
  toolName: "bash",
  callId: "call-1",
  reason: "run a command",
};

/** Run `approval/ask` for an ask whose earlier answerers answer `earlier`. */
function ask(desk: ApprovalDesk, earlier: ApprovalOutcome, signal?: AbortSignal) {
  return desk.ask({ ...ASK, ...(signal === undefined ? {} : { signal }) }, () =>
    Promise.resolve(earlier),
  );
}

test("an ask another answerer decided never reaches the phone", async () => {
  const desk = new ApprovalDesk();
  assert.equal(await ask(desk, "allowed-once"), "allowed-once");
  assert.equal(await ask(desk, "rejected"), "rejected");
  assert.equal(desk.approvable("call-1"), undefined);
});

test("an ask with no exact tool call is a reminder only and fails closed", async () => {
  const desk = new ApprovalDesk();
  const outcome = await desk.ask({ id: "a", toolName: "bash", reason: "why" }, () =>
    Promise.resolve("unavailable"),
  );
  assert.equal(outcome, "unavailable");
  assert.equal(desk.approvable(undefined), undefined);
});

test("a held ask maps to its exact call, and the phone decides it once", async () => {
  const desk = new ApprovalDesk();
  const answered = ask(desk, "unavailable");
  await sleep(10);
  const approvable = desk.approvable("call-1");
  assert.ok(approvable !== undefined);
  assert.equal(approvable.callId, "call-1");
  assert.equal(approvable.toolName, "bash");
  // Another call in the same session is not this ask.
  assert.equal(desk.approvable("call-2"), undefined);
  assert.equal(desk.decide(approvable.token, "allow"), "allowed-once");
  assert.equal(await answered, "allowed-once");
  // A second tap on the same notification is stale.
  assert.equal(desk.decide(approvable.token, "deny"), "unknown");
  assert.equal(desk.approvable("call-1"), undefined);
});

test("deny answers rejected, and an abandoned ask settles cancelled", async () => {
  const desk = new ApprovalDesk();
  const denied = ask(desk, "unavailable");
  await sleep(5);
  const token = desk.approvable("call-1")?.token ?? "";
  assert.equal(desk.decide(token, "deny"), "rejected");
  assert.equal(await denied, "rejected");

  const abort = new AbortController();
  const abandoned = ask(desk, "unavailable", abort.signal);
  await sleep(5);
  abort.abort();
  assert.equal(await abandoned, "cancelled");
  assert.equal(desk.approvable("call-1"), undefined);
});

test("an ask the phone never answers expires fail-closed, and unload settles it", async () => {
  const desk = new ApprovalDesk(50);
  const expired = ask(desk, "unavailable");
  assert.equal(await expired, "unavailable");
  assert.equal(desk.approvable("call-1"), undefined);

  const live = new ApprovalDesk();
  const held = ask(live, "unavailable");
  await sleep(5);
  live.dispose();
  assert.equal(await held, "cancelled");
});

test("only an approval that maps to a call carries the action in its frame", async () => {
  // A short deadline: the held ask is never answered here, and the test must
  // not keep the process (or the runner) waiting for the default 10 minutes.
  const desk = new ApprovalDesk(100);
  const tracker = new AttentionTracker(
    () => "Session",
    (callId) => desk.approvable(callId),
  );
  const frames: unknown[] = [];
  tracker.subscribe((frame) => frames.push(frame));
  const session = { id: "s1" };
  // Held ask: buttons.
  void desk.ask({ ...ASK }, () => Promise.resolve("unavailable"));
  await sleep(5);
  tracker.observe(session, {
    type: "approval/asked",
    time: 1,
    data: { id: "approval-1", toolName: "bash", callId: "call-1", reason: "run a command" },
  });
  // No call, or no held ask: reminder only.
  tracker.observe(session, {
    type: "approval/asked",
    time: 2,
    data: { id: "approval-2", toolName: "bash", callId: "call-2", reason: "another" },
  });
  tracker.observe(session, {
    type: "approval/asked",
    time: 3,
    data: { id: "approval-3", toolName: "bash", reason: "no call" },
  });
  tracker.observe(session, {
    type: "tool/call",
    time: 4,
    data: {
      callId: "q1",
      name: "ask_user_question",
      arguments: '{"questions":[{"question":"go?"}]}',
    },
  });
  const first = frames[0] as { approval?: { callId: string; token: string } };
  assert.equal(first.approval?.callId, "call-1");
  assert.ok((first.approval?.token ?? "").length > 8);
  for (const frame of frames.slice(1)) {
    assert.equal((frame as { approval?: unknown }).approval, undefined);
  }
  desk.dispose();
});

/** A fake response that collects the JSON body it was sent. */
function fakeResponse() {
  const out = { status: 0, body: "" };
  const res = {
    writeHead(status: number) {
      out.status = status;
      return res;
    },
    end(body?: string) {
      out.body = body ?? "";
    },
  } as unknown as ServerResponse;
  return { res, out };
}

async function callApprove(desk: ApprovalDesk, method: string, body: unknown) {
  const { res, out } = fakeResponse();
  await serveApprove(desk, { method } as IncomingMessage, res, () => Promise.resolve(body));
  return { status: out.status, body: out.body === "" ? undefined : JSON.parse(out.body) };
}

test("the approve route answers only the exact held token", async () => {
  const desk = new ApprovalDesk();
  const held = ask(desk, "unavailable");
  await sleep(5);
  const token = desk.approvable("call-1")?.token ?? "";
  assert.deepEqual(await callApprove(desk, "POST", { token, decision: "allow" }), {
    status: 200,
    body: { outcome: "allowed-once" },
  });
  assert.equal(await held, "allowed-once");
  assert.deepEqual(await callApprove(desk, "POST", { token, decision: "allow" }), {
    status: 404,
    body: { error: "no such approval" },
  });
  assert.equal((await callApprove(desk, "POST", { token: "x", decision: "maybe" })).status, 400);
  assert.equal((await callApprove(desk, "GET", {})).status, 405);
});
