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
import { MachineView } from "./src/MachineView";
import { loadMachines, saveMachines } from "./src/machines";
import { PairScanner } from "./src/PairScanner";
import { useStyles, type Palette } from "./src/theme";
import { followMachines, showView, type LiveView, type OpenRequest } from "./src/views";

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
  /** The machine on screen; null while the app's own screens are. */
  const [shown, setShown] = useState<string | null>(null);
  /** Machines whose page stays loaded, the least recently shown first. */
  const [views, setViews] = useState<LiveView[]>([]);
  const [notifications, setNotifications] = useState<NotificationState>("off");
  const [batteryRestricted, setBatteryRestricted] = useState(false);
  const [banner, setBanner] = useState<Attention.Attention | null>(null);
  const [screen, setScreen] = useState<Screen>("machines");
  const [probe, setProbe] = useState<PhoneProbe | null>(null);
  const shownRef = useRef<string | null>(null);
  const machinesRef = useRef<Machine[]>([]);
  const openSeq = useRef(0);
  /** The stored list has been read: before that, a probe would be folded into an empty list and saved over it. */
  const restored = useRef(false);
  shownRef.current = shown;
  machinesRef.current = machines;

  const persist = useCallback((next: Machine[]) => {
    setMachines(next);
    void saveMachines(next);
    Attention.setMachines(next);
    setViews((live) => followMachines(live, next, shownRef.current));
  }, []);

  /** Show a machine's page, loaded already when it is still alive. */
  const show = useCallback((machine: Machine, open: OpenRequest | null) => {
    // Until its page reports, no Session of the machine left is on screen.
    Attention.setOnScreen(machine.id, "");
    setViews((live) => showView(live, machine, open));
    setShown(machine.id);
  }, []);

  /** Open a Session: show its machine, whose page then opens it. */
  const openSession = useCallback(
    (machineId: string, sessionId: string) => {
      const machine = machinesRef.current.find((item) => item.id === machineId);
      if (machine === undefined) return;
      setBanner(null);
      openSeq.current += 1;
      show(machine, { sessionId, seq: openSeq.current });
    },
    [show],
  );

  /** Short of memory: only the page on screen stays loaded. */
  const dropHidden = useCallback(
    () => setViews((live) => live.filter((view) => view.id === shownRef.current)),
    [],
  );

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
      setBanner((visible) => {
        if (attention.kind === "resolved") return visible?.key === attention.key ? null : visible;
        return attention;
      });
    });
    const offMemory = Attention.onMemoryPressure(dropHidden);
    return () => {
      offOpen();
      offAttention();
      offMemory();
    };
  }, [dropHidden, openSession, persist]);

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

  /** A page's Session changed or its page was shown again; only the page on screen counts. */
  const onSession = useCallback((machineId: string, sessionId: string) => {
    if (machineId !== shownRef.current) return;
    Attention.setOnScreen(machineId, sessionId);
    setBanner((visible) => (visible !== null && visible.sessionId === sessionId ? null : visible));
  }, []);

  /** A WebView's renderer is gone: drop its page, and load the one on screen again. */
  const onGone = useCallback((machineId: string) => {
    setViews((live) =>
      live.flatMap((view) => {
        if (view.id !== machineId) return [view];
        if (view.id !== shownRef.current) return [];
        return [{ ...view, generation: view.generation + 1, open: null }];
      }),
    );
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
    if (shown !== null) return undefined;
    void probeNow();
    const timer = setInterval(() => void probeNow(), PROBE_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void probeNow();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [shown, machines.length, probeNow]);

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
  const openMachine = useCallback((machine: Machine) => show(machine, null), [show]);
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

  /** Back to the list: the page stays loaded, hidden. */
  const back = useCallback(() => {
    Attention.setOnScreen("", "");
    setShown(null);
  }, []);

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        {shown === null && screen === "links" ? (
          <LinksScreen
            machines={machines}
            probe={probe}
            onAdd={addMachines}
            onLeave={leaveNetwork}
            onScan={showScanner}
            onBack={showMachines}
          />
        ) : null}
        {shown === null && screen === "scan" ? (
          <PairScanner
            machines={machines}
            onAdd={addMachines}
            onClose={showLinks}
            onManual={showLinks}
          />
        ) : null}
        {shown === null && screen === "machines" ? (
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
        {machines.map((machine) => {
          // In list order, so showing another page never moves a WebView.
          const view = views.find((live) => live.id === machine.id);
          return view === undefined ? null : (
            <MachineView
              key={`${view.id}:${view.generation}`}
              machine={machine}
              visible={view.id === shown}
              open={view.open}
              onSession={onSession}
              onGone={onGone}
              onBack={back}
            />
          );
        })}
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
