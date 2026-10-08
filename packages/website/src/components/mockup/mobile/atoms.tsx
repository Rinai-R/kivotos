// Small shared bits for the mobile mockups. The Kivotos mark is the
// app icon (packages/website/public/favicon.svg) with the black plate dropped,
// so it can be tinted and placed on any tile. Tile fills are the app's identity
// palette — packages/app/src/styles/identity-colors.ts — surfaced as
// `--color-mock-tile-*` tokens in styles.css.

const KIVOTOS_MARK_D =
  "M104 136L184 96V376L104 416V136Z M204 224L328 100H420L264 256L204 224Z M204 244L264 276L420 412H316L204 308V244Z";

export function KivotosMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path transform="translate(256,256) scale(1.1) translate(-261.5,-255.5)" d={KIVOTOS_MARK_D} />
    </svg>
  );
}

/** A hashed identity tile — one letter on a muted identity fill. */
export function LetterTile({
  letter,
  tone,
}: {
  letter: string;
  tone: "red" | "violet" | "amber" | "teal";
}) {
  return (
    <span
      className={`flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold text-white ${TILE_TONE[tone]}`}
    >
      {letter}
    </span>
  );
}

const TILE_TONE = {
  red: "bg-mock-tile-red",
  violet: "bg-mock-tile-violet",
  amber: "bg-mock-tile-amber",
  teal: "bg-mock-tile-teal",
} as const;

/** The Kivotos project tile — white mark on the black app plate. */
export function KivotosTile() {
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-black text-white">
      <KivotosMark size={14} />
    </span>
  );
}
