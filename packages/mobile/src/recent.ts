import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "kivotos.recent";
/** Peers remembered per computer: more than are ever loaded ahead, for when some are offline. */
const PEERS_MAX = 4;

/** What the phone opened lately, which decides what it loads ahead (`preloadTargets`). */
export interface Recent {
  /** The phone row opened last. */
  row: string | null;
  /** Per phone row: the mount ids its pages' switchers were used for, most recent first. */
  peers: Record<string, string[]>;
}

export const NO_RECENT: Recent = { row: null, peers: {} };

export async function loadRecent(): Promise<Recent> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = (raw === null ? null : JSON.parse(raw)) as Partial<Recent> | null;
    return {
      row: typeof parsed?.row === "string" ? parsed.row : null,
      peers: typeof parsed?.peers === "object" && parsed.peers !== null ? parsed.peers : {},
    };
  } catch {
    // Only a hint for loading ahead: a corrupt entry starts over.
    return NO_RECENT;
  }
}

export async function saveRecent(recent: Recent): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(recent));
}

/** @returns `recent` with `peer` switched to last from the pages of row `machine`. */
export function withPeer(recent: Recent, machine: string, peer: string): Recent {
  const known = recent.peers[machine] ?? [];
  if (known[0] === peer) return recent;
  const peers = [peer, ...known.filter((id) => id !== peer)].slice(0, PEERS_MAX);
  return { ...recent, peers: { ...recent.peers, [machine]: peers } };
}

/** @returns `recent` without the rows that are not in `ids` any more. */
export function keepRows(recent: Recent, ids: ReadonlySet<string>): Recent {
  const entries = Object.entries(recent.peers);
  const kept = entries.filter(([id]) => ids.has(id));
  const row = recent.row !== null && ids.has(recent.row) ? recent.row : null;
  if (kept.length === entries.length && row === recent.row) return recent;
  return { row, peers: Object.fromEntries(kept) };
}
