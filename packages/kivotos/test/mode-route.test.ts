import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AttentionHub } from "../src/attention-hub.ts";
import { MountCache } from "../src/cache.ts";
import type { HostContext, WebRoute } from "../src/dsh.ts";
import { PeerRoutes } from "../src/index.ts";
import { machineIdOf } from "../src/machine-book.ts";
import type { MachineInfo } from "../src/machines.ts";
import type { Upstream } from "../src/proxy.ts";
import { TraceLog } from "../src/trace.ts";

const NODE_H = "hHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHh";
const ID_H = machineIdOf(NODE_H);

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

/**
 * A link's end of machine H: it answers every request with its own name;
 * `/stream` starts with it and stays open, like dsh's event streams.
 */
function machineH(link: string): Promise<{ port: number; close: () => void }> {
  return serve((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    if (req.url === "/stream") res.write(link);
    else res.end(link);
  });
}

function upstreamOf(port: number): Upstream {
  return { host: "127.0.0.1", port, authority: `127.0.0.1:${port}`, hop: true };
}

/** A Host with Kivotos' peer routes on a real HTTP server, H reachable over both links. */
async function host(file: string, dir: string, links: { tailnet: number; relay: number }) {
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
  const peers = new PeerRoutes(ctx, trace, cache, hub, { file, retentionMs: 86_400_000 });
  peers.load();
  await peers.settled();
  const disposeList = peers.registerList();
  const base = { id: "lab-h", node: NODE_H, name: "lab-h", os: "macOS", state: "online" as const };
  peers.update(
    "tailscale",
    [{ ...base, key: "static:lab-h", pinned: true, target: upstreamOf(links.tailnet) }],
    { state: "offline" },
  );
  peers.update("relay", [{ ...base, key: `relay:${NODE_H}`, target: upstreamOf(links.relay) }], {
    state: "offline",
  });
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
  return {
    fence,
    settled: () => peers.settled(),
    setMode: (body: string) =>
      fetch(url("/kivotos/mode"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    /** The mode route answers only POST. */
    getMode: () => fetch(url("/kivotos/mode")),
    machineH: async (): Promise<MachineInfo | undefined> => {
      const list = (await (await fetch(url("/kivotos/peers"))).json()) as {
        machines: MachineInfo[];
      };
      return list.machines.find((machine) => machine.id === ID_H);
    },
    /** Which of H's links a page load through the mount reached. */
    load: async (): Promise<string> => (await fetch(url(`/kivotos/peer/${ID_H}/`))).text(),
    /** A long response through the mount: the link it runs over, and its reader. */
    stream: async () => {
      const response = await fetch(url(`/kivotos/peer/${ID_H}/stream`));
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const first = await reader.read();
      return { link: new TextDecoder().decode(first.value), reader };
    },
    close: () => {
      server.close();
      disposeList();
      peers.dispose();
      hub.close();
      cache.close();
    },
  };
}

test(
  "the mode route is fenced, checks its input, and moves the mount to the chosen link",
  { timeout: 10_000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kivotos-mode-"));
    const file = path.join(dir, "machines.json");
    const [tailnet, relay] = await Promise.all([machineH("tailnet"), machineH("relay")]);
    const links = { tailnet: tailnet.port, relay: relay.port };
    const g = await host(file, dir, links);
    try {
      assert.equal(await g.load(), "tailnet");

      // The fence comes first: an unauthenticated page changes nothing.
      g.fence.rejection = 401;
      assert.equal((await g.setMode(JSON.stringify({ machine: ID_H, mode: "relay" }))).status, 401);
      g.fence.rejection = 403;
      assert.equal((await g.getMode()).status, 403);
      g.fence.rejection = undefined;
      assert.equal((await g.machineH())?.mode, "auto");

      assert.equal((await g.getMode()).status, 405);
      for (const body of [
        "not json",
        JSON.stringify({ machine: ID_H }),
        JSON.stringify({ machine: ID_H, mode: "carrier-pigeon" }),
        JSON.stringify({ machine: 7, mode: "relay" }),
        JSON.stringify({ machine: ID_H, mode: "x".repeat(2048) }),
      ]) {
        assert.equal((await g.setMode(body)).status, 400, body.slice(0, 40));
      }
      const unknown = await g.setMode(JSON.stringify({ machine: "node-nobody", mode: "relay" }));
      assert.equal(unknown.status, 404);
      assert.equal((await g.machineH())?.mode, "auto");
      assert.equal(await g.load(), "tailnet");
      const open = await g.stream();
      assert.equal(open.link, "tailnet");

      const set = await g.setMode(JSON.stringify({ machine: ID_H, mode: "relay" }));
      assert.equal(set.status, 200);
      const answered = (await set.json()) as { machines: MachineInfo[] };
      assert.deepEqual(
        answered.machines.map((machine) => [machine.id, machine.mode, machine.route]),
        [[ID_H, "relay", "relay"]],
      );
      assert.equal(await g.load(), "relay");
      // Held to the relay: the stream still open over the tailnet is cut, not left running.
      await assert.rejects(open.reader.read());

      // Kept in machines.json; a restarted Host reaches H over the relay again.
      await g.settled();
      const stored = JSON.parse(await readFile(file, "utf8")) as { modes: unknown };
      assert.deepEqual(stored.modes, { [ID_H]: "relay" });
      g.close();
      const restarted = await host(file, dir, links);
      try {
        assert.equal((await restarted.machineH())?.mode, "relay");
        assert.equal(await restarted.load(), "relay");
      } finally {
        restarted.close();
      }
    } finally {
      g.close();
      tailnet.close();
      relay.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
