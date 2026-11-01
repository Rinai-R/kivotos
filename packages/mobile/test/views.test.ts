import assert from "node:assert/strict";
import { test } from "node:test";
import type { LinkState, MachineLink, PhoneProbe, Via } from "../../kivotos/src/machines.ts";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule.ts";
import type { ListedMachine, SwitchTarget } from "../src/bridge.ts";
import { preloadTargets, switchTarget, type LiveView } from "../src/views.ts";

/** The phone's row for the computer A whose page the switch starts from. */
const A: Machine = { id: "lab-a", name: "lab-a", url: "http://slab-a:7380" };
/** The phone's own row for B, when it has one. */
const B: Machine = { id: "lab-b", name: "lab-b", url: "http://slab-b:7380" };
/** B's mount id on A: what A's switcher names it with, and `/kivotos/peer/<id>/`. */
const MOUNT = "node-b-mount";

const target: SwitchTarget = { id: MOUNT, name: "lab-b", address: "slab-b:7380" };
const listedB: ListedMachine = {
  target: { id: MOUNT, name: "lab-b", address: "slab-b:7380" },
  online: true,
};

function link(via: Via, state: LinkState = "online"): MachineLink {
  return state === "unreachable" ? { via, state, reason: "timeout" } : { via, state };
}

/** Both links, as a machine the phone could reach either way is probed. */
function bothLinks(tailscale: LinkState, relay: LinkState): MachineLink[] {
  return [link("tailscale", tailscale), link("relay", relay)];
}

function probeOf(machines: { id: string; links: MachineLink[] }[]): PhoneProbe {
  return {
    online: true,
    machines: machines.map(({ id, links }) => ({ id, links, stream: "off" })),
    networks: [],
  };
}

/** The phone's probe: Tailscale reaches B directly. */
const directProbe = probeOf([{ id: B.id, links: bothLinks("online", "online") }]);
/** The phone's probe: only the relay reaches B. */
const relayOnlyProbe = probeOf([{ id: B.id, links: bothLinks("unreachable", "online") }]);
/** The phone's probe: neither link reaches B. */
const noRouteProbe = probeOf([{ id: B.id, links: bothLinks("unreachable", "offline") }]);

function view(machine: Machine, peer: LiveView["peer"] = null): LiveView {
  return {
    key: peer === null ? machine.id : `${machine.id}#${peer.id}`,
    machine: machine.id,
    peer,
    generation: 1,
    door: "door",
    open: null,
    preloaded: false,
  };
}

test("switches to the phone's own row when Tailscale reaches the target directly", () => {
  const to = switchTarget([A, B], directProbe, view(A), target, [listedB]);
  assert.deepEqual(to, { machine: B, peer: null });
});

test("goes through the page's computer when the phone's own row is relay only", () => {
  const to = switchTarget([A, B], relayOnlyProbe, view(A), target, [listedB]);
  assert.deepEqual(to, { machine: A, peer: { id: MOUNT, name: "lab-b" } });
});

test("goes through the page's computer when the phone has no row for the target", () => {
  const to = switchTarget([A], directProbe, view(A), target, [listedB]);
  assert.deepEqual(to, { machine: A, peer: { id: MOUNT, name: "lab-b" } });
});

test("goes through the page's computer when the phone's probe found no route", () => {
  const to = switchTarget([A, B], noRouteProbe, view(A), target, [listedB]);
  assert.deepEqual(to, { machine: A, peer: { id: MOUNT, name: "lab-b" } });
});

test("keeps the phone's own row when the page's computer does not list the target", () => {
  for (const listed of [null, [], [{ ...listedB, online: false }]]) {
    const to = switchTarget([A, B], relayOnlyProbe, view(A), target, listed);
    assert.deepEqual(to, { machine: B, peer: null }, `listed: ${JSON.stringify(listed)}`);
  }
  // Without the computer's list and without a row, only its mount is left.
  const to = switchTarget([A], relayOnlyProbe, view(A), target, null);
  assert.deepEqual(to, { machine: A, peer: { id: MOUNT, name: "lab-b" } });
});

test("a machine held to the relay is not a direct Tailscale route", () => {
  const heldToRelay: Machine = { ...B, mode: "relay" };
  const to = switchTarget([A, heldToRelay], directProbe, view(A), target, [listedB]);
  assert.deepEqual(to, { machine: A, peer: { id: MOUNT, name: "lab-b" } });
});

test("a machine held to Tailscale stays on the phone's own row", () => {
  const heldToTailscale: Machine = { ...B, mode: "tailscale" };
  const to = switchTarget([A, heldToTailscale], directProbe, view(A), target, [listedB]);
  assert.deepEqual(to, { machine: heldToTailscale, peer: null });
});

test("a relay-first machine is direct only once its relay fails", () => {
  const relayFirst: Machine = { ...B, mode: "relay" };
  // The relay works: it is the route, so this is not a direct Tailscale page.
  const relayUp = switchTarget([A, relayFirst], directProbe, view(A), target, [listedB]);
  assert.deepEqual(relayUp, { machine: A, peer: { id: MOUNT, name: "lab-b" } });
  // The relay is down: the machine falls back to Tailscale, a direct page again.
  const relayDown = probeOf([{ id: B.id, links: bothLinks("online", "unreachable") }]);
  const fallback = switchTarget([A, relayFirst], relayDown, view(A), target, [listedB]);
  assert.deepEqual(fallback, { machine: relayFirst, peer: null });
});

test("This computer and the peer page keep their pages", () => {
  const peerPage = view(A, { id: MOUNT, name: "lab-b" });
  /** "This computer" on a peer's page is that computer's own page. */
  assert.deepEqual(switchTarget([A], directProbe, peerPage, { id: null, name: "lab-a" }, null), {
    machine: A,
    peer: null,
  });
  /** "This computer" on the row's own page has no page of its own to show. */
  assert.equal(switchTarget([A], directProbe, view(A), { id: null, name: "lab-a" }, null), null);
  /** The peer whose page is on screen: nothing to switch to. */
  assert.equal(switchTarget([A], directProbe, peerPage, target, [listedB]), null);
  /** Another peer of the same computer opens as its mount page. */
  const other: SwitchTarget = { id: "node-c-mount", name: "lab-c" };
  assert.deepEqual(switchTarget([A], directProbe, peerPage, other, null), {
    machine: A,
    peer: { id: "node-c-mount", name: "lab-c" },
  });
});

test("loads ahead the page a switch would show", () => {
  const from = view(A);
  // Tailscale direct: the phone's own row, the fastest way.
  assert.deepEqual(preloadTargets([A, B], directProbe, from, [listedB], []), [
    { machine: B, peer: null },
  ]);
  // Relay only: the computer's mount, which the page already has a door and cache for.
  assert.deepEqual(preloadTargets([A, B], relayOnlyProbe, from, [listedB], []), [
    { machine: A, peer: { id: MOUNT, name: "lab-b" } },
  ]);
  // A stale probe (null) is not proof of a direct route: load the computer's mount.
  assert.deepEqual(preloadTargets([A, B], null, from, [listedB], []), [
    { machine: A, peer: { id: MOUNT, name: "lab-b" } },
  ]);
  // No row for it, and nothing listed: nothing to load ahead.
  assert.deepEqual(preloadTargets([A], directProbe, from, [], []), []);
  // A peer's page loads nothing ahead.
  assert.deepEqual(
    preloadTargets([A, B], directProbe, view(A, { id: MOUNT, name: "lab-b" }), [listedB], []),
    [],
  );
});

test("loads ahead the target switched to lately first, at most PRELOAD_MAX", () => {
  const targets: SwitchTarget[] = [
    { id: "node-b-mount", name: "lab-b" },
    { id: "node-c-mount", name: "lab-c" },
    { id: "node-d-mount", name: "lab-d" },
  ];
  const listed: ListedMachine[] = targets.map((each) => ({ target: each, online: true }));
  const from = view(A);
  const all = preloadTargets([A], directProbe, from, listed, []);
  assert.equal(all.length, 2);
  assert.deepEqual(
    all.map((to) => to.peer?.id),
    ["node-b-mount", "node-c-mount"],
  );
  const lately = preloadTargets([A], directProbe, from, listed, ["node-d-mount"]);
  assert.equal(lately[0]?.peer?.id, "node-d-mount");
});
