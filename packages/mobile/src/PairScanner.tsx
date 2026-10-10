import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { setStatusBarStyle } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  Appearance,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { CloseGlyph, KeyboardGlyph } from "./icons";
import { resolveMachines } from "./machines";
import { errorKey, t, type Key } from "./strings";
import { palette, radius } from "./theme";

interface Props {
  machines: Machine[];
  onAdd: (machines: Machine[]) => void;
  onClose: () => void;
  /** Leave the scanner for manual address entry. */
  onManual: () => void;
}

const QR_ONLY = { barcodeTypes: ["qr" as const] };
/** The camera screen is always dark, whatever the system scheme. */
const DARK = palette("dark");
const HIT_SLOP = 8;

type Access = "pending" | "live" | "denied" | "failed";

/** Camera permission as one state, asked once on open and re-read on return from settings. */
function useCameraAccess() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [requesting, setRequesting] = useState(false);
  const [failed, setFailed] = useState(false);
  const requested = useRef(false);

  const ask = useCallback(() => {
    setRequesting(true);
    setFailed(false);
    void requestPermission()
      .catch(() => setFailed(true))
      .finally(() => setRequesting(false));
  }, [requestPermission]);

  useEffect(() => {
    if (permission?.status === "undetermined" && !requested.current) {
      requested.current = true;
      ask();
    }
  }, [permission?.status, ask]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void getPermission().catch(() => setFailed(true));
    });
    return () => subscription.remove();
  }, [getPermission]);

  const openSettings = useCallback(() => {
    void Linking.openSettings().catch(() => setFailed(true));
  }, []);

  let access: Access = "pending";
  if (failed) access = "failed";
  else if (requesting || permission === null) access = "pending";
  else if (permission.granted) access = "live";
  else if (permission.status !== "undetermined") access = "denied";
  return { access, canAsk: permission?.canAskAgain !== false, ask, openSettings };
}

/** One scanned code at a time: resolve it to machines, then add them. */
function usePairing(machines: Machine[], onAdd: (machines: Machine[]) => void, onDone: () => void) {
  const [error, setError] = useState<Key | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const locked = useRef(false);
  const active = useRef(true);
  const machinesRef = useRef(machines);
  machinesRef.current = machines;
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );

  const scan = useCallback(
    ({ type, data }: BarcodeScanningResult) => {
      // The camera reports the same code many times a second: handle one.
      if (locked.current || type !== "qr") return;
      locked.current = true;
      setBusy(true);
      void (async () => {
        try {
          const added = await resolveMachines(data, machinesRef.current, false);
          if (!active.current) return;
          onAdd(added);
          onDone();
        } catch (failure) {
          if (active.current) setError(errorKey(failure));
        } finally {
          if (active.current) setBusy(false);
        }
      })();
    },
    [onAdd, onDone],
  );
  const retry = useCallback(() => {
    locked.current = false;
    setError(null);
    setAttempt((value) => value + 1);
  }, []);
  const cameraFailed = useCallback(() => setError("cameraUnavailable"), []);
  return { error, busy, attempt, scan, retry, cameraFailed };
}

/** Full-screen QR scanner for the pairing code dsh shows. */
export function PairScanner({ machines, onAdd, onClose, onManual }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const camera = useCameraAccess();
  const pairing = usePairing(machines, onAdd, onClose);

  // Light status bar over the camera; back to the scheme's own on leave.
  useEffect(() => {
    setStatusBarStyle("light");
    return () => setStatusBarStyle(Appearance.getColorScheme() === "dark" ? "light" : "dark");
  }, []);

  const frame = Math.min(Math.round(width * 0.68), 300);
  const layout = useMemo(
    () =>
      StyleSheet.create({
        top: { ...styles.top, paddingTop: insets.top + 8 },
        bottom: { ...styles.bottom, paddingBottom: insets.bottom + 24 },
        frame: { width: frame, height: frame },
      }),
    [frame, insets.bottom, insets.top],
  );

  let panel: ReactNode = null;
  if (camera.access === "failed" || camera.access === "denied") {
    const canAsk = camera.canAsk && camera.access === "denied";
    panel = (
      <Sheet
        message={t(camera.access === "failed" ? "cameraUnavailable" : "cameraDenied")}
        action={canAsk ? t("retry") : t("cameraSettings")}
        onAction={canAsk ? camera.ask : camera.openSettings}
        onManual={onManual}
      />
    );
  } else if (pairing.error !== null) {
    panel = (
      <Sheet
        message={t(pairing.error)}
        action={t("retry")}
        onAction={pairing.retry}
        onManual={onManual}
      />
    );
  }
  const spinning = pairing.busy || camera.access === "pending";

  return (
    <View style={styles.root}>
      {camera.access === "live" && pairing.error === null ? (
        <CameraView
          key={pairing.attempt}
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={QR_ONLY}
          onBarcodeScanned={pairing.busy ? undefined : pairing.scan}
          onMountError={pairing.cameraFailed}
        />
      ) : null}
      <View style={styles.center} pointerEvents="none">
        <View style={layout.frame}>
          <View style={styles.cornerTL} />
          <View style={styles.cornerTR} />
          <View style={styles.cornerBL} />
          <View style={styles.cornerBR} />
          {spinning ? (
            <View style={styles.busy}>
              <ActivityIndicator color="#FFFFFF" />
              {pairing.busy ? <Text style={styles.busyText}>{t("adding")}</Text> : null}
            </View>
          ) : null}
        </View>
      </View>
      <View style={layout.top}>
        <Pressable
          onPress={onClose}
          hitSlop={HIT_SLOP}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={t("close")}
        >
          <CloseGlyph color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title}>{t("scan")}</Text>
        <View style={styles.iconSpacer} />
      </View>
      <View style={layout.bottom}>
        {panel ?? (
          <>
            <Text style={styles.hint}>{t("scanHint")}</Text>
            <Pressable onPress={onManual} style={styles.ghost} accessibilityRole="button">
              <KeyboardGlyph color="#FFFFFF" />
              <Text style={styles.ghostText}>{t("manual")}</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

interface SheetProps {
  message: string;
  action: string;
  onAction: () => void;
  onManual: () => void;
}

/** Problem card over the camera: the scanner stays recognisable behind it. */
function Sheet({ message, action, onAction, onManual }: SheetProps) {
  return (
    <View style={styles.sheet}>
      <Text style={styles.sheetText}>{message}</Text>
      <View style={styles.sheetActions}>
        <Pressable onPress={onManual} style={styles.sheetSecondary} accessibilityRole="button">
          <Text style={styles.sheetSecondaryText}>{t("manualShort")}</Text>
        </Pressable>
        <Pressable onPress={onAction} style={styles.sheetPrimary} accessibilityRole="button">
          <Text style={styles.sheetPrimaryText}>{action}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const CORNER = 28;
const STROKE = 3;
const corner = {
  position: "absolute",
  width: CORNER,
  height: CORNER,
  borderColor: "#FFFFFF",
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  cornerTL: {
    ...corner,
    top: 0,
    left: 0,
    borderTopWidth: STROKE,
    borderLeftWidth: STROKE,
    borderTopLeftRadius: radius.md,
  },
  cornerTR: {
    ...corner,
    top: 0,
    right: 0,
    borderTopWidth: STROKE,
    borderRightWidth: STROKE,
    borderTopRightRadius: radius.md,
  },
  cornerBL: {
    ...corner,
    bottom: 0,
    left: 0,
    borderBottomWidth: STROKE,
    borderLeftWidth: STROKE,
    borderBottomLeftRadius: radius.md,
  },
  cornerBR: {
    ...corner,
    bottom: 0,
    right: 0,
    borderBottomWidth: STROKE,
    borderRightWidth: STROKE,
    borderBottomRightRadius: radius.md,
  },
  busy: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  busyText: { color: "#FFFFFF", fontSize: 15 },
  top: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  iconSpacer: { width: 40 },
  title: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  hint: { color: "#FFFFFF", fontSize: 15, lineHeight: 22, textAlign: "center" },
  ghost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  ghostText: { color: "#FFFFFF", fontSize: 15, fontWeight: "500" },
  sheet: {
    alignSelf: "stretch",
    padding: 18,
    gap: 16,
    borderRadius: radius.lg,
    backgroundColor: DARK.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DARK.border,
  },
  sheetText: { color: DARK.text, fontSize: 15, lineHeight: 22 },
  sheetActions: { flexDirection: "row", gap: 10 },
  sheetSecondary: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DARK.pressed,
  },
  sheetSecondaryText: { color: DARK.text, fontSize: 15, fontWeight: "500" },
  sheetPrimary: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DARK.primary,
  },
  sheetPrimaryText: { color: DARK.onPrimary, fontSize: 15, fontWeight: "600" },
});
