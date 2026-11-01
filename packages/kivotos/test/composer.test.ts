import assert from "node:assert/strict";
import { test } from "node:test";
import { plainEnter, type ComposerKey } from "../src/dsh/frame.ts";

/** A composer keydown that differs from a plain Enter only where a test says. */
function key(overrides: Partial<ComposerKey> = {}): ComposerKey {
  return { key: "Enter", ...overrides };
}

test("a phone's plain Enter asks dsh for a line break, not a send", () => {
  assert.equal(plainEnter(key()), true);
});

test("Shift+Enter keeps dsh's own line break", () => {
  assert.equal(plainEnter(key({ shiftKey: true })), false);
});

test("the chords dsh sends or steers with keep their meaning", () => {
  assert.equal(plainEnter(key({ ctrlKey: true })), false);
  assert.equal(plainEnter(key({ altKey: true })), false);
  assert.equal(plainEnter(key({ metaKey: true })), false);
});

test("an Enter that commits an IME composition is left to dsh", () => {
  assert.equal(plainEnter(key({ isComposing: true })), false);
});

test("keys other than Enter are left to dsh", () => {
  assert.equal(plainEnter({ key: "a" }), false);
  assert.equal(plainEnter({ key: "Tab" }), false);
});
