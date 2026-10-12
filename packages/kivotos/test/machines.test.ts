import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MachineBook,
  machineIdOf,
  probeFailure,
  tellingReason,
  type Sighting,
} from "../src/machine-book.ts";
import {
  addPhoneMachines,
  applyPhoneProbe,
  leavePhoneNetwork,
  statusOf,
  tailnetDownOnPhone,
  type PhoneMachine,
  type PhoneProbe,
} from "../src/machines.ts";

const NODE_H = "hHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHh";
const NODE_I = "iIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIi";
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 13, 12);

function tailnetH(state: Sighting<string>["state"], extra: Partial<Sighting<string>> = {}) {
  return {
    key: "static:lab-h",
    id: "lab-h",
    name: "lab-h",
    os: "",
    address: "100.64.0.1:17398",
    pinned: true,
    state,
    ...extra,
  };
}

function relayOf(node: string, state: Sighting<string>["state"], name = "mac") {
  return { key: `relay:${node}`, id: machineIdOf(node), node, name, os: "macOS", state };
}

test("a node reached over the tailnet and the relay is one machine that prefers Tailscale", () => {
  const book = new MachineBook<string>(7 * DAY);
  book.update("tailscale", [tailnetH("online", { node: NODE_H, target: "tailnet-h" })], T0);
  book.update(
    "relay",
    [
      { ...relayOf(NODE_H, "online"), target: "relay-h" },
      { ...relayOf(NODE_I, "online", "lab-i"), target: "relay-i" },
    ],
    T0,
  );
  const machines = book.machines(T0);
  assert.deepEqual(
    machines.map((machine) => [
      machine.id,
      machine.name,
      machine.route,
      machine.target,
      machine.links.map((link) => link.via),
    ]),
    [
      [machineIdOf(NODE_H), "lab-h", "tailscale", "tailnet-h", ["tailscale", "relay"]],
      [machineIdOf(NODE_I), "lab-i", "relay", "relay-i", ["relay"]],
    ],
  );
});

test("when the tailnet fails the same machine falls back to the relay and says why", () => {
  const book = new MachineBook<string>(7 * DAY);
  book.update("tailscale", [tailnetH("online", { node: NODE_H, target: "tailnet-h" })], T0);
  book.update("relay", [{ ...relayOf(NODE_H, "online"), target: "relay-h" }], T0);
  // The listener is gone: the probe learns no node id this time.
  book.update("tailscale", [tailnetH("unreachable", { reason: "no-listener" })], T0 + 30_000);
  const [machine] = book.machines(T0 + 30_000);
  assert.equal(machine.id, machineIdOf(NODE_H));
  assert.equal(machine.route, "relay");
  assert.equal(machine.target, "relay-h");
  assert.deepEqual(statusOf(machine), {
    kind: "online",
    via: "relay",
    down: {
      via: "tailscale",
      state: "unreachable",
      reason: "no-listener",
      lastSeen: T0,
      address: "100.64.0.1:17398",
    },
  });
});

test("a machine no link reports stays listed as offline until the retention ends", () => {
  const book = new MachineBook<string>(7 * DAY);
  book.update("relay", [{ ...relayOf(NODE_I, "online"), target: "relay-i" }], T0);
  book.update("relay", [], T0 + DAY);
  const [offline] = book.machines(T0 + DAY);
  assert.equal(offline.route, null);
  assert.equal(offline.target, undefined);
  assert.deepEqual(statusOf(offline), { kind: "offline", lastSeen: T0 });

  // A restart keeps it: the book is restored from what was saved.
  const restored = new MachineBook<string>(7 * DAY);
  restored.restore(JSON.parse(JSON.stringify(book.entries())));
  assert.deepEqual(
    restored.machines(T0 + 2 * DAY).map((machine) => [machine.id, machine.links[0].state]),
    [[machineIdOf(NODE_I), "offline"]],
  );

  book.update("relay", [], T0 + 7 * DAY + 1);
  assert.deepEqual(book.machines(T0 + 7 * DAY + 1), []);
});

test("a static peer stays however long ago it was seen, and goes when unconfigured", () => {
  const book = new MachineBook<string>(DAY);
  book.update("tailscale", [tailnetH("online", { node: NODE_H, target: "tailnet-h" })], T0);
  book.update("tailscale", [tailnetH("unreachable", { reason: "timeout" })], T0 + 30 * DAY);
  const [machine] = book.machines(T0 + 30 * DAY);
  assert.equal(machine.id, machineIdOf(NODE_H));
  assert.deepEqual(statusOf(machine), {
    kind: "unreachable",
    link: machine.links[0],
    lastSeen: T0,
  });
  book.update("tailscale", [], T0 + 30 * DAY);
  assert.deepEqual(book.machines(T0 + 30 * DAY), []);
});

test("a link that is down itself shows its remembered machines the way it says", () => {
  const book = new MachineBook<string>(7 * DAY);
  book.update("relay", [{ ...relayOf(NODE_I, "online"), target: "relay-i" }], T0);
  book.update("relay", [], T0 + 60_000, { state: "denied" });
  assert.deepEqual(book.machines(T0 + 60_000)[0].links[0].state, "denied");
  book.update("relay", [], T0 + 60_000, { state: "unreachable", reason: "relay-unreachable" });
  const [machine] = book.machines(T0 + 60_000);
  assert.deepEqual(statusOf(machine), {
    kind: "unreachable",
    link: machine.links[0],
    lastSeen: T0,
  });
  assert.equal(machine.links[0].reason, "relay-unreachable");
  // Leaving the network forgets its members.
  book.forget("relay");
  assert.deepEqual(book.machines(T0 + 60_000), []);
});

test("offline wins over a failed probe when no link works", () => {
  const status = statusOf({
    links: [
      { via: "tailscale", state: "unreachable", reason: "no-listener", lastSeen: T0 },
      { via: "relay", state: "offline", lastSeen: T0 + 5_000 },
    ],
  });
  assert.deepEqual(status, { kind: "offline", lastSeen: T0 + 5_000 });
});

test("probe failures map to reasons, and the more telling reason wins", () => {
  assert.equal(probeFailure({ code: "ECONNREFUSED" }), "no-listener");
  assert.equal(probeFailure({ code: "ETIMEDOUT" }), "timeout");
  assert.equal(probeFailure({ code: "ERR_SSL_WRONG_VERSION_NUMBER" }), "tls");
  assert.equal(probeFailure({ code: "EHOSTUNREACH" }), "network");
  assert.equal(probeFailure({ status: 403 }), "forbidden");
  assert.equal(probeFailure({ status: 200 }), "not-kivotos");
  // HTTPS was refused by a plain listener, plain HTTP then refused the user.
  assert.equal(tellingReason("tls", "forbidden"), "forbidden");
  assert.equal(tellingReason("tls", "timeout"), "tls");
});

const ENDPOINT = "ws://relay.example:7443/v1/connect";
const URL_H = "http://100.64.0.1:17398";

function relayPhone(node: string, name: string): PhoneMachine {
  return { id: `relay:${node}`, name, url: "", relay: { endpoint: ENDPOINT, key: "k", node } };
}

test("the phone folds a URL and a relay invite for one computer into one machine", () => {
  const byUrl: PhoneMachine = { id: URL_H, name: "lab-h", url: URL_H, node: NODE_H };
  const list = addPhoneMachines([byUrl], [relayPhone(NODE_H, "mac"), relayPhone(NODE_I, "lab-i")]);
  assert.deepEqual(list, [
    {
      id: URL_H,
      name: "lab-h",
      url: URL_H,
      node: NODE_H,
      relay: { endpoint: ENDPOINT, key: "k", node: NODE_H },
    },
    relayPhone(NODE_I, "lab-i"),
  ]);
  // The same again changes nothing: the caller reports a duplicate.
  assert.equal(addPhoneMachines(list, [relayPhone(NODE_H, "mac")]), list);
  // Leaving the network keeps the computer the tailnet reaches.
  assert.deepEqual(leavePhoneNetwork(list, "k"), [
    { id: URL_H, name: "lab-h", url: URL_H, node: NODE_H },
  ]);
});

test("a probe teaches the phone node ids and new members, and merges what they join", () => {
  const relayFirst = relayPhone(NODE_H, "mac");
  const byUrl: PhoneMachine = { id: URL_H, name: "lab-h", url: URL_H };
  const probe: PhoneProbe = {
    online: true,
    machines: [{ id: URL_H, node: NODE_H, route: "tailscale", links: [], stream: "off" }],
    networks: [
      {
        endpoint: ENDPOINT,
        key: "k",
        id: "n",
        state: "online",
        peers: [
          { node: NODE_H, name: "mac" },
          { node: NODE_I, name: "lab-i" },
        ],
      },
    ],
  };
  const next = applyPhoneProbe([relayFirst, byUrl], probe);
  assert.deepEqual(next, [
    { id: relayFirst.id, name: "mac", url: URL_H, node: NODE_H, relay: relayFirst.relay },
    relayPhone(NODE_I, "lab-i"),
  ]);
  assert.equal(applyPhoneProbe(next, probe), next);
});

test("the phone suspects its own Tailscale only when every tailnet machine has no route", () => {
  const probe = (reasons: ("timeout" | "no-listener")[], online = true): PhoneProbe => ({
    online,
    networks: [],
    machines: reasons.map((reason, index) => ({
      id: String(index),
      route: null,
      stream: "off",
      links: [{ via: "tailscale", state: "unreachable", reason }],
    })),
  });
  assert.equal(tailnetDownOnPhone(probe(["timeout", "timeout"])), true);
  assert.equal(tailnetDownOnPhone(probe(["timeout", "no-listener"])), false);
  assert.equal(tailnetDownOnPhone(probe(["timeout"], false)), false);
  assert.equal(tailnetDownOnPhone(probe([])), false);
});
