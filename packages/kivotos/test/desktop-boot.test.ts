import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { createContext, runInContext } from "node:vm";
import { guardDesktopBoot } from "../src/dsh/desktop.ts";
import { injectOwnsHost } from "../src/dsh/index-html.ts";

/** Text of the first inline script the transform put into an empty head. */
function scriptOf(html: string): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "no inline script");
  return match[1];
}

const GUARD = scriptOf(guardDesktopBoot("<head></head>", "/kivotos/peer/b").html);
const OWNS_HOST = scriptOf(injectOwnsHost("<head></head>"));
/** The tail script dsh's webServer renders into every index it serves. */
const READY_MARKUP = "(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()";
/**
 * dsh 0.2.0-rc.2's web entry (apps/web/src/main.ts) when the desktop shell is
 * present: install the shell's transport, apply its index rows, open the gate.
 */
const WEB_ENTRY = `"use strict";
const desktop = globalThis.dshDesktopBoot;
const gate = globalThis.__DSH_BOOT_READY__;
if (gate === undefined) throw new Error("desktop web: boot readiness is missing");
desktop.ready().then(async ({ injections, streamBaseUrl }) => {
  globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl };
  globalThis.applied = injections;
  gate.resolve();
}).catch((error) => { gate.reject(error); });`;

interface Page {
  run(source: string): unknown;
  global(name: string): unknown;
}

/** A mounted page's realm with an optional desktop shell bridge. */
function page(ready?: () => Promise<unknown>): Page {
  const context = createContext({ URL });
  if (ready !== undefined) {
    Object.defineProperty(context, "dshDesktopBoot", {
      value: Object.freeze({ ready, failed: async () => {} }),
      writable: false,
      configurable: false,
    });
  }
  return {
    run: (source) => runInContext(source, context),
    global: (name) => runInContext(`globalThis[${JSON.stringify(name)}]`, context),
  };
}

/** Load the mounted page in document order: guard, the peer's head and tail scripts, the entry. */
function load(target: Page): void {
  target.run(GUARD);
  target.run(OWNS_HOST);
  target.run(READY_MARKUP);
  target.run(WEB_ENTRY);
}

const LOCAL_ROWS = [{ kind: "script", placement: "head", text: "window.__ModuleLoader__={}" }];

test("a mounted page in the desktop app keeps its own boot and streams through the mount", async () => {
  const handshake = Promise.withResolvers<unknown>();
  const target = page(() => handshake.promise);
  load(target);

  // The peer's own tail script must not release the boot before the handshake.
  const gate = (target.global("__DSH_BOOT_READY__") as { promise: Promise<void> }).promise;
  const first = await Promise.race([gate.then(() => "released"), tick().then(() => "held")]);
  assert.equal(first, "held");

  handshake.resolve({ injections: LOCAL_ROWS, streamBaseUrl: "http://127.0.0.1:4000" });
  await (target.global("__DSH_BOOT_READY__") as { promise: Promise<void> }).promise;
  await tick();

  assert.equal(target.global("applied"), undefined, "the local Host's rows reached the page");
  const transport = target.global("__DSH_TRANSPORT__") as {
    ownsHost: boolean;
    streamBaseUrl: string;
  };
  assert.equal(transport.ownsHost, true);
  // How dsh's gateway derives its WebSocket (api/gateway stream-client.ts).
  assert.equal(
    new URL("api/remote.mux", transport.streamBaseUrl).href,
    "http://127.0.0.1:4000/kivotos/peer/b/api/remote.mux",
  );
});

test("a failed desktop handshake fails the mounted page's boot", async () => {
  const target = page(() => Promise.reject(new Error("Desktop Host is unavailable")));
  load(target);
  await assert.rejects(
    (target.global("__DSH_BOOT_READY__") as { promise: Promise<void> }).promise,
    /Desktop Host is unavailable/,
  );
});

test("without the desktop shell the guard leaves the page alone", () => {
  const target = page();
  target.run(GUARD);
  target.run(OWNS_HOST);
  assert.equal(target.global("__DSH_BOOT_READY__"), undefined);
  target.run('"use strict"; globalThis.__DSH_TRANSPORT__ = { streamBaseUrl: "http://x" }');
  assert.deepEqual(
    { ...(target.global("__DSH_TRANSPORT__") as object) },
    { streamBaseUrl: "http://x" },
  );
});

test("guardDesktopBoot runs first and cannot be broken out of by a prefix", () => {
  const html = '<head><script src="app.js"></script></head>';
  const out = guardDesktopBoot(html, "/kivotos/peer/b").html;
  assert.ok(out.startsWith("<head><script>"));
  assert.ok(out.indexOf("<script>") < out.indexOf('<script src="app.js">'));
  const hostile = guardDesktopBoot(
    "<head></head>",
    '/kivotos/peer/"</script><script>alert(1)//',
  ).html;
  assert.equal(hostile.split("</script>").length, 2);
});
