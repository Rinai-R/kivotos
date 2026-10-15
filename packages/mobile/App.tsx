import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, PermissionsAndroid, Platform, useColorScheme, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  addPhoneMachines,
  applyPhoneProbe,
  leavePhoneNetwork,
  routeOf,
  setPhoneMode,
  type PhoneProbe,
  type RouteMode,
} from "../kivotos/src/machines";
import * as Attention from "./modules/kivotos-attention/src/KivotosAttentionModule";
import type { Machine } from "./modules/kivotos-attention/src/KivotosAttentionModule";
import { AttentionBanner } from "./src/AttentionBanner";
import { LinksScreen } from "./src/LinksScreen";
import { MachineList } from "./src/MachineList";
import type { ListedMachine, SwitchTarget } from "./src/bridge";
import { MachineView } from "./src/MachineView";
import { loadMachines, saveMachines } from "./src/machines";
import { PairScanner } from "./src/PairScanner";
import { usePreloader } from "./src/preload";
import { keepRows, loadRecent, NO_RECENT, saveRecent, withPeer, type Recent } from "./src/recent";
import { useStyles, type Palette } from "./src/theme";
import {
  followMachines,
  keyOf,
  pathOf,
  preloadTargets,
  showView,
  switchTarget,
  type LiveView,
  type OpenRequest,
} from "./src/views";

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
  /** The page on screen (`LiveView.key`); null while the app's own screens are. */
  const [shown, setShown] = useState<string | null>(null);
  /** Pages that stay loaded, the least recently shown first. */
  const [views, setViews] = useState<LiveView[]>([]);
  const [notifications, setNotifications] = useState<NotificationState>("off");
  const [batteryRestricted, setBatteryRestricted] = useState(false);
  const [banner, setBanner] = useState<Attention.Attention | null>(null);
  const [screen, setScreen] = useState<Screen>("machines");
  const [probe, setProbe] = useState<PhoneProbe | null>(null);
  const shownRef = useRef<string | null>(null);
  const machinesRef = useRef<Machine[]>([]);
  const probeRef = useRef<PhoneProbe | null>(null);
  const viewsRef = useRef<LiveView[]>([]);
  const openSeq = useRef(0);
  /** The stored list has been read: before that, a probe would be folded into an empty list and saved over it. */
  const restored = useRef(false);
  /** What was opened lately, read with the list: decides what is loaded ahead. */
  const recent = useRef<Recent>(NO_RECENT);
  /** The page opened last was considered for loading ahead at start. */
  const startPreloaded = useRef(false);
  shownRef.current = shown;
  machinesRef.current = machines;
  probeRef.current = probe;
  viewsRef.current = views;
  const preloader = usePreloader(machines, views, shown, setViews);

  const remember = useCallback((next: Recent) => {
    if (next === recent.current) return;
    recent.current = next;
    void saveRecent(next);
  }, []);

  const persist = useCallback(
    (next: Machine[]) => {
      setMachines(next);
      void saveMachines(next);
      Attention.setMachines(next);
      setViews((live) => followMachines(live, next, shownRef.current));
      remember(keepRows(recent.current, new Set(next.map((machine) => machine.id))));
    },
    [remember],
  );

  /** Show the page of a machine, or of a peer its computer mounts, loaded already when it is still alive. */
  const show = useCallback(
    (machine: Machine, peer: LiveView["peer"], open: OpenRequest | null) => {
      // Until the page reports, no Session of the page left is on screen.
      Attention.setOnScreen(machine.id, "");
      setViews((live) => showView(live, machine, peer, open));
      setShown(keyOf(machine.id, peer));
      if (peer === null && recent.current.row !== machine.id)
        remember({ ...recent.current, row: machine.id });
    },
    [remember],
  );

  /** Open a Session: show its machine, whose page then opens it. */
  const openSession = useCallback(
    (machineId: string, sessionId: string) => {
      const machine = machinesRef.current.find((item) => item.id === machineId);
      if (machine === undefined) return;
      setBanner(null);
      openSeq.current += 1;
      show(machine, null, { sessionId, seq: openSeq.current });
    },
    [show],
  );

  /** Short of memory: pages loaded ahead go first, else all but the page on screen. */
  const dropHidden = useCallback(() => {
    preloader.pause();
    setViews((live) => {
      const hidden = live.filter((view) => view.key !== shownRef.current);
      const ahead = hidden.filter((view) => view.preloaded);
      const drop = ahead.length > 0 ? ahead : hidden;
      return live.filter((view) => !drop.includes(view));
    });
  }, [preloader]);

  useEffect(() => {
    const restore = async (): Promise<void> => {
      const [stored, opened] = await Promise.all([loadMachines(), loadRecent()]);
      machinesRef.current = stored;
      recent.current = opened;
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

  /**
   * A page's Session changed or its page was shown again; only the page on
   * screen counts. A peer's page counts for the machine whose door it loads
   * through, with the peer's Session: no frame of that machine names it, so
   * all of the machine's own notifications still post.
   */
  const onSession = useCallback((viewKey: string, sessionId: string) => {
    if (viewKey !== shownRef.current) return;
    const view = viewsRef.current.find((live) => live.key === viewKey);
    if (view === undefined) return;
    Attention.setOnScreen(view.machine, sessionId);
    setBanner((visible) => (visible !== null && visible.sessionId === sessionId ? null : visible));
  }, []);

  /**
   * A page's switcher asked for another machine: show the phone's own row for
   * it, else the page of it its computer mounts, both kept loaded.
   */
  const onSwitch = useCallback(
    (viewKey: string, target: SwitchTarget, sessionId: string | undefined) => {
      // Only the page on screen switches; a hidden page's request is dropped, fallback included.
      if (viewKey !== shownRef.current) return true;
      const from = viewsRef.current.find((live) => live.key === viewKey);
      if (from === undefined) return false;
      const to = switchTarget(machinesRef.current, probeRef.current, from, target);
      if (to === null) return false;
      let open: OpenRequest | null = null;
      if (sessionId !== undefined) {
        openSeq.current += 1;
        open = { sessionId, seq: openSeq.current };
      }
      show(to.machine, to.peer, open);
      if (target.id !== null) remember(withPeer(recent.current, from.machine, target.id));
      return true;
    },
    [show, remember],
  );

  /**
   * A page's shell is up. One loading ahead lets the next one start; a phone
   * row's page on screen loads ahead the pages its switcher would show for
   * the machines its computer lists with a route (`preloadTargets`).
   */
  const onReady = useCallback(
    (viewKey: string, listed: ListedMachine[] | null) => {
      preloader.loaded(viewKey);
      if (viewKey !== shownRef.current || listed === null) return;
      const from = viewsRef.current.find((live) => live.key === viewKey);
      if (from === undefined || from.peer !== null) return;
      const lately = recent.current.peers[from.machine] ?? [];
      preloader.plan(preloadTargets(machinesRef.current, probeRef.current, from, listed, lately));
    },
    [preloader],
  );

  /** A page did not load: one loaded ahead goes; the next switch to it loads it again. */
  const onFailed = useCallback((viewKey: string) => {
    setViews((live) =>
      live.filter(
        (view) => view.key !== viewKey || !view.preloaded || view.key === shownRef.current,
      ),
    );
  }, []);

  /** A WebView's renderer is gone: drop its page, and load the one on screen again. */
  const onGone = useCallback((viewKey: string) => {
    // The page loading again has no Session on screen until it reports one.
    if (viewKey === shownRef.current) Attention.setOnScreen("", "");
    setViews((live) =>
      live.flatMap((view) => {
        if (view.key !== viewKey) return [view];
        if (view.key !== shownRef.current) return [];
        return [{ ...view, generation: view.generation + 1, open: null }];
      }),
    );
  }, []);

  // The page on screen went (its row removed, its network left): back to the list.
  useEffect(() => {
    if (shown === null || views.some((view) => view.key === shown)) return;
    Attention.setOnScreen("", "");
    setShown(null);
  }, [shown, views]);

  // At start, once the list has been probed: load the row opened last ahead, when it is reachable.
  useEffect(() => {
    if (startPreloaded.current || probe === null) return;
    startPreloaded.current = true;
    const machine = machinesRef.current.find((row) => row.id === recent.current.row);
    const links = probe.machines.find((entry) => entry.id === machine?.id);
    if (machine === undefined || links === undefined) return;
    if (routeOf(links, machine.mode ?? "auto") !== null) preloader.plan([{ machine, peer: null }]);
  }, [probe, preloader]);

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
  const openMachine = useCallback((machine: Machine) => show(machine, null, null), [show]);
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

  /** Back from a page: a peer's page goes to its computer's, a machine's to the list; the page stays loaded, hidden. */
  const back = useCallback(
    (viewKey: string) => {
      const view = viewsRef.current.find((live) => live.key === viewKey);
      const machine = machinesRef.current.find((item) => item.id === view?.machine);
      if (view?.peer != null && machine !== undefined) {
        show(machine, null, null);
        return;
      }
      Attention.setOnScreen("", "");
      setShown(null);
    },
    [show],
  );

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
        {[...views].sort(byKey).map((view) => {
          // In key order, so showing another page never moves a WebView.
          const machine = machines.find((item) => item.id === view.machine);
          return machine === undefined ? null : (
            <MachineView
              key={`${view.key}:${view.generation}`}
              viewKey={view.key}
              machine={machine}
              path={pathOf(view)}
              name={view.peer?.name ?? machine.name}
              visible={view.key === shown}
              listPeers={view.peer === null}
              open={view.open}
              onSession={onSession}
              onSwitch={onSwitch}
              onGone={onGone}
              onReady={onReady}
              onFailed={onFailed}
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

const byKey = (a: LiveView, b: LiveView): number => (a.key < b.key ? -1 : 1);

function createStyles(c: Palette) {
  return { root: { flex: 1, backgroundColor: c.bg } } as const;
}
