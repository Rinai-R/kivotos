/**
 * Runs one relay failure in a process of its own, so the test can see whether
 * the failure takes the whole process down (an unhandled `error` event or
 * rejection exits Node). Prints `survived` and exits 0 when it does not.
 *
 * Usage: node relay-failure-child.ts <scenario>
 */
import { setTimeout as sleep } from "node:timers/promises";
import { networkOf } from "../../src/federation.ts";
import { RelayLink } from "../../src/relay.ts";
import { createIdentity } from "../../src/x509.ts";
import { startFakeRelay, type FakeRelay } from "../fake-relay.ts";

const scenario = process.argv[2];
const TIMINGS = { handshakeMs: 300, controlSilenceMs: 2_000 };
const warnings: string[] = [];

function member(relay: FakeRelay, network: ReturnType<typeof networkOf>, name: string): RelayLink {
  return new RelayLink(
    network,
    createIdentity(),
    name,
    (socket) => {
      // What RelayHost does with a session: serve it, drop it on error.
      socket.on("error", () => socket.destroy());
      socket.on("data", (chunk: Buffer) => socket.write(chunk));
    },
    (message, error) => warnings.push(`${message}: ${String(error)}`),
    TIMINGS,
  );
}

async function online(link: RelayLink): Promise<void> {
  link.start();
  while (link.status.state !== "online") await sleep(10);
}

const relay = await startFakeRelay(
  scenario === "late-open" ? { upgradeDelayMs: 600 } : {},
);
const network = networkOf(relay.url.replace("ws://", "").replace("/v1/connect", ""));
network.relay = relay.url;

if (scenario === "late-open") {
  // The relay answers the upgrade after the hello's deadline: the stream opens
  // with nobody holding it, then the relay drops it.
  const link = member(relay, network, "a");
  await link.peers().then(
    () => console.log("peers answered"),
    (error: unknown) => console.log(`peers failed: ${String(error)}`),
  );
  // The upgrade is answered at 600 ms; nobody says hello on it any more.
  await sleep(500);
  const late = relay.conns.at(-1);
  if (late === undefined) throw new Error("no connection reached the relay");
  late.reset();
} else if (scenario === "session-reset") {
  // A secured session between two members; the relay cuts the dialing side mid-stream.
  const a = member(relay, network, "a");
  const b = member(relay, network, "b");
  await Promise.all([online(a), online(b)]);
  const dialed = relay.hello("dial");
  const socket = await a.dial(b.node);
  socket.on("error", (error) => console.log(`session error: ${error.message}`));
  socket.write("x".repeat(1 << 16));
  (await dialed).reset();
  await sleep(300);
  // The link still works for a new session.
  const again = await a.dial(b.node);
  again.on("error", () => again.destroy());
  console.log("second dial ok");
  again.destroy();
  a.stop();
  b.stop();
} else if (scenario === "session-reset-unheld") {
  // A dial whose session nobody watches any more (an idle pooled socket): the
  // relay cuts it.
  const a = member(relay, network, "a");
  const b = member(relay, network, "b");
  await Promise.all([online(a), online(b)]);
  const dialed = relay.hello("dial");
  const socket = await a.dial(b.node);
  socket.removeAllListeners("error");
  (await dialed).reset();
  await sleep(300);
  a.stop();
  b.stop();
} else if (scenario === "control-reset") {
  // The control connection is cut; the link must reconnect, not exit.
  const a = member(relay, network, "a");
  await online(a);
  relay.conns.find((conn) => conn.role === "node")?.reset();
  await sleep(100);
  console.log(`after reset: ${a.status.state}`);
  while (a.status.state !== "online") await sleep(20);
  console.log("reconnected");
  a.stop();
} else if (scenario === "control-silent") {
  // The relay stops answering on the control connection: past the silence
  // deadline the link drops it and reconnects.
  let silent = true;
  const quiet = await startFakeRelay({
    onHello: (conn, hello) => {
      if (hello.role === "node" && silent) {
        silent = false;
        conn.send(Buffer.from(`${JSON.stringify({ ok: true })}\n`));
        return false;
      }
      return undefined;
    },
  });
  network.relay = quiet.url;
  const a = member(quiet, network, "a");
  await online(a);
  const started = Date.now();
  while (quiet.conns.filter((conn) => conn.role === "node").length < 2) await sleep(20);
  console.log(`redialed after ${Math.round((Date.now() - started) / 100) / 10} s`);
  a.stop();
  await quiet.close();
} else {
  console.log(`unknown scenario ${scenario}`);
  process.exit(2);
}

await sleep(500);
await relay.close();
console.log(`warnings: ${warnings.length}`);
console.log("survived");
process.exit(0);
