import { useCallback, useMemo } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  modeOptions,
  routeOf,
  type MachineLink,
  type ModeOption,
  type PhoneMachineProbe,
  type RouteMode,
  type Via,
} from "../../kivotos/src/machines";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { ChevronGlyph, RelayGlyph } from "./icons";
import { relayHost } from "./machines";
import { StateDot } from "./StateDot";
import { dotOf, downText, linkText, t } from "./strings";
import { radius, useColors, useStyles, type Palette } from "./theme";

interface Props {
  /** The machine that was long-pressed; null while the sheet is closed. */
  machine: Machine | null;
  /** What the last probe found for it. */
  probe: PhoneMachineProbe | undefined;
  onMode: (id: string, mode: RouteMode) => void;
  /** Remove a machine added by address (the caller confirms). */
  onRemove: (machine: Machine) => void;
  /** Open the Connections screen, where its relay network is. */
  onLinks: () => void;
  onClose: () => void;
}

/** One link of the machine on one line: the link, its dot and state; the route in bold. */
function LinkRow({
  via,
  link,
  used,
  last,
}: {
  via: Via;
  /** undefined until the first probe. */
  link: MachineLink | undefined;
  used: boolean;
  last: boolean;
}) {
  const styles = useStyles(createStyles);
  const text = link === undefined ? t("state.checking") : linkText(link, Date.now());
  return (
    <View style={last ? styles.linkRow : styles.linkRowDivided} accessible>
      <Text style={styles.linkVia}>{t(`via.${via}`)}</Text>
      <StateDot dot={dotOf(link)} used={used} />
      <Text style={used ? styles.linkUsed : styles.linkState} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

interface OptionProps {
  option: ModeOption;
  checked: boolean;
  last: boolean;
  onChoose: (mode: RouteMode) => void;
}

/** One mode on one line: its radio, its name, and what it does or why it is unavailable now. */
function ModeRow({ option, checked, last, onChoose }: OptionProps) {
  const styles = useStyles(createStyles);
  const { mode, disabled } = option;
  const choose = useCallback(() => onChoose(mode), [mode, onChoose]);
  // A link that is down cannot be chosen; the current choice stays, and says why.
  const off = disabled !== undefined && !checked;
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      last ? styles.option : styles.optionDivided,
      off && styles.optionOff,
      pressed && styles.pressed,
    ],
    [last, off, styles],
  );
  const a11y = useMemo(() => ({ checked, disabled: off }), [checked, off]);
  const name = t(`mode.${mode}`);
  const detail =
    disabled === undefined
      ? t(`modeDesc.${mode}`)
      : t("mode.unavailable", { reason: downText(disabled) });
  return (
    <Pressable
      onPress={choose}
      disabled={off}
      style={rowStyle}
      accessibilityRole="radio"
      accessibilityState={a11y}
      accessibilityLabel={`${name}, ${detail}`}
    >
      <View style={checked ? styles.radioOn : styles.radio}>
        {checked ? <View style={styles.radioDot} /> : null}
      </View>
      <Text style={styles.optionName} numberOfLines={1}>
        {name}
      </Text>
      <Text
        style={disabled !== undefined && checked ? styles.optionDown : styles.optionDetail}
        numberOfLines={1}
      >
        {detail}
      </Text>
    </Pressable>
  );
}

/**
 * A machine's actions on the app's home: its links, how the phone reaches it
 * (a machine with both links), the relay network it is in, and removing a
 * machine added by address. Leaving a network is on the Connections screen.
 */
export function MachineSheet({ machine, probe, onMode, onRemove, onLinks, onClose }: Props) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const sheetStyle = useMemo(
    () => [styles.sheet, { paddingBottom: 12 + insets.bottom }],
    [insets.bottom, styles],
  );
  const choose = useCallback(
    (mode: RouteMode) => {
      if (machine !== null) onMode(machine.id, mode);
      onClose();
    },
    [machine, onClose, onMode],
  );
  const remove = useCallback(() => {
    onClose();
    if (machine !== null) onRemove(machine);
  }, [machine, onClose, onRemove]);
  const source = useCallback(() => {
    onClose();
    onLinks();
  }, [onClose, onLinks]);
  const sourceStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.source, pressed && styles.pressed],
    [styles],
  );
  const removeStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.remove, pressed && styles.removePressed],
    [styles],
  );
  const cancelStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.cancel, pressed && styles.pressed],
    [styles],
  );
  let body = null;
  if (machine !== null) {
    const mode = machine.mode ?? "auto";
    const route = probe === undefined ? null : routeOf(probe, mode);
    // Before the first probe: the links the machine was added with, still being checked.
    const vias: Via[] = [];
    if (machine.url !== "") vias.push("tailscale");
    if (machine.relay !== undefined) vias.push("relay");
    const links = probe?.links ?? [];
    const shown = links.length > 0 ? links.map((link) => link.via) : vias;
    const options = probe === undefined ? [] : modeOptions(probe);
    body = (
      <View style={sheetStyle}>
        <View style={styles.grab} />
        <Text style={styles.title} numberOfLines={1}>
          {machine.name}
        </Text>
        <Text style={styles.section}>{t("sheetLinks")}</Text>
        <View style={styles.group}>
          {shown.map((via, index) => (
            <LinkRow
              key={via}
              via={via}
              link={links.find((link) => link.via === via)}
              used={route === via}
              last={index === shown.length - 1}
            />
          ))}
        </View>
        {options.length > 0 ? (
          <>
            <Text style={styles.section}>{t("mode.title")}</Text>
            <View style={styles.group} accessibilityRole="radiogroup">
              {options.map((option, index) => (
                <ModeRow
                  key={option.mode}
                  option={option}
                  checked={option.mode === mode}
                  last={index === options.length - 1}
                  onChoose={choose}
                />
              ))}
            </View>
          </>
        ) : null}
        {machine.relay === undefined ? null : (
          <View style={styles.sourceGroup}>
            <Pressable
              onPress={source}
              style={sourceStyle}
              accessibilityRole="button"
              accessibilityLabel={`${t("sheetSource")}, ${relayHost(machine.relay.endpoint)}`}
            >
              <RelayGlyph size={18} color={colors.textSecondary} />
              <Text style={styles.sourceName}>{t("sheetSource")}</Text>
              <Text style={styles.sourceHost} numberOfLines={1}>
                {relayHost(machine.relay.endpoint)}
              </Text>
              <ChevronGlyph color={colors.textTertiary} />
            </Pressable>
          </View>
        )}
        {machine.url !== "" && machine.relay === undefined ? (
          <Pressable onPress={remove} style={removeStyle} accessibilityRole="button">
            <Text style={styles.removeText}>{t("sheetRemove")}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} style={cancelStyle} accessibilityRole="button">
          <Text style={styles.cancelText}>{t("cancel")}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Modal
      visible={machine !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t("cancel")} />
        {body}
      </View>
    </Modal>
  );
}

function createStyles(c: Palette) {
  const divider = { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border };
  const linkRow = {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 14,
  } as const;
  const linkState = { flex: 1, fontSize: 14, lineHeight: 20 } as const;
  const option = {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 14,
  } as const;
  const radio = {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  } as const;
  const detail = { fontSize: 13, lineHeight: 18, flexShrink: 1 } as const;
  const action = {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  } as const;
  return {
    root: { flex: 1, justifyContent: "flex-end" },
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.scrim },
    sheet: {
      width: "100%",
      maxWidth: 600,
      alignSelf: "center",
      paddingTop: 8,
      paddingHorizontal: 16,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      backgroundColor: c.bg,
    },
    grab: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 2,
      marginBottom: 12,
      backgroundColor: c.border,
    },
    title: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: c.text, marginHorizontal: 4 },
    section: {
      fontSize: 13,
      lineHeight: 18,
      paddingTop: 16,
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
    pressed: { backgroundColor: c.pressed },
    linkRow,
    linkRowDivided: { ...linkRow, ...divider },
    linkVia: { width: 72, fontSize: 14, lineHeight: 20, color: c.textSecondary },
    linkState: { ...linkState, color: c.textSecondary },
    linkUsed: { ...linkState, fontWeight: "600", color: c.text },
    option,
    optionDivided: { ...option, ...divider },
    optionOff: { opacity: 0.45 },
    radio: { ...radio, borderColor: c.textTertiary },
    radioOn: { ...radio, borderColor: c.link },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.link },
    optionName: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "500", color: c.text },
    optionDetail: { ...detail, color: c.textTertiary },
    optionDown: { ...detail, color: c.danger },
    sourceGroup: {
      marginTop: 12,
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    source: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    sourceName: { flex: 1, fontSize: 16, lineHeight: 22, color: c.text },
    sourceHost: {
      fontSize: 14,
      lineHeight: 20,
      fontFamily: "monospace",
      color: c.textTertiary,
      flexShrink: 1,
    },
    remove: { ...action, marginTop: 16, backgroundColor: c.dangerSoft },
    removePressed: { opacity: 0.7 },
    removeText: { fontSize: 15, fontWeight: "600", color: c.danger },
    cancel: { ...action, marginTop: 8 },
    cancelText: { fontSize: 15, fontWeight: "500", color: c.textSecondary },
  } as const;
}
