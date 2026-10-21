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
  modeOptions,
  pinnedVia,
  ROUTE_MODES,
  routeOf,
  setPhoneMode,
  statusOf,
  tailnetDownOnPhone,
  type MachineLink,
  type PhoneMachine,
  type PhoneProbe,
  type Via,
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
  assert.deepEqual(statusOf(machine, machine.mode), {
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
  assert.deepEqual(statusOf(offline, offline.mode), { kind: "offline", lastSeen: T0 });

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

test("a working link survives two failed checks in a row and is down at the third", () => {
  const book = new MachineBook<string>(DAY);
  const at = (n: number) => T0 + n * 30_000;
  book.update("tailscale", [tailnetH("online", { node: NODE_H, target: "tailnet-h" })], at(0));
  for (const n of [1, 2]) {
    book.update("tailscale", [tailnetH("unreachable", { reason: "timeout" })], at(n));
    const [machine] = book.machines(at(n));
    assert.equal(machine.links[0].state, "online", `check ${n}`);
    assert.equal(machine.links[0].unstable, true);
    // It keeps its route: a mount is not torn down for one slow answer.
    assert.equal(machine.target, "tailnet-h");
    // Its row says so: still the route, but unstable.
    assert.deepEqual(statusOf(machine, machine.mode), { kind: "unstable", via: "tailscale" });
  }
  book.update("tailscale", [tailnetH("unreachable", { reason: "timeout" })], at(3));
  const [down] = book.machines(at(3));
  assert.equal(down.links[0].state, "unreachable");
  assert.equal(down.links[0].unstable, undefined);
  assert.equal(down.target, undefined);
  // One answer clears the count: the next failure starts the grace again.
  book.update("tailscale", [tailnetH("online", { node: NODE_H, target: "tailnet-h" })], at(4));
  assert.equal(book.machines(at(4))[0].links[0].unstable, undefined);
  book.update("tailscale", [tailnetH("unreachable", { reason: "timeout" })], at(5));
  assert.equal(book.machines(at(5))[0].links[0].state, "online");
});

test("a refusal, or a failure of a link not working before, is shown at once", () => {
  const book = new MachineBook<string>(DAY);
  book.update("tailscale", [tailnetH("online", { node: NODE_H, target: "tailnet-h" })], T0);
  book.update("tailscale", [tailnetH("unreachable", { reason: "no-listener" })], T0 + 30_000);
  assert.equal(book.machines(T0 + 30_000)[0].links[0].state, "unreachable");
  const fresh = new MachineBook<string>(DAY);
  fresh.update("tailscale", [tailnetH("unreachable", { reason: "timeout" })], T0);
  assert.equal(fresh.machines(T0)[0].links[0].state, "unreachable");
});

test("a dropped relay connection gets the same grace for the machines it was reaching", () => {
  const book = new MachineBook<string>(7 * DAY);
  book.update("relay", [{ ...relayOf(NODE_I, "online"), target: "relay-i" }], T0);
  const down = { state: "unreachable", reason: "relay-unreachable" } as const;
  book.update("relay", [], T0 + 30_000, down);
  const [held] = book.machines(T0 + 30_000);
  assert.equal(held.links[0].state, "online");
  assert.equal(held.links[0].unstable, true);
  book.update("relay", [], T0 + 60_000, down);
  book.update("relay", [], T0 + 90_000, down);
  assert.equal(book.machines(T0 + 90_000)[0].links[0].state, "unreachable");
});

test("a static peer removed while its link is down goes at once", () => {
  const book = new MachineBook<string>(DAY);
  book.update("tailscale", [tailnetH("online", { node: NODE_H, target: "tailnet-h" })], T0);
  book.update("tailscale", [], T0 + 30_000, { state: "unreachable", reason: "network" });
  assert.deepEqual(book.machines(T0 + 30_000), []);
});

test("a static peer stays however long ago it was seen, and goes when unconfigured", () => {
  const book = new MachineBook<string>(DAY);
  book.update("tailscale", [tailnetH("online", { node: NODE_H, target: "tailnet-h" })], T0);
  book.update("tailscale", [tailnetH("unreachable", { reason: "timeout" })], T0 + 30 * DAY);
  const [machine] = book.machines(T0 + 30 * DAY);
  assert.equal(machine.id, machineIdOf(NODE_H));
  assert.deepEqual(statusOf(machine, machine.mode), {
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
  assert.deepEqual(statusOf(machine, machine.mode), {
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
  const status = statusOf(
    {
      links: [
        { via: "tailscale", state: "unreachable", reason: "no-listener", lastSeen: T0 },
        { via: "relay", state: "offline", lastSeen: T0 + 5_000 },
      ],
    },
    "auto",
  );
  assert.deepEqual(status, { kind: "offline", lastSeen: T0 + 5_000 });
});

const DOWN: readonly MachineLink["state"][] = ["offline", "unreachable", "denied"];

function linkIn(via: Via, state: MachineLink["state"]): MachineLink {
  return state === "unreachable" ? { via, state, reason: "no-listener" } : { via, state };
}

test("each mode routes over the links it allows, whatever state the others are in", () => {
  // [tailscale up, relay up] -> route in auto, tailscale, relay.
  const table: [boolean, boolean, Via | null, Via | null, Via | null][] = [
    [true, true, "tailscale", "tailscale", "relay"],
    [true, false, "tailscale", "tailscale", null],
    [false, true, "relay", null, "relay"],
    [false, false, null, null, null],
  ];
  for (const [tailscaleUp, relayUp, auto, tailscale, relay] of table) {
    for (const down of DOWN) {
      const machine = {
        links: [
          linkIn("tailscale", tailscaleUp ? "online" : down),
          linkIn("relay", relayUp ? "online" : down),
        ],
      };
      const label = `tailscale ${tailscaleUp ? "online" : down}, relay ${relayUp ? "online" : down}`;
      assert.equal(routeOf(machine, "auto"), auto, `auto: ${label}`);
      assert.equal(routeOf(machine, "tailscale"), tailscale, `tailscale: ${label}`);
      assert.equal(routeOf(machine, "relay"), relay, `relay: ${label}`);
    }
  }
});

test("a machine with one link uses it in every mode: there is nothing to choose", () => {
  for (const via of ["tailscale", "relay"] as const) {
    for (const mode of ROUTE_MODES) {
      const up = { links: [linkIn(via, "online")] };
      assert.equal(pinnedVia(up, mode), null, `${via} only, ${mode}`);
      assert.equal(routeOf(up, mode), via, `${via} only, ${mode}`);
      for (const down of DOWN) assert.equal(routeOf({ links: [linkIn(via, down)] }, mode), null);
    }
  }
});

test("a machine held to one link shows that link's failure, never the other link", () => {
  const tailnetDown = { via: "tailscale" as const, state: "unreachable" as const };
  const links: MachineLink[] = [
    { ...tailnetDown, reason: "no-listener", lastSeen: T0 },
    { via: "relay", state: "online", lastSeen: T0 + 60_000 },
  ];
  // Auto falls back and says why; Tailscale only is unreachable with Tailscale's reason.
  assert.deepEqual(statusOf({ links }, "auto"), { kind: "online", via: "relay", down: links[0] });
  assert.deepEqual(statusOf({ links }, "tailscale"), {
    kind: "unreachable",
    link: links[0],
    lastSeen: T0,
  });
  // Relay only is plainly online: the failing Tailscale link is not its business.
  assert.deepEqual(statusOf({ links }, "relay"), { kind: "online", via: "relay" });
  const relayGone: MachineLink[] = [
    { via: "tailscale", state: "online", lastSeen: T0 + 60_000 },
    { via: "relay", state: "offline", lastSeen: T0 },
  ];
  assert.deepEqual(statusOf({ links: relayGone }, "relay"), { kind: "offline", lastSeen: T0 });
  assert.deepEqual(statusOf({ links: relayGone }, "auto"), { kind: "online", via: "tailscale" });
});

test("the mode control offers auto and both links, a link that is down disabled with why", () => {
  const shown = (tailnet: MachineLink["state"], relay: MachineLink["state"]) =>
    modeOptions({ links: [linkIn("tailscale", tailnet), linkIn("relay", relay)] }).map((option) =>
      option.disabled === undefined ? option.mode : `${option.mode}!${option.disabled}`,
    );
  assert.deepEqual(shown("online", "online"), ["auto", "tailscale", "relay"]);
  // The control keeps its shape: a down link stays, disabled with its reason or state.
  assert.deepEqual(shown("unreachable", "online"), ["auto", "tailscale!no-listener", "relay"]);
  assert.deepEqual(shown("online", "offline"), ["auto", "tailscale", "relay!offline"]);
  assert.deepEqual(shown("denied", "unreachable"), [
    "auto",
    "tailscale!denied",
    "relay!no-listener",
  ]);
  // An unstable link still works, so it can be chosen.
  const unstable: MachineLink[] = [
    { via: "tailscale", state: "online", unstable: true },
    { via: "relay", state: "unreachable" },
  ];
  assert.deepEqual(
    modeOptions({ links: unstable }).map((option) => option.disabled),
    [undefined, undefined, "unreachable"],
  );
  // One link: nothing to choose.
  assert.deepEqual(modeOptions({ links: [linkIn("relay", "online")] }), []);
});

function bothLinksOfH(book: MachineBook<string>, now: number) {
  book.update("tailscale", [tailnetH("online", { node: NODE_H, target: "tailnet-h" })], now);
  book.update("relay", [{ ...relayOf(NODE_H, "online"), target: "relay-h" }], now);
}

test("a machine's mode picks its route and target, and survives a restart", () => {
  const book = new MachineBook<string>(7 * DAY);
  bothLinksOfH(book, T0);
  const id = machineIdOf(NODE_H);
  assert.equal(book.setMode("node-unknown", "relay"), false);
  assert.equal(book.setMode(id, "relay"), true);
  const [held] = book.machines(T0);
  assert.deepEqual([held.mode, held.route, held.target], ["relay", "relay", "relay-h"]);

  const restored = new MachineBook<string>(7 * DAY);
  restored.restore(
    JSON.parse(JSON.stringify(book.entries())),
    JSON.parse(JSON.stringify(book.storedModes())),
  );
  bothLinksOfH(restored, T0 + 60_000);
  const [again] = restored.machines(T0 + 60_000);
  assert.deepEqual([again.mode, again.route, again.target], ["relay", "relay", "relay-h"]);

  // Back to auto: nothing left to store, Tailscale preferred again.
  assert.equal(restored.setMode(id, "auto"), true);
  assert.deepEqual(restored.storedModes(), {});
  assert.equal(restored.machines(T0 + 60_000)[0].route, "tailscale");
});

test("a mode held to a failing link is never rerouted, and outlasts the other link", () => {
  const book = new MachineBook<string>(7 * DAY);
  bothLinksOfH(book, T0);
  const id = machineIdOf(NODE_H);
  book.setMode(id, "tailscale");
  book.update("tailscale", [tailnetH("unreachable", { reason: "no-listener" })], T0 + 30_000);
  const [held] = book.machines(T0 + 30_000);
  assert.equal(held.route, null);
  assert.equal(held.target, undefined);
  assert.deepEqual(statusOf(held, held.mode), {
    kind: "unreachable",
    link: held.links[0],
    lastSeen: T0,
  });

  // Leaving the relay network leaves one link: it is used, and the mode waits for the relay.
  book.update(
    "tailscale",
    [tailnetH("online", { node: NODE_H, target: "tailnet-h" })],
    T0 + 60_000,
  );
  book.forget("relay");
  assert.deepEqual(book.storedModes(), { [id]: "tailscale" });
  book.setMode(id, "relay");
  const [single] = book.machines(T0 + 60_000);
  assert.deepEqual([single.mode, single.route, single.target], ["relay", "tailscale", "tailnet-h"]);
  book.update("relay", [{ ...relayOf(NODE_H, "online"), target: "relay-h" }], T0 + 90_000);
  assert.equal(book.machines(T0 + 90_000)[0].target, "relay-h");

  // The mode goes with the machine.
  book.update("tailscale", [], T0 + 90_000);
  book.forget("relay");
  assert.deepEqual(book.storedModes(), {});
});

test("a restore keeps only modes it can read", () => {
  const book = new MachineBook<string>(7 * DAY);
  bothLinksOfH(book, T0);
  const id = machineIdOf(NODE_H);
  book.restore([], { [id]: "carrier-pigeon", "node-other": 3 });
  assert.equal(book.machines(T0)[0].mode, "auto");
  book.restore([], { [id]: "relay" });
  assert.equal(book.machines(T0)[0].route, "relay");
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
    machines: [{ id: URL_H, node: NODE_H, links: [], stream: "off" }],
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

test("the phone keeps a machine's mode through merges, probes and leaving a network", () => {
  const byUrl: PhoneMachine = { id: URL_H, name: "lab-h", url: URL_H };
  const held = setPhoneMode([byUrl, relayPhone(NODE_I, "lab-i")], URL_H, "tailscale");
  assert.deepEqual(held[0], { ...byUrl, mode: "tailscale" });
  assert.deepEqual(held[1], relayPhone(NODE_I, "lab-i"));
  // Its hello names the node, then the relay invite for the same computer joins it.
  const probe: PhoneProbe = {
    online: true,
    machines: [{ id: URL_H, node: NODE_H, links: [], stream: "off" }],
    networks: [],
  };
  const learnt = applyPhoneProbe(held, probe);
  assert.equal(learnt[0].mode, "tailscale");
  const both = addPhoneMachines(learnt, [relayPhone(NODE_H, "mac")]);
  assert.deepEqual(both[0], {
    id: URL_H,
    name: "lab-h",
    url: URL_H,
    node: NODE_H,
    relay: { endpoint: ENDPOINT, key: "k", node: NODE_H },
    mode: "tailscale",
  });
  // Leaving the network leaves one link; the mode stays for when the relay comes back.
  assert.equal(leavePhoneNetwork(both, "k")[0].mode, "tailscale");
  // Auto is stored as no mode at all.
  assert.deepEqual(setPhoneMode(both, URL_H, "auto")[0], {
    id: URL_H,
    name: "lab-h",
    url: URL_H,
    node: NODE_H,
    relay: { endpoint: ENDPOINT, key: "k", node: NODE_H },
  });
});

test("the phone suspects its own Tailscale only when every tailnet machine has no route", () => {
  const probe = (reasons: ("timeout" | "no-listener")[], online = true): PhoneProbe => ({
    online,
    networks: [],
    machines: reasons.map((reason, index) => ({
      id: String(index),
      stream: "off",
      links: [{ via: "tailscale", state: "unreachable", reason }],
    })),
  });
  assert.equal(tailnetDownOnPhone(probe(["timeout", "timeout"])), true);
  assert.equal(tailnetDownOnPhone(probe(["timeout", "no-listener"])), false);
  assert.equal(tailnetDownOnPhone(probe(["timeout"], false)), false);
  assert.equal(tailnetDownOnPhone(probe([])), false);
});

test("a retired relay identity of this computer can be discarded, but a reported one stays", () => {
  const book = new MachineBook<string>(7 * DAY);
  book.update("relay", [{ ...relayOf(NODE_H, "online"), name: "mac", target: "relay-h" }], T0);
  // A previous identity of this computer, seen once and no longer reported.
  book.update("relay", [{ ...relayOf(NODE_I, "offline"), name: "mac", lastSeen: T0 }], T0);
  book.update("relay", [], T0 + 1000, { state: "offline" });
  assert.deepEqual(
    book.machines(T0 + 1000).map((machine) => machine.id),
    [machineIdOf(NODE_H), machineIdOf(NODE_I)],
  );
  // The caller knows this computer's current name and OS and drops the old one.
  book.discard(
    (entry) =>
      entry.via === "relay" &&
      entry.node !== NODE_H &&
      entry.name === "mac" &&
      entry.os === "macOS",
  );
  assert.deepEqual(
    book.machines(T0 + 1000).map((machine) => machine.id),
    [machineIdOf(NODE_H)],
  );
  // A reported entry is never discarded: a real machine with the same name stays.
  book.update(
    "relay",
    [{ ...relayOf(NODE_I, "online"), name: "mac", target: "relay-i" }],
    T0 + 2000,
  );
  book.discard((entry) => entry.node === NODE_I && entry.name === "mac");
  assert.equal(
    book.machines(T0 + 2000).some((machine) => machine.id === machineIdOf(NODE_I)),
    true,
  );
});
