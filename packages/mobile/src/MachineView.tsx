import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { WebViewHttpErrorEvent } from "react-native-webview/lib/WebViewTypes";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { BRIDGE, openSessionScript, parseBridgeMessage } from "./bridge";
import { t } from "./strings";
import { useStyles, type Palette } from "./theme";

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
  const web = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const pending = useRef(props.initialSession);
  const [failed, setFailed] = useState(false);
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
  const onError = useCallback(() => setFailed(true), []);
  const onHttpError = useCallback(
    (event: WebViewHttpErrorEvent) => setFailed(event.nativeEvent.statusCode >= 500),
    [],
  );
  const retry = useCallback(() => web.current?.reload(), []);

  return (
    <View style={styles.root}>
      <WebView
        ref={web}
        source={source}
        injectedJavaScript={BRIDGE}
        onMessage={onMessage}
        onNavigationStateChange={onNavigation}
        onLoadStart={onLoadStart}
        onError={onError}
        onHttpError={onHttpError}
        domStorageEnabled
        javaScriptEnabled
        allowsBackForwardNavigationGestures
        setSupportMultipleWindows={false}
        pullToRefreshEnabled
        style={styles.web}
      />
      {failed ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t("offline")}</Text>
          <Pressable onPress={retry} style={styles.retry}>
            <Text style={styles.retryText}>↻</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

function createStyles(c: Palette) {
  return {
    root: { flex: 1, backgroundColor: c.bg },
    web: { flex: 1, backgroundColor: "transparent" },
    banner: {
      position: "absolute",
      left: 16,
      right: 16,
      top: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: 12,
      borderWidth: 0.5,
      backgroundColor: c.card,
      borderColor: c.border,
    },
    bannerText: { flex: 1, fontSize: 14, color: c.text },
    retry: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accent,
    },
    retryText: { color: "#FFFFFF", fontSize: 18 },
  } as const;
}
