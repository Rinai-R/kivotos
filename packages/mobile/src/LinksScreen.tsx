import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { tailnetDownOnPhone, type PhoneProbe } from "../../kivotos/src/machines";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { BackGlyph, ChevronGlyph, QrGlyph } from "./icons";
import { isInvite, resolveMachines } from "./machines";
import { errorKey, t, type Key } from "./strings";
import { radius, useColors, useStyles, type Palette } from "./theme";

interface Props {
  machines: Machine[];
  /** The latest probe of every link; null until the first one finished. */
  probe: PhoneProbe | null;
  onAdd: (machines: Machine[]) => void;
  onLeave: (key: string) => void;
  onScan: () => void;
  onBack: () => void;
}

const EDGES = ["top", "bottom"] as const;

/** `host:port` of a relay endpoint, as the computer's Settings show it. */
function hostOf(endpoint: string): string {
  return endpoint.replace(/^wss?:\/\//, "").replace(/\/.*$/, "");
}

function Field({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const styles = useStyles(createStyles);
  return (
    <View style={last === true ? styles.fieldLast : styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

/** A link line's dot: working, on its way, failing, or not set up (settings.tsx `Tone`). */
type Tone = "ok" | "busy" | "bad" | "off";

/** One link of the phone: dot, name, state and details; an action at its end. */
function LinkHead({
  name,
  tone,
  text,
  hint,
  children,
}: {
  name: string;
  tone: Tone;
  text: string;
  /** A second line, when the link needs the user. */
  hint?: string;
  children?: ReactNode;
}) {
  const styles = useStyles(createStyles);
  let dot = styles.dotOff;
  if (tone === "ok") dot = styles.dotOk;
  else if (tone === "busy") dot = styles.dotBusy;
  else if (tone === "bad") dot = styles.dotBad;
  return (
    <View style={styles.line}>
      <View style={dot} />
      <View style={styles.lineText}>
        <Text style={styles.lineName}>{name}</Text>
        <Text style={styles.lineState}>{text}</Text>
        {hint === undefined ? null : <Text style={styles.lineHint}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

/** Tailscale: how many tailnet machines the phone reaches, and whether the phone seems off the tailnet. */
function TailscaleLine({ machines, probe }: { machines: Machine[]; probe: PhoneProbe | null }) {
  const total = machines.filter((machine) => machine.url !== "").length;
  const reachable =
    probe?.machines.filter((entry) =>
      entry.links.some((link) => link.via === "tailscale" && link.state === "online"),
    ).length ?? 0;
  let tone: Tone = "off";
  let text = t("linksTailscaleNone");
  if (total > 0 && probe === null) {
    tone = "busy";
    text = t("checking");
  } else if (total > 0) {
    tone = reachable > 0 ? "ok" : "bad";
    text = t("linksTailscaleCount", { count: String(reachable), total: String(total) });
  }
  const down = probe !== null && tailnetDownOnPhone(probe);
  if (down) tone = "bad";
  return (
    <LinkHead
      name={t("linksTailscale")}
      tone={tone}
      text={text}
      hint={down ? t("linksTailscaleDown") : undefined}
    />
  );
}

interface Joined {
  endpoint: string;
  key: string;
}

/** Manage or Set up at the end of the relay line; it folds the details out below. */
function FoldButton({
  label,
  open,
  onPress,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.foldPressed : styles.fold),
    [styles],
  );
  const a11y = useMemo(() => ({ expanded: open }), [open]);
  return (
    <Pressable onPress={onPress} style={style} accessibilityRole="button" accessibilityState={a11y}>
      <Text style={styles.foldText}>{label}</Text>
      <View style={open ? styles.chevronUp : styles.chevronDown}>
        <ChevronGlyph size={14} color={colors.textSecondary} />
      </View>
    </Pressable>
  );
}

/** One joined relay network: its state as the relay answered; Manage shows where it is, and Leave. */
function NetworkLine({
  network,
  probe,
  last,
  onLeave,
}: {
  network: Joined;
  probe: PhoneProbe | null;
  last: boolean;
  onLeave: (key: string) => void;
}) {
  const styles = useStyles(createStyles);
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((shown) => !shown), []);
  const found = probe?.networks.find((entry) => entry.key === network.key);
  const state = found?.state ?? "connecting";
  const leave = useCallback(() => {
    Alert.alert(t("leaveConfirm"), t("leaveDetail"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("leave"), style: "destructive", onPress: () => onLeave(network.key) },
    ]);
  }, [network.key, onLeave]);
  const leaveStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.dangerPressed : styles.danger),
    [styles],
  );
  let tone: Tone = "bad";
  if (state === "online") tone = "ok";
  else if (state === "connecting") tone = "busy";
  const parts = [t(`relayState.${state}`), hostOf(network.endpoint)];
  if (found !== undefined && state === "online")
    parts.push(t("linksRelayPeers", { count: String(found.peers.length) }));
  return (
    <View style={last ? undefined : styles.divided}>
      <LinkHead name={t("linksRelay")} tone={tone} text={parts.join(" · ")}>
        <FoldButton label={t("linksManage")} open={open} onPress={toggle} />
      </LinkHead>
      {open ? (
        <View style={styles.details}>
          <View style={styles.inner}>
            <Field label={t("linksRelayAddress")} value={hostOf(network.endpoint)} />
            <Field label={t("linksRelayNetwork")} value={found?.id ?? "…"} />
            <Field label={t("linksStatus")} value={t(`relayState.${state}`)} />
            <Field
              label={t("linksRelayMachines")}
              value={found === undefined ? "…" : String(found.peers.length)}
              last
            />
          </View>
          <Pressable onPress={leave} style={leaveStyle} accessibilityRole="button">
            <Text style={styles.dangerText}>{t("linksLeave")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** Not in a network yet: paste an invite or scan its code. */
function JoinForm({
  machines,
  onAdd,
  onScan,
}: {
  machines: Machine[];
  onAdd: (machines: Machine[]) => void;
  onScan: () => void;
}) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const change = useCallback((text: string) => {
    setInvite(text);
    setError(null);
  }, []);
  const join = useCallback(() => {
    if (!isInvite(invite)) {
      setError("relayInvite");
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        onAdd(await resolveMachines(invite, machines, true));
        if (mounted.current) setInvite("");
      } catch (failure) {
        if (mounted.current) setError(errorKey(failure));
      } finally {
        if (mounted.current) setBusy(false);
      }
    })();
  }, [invite, machines, onAdd]);
  const canJoin = !busy && invite.trim() !== "";
  const scanStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.primaryPressed : styles.primary),
    [styles],
  );
  return (
    <View style={styles.details}>
      <Text style={styles.intro}>{t("linksRelayIntro")}</Text>
      <View style={styles.addRow}>
        <TextInput
          value={invite}
          onChangeText={change}
          onSubmitEditing={join}
          placeholder={t("linksInvitePlaceholder")}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          editable={!busy}
          style={styles.input}
        />
        <Pressable
          onPress={join}
          disabled={!canJoin}
          style={canJoin ? styles.addButton : styles.addButtonDisabled}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Text style={styles.addText}>{t("linksJoin")}</Text>
          )}
        </Pressable>
      </View>
      <Pressable onPress={onScan} disabled={busy} style={scanStyle} accessibilityRole="button">
        <QrGlyph color={colors.onPrimary} />
        <Text style={styles.primaryText}>{t("linksScan")}</Text>
      </Pressable>
      {error === null ? null : (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{t(error)}</Text>
        </View>
      )}
    </View>
  );
}

/** No network joined: the relay line says so; Set up folds out the join form. */
function SetUpLine({
  machines,
  onAdd,
  onScan,
}: {
  machines: Machine[];
  onAdd: (machines: Machine[]) => void;
  onScan: () => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((shown) => !shown), []);
  return (
    <>
      <LinkHead name={t("linksRelay")} tone="off" text={t("linksRelayNone")}>
        <FoldButton label={t("linksSetUp")} open={open} onPress={toggle} />
      </LinkHead>
      {open ? <JoinForm machines={machines} onAdd={onAdd} onScan={onScan} /> : null}
    </>
  );
}

/**
 * The phone's links, like the computer's Settings → Remote access: a line
 * for Tailscale, then one for the own relay with Manage or Set up below it.
 */
export function LinksScreen({ machines, probe, onAdd, onLeave, onScan, onBack }: Props) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);
  const networks = useMemo(() => {
    const joined = new Map<string, Joined>();
    for (const machine of machines) {
      if (machine.relay !== undefined)
        joined.set(machine.relay.key, { endpoint: machine.relay.endpoint, key: machine.relay.key });
    }
    return [...joined.values()];
  }, [machines]);
  return (
    <SafeAreaView style={styles.safe} edges={EDGES}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel={t("back")}
        >
          <BackGlyph color={colors.textSecondary} />
          <Text style={styles.backText}>{t("back")}</Text>
        </Pressable>
        <Text style={styles.title}>{t("connections")}</Text>
        <View style={styles.group}>
          <View style={styles.divided}>
            <TailscaleLine machines={machines} probe={probe} />
          </View>
          {networks.length === 0 ? (
            <SetUpLine machines={machines} onAdd={onAdd} onScan={onScan} />
          ) : (
            networks.map((network, index) => (
              <NetworkLine
                key={network.key}
                network={network}
                probe={probe}
                last={index === networks.length - 1}
                onLeave={onLeave}
              />
            ))
          )}
        </View>
        <Text style={styles.footnote}>{t("linksTailscaleHint")}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: Palette) {
  const field = {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 14,
  } as const;
  const button = {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 48,
    marginTop: 12,
    borderRadius: radius.md,
  } as const;
  const dot = {
    width: 8,
    height: 8,
    borderRadius: 4,
    alignSelf: "flex-start",
    marginTop: 7,
  } as const;
  const fold = {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: c.border,
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
    content: {
      width: "100%",
      maxWidth: 600,
      alignSelf: "center",
      paddingHorizontal: 20,
      paddingBottom: 32,
    },
    back: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 16,
      alignSelf: "flex-start",
    },
    backText: { fontSize: 15, color: c.textSecondary },
    title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.3, marginTop: 12, color: c.text },
    group: {
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    divided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    line: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, padding: 14 },
    lineText: { flex: 1 },
    lineName: { fontSize: 16, fontWeight: "500", color: c.text },
    lineState: { fontSize: 13, lineHeight: 18, marginTop: 2, color: c.textTertiary },
    lineHint: { fontSize: 13, lineHeight: 18, marginTop: 4, color: c.danger },
    dotOff: { ...dot, backgroundColor: c.textTertiary },
    dotOk: { ...dot, backgroundColor: c.success },
    dotBusy: { ...dot, backgroundColor: c.warn },
    dotBad: { ...dot, backgroundColor: c.danger },
    fold,
    foldPressed: { ...fold, backgroundColor: c.pressed },
    foldText: { fontSize: 14, fontWeight: "500", color: c.text },
    chevronDown: { transform: [{ rotate: "90deg" }] },
    chevronUp: { transform: [{ rotate: "-90deg" }] },
    details: {
      paddingHorizontal: 14,
      paddingBottom: 14,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    inner: {
      borderRadius: radius.md,
      overflow: "hidden",
      backgroundColor: c.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    field: { ...field, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    fieldLast: field,
    fieldLabel: { width: 110, fontSize: 14, color: c.textTertiary },
    fieldValue: { flex: 1, fontSize: 15, color: c.text },
    footnote: { fontSize: 12, lineHeight: 17, marginTop: 8, marginLeft: 4, color: c.textTertiary },
    intro: {
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 12,
      marginLeft: 4,
      color: c.textSecondary,
    },
    addRow: { flexDirection: "row", gap: 8 },
    input: {
      flex: 1,
      height: 46,
      paddingHorizontal: 14,
      fontSize: 15,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      color: c.text,
      backgroundColor: c.bg,
      borderColor: c.border,
    },
    addButton,
    addButtonDisabled: { ...addButton, opacity: 0.5 },
    addText: { fontSize: 15, fontWeight: "600", color: c.text },
    primary: { ...button, backgroundColor: c.primary },
    primaryPressed: { ...button, backgroundColor: c.primary, opacity: 0.85 },
    primaryText: { fontSize: 16, fontWeight: "600", color: c.onPrimary },
    danger: { ...button, backgroundColor: c.dangerSoft },
    dangerPressed: { ...button, backgroundColor: c.dangerSoft, opacity: 0.7 },
    dangerText: { fontSize: 16, fontWeight: "600", color: c.danger },
    errorBox: {
      marginTop: 12,
      padding: 12,
      borderRadius: radius.md,
      backgroundColor: c.dangerSoft,
    },
    errorText: { fontSize: 14, lineHeight: 20, color: c.danger },
  } as const;
}
