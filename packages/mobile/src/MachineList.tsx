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
import {
  routeOf,
  type PhoneMachineProbe,
  type PhoneProbe,
  type RouteMode,
} from "../../kivotos/src/machines";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { ChevronGlyph, KivotosMark, MonitorGlyph, QrGlyph } from "./icons";
import { MachineSheet } from "./MachineSheet";
import { resolveMachines } from "./machines";
import { PairScanner } from "./PairScanner";
import { StateDot } from "./StateDot";
import { errorKey, summaryOf, t, type Key } from "./strings";
import { radius, useColors, useStyles, type Palette } from "./theme";

interface Props {
  machines: Machine[];
  /** The latest probe of every link; null until the first one finished. */
  probe: PhoneProbe | null;
  notifications: "on" | "off" | "denied";
  batteryRestricted: boolean;
  onAdd: (machines: Machine[]) => void;
  onRemove: (id: string) => void;
  /** Set how the phone reaches a machine. */
  onMode: (id: string, mode: RouteMode) => void;
  onOpen: (machine: Machine) => void;
  onToggleNotifications: () => void;
  onFixBattery: () => void;
  onLinks: () => void;
}

const EDGES = ["top", "bottom"] as const;

interface RowProps {
  machine: Machine;
  /** What the last probe found; undefined until then. */
  probe: PhoneMachineProbe | undefined;
  last: boolean;
  onOpen: (machine: Machine) => void;
  /** Long-press: its actions (how it is reached, remove). */
  onActions: (machine: Machine) => void;
}

/** One machine on one line: its name, then the route or why there is none. */
function MachineRow({ machine, probe, last, onOpen, onActions }: RowProps) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const open = useCallback(() => onOpen(machine), [machine, onOpen]);
  const actions = useCallback(() => onActions(machine), [machine, onActions]);
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      last ? styles.row : styles.rowDivided,
      pressed && styles.pressed,
    ],
    [last, styles],
  );
  const mode = machine.mode ?? "auto";
  const summary = summaryOf(probe, mode, Date.now());
  // A machine no link reaches is dimmed; its word says why.
  const reachable = probe === undefined || routeOf(probe, mode) !== null;
  return (
    <Pressable
      onPress={open}
      onLongPress={actions}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityLabel={`${machine.name}, ${summary.text}`}
    >
      <View style={styles.tile}>
        <MonitorGlyph color={colors.textSecondary} />
      </View>
      <Text style={reachable ? styles.name : styles.nameDim} numberOfLines={1}>
        {machine.name}
      </Text>
      <View style={styles.state}>
        <StateDot dot={summary.dot} />
        <Text style={styles.stateText} numberOfLines={1}>
          {summary.text}
        </Text>
      </View>
      <ChevronGlyph color={colors.textTertiary} />
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
  /** The machine whose actions are open. */
  const [sheet, setSheet] = useState<Machine | null>(null);
  const mounted = useRef(true);
  const { machines, onAdd, onRemove, onOpen } = props;
  const probes = useMemo(
    () => new Map((props.probe?.machines ?? []).map((entry) => [entry.id, entry])),
    [props.probe],
  );
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const add = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      onAdd(await resolveMachines(input, machines, true));
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

  /** Only a machine added by address is removed here; a network's machines go with the network. */
  const confirmRemove = useCallback(
    (machine: Machine) => {
      Alert.alert(
        t("removeTitle", { name: machine.name }),
        t("removeBody", { address: machine.url.replace(/^https?:\/\//, "") }),
        [
          { text: t("cancel"), style: "cancel" },
          { text: t("remove"), style: "destructive", onPress: () => onRemove(machine.id) },
        ],
      );
    },
    [onRemove],
  );
  const closeSheet = useCallback(() => setSheet(null), []);

  const trackColor = useMemo(() => ({ false: colors.pressed, true: colors.link }), [colors]);
  const linksStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.plainDivided, pressed && styles.pressed],
    [styles],
  );
  const primaryStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.primary, pressed && styles.primaryPressed],
    [styles],
  );
  const secondaryStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.secondary, pressed && styles.pressed],
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

  const canAdd = !busy && input.trim() !== "";
  // Notices under the switch, each only while it holds.
  let notice: string | null = null;
  if (props.notifications === "denied") notice = t("notificationsDenied");
  else if (props.notifications === "on" && props.batteryRestricted) notice = t("batteryHint");

  return (
    <SafeAreaView style={styles.safe} edges={EDGES}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <KivotosMark size={40} />
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
                probe={probes.get(machine.id)}
                last={index === machines.length - 1}
                onOpen={onOpen}
                onActions={setSheet}
              />
            ))}
          </View>
        )}
        {machines.length > 0 ? <Text style={styles.footnote}>{t("removeHint")}</Text> : null}

        <View style={styles.buttons}>
          <Pressable
            onPress={openScanner}
            disabled={busy}
            style={primaryStyle}
            accessibilityRole="button"
          >
            <QrGlyph size={18} color={colors.onPrimary} />
            <Text style={styles.primaryText} numberOfLines={1}>
              {t("scan")}
            </Text>
          </Pressable>
          <Pressable onPress={showManual} style={secondaryStyle} accessibilityRole="button">
            <Text style={styles.secondaryText} numberOfLines={1}>
              {t("manual")}
            </Text>
          </Pressable>
        </View>

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
        ) : null}
        {error === null ? null : (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(error)}</Text>
          </View>
        )}

        <Text style={styles.section}>{t("sectionSettings")}</Text>
        <View style={styles.group}>
          <Pressable
            onPress={props.onLinks}
            style={linksStyle}
            accessibilityRole="button"
            accessibilityLabel={`${t("connections")}, ${t("connectionsMeta")}`}
          >
            <Text style={styles.plainName}>{t("connections")}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {t("connectionsMeta")}
            </Text>
            <ChevronGlyph color={colors.textTertiary} />
          </Pressable>
          <Pressable
            onPress={props.onToggleNotifications}
            style={notice === null ? styles.plain : styles.plainDivided}
          >
            <Text style={styles.plainName}>{t("notifications")}</Text>
            <Switch
              value={props.notifications === "on"}
              onValueChange={props.onToggleNotifications}
              trackColor={trackColor}
              thumbColor="#FFFFFF"
              accessibilityLabel={t("notifications")}
            />
          </Pressable>
          {notice === null ? null : (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{notice}</Text>
              {props.notifications === "on" ? (
                <Pressable onPress={props.onFixBattery} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.link}>{t("batteryFix")}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>
      <MachineSheet
        machine={sheet}
        probe={sheet === null ? undefined : probes.get(sheet.id)}
        onMode={props.onMode}
        onRemove={confirmRemove}
        onLinks={props.onLinks}
        onClose={closeSheet}
      />
    </SafeAreaView>
  );
}

function createStyles(c: Palette) {
  const row = {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingVertical: 10,
    paddingHorizontal: 14,
  } as const;
  const plain = { ...row, minHeight: 52, paddingVertical: 8 } as const;
  const divider = { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border };
  const button = {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    paddingHorizontal: 12,
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
      paddingHorizontal: 16,
      paddingBottom: 32,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingTop: 16,
      paddingHorizontal: 4,
    },
    headerText: { flex: 1 },
    brand: { fontSize: 24, lineHeight: 32, fontWeight: "700", color: c.text },
    tagline: { fontSize: 14, lineHeight: 20, color: c.textSecondary },
    section: {
      fontSize: 13,
      lineHeight: 18,
      paddingTop: 24,
      paddingBottom: 8,
      paddingHorizontal: 4,
      color: c.textSecondary,
    },
    group: {
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    row,
    rowDivided: { ...row, ...divider },
    pressed: { backgroundColor: c.pressed },
    tile: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.pressed,
    },
    name: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "500", color: c.text },
    nameDim: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "500", color: c.textSecondary },
    state: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
    stateText: { fontSize: 14, lineHeight: 20, color: c.textSecondary, flexShrink: 1 },
    plain,
    plainDivided: { ...plain, ...divider },
    plainName: { flex: 1, fontSize: 16, lineHeight: 22, color: c.text },
    meta: { fontSize: 14, lineHeight: 20, color: c.textTertiary, flexShrink: 1 },
    footnote: {
      fontSize: 13,
      lineHeight: 18,
      paddingTop: 8,
      paddingHorizontal: 4,
      color: c.textTertiary,
    },
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
    buttons: { flexDirection: "row", gap: 10, marginTop: 16 },
    primary: { ...button, backgroundColor: c.primary },
    primaryPressed: { opacity: 0.85 },
    primaryText: { fontSize: 15, fontWeight: "600", color: c.onPrimary, flexShrink: 1 },
    secondary: {
      ...button,
      backgroundColor: c.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    secondaryText: { fontSize: 15, fontWeight: "500", color: c.text, flexShrink: 1 },
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
    notice: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    noticeText: { flex: 1, fontSize: 13, lineHeight: 18, color: c.textSecondary },
    link: { fontSize: 14, fontWeight: "600", color: c.link },
  } as const;
}
