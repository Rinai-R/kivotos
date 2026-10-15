import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { addPhoneMachines } from "../../kivotos/src/machines";
import {
  relayJoin,
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
  /** Its node id, which ties it to the same computer in a relay network (newer Kivotos). */
  node?: string;
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
    const who: Hello = { name: String(body.name ?? url), os: String(body.os ?? "") };
    if (typeof body.node === "string" && body.node !== "") who.node = body.node;
    return who;
  } finally {
    clearTimeout(timer);
  }
}

const INVITE = /^kivotos:\/\/join\?/;

/** Whether text is a relay invite link. */
export function isInvite(text: string): boolean {
  return INVITE.test(text.trim());
}

/** `host[:port]` of a relay endpoint (`wss://relay.example.net/v1/connect`), as the computer's Settings show it. */
export function relayHost(endpoint: string): string {
  return endpoint.replace(/^wss?:\/\//, "").replace(/\/.*$/, "");
}

function relayMachine(address: Omit<RelayAddress, "node">, peer: RelayPeer): Machine {
  return {
    id: `relay:${peer.node}`,
    name: peer.name || peer.node.slice(0, 8),
    url: "",
    relay: { ...address, node: peer.node },
  };
}

/**
 * Turn what was scanned or typed into the machines to add.
 * - A relay invite (`kivotos://join?...`): every computer of that network
 *   that is online.
 * - A pairing code or an address: that one computer, over the tailnet.
 * A computer already in the list gains the new link instead of a second row.
 * @param typed - the text came from the keyboard, so a bare address is accepted.
 * @returns the machines to add (`addPhoneMachines`); throws an Error whose message `errorKey` maps.
 */
export async function resolveMachines(
  text: string,
  known: Machine[],
  typed: boolean,
): Promise<Machine[]> {
  const input = text.trim();
  const fresh = (machines: Machine[]): Machine[] => {
    if (addPhoneMachines(known, machines) === known) throw new Error("duplicate");
    return machines;
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
  const machine: Machine = { id: url, name: who.name, url };
  if (who.node !== undefined) machine.node = who.node;
  return fresh([machine]);
}

export const zh = getLocales()[0]?.languageCode === "zh";
