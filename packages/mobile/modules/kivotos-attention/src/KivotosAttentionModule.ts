import { NativeModule, requireNativeModule } from "expo";

/** A machine the attention service follows. */
export interface Machine {
  id: string;
  name: string;
  /** Base URL of the machine's Kivotos tailnet listener, e.g. http://100.64.0.1:7380; "" for a relay machine. */
  url: string;
  /** Set when the machine is reached through a relay instead. */
  relay?: RelayAddress;
}

/** A computer as a node of a relay network. */
export interface RelayAddress {
  /** Relay WebSocket endpoint. */
  endpoint: string;
  /** The network's federation key; whoever holds it is a member. */
  key: string;
  /** The computer's node id in the network. */
  node: string;
}

/** A computer of a network that is online, as the relay reports it. */
export interface RelayPeer {
  node: string;
  name: string;
}

/** A notification tap: open this session on this machine. */
export interface OpenSession {
  machineId: string;
  sessionId: string;
}

/** A frame while the app is open: shown as an in-app banner. */
export interface Attention {
  machineId: string;
  machineName: string;
  kind: "approval" | "question" | "done" | "failed" | "resolved";
  sessionId: string;
  title: string;
  key: string;
  detail: string;
}

/** Native events. */
// oxlint-disable-next-line typescript/consistent-type-definitions -- Expo's `EventsMap` is an index-signature type, which an interface does not satisfy (interfaces get no implicit index signature).
type Events = {
  onOpenSession: (payload: OpenSession) => void;
  onAttention: (payload: Attention) => void;
};

declare class KivotosAttentionModule extends NativeModule<Events> {
  setMachines(json: string): void;
  relayJoin(invite: string): Promise<{ endpoint: string; key: string; peers: RelayPeer[] }>;
  relayPeers(endpoint: string, key: string): Promise<RelayPeer[]>;
  relayOpen(json: string): string;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  setOnScreen(machineId: string, sessionId: string): void;
  takePendingOpen(): OpenSession | null;
  isBatteryRestricted(): boolean;
  requestBatteryExemption(): void;
  openNotificationSettings(): void;
}

const native = requireNativeModule<KivotosAttentionModule>("KivotosAttention");

export const setMachines = (machines: Machine[]): void =>
  native.setMachines(JSON.stringify(machines));
/** Read an invite link and list the network's online computers. Rejects with code "invite", "denied" or "unreachable". */
export const relayJoin = (
  invite: string,
): Promise<{ endpoint: string; key: string; peers: RelayPeer[] }> => native.relayJoin(invite);
export const relayPeers = (endpoint: string, key: string): Promise<RelayPeer[]> =>
  native.relayPeers(endpoint, key);
/** @returns the local base URL through which a relay machine's dsh loads. */
export const relayOpen = (machine: Machine): string => native.relayOpen(JSON.stringify(machine));
export const setEnabled = (enabled: boolean): void => native.setEnabled(enabled);
export const isEnabled = (): boolean => native.isEnabled();
export const setOnScreen = (machineId: string, sessionId: string): void =>
  native.setOnScreen(machineId, sessionId);
export const takePendingOpen = (): OpenSession | null => native.takePendingOpen();
export const isBatteryRestricted = (): boolean => native.isBatteryRestricted();
export const requestBatteryExemption = (): void => native.requestBatteryExemption();
export const openNotificationSettings = (): void => native.openNotificationSettings();

/** @returns unsubscribe. */
export function onOpenSession(listener: (open: OpenSession) => void): () => void {
  const subscription = native.addListener("onOpenSession", listener);
  return () => subscription.remove();
}

/** @returns unsubscribe. */
export function onAttention(listener: (attention: Attention) => void): () => void {
  const subscription = native.addListener("onAttention", listener);
  return () => subscription.remove();
}
