import Svg, { Path } from "react-native-svg";
import { KIVOTOS_MARK_VIEWBOX, KIVOTOS_PLANES, KIVOTOS_MARK_TRANSFORM } from "./kivotos-mark";

interface KivotosLogoProps {
  size?: number;
  /** Renders the mark in a single colour instead of the brand palette. */
  color?: string;
}

export function KivotosLogo({ size = 64, color }: KivotosLogoProps) {
  return (
    <Svg width={size} height={size} viewBox={KIVOTOS_MARK_VIEWBOX} fill="none">
      {KIVOTOS_PLANES.map(({ d, fill }) => (
        <Path key={d} d={d} fill={color ?? fill} transform={KIVOTOS_MARK_TRANSFORM} />
      ))}
    </Svg>
  );
}
