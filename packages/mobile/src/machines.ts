import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import {
  relayJoin,
  relayPeers,
  type Machine,
  type RelayAddress,
  type RelayPeer,
} from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { parsePairingUrl } from "./pairing";

const KEY = "kivotos.machines";

export async function loadMachines(): Promise<Machine[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Machine[]) : [];
  } catch {
    // A corrupt entry is treated as no machines; the user can add them again.
    return [];
  }
}

export async function saveMachines(machines: Machine[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(machines));
}

/**
 * Normalize what the user typed into a listener base URL.
 * `100.64.0.1` → `http://100.64.0.1:7380`; an explicit scheme or port is kept.
 * @returns the URL, or null when it cannot be one.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed === "") return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.port === "" && !/:\d+$/.test(url.host)) url.port = "7380";
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** What a machine's `/kivotos/hello` answers. */
export interface Hello {
  name: string;
  os: string;
}

/**
 * Ask a machine who it is. Also proves the phone passes its admission
 * (same tailnet user).
 */
export async function hello(url: string): Promise<Hello> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${url}/kivotos/hello`, { signal: controller.signal });
    if (res.status === 403) throw new Error("forbidden");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Partial<Hello> & { kivotos?: string };
    if (body.kivotos === undefined) throw new Error("not-kivotos");
    return { name: String(body.name ?? url), os: String(body.os ?? "") };
  } finally {
    clearTimeout(timer);
  }
}

const INVITE = /^kivotos:\/\/join\?/;

function relayMachine(address: Omit<RelayAddress, "node">, peer: RelayPeer): Machine {
  return {
    id: `relay:${peer.node}`,
    name: peer.name || peer.node.slice(0, 8),
    url: "",
    relay: { ...address, node: peer.node },
  };
}

/** Whether two machines are computers of the same relay network. */
export function sameNetwork(a: Machine, b: Machine): boolean {
  return a.relay !== undefined && a.relay.key === b.relay?.key;
}

/**
 * Turn what was scanned or typed into the machines to add.
 * - A relay invite (`kivotos://join?...`): every computer of that network
 *   that is online.
 * - A pairing code or an address: that one computer, over the tailnet.
 * @param typed - the text came from the keyboard, so a bare address is accepted.
 * @returns machines not in `known`; throws an Error whose message `errorKey` maps.
 */
export async function resolveMachines(
  text: string,
  known: Machine[],
  typed: boolean,
): Promise<Machine[]> {
  const input = text.trim();
  const fresh = (machines: Machine[]): Machine[] => {
    const added = machines.filter((machine) => known.every((other) => other.id !== machine.id));
    if (added.length === 0) throw new Error("duplicate");
    return added;
  };
  if (INVITE.test(input)) {
    let joined: Awaited<ReturnType<typeof relayJoin>>;
    try {
      joined = await relayJoin(input);
    } catch (failure) {
      // The native side rejects with a code: "invite", "denied" or "unreachable".
      const code: unknown = failure instanceof Error ? Reflect.get(failure, "code") : undefined;
      throw new Error(typeof code === "string" ? `relay-${code}` : "relay-unreachable", {
        cause: failure,
      });
    }
    if (joined.peers.length === 0) throw new Error("relay-empty");
    return fresh(joined.peers.map((peer) => relayMachine(joined, peer)));
  }
  const url = typed ? normalizeUrl(input) : parsePairingUrl(input);
  if (url === null) throw new Error(typed ? "invalid" : "scan-invalid");
  const who = await hello(url);
  return fresh([{ id: url, name: who.name, url }]);
}

/**
 * Add the computers that came online in the relay networks already joined,
 * and pick up renames. Networks that cannot be reached are left as they are.
 * @returns the updated list, or `machines` itself when nothing changed.
 */
export async function refreshRelayMachines(machines: Machine[]): Promise<Machine[]> {
  const networks = new Map<string, Omit<RelayAddress, "node">>();
  for (const machine of machines) {
    if (machine.relay !== undefined) networks.set(machine.relay.key, machine.relay);
  }
  const online = await Promise.all(
    [...networks.values()].map(async (address) => {
      try {
        const peers = await relayPeers(address.endpoint, address.key);
        return peers.map((peer) => relayMachine(address, peer));
      } catch {
        return [];
      }
    }),
  );
  const next = [...machines];
  let changed = false;
  for (const machine of online.flat()) {
    const index = next.findIndex((other) => other.id === machine.id);
    if (index < 0) next.push(machine);
    else if (next[index].name === machine.name) continue;
    else next[index] = machine;
    changed = true;
  }
  return changed ? next : machines;
}

export const zh = getLocales()[0]?.languageCode === "zh";
