import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  findNodeHandle,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { WebViewHttpErrorEvent } from "react-native-webview/lib/WebViewTypes";
import {
  doorFailure,
  machineOpen,
  onNetwork,
  setPageVisible,
  type Machine,
} from "../modules/kivotos-attention/src/KivotosAttentionModule";
import {
  assignScript,
  BRIDGE,
  openSessionScript,
  parseBridgeMessage,
  PEERS_SCRIPT,
  type ListedMachine,
  type SwitchTarget,
} from "./bridge";
import { KivotosMark } from "./icons";
import { doorText, t } from "./strings";
import { radius, useColors, useStyles, type Palette } from "./theme";
import type { OpenRequest } from "./views";

const EDGES = ["top", "bottom"] as const;
/**
 * Appended to the WebView's User-Agent. The plugin's client module reads it to
 * know the page runs in this app (packages/kivotos/src/client.tsx, IN_APP).
 */
const USER_AGENT_NAME = "Kivotos";
/** Waits before each automatic retry of a page that failed to load; the last repeats. */
const RETRY_MS = [2000, 5000, 10_000, 15_000];
/** Retries on a network change or a return to the app closer together than this are one. */
const RETRY_BURST_MS = 1000;

/** The page's main document did not load: the app's cover replaces it. */
interface Failure {
  /** One line: each link the door tried and why it failed, or the generic advice. */
  detail: string;
  /** Automatic retries that failed so far. */
  attempt: number;
  /** A retry is loading. */
  trying: boolean;
}

interface Props {
  /** The view's key (`LiveView.key`), which every callback names. */
  viewKey: string;
  /** The machine whose door the page loads through. */
  machine: Machine;
  /** Loaded on the door at mount: "/", or a peer's mount path. */
  path: string;
  /** What the page shows, for the splash and the offline card. */
  name: string;
  /**
   * On screen. A hidden page stays loaded (display none, out of the
   * accessibility tree and of touch), so showing it again is instant; a page
   * loaded ahead is hidden from the start.
   */
  visible: boolean;
  /** Ask the page, when its shell is up on screen, which machines its computer lists (`onReady`). */
  listPeers: boolean;
  /** A Session to open (a notification tap); a new request opens it again. */
  open: OpenRequest | null;
  /** The Session shown changed ("" for none); reported again when the page is shown. */
  onSession: (viewKey: string, sessionId: string) => void;
  /**
   * The page's switcher asked for another machine.
   * @returns whether the app shows a page for it; when not, the page navigates to the fallback.
   */
  onSwitch: (viewKey: string, target: SwitchTarget, sessionId: string | undefined) => boolean;
  /** The WebView's renderer is gone: this page cannot be shown again. */
  onGone: (viewKey: string) => void;
  /**
   * dsh's shell is up in the page, or the page was shown again with it up.
   * `listed`: what the computer lists, with `listPeers` on screen; else null.
   */
  onReady: (viewKey: string, listed: ListedMachine[] | null) => void;
  /** The page did not load: no answer, or a status other than 200. */
  onFailed: (viewKey: string) => void;
  /** Back past the page's own history. */
  onBack: (viewKey: string) => void;
}

/**
 * Height the soft keyboard covers, minus the bottom inset the screen already
 * pads. With edge-to-edge on (Android 15 default) `adjustResize` no longer
 * shrinks the WebView, so the page never learns about the keyboard and dsh's
 * composer stays underneath it. Shrinking the WebView here gives dsh a
 * shorter viewport; its frame pins the composer to that viewport's bottom.
 */
function useKeyboardInset(bottomInset: number): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) =>
      setHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return Math.max(0, height - bottomInset);
}
/** One machine's complete dsh UI. */
export const MachineView = memo(function MachineView(props: Props) {
  const { viewKey, machine, path, name, visible, listPeers, open } = props;
  const { onBack, onSession, onSwitch, onGone, onReady, onFailed } = props;
  const styles = useStyles(createStyles);
  const colors = useColors();
  const web = useRef<WebView>(null);
  const holder = useRef<View>(null);
  const canGoBack = useRef(false);
  // A Session to open once dsh is up: the request the page was mounted with, or one that came while it loaded.
  const pending = useRef(open?.sessionId ?? null);
  const handled = useRef(open?.seq);
  // dsh is up in the current document: its bridge has reported.
  const ready = useRef(false);
  // The Session the page last reported; null until it has.
  const session = useRef<string | null>(null);
  // dsh's shell is up in the current document: the bridge posted `ready`.
  const shell = useRef(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // The main document's load since the last retry failed; a page that reports after that is the failure's own.
  const errored = useRef(false);
  const triedAt = useRef(0);
  // The app is in the foreground; retries pause while it is not.
  const [active, setActive] = useState(AppState.currentState === "active");
  // The page was on screen in the foreground when the retry effect last ran.
  const onScreen = useRef(visible && active);
  // The splash covers only the first load; dsh's own UI handles later navigation.
  const [loaded, setLoaded] = useState(false);
  // Every machine loads through its local door, which the native side opens here.
  const [source] = useState(() => ({ uri: `${machineOpen(machine)}${path}` }));
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset(insets.bottom);
  const keyboardSpace = useMemo(() => ({ height: keyboard }), [keyboard]);

  // A new request: open it now, or once dsh is up.
  useEffect(() => {
    if (open === null || open.seq === handled.current) return;
    handled.current = open.seq;
    if (ready.current) web.current?.injectJavaScript(openSessionScript(open.sessionId));
    else pending.current = open.sessionId;
  }, [open]);

  // The page learns it is hidden (visibilityState, throttled timers) and stops rendering.
  const applyVisible = useCallback(() => {
    const tag = findNodeHandle(holder.current);
    if (tag !== null) void setPageVisible(tag, visible);
  }, [visible]);
  useEffect(applyVisible, [applyVisible]);

  // Shown again: its Session is the one on screen.
  useEffect(() => {
    if (visible && session.current !== null) onSession(viewKey, session.current);
  }, [visible, viewKey, onSession]);

  const reportReady = useCallback(() => {
    if (visible && listPeers) web.current?.injectJavaScript(PEERS_SCRIPT);
    else onReady(viewKey, null);
  }, [visible, listPeers, viewKey, onReady]);

  // Shown again with its shell up: ready on screen.
  useEffect(() => {
    if (visible && shell.current) reportReady();
  }, [visible, reportReady]);

  // Only the page on screen takes the hardware Back.
  useEffect(() => {
    if (!visible) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack.current) web.current?.goBack();
      else onBack(viewKey);
      return true;
    });
    return () => subscription.remove();
  }, [visible, viewKey, onBack]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseBridgeMessage(event.nativeEvent.data);
      if (message === null) return;
      // A document that loaded without an error runs the bridge: the page is back.
      if (!errored.current) setFailure(null);
      if (message.type === "kivotos.switch") {
        // `fallback` is one of the switcher's own paths (bridge.ts, isFallbackFor).
        if (!onSwitch(viewKey, message.machine, message.sessionId))
          web.current?.injectJavaScript(assignScript(message.fallback));
        return;
      }
      if (message.type === "ready") {
        shell.current = true;
        reportReady();
        return;
      }
      if (message.type === "kivotos.peers") {
        onReady(viewKey, message.machines);
        return;
      }
      ready.current = true;
      // A tap that launched the app: open its Session once dsh is up.
      if (pending.current !== null) {
        const sessionId = pending.current;
        pending.current = null;
        if (message.sessionId !== sessionId) {
          web.current?.injectJavaScript(openSessionScript(sessionId));
          return;
        }
      }
      session.current = message.sessionId;
      if (visible) onSession(viewKey, message.sessionId);
    },
    [viewKey, visible, onSession, onSwitch, onReady, reportReady],
  );
  const onNavigation = useCallback((state: WebViewNavigation) => {
    canGoBack.current = state.canGoBack;
  }, []);
  // Not the end of a failure: Chromium's error page for it starts a load too.
  const onLoadStart = useCallback(() => {
    ready.current = false;
    shell.current = false;
    // A page mounted hidden (loaded ahead): its WebView may not have existed when the effect ran.
    applyVisible();
  }, [applyVisible]);
  const onLoadEnd = useCallback(() => setLoaded(true), []);
  // The main document failed (both callbacks report only the main frame): cover it.
  const fail = useCallback(() => {
    errored.current = true;
    const failures = doorFailure(machine.id);
    const detail = failures.length > 0 ? doorText(failures) : t("offlineDetail");
    setFailure((last) => ({
      detail,
      attempt: last === null ? 0 : last.attempt + (last.trying ? 1 : 0),
      trying: false,
    }));
  }, [machine.id]);
  const onError = useCallback(() => {
    fail();
    onFailed(viewKey);
  }, [fail, viewKey, onFailed]);
  const onHttpError = useCallback(
    (event: WebViewHttpErrorEvent) => {
      const { statusCode } = event.nativeEvent;
      if (statusCode >= 500) fail();
      if (statusCode !== 200) onFailed(viewKey);
    },
    [fail, viewKey, onFailed],
  );
  const onRenderProcessGone = useCallback(() => onGone(viewKey), [viewKey, onGone]);
  const back = useCallback(() => onBack(viewKey), [viewKey, onBack]);
  const retry = useCallback(() => {
    triedAt.current = Date.now();
    errored.current = false;
    setFailure((last) => last && { ...last, trying: true });
    web.current?.reload();
  }, []);
  const retryNow = useCallback(() => {
    if (Date.now() - triedAt.current > RETRY_BURST_MS) retry();
  }, [retry]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  // While the cover is on screen in the foreground, retry by itself: after a
  // wait that grows with each failed retry, and at once when the page is shown
  // again or the app comes back. A retry still loading is left to finish: over
  // a slow link that takes minutes. In the background the timer is cancelled.
  useEffect(() => {
    const now = visible && active;
    const returned = now && !onScreen.current;
    onScreen.current = now;
    if (failure === null || failure.trying || !now) return undefined;
    const wait = returned ? 0 : RETRY_MS[Math.min(failure.attempt, RETRY_MS.length - 1)];
    const timer = setTimeout(retry, wait);
    return () => clearTimeout(timer);
  }, [failure, visible, active, retry]);

  // ... and at once when the phone's network changes, only in the foreground.
  const failed = failure !== null;
  useEffect(() => {
    if (!failed || !visible || !active) return undefined;
    return onNetwork(retryNow);
  }, [failed, visible, active, retryNow]);

  return (
    <SafeAreaView
      style={visible ? styles.root : styles.hidden}
      edges={EDGES}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
    >
      <View ref={holder} collapsable={false} style={styles.web}>
        <WebView
          ref={web}
          source={source}
          injectedJavaScript={BRIDGE}
          applicationNameForUserAgent={USER_AGENT_NAME}
          onMessage={onMessage}
          onNavigationStateChange={onNavigation}
          onLoadStart={onLoadStart}
          onLoadEnd={onLoadEnd}
          onError={onError}
          onHttpError={onHttpError}
          onRenderProcessGone={onRenderProcessGone}
          domStorageEnabled
          javaScriptEnabled
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
          pullToRefreshEnabled
          style={styles.web}
        />
      </View>
      <View style={keyboardSpace} />
      {!loaded && failure === null ? (
        <View style={styles.cover}>
          <KivotosMark size={56} />
          <ActivityIndicator color={colors.textTertiary} />
          <Text style={styles.coverText}>{t("loading", { name })}</Text>
        </View>
      ) : null}
      {failure !== null ? (
        <View style={styles.cover}>
          <View style={styles.card}>
            <KivotosMark size={40} />
            <Text style={styles.cardTitle}>{t("offline", { name })}</Text>
            <Text style={styles.cardText}>{failure.detail}</Text>
            <View style={styles.cardActions}>
              <Pressable onPress={back} style={styles.secondary} accessibilityRole="button">
                <Text style={styles.secondaryText}>{t("back")}</Text>
              </Pressable>
              <Pressable onPress={retry} style={styles.primary} accessibilityRole="button">
                {failure.trying ? (
                  <ActivityIndicator color={colors.onPrimary} accessibilityLabel={t("retry")} />
                ) : (
                  <Text style={styles.primaryText}>{t("retry")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
});

function createStyles(c: Palette) {
  const button = {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  } as const;
  return {
    root: { flex: 1, backgroundColor: c.bg },
    hidden: { display: "none", pointerEvents: "none" },
    web: { flex: 1, backgroundColor: "transparent" },
    cover: {
      ...StyleSheet.absoluteFill,
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      padding: 24,
      backgroundColor: c.bg,
    },
    coverText: { fontSize: 14, color: c.textTertiary },
    card: {
      alignSelf: "stretch",
      maxWidth: 420,
      alignItems: "center",
      gap: 10,
      padding: 24,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    cardTitle: {
      fontSize: 17,
      fontWeight: "600",
      marginTop: 6,
      textAlign: "center",
      color: c.text,
    },
    cardText: { fontSize: 14, lineHeight: 20, textAlign: "center", color: c.textSecondary },
    cardActions: { flexDirection: "row", alignSelf: "stretch", gap: 10, marginTop: 10 },
    secondary: { ...button, backgroundColor: c.pressed },
    secondaryText: { fontSize: 15, fontWeight: "500", color: c.text },
    primary: { ...button, backgroundColor: c.primary },
    primaryText: { fontSize: 15, fontWeight: "600", color: c.onPrimary },
  } as const;
}
