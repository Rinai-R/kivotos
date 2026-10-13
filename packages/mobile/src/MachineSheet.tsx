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
  type PhoneMachineProbe,
  type RouteMode,
  type Via,
} from "../../kivotos/src/machines";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { CheckGlyph } from "./icons";
import { LinkChips } from "./LinkChips";
import { linkLine, linkState, routeLine, statusLine, t } from "./strings";
import { radius, useColors, useStyles, type Palette } from "./theme";

interface Props {
  /** The machine that was long-pressed; null while the sheet is closed. */
  machine: Machine | null;
  /** What the last probe found for it. */
  probe: PhoneMachineProbe | undefined;
  /** The links the phone has: one chip each. */
  vias: readonly Via[];
  onMode: (id: string, mode: RouteMode) => void;
  onRemove: (machine: Machine) => void;
  onClose: () => void;
}

interface OptionProps {
  mode: RouteMode;
  checked: boolean;
  /** What choosing it gives now, or why it does not work (`unavailable`). */
  state: string;
  unavailable: boolean;
  last: boolean;
  onChoose: (mode: RouteMode) => void;
}

function ModeOption({ mode, checked, state, unavailable, last, onChoose }: OptionProps) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const choose = useCallback(() => onChoose(mode), [mode, onChoose]);
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.optionPressed : styles.option),
    [styles],
  );
  const a11y = useMemo(() => ({ checked }), [checked]);
  const name = mode === "auto" ? t("mode.auto") : t(`via.${mode}`);
  return (
    <Pressable
      onPress={choose}
      style={rowStyle}
      accessibilityRole="radio"
      accessibilityState={a11y}
      accessibilityLabel={`${name}, ${state}`}
    >
      <View style={last ? styles.optionBodyLast : styles.optionBody}>
        <View style={styles.optionText}>
          <Text style={styles.optionName}>{name}</Text>
          <Text style={unavailable ? styles.optionUnavailable : styles.optionState}>{state}</Text>
        </View>
        {checked ? <CheckGlyph color={colors.link} /> : <View style={styles.check} />}
      </View>
    </Pressable>
  );
}

/**
 * A machine's actions on the app's home: how the phone reaches it (for a
 * machine with both links: Auto, the links that work, and the current choice
 * even when its link is down, as on the computer), then removing it.
 */
export function MachineSheet({ machine, probe, vias, onMode, onRemove, onClose }: Props) {
  const styles = useStyles(createStyles);
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
  const actionStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.actionPressed : styles.action),
    [styles],
  );
  const now = Date.now();
  let body = null;
  if (machine !== null) {
    const mode = machine.mode ?? "auto";
    const options = probe === undefined ? [] : modeOptions(probe, mode);
    body = (
      <View style={sheetStyle}>
        <Text style={styles.title} numberOfLines={1}>
          {machine.name}
        </Text>
        <Text style={styles.subtitle}>{statusLine(probe, mode, now)}</Text>
        <LinkChips machine={machine} probe={probe} vias={vias} />
        {probe !== undefined && options.length > 0 ? (
          <>
            <Text style={styles.section}>{t("mode.title")}</Text>
            <View style={styles.group} accessibilityRole="radiogroup">
              {options.map((option, index) => {
                let state = routeLine(probe, "auto", now);
                if (option.link !== undefined)
                  state = option.unavailable
                    ? t("mode.unavailable", { reason: linkState(option.link) })
                    : linkLine(option.link, now);
                return (
                  <ModeOption
                    key={option.mode}
                    mode={option.mode}
                    checked={option.mode === mode}
                    state={state}
                    unavailable={option.unavailable}
                    last={index === options.length - 1}
                    onChoose={choose}
                  />
                );
              })}
            </View>
          </>
        ) : null}
        <View style={styles.actions}>
          <Pressable onPress={remove} style={actionStyle} accessibilityRole="button">
            <Text style={styles.danger}>
              {machine.relay === undefined ? t("remove") : t("linksLeave")}
            </Text>
          </Pressable>
          <Pressable onPress={onClose} style={actionStyle} accessibilityRole="button">
            <Text style={styles.cancel}>{t("cancel")}</Text>
          </Pressable>
        </View>
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
  const option = { paddingLeft: 16 } as const;
  const optionBody = {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingRight: 16,
  } as const;
  const action = {
    height: 52,
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
      paddingTop: 20,
      paddingHorizontal: 16,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      backgroundColor: c.bg,
    },
    title: { fontSize: 18, fontWeight: "600", color: c.text, marginHorizontal: 4 },
    subtitle: {
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4,
      marginHorizontal: 4,
      color: c.textTertiary,
    },
    section: {
      fontSize: 13,
      fontWeight: "500",
      marginTop: 20,
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
    option,
    optionPressed: { ...option, backgroundColor: c.pressed },
    optionBody: {
      ...optionBody,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    optionBodyLast: optionBody,
    optionText: { flex: 1, paddingVertical: 10 },
    optionName: { fontSize: 16, fontWeight: "500", color: c.text },
    optionState: { fontSize: 13, lineHeight: 18, marginTop: 2, color: c.textTertiary },
    optionUnavailable: { fontSize: 13, lineHeight: 18, marginTop: 2, color: c.danger },
    check: { width: 18, height: 18 },
    actions: { marginTop: 16, gap: 4 },
    action,
    actionPressed: { ...action, backgroundColor: c.pressed },
    danger: { fontSize: 16, fontWeight: "600", color: c.danger },
    cancel: { fontSize: 16, fontWeight: "500", color: c.textSecondary },
  } as const;
}
