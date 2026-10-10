import { useCallback, useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Attention } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { zh } from "./machines";
import { CloseGlyph } from "./icons";
import { radius, useColors, useStyles, type Palette } from "./theme";

const HEADLINE: Record<string, [string, string]> = {
  approval: ["Approval needed", "需要审批"],
  question: ["Question for you", "有问题等你回答"],
  done: ["Task finished", "任务完成"],
  failed: ["Task failed", "任务失败"],
};

/** Waiting items stay until handled; results fade after a few seconds. */
const RESULT_MS = 6000;
const HIT_SLOP = 12;

interface Props {
  attention: Attention;
  onOpen: (attention: Attention) => void;
  onDismiss: (attention: Attention) => void;
}

/** In-app pop-up for a session that is not on screen. */
export function AttentionBanner({ attention, onOpen, onDismiss }: Props) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(-120)).current;
  const waiting = attention.kind === "approval" || attention.kind === "question";

  useEffect(() => {
    slide.setValue(-120);
    Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start();
    if (waiting) return undefined;
    const timer = setTimeout(() => onDismiss(attention), RESULT_MS);
    return () => clearTimeout(timer);
  }, [attention, onDismiss, slide, waiting]);

  const position = useMemo(
    () => [styles.wrap, { top: insets.top + 8, transform: [{ translateY: slide }] }],
    [insets.top, slide, styles.wrap],
  );
  const open = useCallback(() => onOpen(attention), [attention, onOpen]);
  const dismiss = useCallback(() => onDismiss(attention), [attention, onDismiss]);

  const [en, zhHeadline] = HEADLINE[attention.kind] ?? ["", ""];
  const headline = zh ? zhHeadline : en;
  const title = attention.title || (zh ? "会话" : "Session");

  return (
    <Animated.View style={position} pointerEvents="box-none">
      <Pressable onPress={open} style={styles.card}>
        <View style={attention.kind === "failed" ? styles.dotFailed : styles.dot} />
        <View style={styles.body}>
          <Text style={styles.headline} numberOfLines={1}>
            {headline} · {title}
          </Text>
          <Text style={styles.detail} numberOfLines={2}>
            {attention.detail || attention.machineName}
          </Text>
        </View>
        <Pressable onPress={dismiss} hitSlop={HIT_SLOP} style={styles.close}>
          <CloseGlyph size={16} color={colors.textTertiary} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

function createStyles(c: Palette) {
  const dot = { width: 10, height: 10, borderRadius: 5 };
  return {
    wrap: { position: "absolute", left: 12, right: 12, zIndex: 100 },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: c.bg,
      borderColor: c.border,
      elevation: 8,
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    dot: { ...dot, backgroundColor: c.link },
    dotFailed: { ...dot, backgroundColor: c.danger },
    body: { flex: 1 },
    headline: { fontSize: 15, fontWeight: "600", color: c.text },
    detail: { fontSize: 13, lineHeight: 18, marginTop: 2, color: c.textSecondary },
    close: { padding: 4 },
  } as const;
}
