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
import {
  tailnetDownOnPhone,
  type PhoneNetworkProbe,
  type PhoneProbe,
  type Via,
} from "../../kivotos/src/machines";
import * as Attention from "../modules/kivotos-attention/src/KivotosAttentionModule";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { BackGlyph, ErrorGlyph, QrGlyph, RelayGlyph, TailscaleGlyph } from "./icons";
import { isInvite, relayHost, resolveMachines, zh } from "./machines";
import { StateDot } from "./StateDot";
import { dotOf, joinErrorKey, linkText, t, type Dot, type Key } from "./strings";
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

/** A tag's tone: what was observed is working, needs the user, fails, or is not set up. */
type Tone = "success" | "warning" | "danger" | "neutral";

/** A card's head: the link's tile and name, an address under it, and its state as a tag. */
function CardHead({ via, sub, tone, tag }: { via: Via; sub?: string; tone: Tone; tag: string }) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  return (
    <View style={styles.head}>
      <View style={styles.tile}>
        {via === "tailscale" ? (
          <TailscaleGlyph color={colors.textSecondary} />
        ) : (
          <RelayGlyph color={colors.textSecondary} />
        )}
      </View>
      <View style={styles.headText}>
        <Text style={styles.headName}>{t(via === "tailscale" ? "tailscale" : "relay")}</Text>
        {sub === undefined ? null : (
          <Text style={styles.headSub} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      <View style={styles[`tag.${tone}`]}>
        <Text style={styles[`tagText.${tone}`]}>{tag}</Text>
      </View>
    </View>
  );
}

/** A machine as a chip, with its dot. */
function Chip({ name, dot, label }: { name: string; dot: Dot; label: string }) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.chip} accessible accessibilityLabel={label}>
      <StateDot dot={dot} />
      <Text style={styles.chipText} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

/**
 * Tailscale, as the phone observes it: whether the machines added by address
 * answer it (one chip each), or, when none does, one line and the way to the
 * Tailscale app. The phone cannot see another app's VPN, so answers are what
 * it has.
 */
function TailscaleCard({ machines, probe }: { machines: Machine[]; probe: PhoneProbe | null }) {
  const styles = useStyles(createStyles);
  const openStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.small, pressed && styles.pressed],
    [styles],
  );
  const tailnet = machines.filter((machine) => machine.url !== "");
  if (tailnet.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.section}>
          <CardHead via="tailscale" tone="neutral" tag={t("relayTag.none")} />
          <Text style={styles.line}>{t("tsNone")}</Text>
        </View>
      </View>
    );
  }
  const now = Date.now();
  const links = new Map(
    (probe?.machines ?? []).map((entry) => [
      entry.id,
      entry.links.find((link) => link.via === "tailscale"),
    ]),
  );
  // An answer is anything but silence: a refusal or another service answered too.
  const answered = [...links.values()].some(
    (link) =>
      link !== undefined &&
      (link.state === "online" ||
        (link.reason !== undefined && link.reason !== "timeout" && link.reason !== "network")),
  );
  let tone: Tone = answered ? "success" : "danger";
  let tag = t(answered ? "tsTag.ok" : "tsTag.down");
  if (probe === null) {
    tone = "neutral";
    tag = t("state.checking");
  }
  const down = probe !== null && tailnetDownOnPhone(probe);
  return (
    <View style={styles.card}>
      <View style={styles.section}>
        <CardHead via="tailscale" tone={tone} tag={tag} />
        {down ? (
          <View style={styles.actLine}>
            <Text style={styles.actText}>{t("tsDown")}</Text>
            <Pressable
              onPress={Attention.openTailscale}
              style={openStyle}
              accessibilityRole="button"
            >
              <Text style={styles.smallText}>{t("tsOpen")}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.chips}>
            {tailnet.map((machine) => {
              const link = links.get(machine.id);
              const state = link === undefined ? t("state.checking") : linkText(link, now);
              return (
                <Chip
                  key={machine.id}
                  name={machine.name}
                  dot={dotOf(link)}
                  label={`${machine.name}, ${state}`}
                />
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

interface Joined {
  endpoint: string;
  key: string;
}

/** A network's tag by what the relay answered; `connecting` until the first probe asked it. */
const RELAY_TAGS: Record<PhoneNetworkProbe["state"] | "connecting", { tone: Tone; tag: Key }> = {
  online: { tone: "success", tag: "relayTag.online" },
  denied: { tone: "warning", tag: "relayTag.denied" },
  unreachable: { tone: "danger", tag: "relayTag.unreachable" },
  connecting: { tone: "neutral", tag: "relayTag.connecting" },
};

/**
 * One joined relay network: its state as the relay answered this probe, the
 * computers online, a one-line callout when the relay's TLS handshake is
 * reset, and Leave in its own section.
 */
function RelayCard({
  network,
  machines,
  probe,
  onLeave,
}: {
  network: Joined;
  machines: Machine[];
  probe: PhoneProbe | null;
  onLeave: (key: string) => void;
}) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const found = probe?.networks.find((entry) => entry.key === network.key);
  const host = relayHost(network.endpoint);
  const leave = useCallback(() => {
    // What leaves the list: the machines only this network reaches.
    const lost = machines
      .filter((machine) => machine.relay?.key === network.key && machine.url === "")
      .map((machine) => machine.name);
    let lose = t("leaveKeep");
    if (lost.length > 0)
      lose = t(lost.length === 1 ? "leaveLoseOne" : "leaveLoseMany", {
        names: lost.join(t("nameSeparator")),
      });
    Alert.alert(t("leaveTitle"), [t("leaveBody", { host }), lose].join(zh ? "" : " "), [
      { text: t("cancel"), style: "cancel" },
      { text: t("leaveConfirm"), style: "destructive", onPress: () => onLeave(network.key) },
    ]);
  }, [host, machines, network.key, onLeave]);
  const leaveStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.leave, pressed && styles.leavePressed],
    [styles],
  );
  const { tone, tag } = RELAY_TAGS[found?.state ?? "connecting"];
  // The network's computers online, in the order of the machine list (the relay lists them by node id).
  const online = new Set(found?.state === "online" ? found.peers.map((peer) => peer.node) : []);
  const peers = machines.filter(
    (machine) => machine.relay?.key === network.key && online.has(machine.relay.node),
  );
  return (
    <View style={styles.card}>
      <View style={styles.section}>
        <CardHead via="relay" sub={host} tone={tone} tag={t(tag)} />
        {peers.length > 0 ? (
          <>
            <Text style={styles.label}>{t("relayOnline")}</Text>
            <View style={styles.chips}>
              {peers.map((machine) => (
                <Chip key={machine.id} name={machine.name} dot="online" label={machine.name} />
              ))}
            </View>
          </>
        ) : null}
        {found?.reason === "tls-reset" ? (
          <View style={styles.callout}>
            <ErrorGlyph color={colors.danger} />
            <Text style={styles.calloutText}>
              <Text style={styles.calloutLead}>{t("resetLead")}</Text>
              {`${zh ? "：" : ": "}${t("resetBody")}`}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.sectionDivided}>
        <Pressable onPress={leave} style={leaveStyle} accessibilityRole="button">
          <Text style={styles.leaveText}>{t("relayLeave")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The relay a typed invite points at, for the error that names it. */
function inviteHost(invite: string): string {
  const relay = /[?&]relay=([^&#]+)/.exec(invite)?.[1];
  if (relay === undefined) return "";
  try {
    return relayHost(decodeURIComponent(relay));
  } catch {
    return "";
  }
}

/** Not in a network yet: scan an invite code first, else paste the link. */
function JoinCard({
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
  const [error, setError] = useState<string | null>(null);
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
      setError(t("joinError.invalid"));
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        onAdd(await resolveMachines(invite, machines, true));
        if (mounted.current) setInvite("");
      } catch (failure) {
        if (mounted.current) setError(t(joinErrorKey(failure), { host: inviteHost(invite) }));
      } finally {
        if (mounted.current) setBusy(false);
      }
    })();
  }, [invite, machines, onAdd]);
  const canJoin = !busy && invite.trim() !== "";
  const scanStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.primary, pressed && styles.primaryPressed],
    [styles],
  );
  return (
    <View style={styles.card}>
      <View style={styles.section}>
        <CardHead via="relay" tone="neutral" tag={t("relayTag.none")} />
        <Pressable onPress={onScan} disabled={busy} style={scanStyle} accessibilityRole="button">
          <QrGlyph size={18} color={colors.onPrimary} />
          <Text style={styles.primaryText}>{t("relayScan")}</Text>
        </Pressable>
        <Text style={styles.pasteLabel}>{t("relayPaste")}</Text>
        <View style={styles.addRow}>
          <TextInput
            value={invite}
            onChangeText={change}
            onSubmitEditing={join}
            placeholder={t("invitePlaceholder")}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            editable={!busy}
            style={styles.input}
            accessibilityLabel={t("relayPaste")}
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
              <Text style={styles.addText}>{t("relayJoin")}</Text>
            )}
          </Pressable>
        </View>
        {error === null ? null : (
          <Text style={styles.error} numberOfLines={1}>
            {error}
          </Text>
        )}
        <Text style={styles.note}>{t("relayWhere")}</Text>
      </View>
    </View>
  );
}

/**
 * The phone's links, like the computer's Settings → Remote access: a card
 * for Tailscale, then one for the own relay, joined or not.
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
        <View style={styles.cards}>
          <TailscaleCard machines={machines} probe={probe} />
          {networks.length === 0 ? (
            <JoinCard machines={machines} onAdd={onAdd} onScan={onScan} />
          ) : (
            networks.map((network) => (
              <RelayCard
                key={network.key}
                network={network}
                machines={machines}
                probe={probe}
                onLeave={onLeave}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(c: Palette) {
  const tag = { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999 } as const;
  const tagText = { fontSize: 12, lineHeight: 18, fontWeight: "500" } as const;
  const section = { padding: 14 } as const;
  const button = {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: radius.md,
  } as const;
  const addButton = {
    height: 44,
    minWidth: 72,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.bg,
  } as const;
  return {
    safe: { flex: 1, backgroundColor: c.bg },
    scroll: { flex: 1 },
    content: {
      width: "100%",
      maxWidth: 600,
      alignSelf: "center",
      paddingHorizontal: 16,
      paddingBottom: 32,
    },
    back: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      height: 44,
      marginLeft: -6,
      alignSelf: "flex-start",
    },
    backText: { fontSize: 15, color: c.textSecondary },
    title: { fontSize: 26, lineHeight: 34, fontWeight: "700", paddingHorizontal: 4, color: c.text },
    cards: { gap: 12, marginTop: 16 },
    card: {
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    section,
    sectionDivided: {
      ...section,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    pressed: { backgroundColor: c.pressed },
    head: { flexDirection: "row", alignItems: "center", gap: 12 },
    tile: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.pressed,
    },
    headText: { flex: 1 },
    headName: { fontSize: 16, lineHeight: 22, fontWeight: "500", color: c.text },
    headSub: {
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2,
      fontFamily: "monospace",
      color: c.textSecondary,
    },
    "tag.success": { ...tag, backgroundColor: c.successSoft },
    "tag.warning": { ...tag, backgroundColor: c.warnSoft },
    "tag.danger": { ...tag, backgroundColor: c.dangerSoft },
    "tag.neutral": { ...tag, backgroundColor: c.pressed },
    "tagText.success": { ...tagText, color: c.successText },
    "tagText.warning": { ...tagText, color: c.warnText },
    "tagText.danger": { ...tagText, color: c.danger },
    "tagText.neutral": { ...tagText, color: c.textSecondary },
    line: { fontSize: 14, lineHeight: 20, marginTop: 12, color: c.textSecondary },
    label: { fontSize: 13, lineHeight: 18, marginTop: 14, color: c.textSecondary },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      height: 28,
      paddingLeft: 8,
      paddingRight: 10,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.bg,
    },
    chipText: { fontSize: 13, color: c.text },
    actLine: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
    actText: { flex: 1, fontSize: 14, lineHeight: 20, color: c.textSecondary },
    small: {
      height: 36,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.bg,
    },
    smallText: { fontSize: 14, fontWeight: "500", color: c.text },
    callout: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 12,
      padding: 12,
      borderRadius: radius.md,
      backgroundColor: c.dangerSoft,
    },
    calloutText: { flex: 1, fontSize: 14, lineHeight: 20, color: c.textSecondary },
    calloutLead: { fontWeight: "600", color: c.text },
    leave: { ...button, height: 40, backgroundColor: c.dangerSoft },
    leavePressed: { opacity: 0.7 },
    leaveText: { fontSize: 15, fontWeight: "600", color: c.danger },
    primary: { ...button, marginTop: 14, backgroundColor: c.primary },
    primaryPressed: { opacity: 0.85 },
    primaryText: { fontSize: 15, fontWeight: "600", color: c.onPrimary },
    pasteLabel: {
      fontSize: 13,
      lineHeight: 18,
      marginTop: 14,
      marginBottom: 8,
      color: c.textSecondary,
    },
    addRow: { flexDirection: "row", gap: 8 },
    input: {
      flex: 1,
      height: 44,
      paddingHorizontal: 12,
      fontSize: 15,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      color: c.text,
      backgroundColor: c.bg,
      borderColor: c.border,
    },
    addButton,
    addButtonDisabled: { ...addButton, opacity: 0.45 },
    addText: { fontSize: 15, fontWeight: "500", color: c.text },
    error: { fontSize: 13, lineHeight: 18, marginTop: 10, color: c.danger },
    note: { fontSize: 13, lineHeight: 18, marginTop: 10, color: c.textTertiary },
  } as const;
}
