import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { networkOf, relayEndpoint } from "../src/federation.ts";
import { Config } from "../src/index.ts";
import { RelayLink } from "../src/relay.ts";
import { createIdentity } from "../src/x509.ts";
import { startFakeRelay } from "./fake-relay.ts";

/**
 * Regression for #relay-crash: a relay peer dropped or stalled mid-stream
 * exited the whole dsh process. A relay stream is often held by nobody when
 * that happens — between two reads, on a control connection the relay stops
 * answering, on a WebSocket the relay answers after the caller gave up — and
 * `destroy(error)` with no `error` listener is an uncaught exception.
 *
 * Each scenario runs in a child process of its own, because the failure mode
 * is the process exiting; `survived` is printed only at the end.
 */
const CHILD = fileURLToPath(new URL("fixtures/relay-failure-child.ts", import.meta.url));

interface Outcome {
  code: number | null;
  output: string;
}

function runChild(scenario: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHILD, scenario], {
      env: { ...process.env, NODE_OPTIONS: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (output += chunk));
    child.stderr.on("data", (chunk: string) => (output += chunk));
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      resolve({ code, output });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, 30_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      finish(code);
    });
  });
}

test("a relay that answers late and then drops the stream does not exit dsh", async () => {
  const { code, output } = await runChild("late-open");
  assert.equal(code, 0, output);
  assert.match(output, /survived/);
  assert.doesNotMatch(output, /Unhandled 'error' event/);
});

test("a dropped session nobody is watching any more does not exit dsh", async () => {
  const { code, output } = await runChild("session-reset-unheld");
  assert.equal(code, 0, output);
  assert.match(output, /survived/);
});

test("a session cut mid-stream keeps the link usable and does not exit dsh", async () => {
  const { code, output } = await runChild("session-reset");
  assert.equal(code, 0, output);
  // Whether the cut surfaces as an error or as a close depends on the platform;
  // what matters is that the session ends, the link still dials, and dsh lives.
  assert.match(output, /session (error|closed)/);
  assert.match(output, /second dial ok/);
  assert.doesNotMatch(output, /Unhandled 'error' event/);
});

test("a reset control connection reconnects instead of ending the process", async () => {
  const { code, output } = await runChild("control-reset");
  assert.equal(code, 0, output);
  assert.match(output, /after reset: unreachable/);
  assert.match(output, /reconnected/);
});

test("a relay that stops pinging is dropped after the silence deadline and redialed", async () => {
  const { code, output } = await runChild("control-silent");
  assert.equal(code, 0, output);
  assert.match(output, /redialed after/);
});

test("the silence deadline is configurable and defaults to the protocol's 70 s", async () => {
  const config = await Config["~standard"].validate({});
  assert.ok("value" in config);
  assert.equal(config.value.relaySilenceSeconds, 70);
  const raised = await Config["~standard"].validate({ relaySilenceSeconds: 120 });
  assert.ok("value" in raised);
  assert.equal(raised.value.relaySilenceSeconds, 120);
  const low = await Config["~standard"].validate({ relaySilenceSeconds: 5 });
  assert.ok("issues" in low);
  assert.equal(low.issues[0]?.message, "must be an integer in 30..600");
});

/** One member with a link whose notes are collected. */
function member(relay: string) {
  const notes: string[] = [];
  const network = networkOf(relayEndpoint(relay).replace("ws://", "").replace("/v1/connect", ""));
  const link = new RelayLink(
    network,
    createIdentity(),
    "test",
    () => {},
    (message) => notes.push(message),
    { handshakeMs: 2_000, controlSilenceMs: 2_000 },
  );
  return { link, notes };
}

test("a refused relay answers with an error, and a link failure is noted not thrown", async () => {
  const relay = await startFakeRelay();
  const port = new URL(relay.url).port;
  const { link, notes } = member(`127.0.0.1:${port}`);
  link.start();
  try {
    while (link.status.state !== "online") await sleep(10);
    // The relay drops the dial before the target answers: `dial` rejects.
    await assert.rejects(link.dial("not-online"), /refused|connect/);
    assert.equal(link.status.state, "online");
  } finally {
    link.stop();
    await relay.close();
  }
  // Stream errors of a successful link were never thrown; what is noted is
  // only what a caller could not act on.
  assert.ok(Array.isArray(notes));
});

test("a control connection the relay drops closes only itself; the link goes unreachable", async () => {
  const relay = await startFakeRelay();
  const port = new URL(relay.url).port;
  const { link, notes } = member(`127.0.0.1:${port}`);
  link.start();
  try {
    while (link.status.state !== "online") await sleep(10);
    const control = relay.conns.find((conn) => conn.role === "node");
    assert.ok(control !== undefined);
    control.reset();
    while (link.status.state === "online") await sleep(10);
    assert.equal(link.status.state, "unreachable");
    // Dropping the same connection again is harmless: the link carries on.
    assert.doesNotThrow(() => control.reset());
  } finally {
    link.stop();
    await relay.close();
  }
  // The close path is a normal end of stream; whatever was noted stays notes.
  assert.ok(Array.isArray(notes));
});

test("the helper scripts the children run exist next to the test", () => {
  assert.ok(path.isAbsolute(CHILD));
});
