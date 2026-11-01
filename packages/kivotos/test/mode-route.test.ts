import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AttentionHub } from "../src/attention-hub.ts";
import { MountCache } from "../src/cache.ts";
import { CompatWatch } from "../src/dsh/compat.ts";
import type { HostContext, WebRoute } from "../src/dsh.ts";
import { PeerRoutes } from "../src/index.ts";
import { machineIdOf } from "../src/machine-book.ts";
import { DEFAULT_ROUTE_MODE, type MachineInfo } from "../src/machines.ts";
import type { Upstream } from "../src/proxy.ts";
import { TraceLog } from "../src/trace.ts";

const NODE_H = "hHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHh";
const ID_H = machineIdOf(NODE_H);

/** The links a Host under test has, with the port its probe reaches the machine at. */
interface Links {
  tailscale?: number;
  relay?: number;
}

type Link = keyof Links;

/** A server on an ephemeral loopback port; returns its port and a closer. */
async function serve(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  const server = http.createServer(handler);
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return {
    port: address.port,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

/** A link's end of machine H: it answers every request with its own name. */
function machineH(link: string): Promise<{ port: number; close: () => void }> {
  return serve((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(link);
  });
}

function upstreamOf(port: number): Upstream {
  return { host: "127.0.0.1", port, authority: `127.0.0.1:${port}`, hop: true };
}

/**
 * A Host with Kivotos' peer routes on a real HTTP server, H reachable over the
 * links given. A link starts online and can be taken down and brought back
 * (`setLink`), which moves H's route by its mode and priority.
 */
async function host(file: string, dir: string, links: Links) {
  const routes = new Map<string, WebRoute>();
  const fence: { rejection: 401 | 403 | undefined } = { rejection: undefined };
  const ctx: HostContext = {
    webServer: {
      port: 0,
      register: (route) => {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
      registerUpgrade: () => () => undefined,
      tapIndex: () => () => undefined,
    },
    connection: {
      requestRejection: () => fence.rejection,
      authenticatedUrl: (base) => base,
    },
    logger: { info: () => undefined, warn: () => undefined },
    effect: () => undefined,
    get: () => undefined,
    on: () => () => undefined,
  };
  const trace = new TraceLog(dir, "off");
  const cache = new MountCache({ dir, maxBytes: 0, warm: false, trace, warn: () => undefined });
  const hub = new AttentionHub(trace, { waiting: false, finished: false });
  const peers = new PeerRoutes(ctx, trace, cache, hub, new CompatWatch(() => undefined), {
    file,
    retentionMs: 86_400_000,
  });
  peers.load();
  await peers.settled();
  const disposeList = peers.registerList();
  const base = { id: "lab-h", node: NODE_H, name: "lab-h", os: "macOS", state: "online" as const };
  const online = new Set<Link>(
    (["tailscale", "relay"] as const).filter((via) => links[via] !== undefined),
  );
  const publish = (via: Link): void => {
    const port = links[via];
    if (port === undefined) return;
    peers.update(
      via,
      online.has(via)
        ? [
            via === "tailscale"
              ? { ...base, key: "static:lab-h", pinned: true, target: upstreamOf(port) }
              : { ...base, key: `relay:${NODE_H}`, target: upstreamOf(port) },
          ]
        : [],
      { state: "unreachable", reason: "no-listener" },
    );
  };
  for (const via of online) publish(via);
  const server = await serve((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    const route =
      routes.get(pathname) ??
      [...routes.values()].find(
        (candidate) => candidate.kind === "prefix" && pathname.startsWith(`${candidate.path}/`),
      );
    if (route === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    void route.handler(req, res);
  });
  const url = (target: string): string => `http://127.0.0.1:${server.port}${target}`;
  let closed = false;
  return {
    fence,
    settled: () => peers.settled(),
    /** The mode route with a body of the test's own. */
    setModeRaw: (body: string) =>
      fetch(url("/kivotos/mode"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    /** Set H's mode, as the Settings dropdown does. */
    setMode: (mode: string) =>
      fetch(url("/kivotos/mode"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ machine: ID_H, mode }),
      }),
    /** The mode route answers only POST. */
    getMode: () => fetch(url("/kivotos/mode")),
    /** Take a link down, or bring it back, as the machine book would see it. */
    setLink: (via: Link, up: boolean): void => {
      if (links[via] === undefined) throw new Error(`no ${via} link`);
      if (up) online.add(via);
      else online.delete(via);
      publish(via);
    },
    machineH: async (): Promise<MachineInfo | undefined> => {
      const list = (await (await fetch(url("/kivotos/peers"))).json()) as {
        machines: MachineInfo[];
      };
      return list.machines.find((machine) => machine.id === ID_H);
    },
    /** Which of H's links a page load through the mount reached. */
    load: async (): Promise<string> => (await fetch(url(`/kivotos/peer/${ID_H}/`))).text(),
    /**
     * Stop everything, and wait for the Host's last `machines.json` write:
     * the file lives in the test's directory, and removing it while that
     * write lands fails with ENOTEMPTY on a loaded CI runner.
     */
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      // The wrapper's close stops the server and drops its connections.
      server.close();
      disposeList();
      peers.dispose();
      hub.close();
      cache.close();
      await peers.settled();
      await trace.close();
    },
  };
}

/** @returns a test directory removed once every writer in it is done. */
function removeDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

test(
  "the mode route is fenced, takes only the two priorities, and moves the mount",
  { timeout: 10_000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kivotos-mode-"));
    const file = path.join(dir, "machines.json");
    const [tailnet, relay] = await Promise.all([machineH("tailnet"), machineH("relay")]);
    const links = { tailscale: tailnet.port, relay: relay.port };
    const g = await host(file, dir, links);
    try {
      // No mode stored yet: the default, Tailscale first.
      assert.equal((await g.machineH())?.mode, DEFAULT_ROUTE_MODE);
      assert.equal((await g.machineH())?.route, "tailscale");
      assert.equal(await g.load(), "tailnet");

      // The fence comes first: an unauthenticated page changes nothing.
      g.fence.rejection = 401;
      assert.equal((await g.setMode("relay")).status, 401);
      g.fence.rejection = 403;
      assert.equal((await g.getMode()).status, 403);
      g.fence.rejection = undefined;

      assert.equal((await g.getMode()).status, 405);
      for (const body of [
        "not json",
        JSON.stringify({ machine: ID_H }),
        // The legacy mode is not accepted any more.
        JSON.stringify({ machine: ID_H, mode: "auto" }),
        JSON.stringify({ machine: ID_H, mode: "carrier-pigeon" }),
        JSON.stringify({ machine: 7, mode: "relay" }),
        JSON.stringify({ machine: ID_H, mode: "x".repeat(2048) }),
      ]) {
        assert.equal((await g.setModeRaw(body)).status, 400, body.slice(0, 40));
      }
      const unknown = await g.setModeRaw(JSON.stringify({ machine: "node-nobody", mode: "relay" }));
      assert.equal(unknown.status, 404);
      assert.equal((await g.machineH())?.mode, DEFAULT_ROUTE_MODE);
      assert.equal(await g.load(), "tailnet");

      const set = await g.setMode("relay");
      assert.equal(set.status, 200);
      const answered = (await set.json()) as { machines: MachineInfo[] };
      assert.deepEqual(
        answered.machines.map((machine) => [machine.id, machine.mode, machine.route]),
        [[ID_H, "relay", "relay"]],
      );
      assert.equal(await g.load(), "relay");

      // Kept in machines.json; a restarted Host reaches H over the relay again.
      await g.settled();
      const stored = JSON.parse(await readFile(file, "utf8")) as { modes: unknown };
      assert.deepEqual(stored.modes, { [ID_H]: "relay" });
      await g.close();
      const restarted = await host(file, dir, links);
      try {
        const restored = await restarted.machineH();
        assert.deepEqual([restored?.mode, restored?.route], ["relay", "relay"]);
        assert.equal(await restarted.load(), "relay");

        // Back to the default: nothing left to store, Tailscale preferred again.
        assert.equal((await restarted.setMode("tailscale")).status, 200);
        await restarted.settled();
        const back = JSON.parse(await readFile(file, "utf8")) as { modes: unknown };
        assert.deepEqual(back.modes, {});
        const tailscale = await restarted.machineH();
        assert.deepEqual([tailscale?.mode, tailscale?.route], ["tailscale", "tailscale"]);
        assert.equal(await restarted.load(), "tailnet");
      } finally {
        await restarted.close();
      }
    } finally {
      await g.close();
      tailnet.close();
      relay.close();
      await removeDir(dir);
    }
  },
);

test(
  "a machine falls back when its preferred link is down, and returns when it recovers",
  { timeout: 10_000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kivotos-fallback-"));
    const file = path.join(dir, "machines.json");
    const [tailnet, relay] = await Promise.all([machineH("tailnet"), machineH("relay")]);
    const g = await host(file, dir, { tailscale: tailnet.port, relay: relay.port });
    try {
      // Tailscale first: the tailnet listener.
      assert.equal((await g.machineH())?.route, "tailscale");
      assert.equal(await g.load(), "tailnet");

      // The listener goes: the default mode falls back to the relay.
      g.setLink("tailscale", false);
      assert.equal((await g.machineH())?.route, "relay");
      assert.equal(await g.load(), "relay");

      // Relay first with the listener gone: the relay, its preferred link.
      assert.equal((await g.setMode("relay")).status, 200);
      const relayFirst = await g.machineH();
      assert.deepEqual([relayFirst?.mode, relayFirst?.route], ["relay", "relay"]);
      assert.equal(await g.load(), "relay");

      // The listener is back; a relay-first machine still prefers the relay.
      g.setLink("tailscale", true);
      assert.equal((await g.machineH())?.route, "relay");

      // The relay goes: the relay-first machine falls back to the tailnet.
      g.setLink("relay", false);
      assert.equal((await g.machineH())?.route, "tailscale");
      assert.equal(await g.load(), "tailnet");
    } finally {
      await g.close();
      tailnet.close();
      relay.close();
      await removeDir(dir);
    }
  },
);

test("a machine with one link uses it whatever the mode says", { timeout: 10_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kivotos-single-"));
  const file = path.join(dir, "machines.json");
  const relay = await machineH("relay");
  const g = await host(file, dir, { relay: relay.port });
  try {
    // The default mode is kept for when the other link appears; the one link is used.
    const initial = await g.machineH();
    assert.deepEqual([initial?.mode, initial?.route], [DEFAULT_ROUTE_MODE, "relay"]);
    assert.equal(await g.load(), "relay");

    // Choosing either priority changes nothing: there is nothing to choose.
    assert.equal((await g.setMode("tailscale")).status, 200);
    assert.equal((await g.machineH())?.route, "relay");
    assert.equal((await g.setMode("relay")).status, 200);
    assert.equal((await g.machineH())?.route, "relay");
    assert.equal(await g.load(), "relay");

    // The default is not stored; the relay is.
    await g.settled();
    const stored = JSON.parse(await readFile(file, "utf8")) as { modes: unknown };
    assert.deepEqual(stored.modes, { [ID_H]: "relay" });
  } finally {
    await g.close();
    relay.close();
    await removeDir(dir);
  }
});
