import Svg, { Circle, G, Path, Rect } from "react-native-svg";

interface GlyphProps {
  size?: number;
  color: string;
}

/** The Kivotos K (assets/kivotos-logo.svg); brand artwork keeps its own blues. */
export function KivotosMark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="88 88 344 336">
      <Path d="M104 136L184 96V376L104 416V136Z" fill="#3478DB" />
      <Path d="M204 224L328 100H420L264 256L204 224Z" fill="#62A5F5" />
      <Path d="M204 244L264 276L420 412H316L204 308V244Z" fill="#2455A4" />
    </Svg>
  );
}

export function MonitorGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Rect x={2.5} y={3.5} width={15} height={10} rx={2} stroke={color} strokeWidth={1.5} />
      <Path d="M7 16.5h6M10 13.5v3" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

export function QrGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Rect x={3} y={3} width={5.5} height={5.5} rx={1.2} stroke={color} strokeWidth={1.5} />
      <Rect x={11.5} y={3} width={5.5} height={5.5} rx={1.2} stroke={color} strokeWidth={1.5} />
      <Rect x={3} y={11.5} width={5.5} height={5.5} rx={1.2} stroke={color} strokeWidth={1.5} />
      <Path
        d="M11.5 11.5h2v2M17 11.5v2M11.5 17h2.5M17 15.5V17"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function ChevronGlyph({ size = 16, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M6 3.5L10.5 8 6 12.5"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CloseGlyph({ size = 18, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

export function KeyboardGlyph({ size = 18, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Rect x={2} y={5} width={16} height={10} rx={2} stroke={color} strokeWidth={1.5} />
      <Path
        d="M5.5 8.5h1M9.5 8.5h1M13.5 8.5h1M6.5 12h7"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** The Tailscale grid: x, y and opacity of each dot. */
const TAILSCALE_DOTS = [
  [3.5, 3.5, 0.35],
  [8, 3.5, 0.35],
  [12.5, 3.5, 0.35],
  [3.5, 8, 1],
  [8, 8, 1],
  [12.5, 8, 1],
  [3.5, 12.5, 0.35],
  [8, 12.5, 1],
  [12.5, 12.5, 0.35],
] as const;

/** The Tailscale link: a grid of nine dots, as dsh's Remote access shows it. */
export function TailscaleGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <G fill={color}>
        {TAILSCALE_DOTS.map(([cx, cy, opacity]) => (
          <Circle key={`${cx},${cy}`} cx={cx} cy={cy} r={1.3} opacity={opacity} />
        ))}
      </G>
    </Svg>
  );
}

/** The own relay: a box between two arrows. */
export function RelayGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Rect x={5.25} y={5.25} width={5.5} height={5.5} rx={1.2} stroke={color} strokeWidth={1.3} />
      <Path
        d="M1.5 8h3.75M10.75 8h3.75M3.5 6l-2 2 2 2M12.5 6l2 2-2 2"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** A circled exclamation mark: a failure callout. */
export function ErrorGlyph({ size = 18, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Circle cx={8} cy={8} r={6.5} stroke={color} strokeWidth={1.3} />
      <Path d="M8 4.8v4M8 11.2h.01" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

export function BackGlyph({ size = 20, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M12.5 4.5L7 10l5.5 5.5"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
