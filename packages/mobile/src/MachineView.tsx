import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { WebViewHttpErrorEvent } from "react-native-webview/lib/WebViewTypes";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { BRIDGE, openSessionScript, parseBridgeMessage } from "./bridge";
import { KivotosMark } from "./icons";
import { t } from "./strings";
import { radius, useColors, useStyles, type Palette } from "./theme";

const EDGES = ["top", "bottom"] as const;

/** Imperative handle: open a Session inside the loaded dsh page. */
export interface MachineViewHandle {
  openSession(sessionId: string): void;
}

interface Props {
  machine: Machine;
  /** A Session to open once the page is loaded (from a notification tap). */
  initialSession: string | null;
  /** The Session shown changed ("" for none). */
  onSession: (sessionId: string) => void;
  onBack: () => void;
}

/** One machine's complete dsh UI. */
export const MachineView = forwardRef<MachineViewHandle, Props>(function MachineView(props, ref) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const web = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const pending = useRef(props.initialSession);
  const [failed, setFailed] = useState(false);
  // The splash covers only the first load; dsh's own UI handles later navigation.
  const [loaded, setLoaded] = useState(false);
  const [source] = useState(() => ({ uri: `${props.machine.url}/` }));
  const { onBack, onSession } = props;

  useImperativeHandle(ref, () => ({
    openSession(sessionId: string) {
      web.current?.injectJavaScript(openSessionScript(sessionId));
    },
  }));

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack.current) web.current?.goBack();
      else onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseBridgeMessage(event.nativeEvent.data);
      if (message === null) return;
      // A tap that launched the app: open its Session once dsh is up.
      if (pending.current !== null) {
        const sessionId = pending.current;
        pending.current = null;
        if (message.sessionId !== sessionId) {
          web.current?.injectJavaScript(openSessionScript(sessionId));
          return;
        }
      }
      onSession(message.sessionId);
    },
    [onSession],
  );
  const onNavigation = useCallback((state: WebViewNavigation) => {
    canGoBack.current = state.canGoBack;
  }, []);
  const onLoadStart = useCallback(() => setFailed(false), []);
  const onLoadEnd = useCallback(() => setLoaded(true), []);
  const onError = useCallback(() => setFailed(true), []);
  const onHttpError = useCallback(
    (event: WebViewHttpErrorEvent) => setFailed(event.nativeEvent.statusCode >= 500),
    [],
  );
  const retry = useCallback(() => {
    setFailed(false);
    web.current?.reload();
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={EDGES}>
      <WebView
        ref={web}
        source={source}
        injectedJavaScript={BRIDGE}
        onMessage={onMessage}
        onNavigationStateChange={onNavigation}
        onLoadStart={onLoadStart}
        onLoadEnd={onLoadEnd}
        onError={onError}
        onHttpError={onHttpError}
        domStorageEnabled
        javaScriptEnabled
        allowsBackForwardNavigationGestures
        setSupportMultipleWindows={false}
        pullToRefreshEnabled
        style={styles.web}
      />
      {!loaded && !failed ? (
        <View style={styles.cover}>
          <KivotosMark size={56} />
          <ActivityIndicator color={colors.textTertiary} />
          <Text style={styles.coverText}>{t("loading", { name: props.machine.name })}</Text>
        </View>
      ) : null}
      {failed ? (
        <View style={styles.cover}>
          <View style={styles.card}>
            <KivotosMark size={40} />
            <Text style={styles.cardTitle}>{t("offline", { name: props.machine.name })}</Text>
            <Text style={styles.cardText}>{t("offlineDetail")}</Text>
            <View style={styles.cardActions}>
              <Pressable onPress={onBack} style={styles.secondary} accessibilityRole="button">
                <Text style={styles.secondaryText}>{t("back")}</Text>
              </Pressable>
              <Pressable onPress={retry} style={styles.primary} accessibilityRole="button">
                <Text style={styles.primaryText}>{t("retry")}</Text>
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
