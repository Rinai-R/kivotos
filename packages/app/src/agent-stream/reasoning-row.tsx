import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Brain } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ExpandableBadge } from "@/components/message";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { useRevealedText } from "@/hooks/use-revealed-text";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
import type { StreamItem } from "@/types/stream";

interface ReasoningRowProps {
  itemId: string;
  onInlineDetailsExpandedChangeByItemId: (itemId: string, expanded: boolean) => void;
  text: string;
  status: Extract<StreamItem, { kind: "thought" }>["status"];
  isLastInSequence: boolean;
  defaultExpanded: boolean;
}

function reasoningSummary(text: string, running: boolean): string {
  const paragraphs = text.split(/\r?\n[\t ]*\r?\n/);
  let summary = "";
  for (let index = 0; index < paragraphs.length; index++) {
    const paragraph = paragraphs[index];
    const newline = paragraph.indexOf("\n");
    if (running && index === paragraphs.length - 1 && newline === -1) break;
    const firstLine = (newline === -1 ? paragraph : paragraph.slice(0, newline)).trim();
    if (firstLine) summary = firstLine;
    if (!running && summary) break;
  }
  return summary.replaceAll("**", "");
}

export const ReasoningRow = memo(function ReasoningRow({
  itemId,
  onInlineDetailsExpandedChangeByItemId,
  text,
  status,
  isLastInSequence,
  defaultExpanded,
}: ReasoningRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const running = status !== "ready";
  const phase = running ? "streaming" : "complete";
  const revealedText = useRevealedText(text, expanded ? phase : "complete");
  const parser = useMemo(() => createAssistantMarkdownParser({ streaming: running }), [running]);
  const summary = useMemo(() => reasoningSummary(text, running), [text, running]);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  useEffect(() => {
    onInlineDetailsExpandedChangeByItemId(itemId, expanded);
  }, [expanded, itemId, onInlineDetailsExpandedChangeByItemId]);
  useEffect(
    () => () => {
      onInlineDetailsExpandedChangeByItemId(itemId, false);
    },
    [itemId, onInlineDetailsExpandedChangeByItemId],
  );

  const renderDetails = useCallback(
    () => (
      <View style={styles.body} testID="reasoning-content">
        <MarkdownRenderer
          text={revealedText}
          compact
          tone="secondary"
          markdownit={parser}
          enableHtmlish={false}
        />
      </View>
    ),
    [revealedText, parser],
  );

  return (
    <ExpandableBadge
      testID="reasoning-row"
      label={t("agentControls.thinking.title")}
      secondaryLabel={expanded ? undefined : summary}
      icon={Brain}
      isLoading={running}
      isExpanded={expanded}
      onToggle={toggle}
      renderDetails={renderDetails}
      isLastInSequence={isLastInSequence}
      borderlessWhenExpanded
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  body: {
    paddingLeft: theme.spacing[8],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
    minWidth: 0,
  },
}));
