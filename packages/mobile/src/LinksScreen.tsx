import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { BackGlyph, QrGlyph } from "./icons";
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

/** Whether the phone reaches its tailnet machines: counted from the last probe. */
function TailscaleGroup({ machines, probe }: { machines: Machine[]; probe: PhoneProbe | null }) {
  const styles = useStyles(createStyles);
  const total = machines.filter((machine) => machine.url !== "").length;
  const reachable =
    probe?.machines.filter((entry) =>
      entry.links.some((link) => link.via === "tailscale" && link.state === "online"),
    ).length ?? 0;
  let summary = t("linksTailscaleNone");
  if (total > 0)
    summary =
      probe === null
        ? t("checking")
        : t("linksTailscaleCount", { count: String(reachable), total: String(total) });
  const down = probe !== null && tailnetDownOnPhone(probe);
  return (
    <>
      <Text style={styles.section}>{t("linksTailscale")}</Text>
      <View style={styles.group}>
        <Field label={t("linksStatus")} value={summary} last />
      </View>
      {down ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>{t("linksTailscaleDown")}</Text>
        </View>
      ) : null}
      <Text style={styles.footnote}>{t("linksTailscaleHint")}</Text>
    </>
  );
}

interface Joined {
  endpoint: string;
  key: string;
}

/** One joined relay network: where it is, its state as the relay answered, and Leave. */
function NetworkGroup({
  network,
  probe,
  onLeave,
}: {
  network: Joined;
  probe: PhoneProbe | null;
  onLeave: (key: string) => void;
}) {
  const styles = useStyles(createStyles);
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
  return (
    <>
      <View style={styles.group}>
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
    </>
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
    <>
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
    </>
  );
}

/** The phone's links, like the computer's Settings → Remote access: Tailscale, then the own relay. */
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
        <TailscaleGroup machines={machines} probe={probe} />
        <Text style={styles.section}>{t("linksRelay")}</Text>
        {networks.length === 0 ? (
          <JoinForm machines={machines} onAdd={onAdd} onScan={onScan} />
        ) : (
          networks.map((network) => (
            <NetworkGroup key={network.key} network={network} probe={probe} onLeave={onLeave} />
          ))
        )}
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
    section: {
      fontSize: 13,
      fontWeight: "500",
      marginTop: 28,
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
    warnBox: { marginTop: 10, padding: 12, borderRadius: radius.md, backgroundColor: c.dangerSoft },
    warnText: { fontSize: 14, lineHeight: 20, color: c.danger },
    addRow: { flexDirection: "row", gap: 8 },
    input: {
      flex: 1,
      height: 46,
      paddingHorizontal: 14,
      fontSize: 15,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      color: c.text,
      backgroundColor: c.surface,
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
