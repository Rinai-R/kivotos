import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, PermissionsAndroid, Platform, useColorScheme, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  addPhoneMachines,
  applyPhoneProbe,
  leavePhoneNetwork,
  setPhoneMode,
  type PhoneProbe,
  type RouteMode,
} from "../kivotos/src/machines";
import * as Attention from "./modules/kivotos-attention/src/KivotosAttentionModule";
import type { Machine } from "./modules/kivotos-attention/src/KivotosAttentionModule";
import { AttentionBanner } from "./src/AttentionBanner";
import { LinksScreen } from "./src/LinksScreen";
import { MachineList } from "./src/MachineList";
import { MachineView, type MachineViewHandle } from "./src/MachineView";
import { loadMachines, saveMachines } from "./src/machines";
import { PairScanner } from "./src/PairScanner";
import { useStyles, type Palette } from "./src/theme";

type NotificationState = "on" | "off" | "denied";
/** The app's own screens, shown while no machine is open. */
type Screen = "machines" | "links" | "scan";
/** How often the machine list re-probes every link while it is on screen. */
const PROBE_MS = 15_000;

async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || Platform.Version < 33) return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export default function App() {
  const scheme = useColorScheme();
  const styles = useStyles(createStyles);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [current, setCurrent] = useState<Machine | null>(null);
  const [initialSession, setInitialSession] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationState>("off");
  const [batteryRestricted, setBatteryRestricted] = useState(false);
  const [banner, setBanner] = useState<Attention.Attention | null>(null);
  const [screen, setScreen] = useState<Screen>("machines");
  const [probe, setProbe] = useState<PhoneProbe | null>(null);
  const view = useRef<MachineViewHandle>(null);
  const currentRef = useRef<Machine | null>(null);
  const machinesRef = useRef<Machine[]>([]);
  /** The stored list has been read: before that, a probe would be folded into an empty list and saved over it. */
  const restored = useRef(false);
  currentRef.current = current;
  machinesRef.current = machines;

  const persist = useCallback((next: Machine[]) => {
    setMachines(next);
    void saveMachines(next);
    Attention.setMachines(next);
  }, []);

  /** Open a Session: switch machine if needed, else open it in the loaded page. */
  const openSession = useCallback((machineId: string, sessionId: string) => {
    const machine = machinesRef.current.find((item) => item.id === machineId);
    if (machine === undefined) return;
    setBanner(null);
    if (currentRef.current?.id === machine.id) {
      view.current?.openSession(sessionId);
    } else {
      setInitialSession(sessionId);
      setCurrent(machine);
    }
  }, []);

  useEffect(() => {
    const restore = async (): Promise<void> => {
      const stored = await loadMachines();
      machinesRef.current = stored;
      restored.current = true;
      setMachines(stored);
      Attention.setMachines(stored);
      // A tap that launched the app before this listener existed.
      const pending = Attention.takePendingOpen();
      if (pending !== null) openSession(pending.machineId, pending.sessionId);
    };
    void restore();
    setNotifications(Attention.isEnabled() ? "on" : "off");
    setBatteryRestricted(Attention.isBatteryRestricted());
    const offOpen = Attention.onOpenSession(({ machineId, sessionId }) =>
      openSession(machineId, sessionId),
    );
    const offAttention = Attention.onAttention((attention) => {
      setBanner((shown) => {
        if (attention.kind === "resolved") return shown?.key === attention.key ? null : shown;
        return attention;
      });
    });
    return () => {
      offOpen();
      offAttention();
    };
  }, [openSession, persist]);

  const toggleNotifications = useCallback(async () => {
    if (notifications === "on") {
      Attention.setEnabled(false);
      setNotifications("off");
      return;
    }
    if (!(await requestNotificationPermission())) {
      setNotifications("denied");
      Attention.openNotificationSettings();
      return;
    }
    Attention.setEnabled(true);
    setNotifications("on");
    setBatteryRestricted(Attention.isBatteryRestricted());
  }, [notifications]);

  const onSession = useCallback((sessionId: string) => {
    const machine = currentRef.current;
    Attention.setOnScreen(machine?.id ?? "", sessionId);
    setBanner((shown) => (shown !== null && shown.sessionId === sessionId ? null : shown));
  }, []);

  /** Probe every link; the probe also brings the list new relay members, node ids and renames. */
  const probeNow = useCallback(async () => {
    let found: PhoneProbe;
    try {
      found = await Attention.probeLinks();
    } catch {
      // The native side never rejects on a link failure; this is the bridge itself.
      return;
    }
    if (!restored.current) return;
    setProbe(found);
    const next = applyPhoneProbe(machinesRef.current, found);
    if (next !== machinesRef.current) persist(next);
  }, [persist]);

  // While the app's own screens are up: probe now, every PROBE_MS, and on return to the app.
  useEffect(() => {
    if (current !== null) return undefined;
    void probeNow();
    const timer = setInterval(() => void probeNow(), PROBE_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void probeNow();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [current, machines.length, probeNow]);

  /** Add machines; one already in the list (same node) gains the new link instead. */
  const addMachines = useCallback(
    (added: Machine[]) => persist(addPhoneMachines(machinesRef.current, added)),
    [persist],
  );
  const leaveNetwork = useCallback(
    (key: string) => persist(leavePhoneNetwork(machinesRef.current, key)),
    [persist],
  );
  /** Remove a machine added by address; a relay network's machines leave with the network. */
  const removeMachine = useCallback(
    (id: string) => persist(machinesRef.current.filter((machine) => machine.id !== id)),
    [persist],
  );
  /** How the phone reaches a machine: its door and its event stream follow (native setMachines). */
  const changeMode = useCallback(
    (id: string, mode: RouteMode) => persist(setPhoneMode(machinesRef.current, id, mode)),
    [persist],
  );
  const showLinks = useCallback(() => setScreen("links"), []);
  const showMachines = useCallback(() => setScreen("machines"), []);
  const showScanner = useCallback(() => setScreen("scan"), []);
  const openMachine = useCallback((machine: Machine) => {
    setInitialSession(null);
    setCurrent(machine);
  }, []);
  const onToggleNotifications = useCallback(
    () => void toggleNotifications(),
    [toggleNotifications],
  );
  const fixBattery = useCallback(() => {
    Attention.requestBatteryExemption();
    setBatteryRestricted(false);
  }, []);
  const openBanner = useCallback(
    (attention: Attention.Attention) => openSession(attention.machineId, attention.sessionId),
    [openSession],
  );
  const dismissBanner = useCallback(() => setBanner(null), []);

  const back = useCallback(() => {
    Attention.setOnScreen("", "");
    setInitialSession(null);
    setCurrent(null);
  }, []);

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        {current === null && screen === "links" ? (
          <LinksScreen
            machines={machines}
            probe={probe}
            onAdd={addMachines}
            onLeave={leaveNetwork}
            onScan={showScanner}
            onBack={showMachines}
          />
        ) : null}
        {current === null && screen === "scan" ? (
          <PairScanner
            machines={machines}
            onAdd={addMachines}
            onClose={showLinks}
            onManual={showLinks}
          />
        ) : null}
        {current === null && screen === "machines" ? (
          <MachineList
            machines={machines}
            probe={probe}
            notifications={notifications}
            batteryRestricted={batteryRestricted}
            onAdd={addMachines}
            onRemove={removeMachine}
            onMode={changeMode}
            onOpen={openMachine}
            onToggleNotifications={onToggleNotifications}
            onFixBattery={fixBattery}
            onLinks={showLinks}
          />
        ) : null}
        {current === null ? null : (
          <MachineView
            key={current.id}
            ref={view}
            machine={current}
            initialSession={initialSession}
            onSession={onSession}
            onBack={back}
          />
        )}
        {banner === null ? null : (
          <AttentionBanner attention={banner} onOpen={openBanner} onDismiss={dismissBanner} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

function createStyles(c: Palette) {
  return { root: { flex: 1, backgroundColor: c.bg } } as const;
}
