import assert from "node:assert/strict";
import { test } from "node:test";
import { AttentionBoard } from "../src/attention-hub.ts";
import type { AttentionFrame, AttentionKind } from "../src/attention.ts";
import { SseReader } from "../src/sse.ts";

let next = 0;
function frame(kind: AttentionKind, sessionId: string, key: string, epoch = "e1"): AttentionFrame {
  next += 1;
  return { id: next, epoch, kind, sessionId, title: "", key, detail: "", time: next };
}

const PEERS = [
  { id: "b", name: "B" },
  { id: "b2", name: "B over relay" },
  { id: "c", name: "C" },
];

function counts(board: AttentionBoard): Record<string, [number, number]> {
  return Object.fromEntries(
    board.view(PEERS).map((row) => [row.id, [row.pending.length, row.finished.length]]),
  );
}

test("a wait reported by two mounts of one machine is news once and settles from either", () => {
  const board = new AttentionBoard();
  const ask = frame("approval", "s1", "a1");
  assert.equal(board.receive("b", ask, true), ask);
  assert.equal(board.receive("b2", { ...ask }, true), undefined);
  assert.deepEqual(counts(board), { b: [1, 0], b2: [1, 0], c: [0, 0] });

  const resolved = frame("resolved", "s1", "a1");
  assert.equal(board.receive("b2", resolved, true), resolved);
  // The slower mount's copies arrive after the wait settled: nothing reopens or repeats.
  assert.equal(board.receive("b", { ...ask }, true), undefined);
  assert.equal(board.receive("b", { ...resolved }, true), undefined);
  assert.deepEqual(counts(board), { b: [0, 0], b2: [0, 0], c: [0, 0] });
});

test("history replayed before the live marker updates the board but is not news", () => {
  const board = new AttentionBoard();
  assert.equal(board.receive("b", frame("approval", "s1", "a1"), false), undefined);
  assert.equal(board.receive("b", frame("question", "s2", "c1"), false), undefined);
  assert.equal(board.receive("b", frame("resolved", "s2", "c1"), false)?.kind, "resolved");
  assert.equal(board.receive("b", frame("done", "s3", "turn:1"), false), undefined);
  assert.deepEqual(counts(board), { b: [1, 0], b2: [0, 0], c: [0, 0] });
  // The same turn told live later (another mount catching up) stays old news.
  assert.equal(board.receive("b2", frame("done", "s3", "turn:1"), true), undefined);
  assert.deepEqual(counts(board), { b: [1, 0], b2: [0, 0], c: [0, 0] });
});

test("finished turns stay on their machine until it is opened", () => {
  const board = new AttentionBoard();
  const done = frame("done", "s1", "turn:3");
  assert.equal(board.receive("c", done, true), done);
  assert.equal(board.receive("c", frame("failed", "s2", "turn:1"), true)?.kind, "failed");
  assert.equal(board.receive("b2", { ...done }, true), undefined);
  assert.deepEqual(counts(board), { b: [0, 0], b2: [0, 0], c: [0, 2] });
  const before = board.version;
  board.seen("c");
  assert.ok(board.version > before);
  assert.deepEqual(counts(board), { b: [0, 0], b2: [0, 0], c: [0, 0] });
});

test("a peer's new Host process drops only the waits that peer alone reported", () => {
  const board = new AttentionBoard();
  board.receive("b", frame("approval", "s1", "a1"), true);
  board.receive("b", frame("question", "s2", "c1"), true);
  board.receive("b2", frame("question", "s2", "c1"), true);
  board.receive("c", frame("approval", "s9", "a9"), true);
  // b restarted: its live marker carries a new epoch before any frame of it.
  board.epoch("b", "e2");
  assert.deepEqual(counts(board), { b: [0, 0], b2: [1, 0], c: [1, 0] });
  // An unchanged epoch is not a restart.
  board.epoch("c", "e1");
  assert.deepEqual(counts(board), { b: [0, 0], b2: [1, 0], c: [1, 0] });
  // A frame of another epoch is a restart too.
  board.receive("c", frame("done", "s9", "turn:2", "e3"), true);
  assert.deepEqual(counts(board), { b: [0, 0], b2: [1, 0], c: [0, 1] });
});

test("an unmounted peer leaves the board", () => {
  const board = new AttentionBoard();
  board.receive("c", frame("approval", "s1", "a1"), true);
  board.receive("c", frame("done", "s2", "turn:1"), true);
  board.drop("c");
  assert.deepEqual(counts(board), { b: [0, 0], b2: [0, 0], c: [0, 0] });
});

test("the SSE reader splits events across chunks and line endings, and keeps bare markers", () => {
  const reader = new SseReader();
  const events = [
    ...reader.push(": ping\r"),
    ...reader.push('\nevent: attention\r\ndata: {"a":'),
    ...reader.push("1}\n\nevent: live\n"),
    ...reader.push("\ndata: one\ndata: two\r\r"),
  ];
  assert.deepEqual(events, [
    { event: "attention", data: '{"a":1}' },
    { event: "live", data: "" },
    { event: "message", data: "one\ntwo" },
  ]);
});
