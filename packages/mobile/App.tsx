import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform, useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as Attention from "./modules/kivotos-attention/src/KivotosAttentionModule";
import type { Machine } from "./modules/kivotos-attention/src/KivotosAttentionModule";
import { AttentionBanner } from "./src/AttentionBanner";
import { MachineList } from "./src/MachineList";
import { MachineView, type MachineViewHandle } from "./src/MachineView";
import { loadMachines, saveMachines } from "./src/machines";
import { useStyles, type Palette } from "./src/theme";

type NotificationState = "on" | "off" | "denied";

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
  const view = useRef<MachineViewHandle>(null);
  const currentRef = useRef<Machine | null>(null);
  const machinesRef = useRef<Machine[]>([]);
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
      setMachines(stored);
      Attention.setMachines(stored);
      // A tap that launched the app before this listener existed.
      const pending = Attention.takePendingOpen();
      if (pending !== null) {
        machinesRef.current = stored;
        openSession(pending.machineId, pending.sessionId);
      }
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
  }, [openSession]);

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

  const addMachine = useCallback(
    (machine: Machine) => persist([...machinesRef.current, machine]),
    [persist],
  );
  const removeMachine = useCallback(
    (id: string) => persist(machinesRef.current.filter((machine) => machine.id !== id)),
    [persist],
  );
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
      <SafeAreaView style={styles.root} edges={EDGES}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        {current === null ? (
          <MachineList
            machines={machines}
            notifications={notifications}
            batteryRestricted={batteryRestricted}
            onAdd={addMachine}
            onRemove={removeMachine}
            onOpen={openMachine}
            onToggleNotifications={onToggleNotifications}
            onFixBattery={fixBattery}
          />
        ) : (
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
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const EDGES = ["top", "bottom"] as const;

function createStyles(c: Palette) {
  return { root: { flex: 1, backgroundColor: c.bg } } as const;
}
