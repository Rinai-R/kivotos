import { StyleSheet, View } from "react-native";
import type { Dot } from "./strings";
import { useStyles, type Palette } from "./theme";

/**
 * A link's or a machine's state dot (8 px, theme.ts colours), in a 12 px
 * slot. `used` rings it: the link the phone goes through.
 */
export function StateDot({ dot, used = false }: { dot: Dot; used?: boolean }) {
  const styles = useStyles(createStyles);
  return (
    <View style={styles.slot}>
      {used ? <View style={styles[`halo.${dot}`]} /> : null}
      <View style={styles[`dot.${dot}`]} />
    </View>
  );
}

function createStyles(c: Palette) {
  const dot = { width: 8, height: 8, borderRadius: 4 } as const;
  const halo = { ...StyleSheet.absoluteFill, borderRadius: 6, opacity: 0.3 } as const;
  return {
    slot: { width: 12, height: 12, alignItems: "center", justifyContent: "center" },
    "dot.online": { ...dot, backgroundColor: c.success },
    "dot.unstable": { ...dot, backgroundColor: c.warn },
    "dot.down": { ...dot, backgroundColor: c.danger },
    "dot.idle": { ...dot, backgroundColor: c.textTertiary },
    "dot.checking": {
      ...dot,
      borderWidth: 1.5,
      borderColor: c.textTertiary,
      borderRightColor: "transparent",
    },
    "halo.online": { ...halo, backgroundColor: c.success },
    "halo.unstable": { ...halo, backgroundColor: c.warn },
    "halo.down": { ...halo, backgroundColor: c.danger },
    "halo.idle": { ...halo, backgroundColor: c.textTertiary },
    "halo.checking": { ...halo, backgroundColor: c.textTertiary },
  } as const;
}
