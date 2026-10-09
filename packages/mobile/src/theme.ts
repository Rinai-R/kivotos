import { useMemo } from "react";
import { StyleSheet, useColorScheme, type ColorSchemeName } from "react-native";

/** Colors of the app's own screens, matching dsh's light and dark grounds. */
export function palette(scheme: ColorSchemeName) {
  return scheme === "dark"
    ? {
        bg: "#151517",
        card: "#1E1E21",
        pressed: "#2A2A2E",
        border: "#3A3A3F",
        text: "#F2F2F3",
        muted: "#9A9AA1",
        accent: "#3478DB",
        danger: "#FF6B6B",
      }
    : {
        bg: "#FFFFFF",
        card: "#F9FAFB",
        pressed: "#EEF0F3",
        border: "#E3E5E8",
        text: "#151517",
        muted: "#6B6F76",
        accent: "#3478DB",
        danger: "#D93636",
      };
}

export type Palette = ReturnType<typeof palette>;

/**
 * A component's style sheet for the current color scheme, built once per
 * scheme so style props keep their identity across renders.
 * @param create - builds the sheet from the palette; define it at module scope.
 */
export function useStyles<T extends StyleSheet.NamedStyles<T>>(create: (colors: Palette) => T): T {
  const scheme = useColorScheme();
  return useMemo(() => StyleSheet.create(create(palette(scheme))), [create, scheme]);
}

/** The current palette (for props that take a plain color). */
export function useColors(): Palette {
  const scheme = useColorScheme();
  return useMemo(() => palette(scheme), [scheme]);
}
