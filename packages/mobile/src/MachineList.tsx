import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import {
  BellGlyph,
  ChevronGlyph,
  KeyboardGlyph,
  KivotosMark,
  MonitorGlyph,
  QrGlyph,
} from "./icons";
import { hello, normalizeUrl } from "./machines";
import { PairScanner } from "./PairScanner";
import { errorKey, t, type Key } from "./strings";
import { radius, useColors, useStyles, type Palette } from "./theme";

interface Props {
  machines: Machine[];
  notifications: "on" | "off" | "denied";
  batteryRestricted: boolean;
  onAdd: (machine: Machine) => void;
  onRemove: (id: string) => void;
  onOpen: (machine: Machine) => void;
  onToggleNotifications: () => void;
  onFixBattery: () => void;
}

const EDGES = ["top", "bottom"] as const;

interface RowProps {
  machine: Machine;
  last: boolean;
  onOpen: (machine: Machine) => void;
  onRemove: (machine: Machine) => void;
}

function MachineRow({ machine, last, onOpen, onRemove }: RowProps) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const open = useCallback(() => onOpen(machine), [machine, onOpen]);
  const remove = useCallback(() => onRemove(machine), [machine, onRemove]);
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.rowPressed : styles.row),
    [styles],
  );
  // Show the host part only: the scheme and default port are noise on a phone.
  const address = machine.url.replace(/^https?:\/\//, "").replace(/:7380$/, "");
  return (
    <Pressable
      onPress={open}
      onLongPress={remove}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityLabel={machine.name}
    >
      <View style={styles.tile}>
        <MonitorGlyph color={colors.text} />
      </View>
      <View style={last ? styles.rowBodyLast : styles.rowBody}>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {machine.name}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {address}
          </Text>
        </View>
        <ChevronGlyph color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

/** First-run card: where the pairing code lives, in two steps. */
function EmptyCard() {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.group}>
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{t("emptyTitle")}</Text>
        <View style={styles.step}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepNumber}>1</Text>
          </View>
          <Text style={styles.stepText}>{t("emptyStep1")}</Text>
        </View>
        <View style={styles.step}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepNumber}>2</Text>
          </View>
          <Text style={styles.stepText}>{t("emptyStep2")}</Text>
        </View>
      </View>
    </View>
  );
}

/** The app's home: machines to open, pairing, and the notification switch. */
export function MachineList(props: Props) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const mounted = useRef(true);
  const { machines, onAdd, onRemove, onOpen } = props;
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const add = useCallback(async () => {
    const url = normalizeUrl(input);
    if (url === null) {
      setError("errorInvalid");
      return;
    }
    if (machines.some((machine) => machine.url === url)) {
      setError("duplicate");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const who = await hello(url);
      onAdd({ id: url, name: who.name, url });
      if (mounted.current) {
        setInput("");
        setManual(false);
      }
    } catch (failure) {
      if (mounted.current) setError(errorKey(failure));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [input, machines, onAdd]);
  const submit = useCallback(() => void add(), [add]);
  const openScanner = useCallback(() => {
    setError(null);
    setScanning(true);
  }, []);
  const closeScanner = useCallback(() => setScanning(false), []);
  const scannerToManual = useCallback(() => {
    setScanning(false);
    setManual(true);
  }, []);
  const showManual = useCallback(() => setManual(true), []);
  const changeInput = useCallback((text: string) => {
    setInput(text);
    setError(null);
  }, []);

  const confirmRemove = useCallback(
    (machine: Machine) => {
      Alert.alert(t("removeConfirm", { name: machine.name }), machine.url, [
        { text: t("cancel"), style: "cancel" },
        { text: t("remove"), style: "destructive", onPress: () => onRemove(machine.id) },
      ]);
    },
    [onRemove],
  );

  const trackColor = useMemo(() => ({ false: colors.pressed, true: colors.link }), [colors]);
  const primaryStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.primaryPressed : styles.primary),
    [styles],
  );

  if (scanning) {
    return (
      <PairScanner
        machines={machines}
        onAdd={onAdd}
        onClose={closeScanner}
        onManual={scannerToManual}
      />
    );
  }

  let notificationLabel = t("notificationsOff");
  if (props.notifications === "on") notificationLabel = t("notificationsOn");
  else if (props.notifications === "denied") notificationLabel = t("notificationsDenied");
  const canAdd = !busy && input.trim() !== "";
  const showBattery = props.notifications === "on" && props.batteryRestricted;

  return (
    <SafeAreaView style={styles.safe} edges={EDGES}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <KivotosMark size={36} />
          <View style={styles.headerText}>
            <Text style={styles.brand}>Kivotos</Text>
            <Text style={styles.tagline}>{t("tagline")}</Text>
          </View>
        </View>

        <Text style={styles.section}>{t("sectionMachines")}</Text>
        {machines.length === 0 ? (
          <EmptyCard />
        ) : (
          <View style={styles.group}>
            {machines.map((machine, index) => (
              <MachineRow
                key={machine.id}
                machine={machine}
                last={index === machines.length - 1}
                onOpen={onOpen}
                onRemove={confirmRemove}
              />
            ))}
          </View>
        )}
        {machines.length > 0 ? <Text style={styles.footnote}>{t("removeHint")}</Text> : null}

        <Pressable
          onPress={openScanner}
          disabled={busy}
          style={primaryStyle}
          accessibilityRole="button"
        >
          <QrGlyph color={colors.onPrimary} />
          <Text style={styles.primaryText}>{t("scan")}</Text>
        </Pressable>

        {manual ? (
          <View style={styles.manual}>
            <Text style={styles.manualHint}>{t("manualHint")}</Text>
            <View style={styles.addRow}>
              <TextInput
                value={input}
                onChangeText={changeInput}
                onSubmitEditing={submit}
                placeholder={t("addPlaceholder")}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                keyboardType="url"
                returnKeyType="go"
                editable={!busy}
                style={styles.input}
              />
              <Pressable
                onPress={submit}
                disabled={!canAdd}
                style={canAdd ? styles.addButton : styles.addButtonDisabled}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.addText}>{t("add")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={showManual} style={styles.secondary} accessibilityRole="button">
            <KeyboardGlyph color={colors.textSecondary} />
            <Text style={styles.secondaryText}>{t("manual")}</Text>
          </Pressable>
        )}
        {error === null ? null : (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(error)}</Text>
          </View>
        )}

        <Text style={styles.section}>{t("sectionSettings")}</Text>
        <View style={styles.group}>
          <Pressable onPress={props.onToggleNotifications} style={styles.row}>
            <View style={styles.tile}>
              <BellGlyph color={colors.text} />
            </View>
            <View style={showBattery ? styles.rowBody : styles.rowBodyLast}>
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{t("notifications")}</Text>
                <Text style={styles.rowMeta}>{notificationLabel}</Text>
              </View>
              <Switch
                value={props.notifications === "on"}
                onValueChange={props.onToggleNotifications}
                trackColor={trackColor}
                thumbColor="#FFFFFF"
              />
            </View>
          </Pressable>
          {showBattery ? (
            <View style={styles.battery}>
              <Text style={styles.rowMeta}>{t("batteryHint")}</Text>
              <Pressable onPress={props.onFixBattery} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>{t("batteryFix")}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: Palette) {
  const row = {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    minHeight: 64,
  } as const;
  const rowBody = {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 10,
    marginLeft: 12,
    paddingRight: 14,
  } as const;
  const primary = {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 52,
    marginTop: 24,
    borderRadius: radius.md,
  } as const;
  const addButton = {
    height: 46,
    minWidth: 72,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.pressed,
  } as const;
  return {
    safe: { flex: 1, backgroundColor: c.bg },
    scroll: { flex: 1 },
    // Phones fill the width; tablets get a centered column like dsh's own content.
    content: {
      width: "100%",
      maxWidth: 600,
      alignSelf: "center",
      paddingHorizontal: 20,
      paddingBottom: 32,
    },
    header: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 20 },
    headerText: { flex: 1 },
    brand: { fontSize: 24, fontWeight: "700", letterSpacing: -0.3, color: c.text },
    tagline: { fontSize: 13, marginTop: 2, color: c.textTertiary },
    section: {
      fontSize: 13,
      fontWeight: "500",
      marginTop: 32,
      marginBottom: 8,
      marginLeft: 4,
      color: c.textTertiary,
    },
    group: {
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    row,
    rowPressed: { ...row, backgroundColor: c.pressed },
    rowBody: {
      ...rowBody,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowBodyLast: rowBody,
    rowText: { flex: 1, paddingVertical: 12 },
    rowName: { fontSize: 16, fontWeight: "500", color: c.text },
    rowMeta: { fontSize: 13, lineHeight: 18, marginTop: 2, color: c.textTertiary },
    tile: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    footnote: { fontSize: 12, marginTop: 8, marginLeft: 4, color: c.textTertiary },
    empty: { padding: 18, gap: 14 },
    emptyTitle: { fontSize: 17, fontWeight: "600", color: c.text },
    step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    stepBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      marginTop: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.pressed,
    },
    stepNumber: { fontSize: 12, fontWeight: "600", color: c.textSecondary },
    stepText: { flex: 1, fontSize: 15, lineHeight: 22, color: c.textSecondary },
    primary: { ...primary, backgroundColor: c.primary },
    primaryPressed: { ...primary, backgroundColor: c.primary, opacity: 0.85 },
    primaryText: { fontSize: 16, fontWeight: "600", color: c.onPrimary },
    secondary: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      height: 44,
      marginTop: 8,
    },
    secondaryText: { fontSize: 15, fontWeight: "500", color: c.textSecondary },
    manual: { marginTop: 16, gap: 8 },
    manualHint: { fontSize: 13, marginLeft: 4, color: c.textTertiary },
    addRow: { flexDirection: "row", gap: 8 },
    input: {
      flex: 1,
      height: 46,
      paddingHorizontal: 14,
      fontSize: 16,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      color: c.text,
      backgroundColor: c.surface,
      borderColor: c.border,
    },
    addButton,
    addButtonDisabled: { ...addButton, opacity: 0.5 },
    addText: { fontSize: 15, fontWeight: "600", color: c.text },
    errorBox: {
      marginTop: 12,
      padding: 12,
      borderRadius: radius.md,
      backgroundColor: c.dangerSoft,
    },
    errorText: { fontSize: 14, lineHeight: 20, color: c.danger },
    battery: {
      alignItems: "flex-start",
      gap: 6,
      paddingVertical: 12,
      paddingLeft: 62,
      paddingRight: 14,
    },
    link: { fontSize: 14, fontWeight: "600", color: c.link },
  } as const;
}
