import assert from "node:assert/strict";
import { test } from "node:test";
import { AttentionTracker, firstQuestion, type AttentionFrame } from "../src/attention.ts";

const S = { id: "s1" };
let seq = 0;
const ev = (type: string, data: unknown) => ({ type, time: ++seq, data });

function record(tracker: AttentionTracker): AttentionFrame[] {
  const frames: AttentionFrame[] = [];
  tracker.subscribe((frame) => frames.push(frame));
  return frames;
}

test("an approval waits until decided, then resolves under the same key", () => {
  const tracker = new AttentionTracker();
  const frames = record(tracker);
  tracker.observe(S, ev("session/title", { title: "Fix login" }));
  tracker.observe(S, ev("approval/asked", { id: "a1", toolName: "bash", reason: "rm -rf build" }));
  assert.deepEqual(
    tracker.pending().map((f) => f.key),
    ["a1"],
  );
  tracker.observe(S, ev("approval/decided", { id: "a1", outcome: "allowed-once" }));
  assert.deepEqual(
    frames.map((f) => [f.kind, f.key, f.title, f.detail]),
    [
      ["approval", "a1", "Fix login", "rm -rf build"],
      ["resolved", "a1", "Fix login", "allowed-once"],
    ],
  );
  assert.deepEqual(tracker.pending(), []);
});

test("a question resolves on a final tool result or a late reply, not on a pending result", () => {
  const tracker = new AttentionTracker();
  const frames = record(tracker);
  const args = JSON.stringify({ questions: [{ id: "q", question: "Which branch?" }] });
  tracker.observe(S, ev("tool/call", { callId: "c1", name: "ask_user_question", arguments: args }));
  tracker.observe(
    S,
    ev("tool/result", {
      message: { toolCallId: "c1", content: [{ type: "text", text: '{"pending":true}' }] },
    }),
  );
  assert.equal(tracker.pending().length, 1, "a timed-out ask stays open for a late reply");
  tracker.observe(
    S,
    ev("user/message", { source: { kind: "user-question-reply", callId: "c1" }, content: [] }),
  );
  assert.deepEqual(
    frames.map((f) => [f.kind, f.key, f.detail]),
    [
      ["question", "c1", "Which branch?"],
      ["resolved", "c1", ""],
    ],
  );
  assert.deepEqual(tracker.pending(), []);
});

test("other tool calls and unknown resolutions produce nothing", () => {
  const tracker = new AttentionTracker();
  const frames = record(tracker);
  tracker.observe(S, ev("tool/call", { callId: "c2", name: "bash", arguments: "{}" }));
  tracker.observe(S, ev("tool/result", { message: { toolCallId: "c2", content: [] } }));
  tracker.observe(S, ev("approval/decided", { id: "never-asked", outcome: "rejected" }));
  assert.deepEqual(frames, []);
});

test("turn ends: success is done, failure is failed, a user stop and replay closers are silent", () => {
  const tracker = new AttentionTracker();
  const frames = record(tracker);
  tracker.observe(S, ev("turn/end", { turn: 1, reason: { kind: "completed" } }));
  tracker.observe(
    S,
    ev("turn/end", { turn: 2, reason: { kind: "error", error: { message: "rate limited" } } }),
  );
  tracker.observe(S, ev("turn/end", { turn: 3, reason: { kind: "aborted", reason: {} } }));
  tracker.observe(S, ev("turn/end", { turn: 4, reason: { kind: "interrupted" } }));
  tracker.observe(S, ev("turn/end", { turn: 5, reason: { kind: "forked" } }));
  assert.deepEqual(
    frames.map((f) => [f.kind, f.key, f.detail]),
    [
      ["done", "turn:1", ""],
      ["failed", "turn:2", "rate limited"],
    ],
  );
});

test("since() replays only newer frames, so a reconnect does not notify twice", () => {
  const tracker = new AttentionTracker();
  tracker.observe(S, ev("turn/end", { turn: 1, reason: { kind: "completed" } }));
  tracker.observe(S, ev("turn/end", { turn: 2, reason: { kind: "completed" } }));
  const [first, second] = tracker.since(0);
  assert.deepEqual(
    tracker.since(first.id).map((f) => f.id),
    [second.id],
  );
  assert.deepEqual(tracker.since(second.id), []);
  assert.equal(first.epoch, tracker.epoch);
  assert.notEqual(
    new AttentionTracker().epoch,
    tracker.epoch,
    "a new Host process has a new epoch",
  );
});

test("a session joined mid-log takes its current title from the title source", () => {
  const tracker = new AttentionTracker((session) => (session.id === "s1" ? "Deploy" : null));
  const frames = record(tracker);
  tracker.observe(S, ev("turn/end", { turn: 1, reason: { kind: "completed" } }));
  tracker.observe({ id: "s2" }, ev("turn/end", { turn: 1, reason: { kind: "completed" } }));
  assert.deepEqual(
    frames.map((f) => f.title),
    ["Deploy", ""],
  );
});

test("firstQuestion prefers the header and survives malformed arguments", () => {
  assert.equal(
    firstQuestion(JSON.stringify({ questions: [{ header: "Branch", question: "Which?" }] })),
    "Branch",
  );
  assert.equal(firstQuestion("{not json"), "");
  assert.equal(firstQuestion(JSON.stringify({ questions: "nope" })), "");
});
