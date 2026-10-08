/**
 * Geometry of the Kivotos mark — an angular K built from three folded ribbon planes,
 * drawn inside a 512 box. Shared by every surface that draws the logo in code.
 */
export interface KivotosPlane {
  d: string;
  fill: string;
}

export const KIVOTOS_MARK_VIEWBOX = "0 0 512 512";

export const KIVOTOS_PLANES: readonly KivotosPlane[] = [
  { d: "M104 136L184 96V376L104 416V136Z", fill: "#3478DB" },
  { d: "M204 224L328 100H420L264 256L204 224Z", fill: "#62A5F5" },
  { d: "M204 244L264 276L420 412H316L204 308V244Z", fill: "#2455A4" },
];

/** Every plane as one path, for masks and single-colour renderings. */
export const KIVOTOS_MARK_D =
  "M104 136L184 96V376L104 416V136Z M204 224L328 100H420L264 256L204 224Z M204 244L264 276L420 412H316L204 308V244Z";

/** Scales the mark to the painted weight of the previous logo inside the same box. */
export const KIVOTOS_MARK_TRANSFORM = "translate(256,256) scale(1.1) translate(-261.5,-255.5)";
