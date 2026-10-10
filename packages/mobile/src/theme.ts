import { useMemo } from "react";
import { StyleSheet, useColorScheme, type ColorSchemeName } from "react-native";

/**
 * Colors of the app's own screens. Each value is the resolved dsh 0.2.0-rc.2
 * `--dsw-alias-*` token (ui-theme design-platform.css) named in its comment,
 * so the native screens and the dsh WebView read as one product.
 */
export function palette(scheme: ColorSchemeName) {
  return scheme === "dark"
    ? {
        bg: "#151517", // bg-base
        surface: "#1B1B1C", // neutral-bluish-900
        pressed: "#2C2C2E", // neutral-bluish-850
        separator: "rgba(255,255,255,0.06)", // border-l1
        border: "rgba(255,255,255,0.12)", // border-l2
        text: "#F9FAFB", // label-primary
        textSecondary: "#CFD3D6", // label-secondary
        textTertiary: "#ADB2B8", // label-tertiary
        primary: "#F9FAFB", // button-primary-fill
        onPrimary: "#151517",
        link: "#7AAAFF", // link
        danger: "#F25A5A", // state-error-primary
        dangerSoft: "rgba(242,90,90,0.12)",
        scrim: "rgba(0,0,0,0.55)",
      }
    : {
        bg: "#FFFFFF",
        surface: "#F9FAFB", // neutral-bluish-50
        pressed: "#EBEEF2", // neutral-bluish-100
        separator: "rgba(0,0,0,0.04)",
        border: "rgba(0,0,0,0.1)",
        text: "#0F1115",
        textSecondary: "#61666B",
        textTertiary: "#81858C",
        primary: "#0F1115",
        onPrimary: "#FFFFFF",
        link: "#4176E6",
        danger: "#EC1313",
        dangerSoft: "#FEF2F2", // red-50
        scrim: "rgba(15,17,21,0.45)",
      };
}

export type Palette = ReturnType<typeof palette>;

/** dsh radii (`--dsw-radius-*`). */
export const radius = { sm: 8, md: 12, lg: 16, xl: 20 } as const;

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
