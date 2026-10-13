import { StyleSheet, Text, View } from "react-native";
import type { MachineLink, PhoneMachineProbe, Via } from "../../kivotos/src/machines";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { linkState, t } from "./strings";
import { useStyles, type Palette } from "./theme";

const NO_VIAS: readonly Via[] = [];
const TAILSCALE: readonly Via[] = ["tailscale"];
const RELAY: readonly Via[] = ["relay"];
const BOTH: readonly Via[] = ["tailscale", "relay"];

/**
 * The links the phone has: Tailscale once it reaches a machine by address,
 * the relay once it joined a network. Each gets a chip on every machine row.
 */
export function phoneVias(machines: readonly Machine[]): readonly Via[] {
  const tailnet = machines.some((machine) => machine.url !== "");
  const relay = machines.some((machine) => machine.relay !== undefined);
  if (tailnet) return relay ? BOTH : TAILSCALE;
  return relay ? RELAY : NO_VIAS;
}

function Chip({
  via,
  link,
  machine,
}: {
  via: Via;
  link: MachineLink | undefined;
  machine: Machine;
}) {
  const styles = useStyles(createStyles);
  // One link per way: the machine has a tailnet URL, a relay network, or both.
  if (via === "tailscale" ? machine.url === "" : machine.relay === undefined) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>
          {t(via === "tailscale" ? "chip.noTailnet" : "chip.noNetwork")}
        </Text>
      </View>
    );
  }
  let dot = styles.dotIdle;
  if (link?.state === "online") dot = styles.dotOnline;
  else if (link?.state === "unreachable" || link?.state === "denied") dot = styles.dotFailed;
  return (
    <View style={styles.chip}>
      <View style={dot} />
      <Text style={styles.text}>
        {`${t(`via.${via}`)} · ${link === undefined ? t("checking") : linkState(link)}`}
      </Text>
    </View>
  );
}

/**
 * A machine's state on each link the phone has, in the computer's words
 * (settings.tsx `LinkChip`); dashed when the machine lacks that link.
 */
export function LinkChips({
  machine,
  probe,
  vias,
}: {
  machine: Machine;
  probe: PhoneMachineProbe | undefined;
  vias: readonly Via[];
}) {
  const styles = useStyles(createStyles);
  if (vias.length === 0) return null;
  return (
    <View style={styles.row}>
      {vias.map((via) => (
        <Chip
          key={via}
          via={via}
          link={probe?.links.find((link) => link.via === via)}
          machine={machine}
        />
      ))}
    </View>
  );
}

function createStyles(c: Palette) {
  const chip = {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 24,
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: c.border,
  } as const;
  const dot = { width: 6, height: 6, borderRadius: 3 } as const;
  return {
    row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
    chip,
    missing: { ...chip, borderStyle: "dashed" },
    text: { fontSize: 12, lineHeight: 16, color: c.textSecondary, flexShrink: 1 },
    missingText: { fontSize: 12, lineHeight: 16, color: c.textTertiary },
    dotIdle: { ...dot, backgroundColor: c.textTertiary },
    dotOnline: { ...dot, backgroundColor: c.success },
    dotFailed: { ...dot, backgroundColor: c.danger },
  } as const;
}
