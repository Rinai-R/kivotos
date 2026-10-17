/**
 * The machinery of the dsh adapter: how a coupling point is probed, reported
 * and turned off. The points themselves live beside the code that uses them,
 * one module per part of dsh:
 *
 * - `index-html.ts`: the index dsh serves (viewport, manifest, boot graph,
 *   boot gate, transport global);
 * - `desktop.ts`: the desktop shell's boot bridge;
 * - `sessions.ts`: dsh's current-Session store and its localStorage keys;
 * - `frame.ts`: the rendered frame, conversation and Settings panel the phone
 *   stylesheet positions;
 * - `web-server.ts`: dsh's own paths and asset naming.
 *
 * `src/dsh/` is the only place that may know a dsh internal; everything else
 * calls its functions (`scripts/check-dsh-boundary.mjs` enforces it). Each
 * function that relies on an internal probes it first and does nothing when
 * the probe fails, so the probe and the use cannot disagree. A failed probe
 * costs its own feature, a host log line and a notice, not the page.
 *
 * No Node imports: the Client bundle includes this module.
 */

/** The dsh release every shape in this adapter is pinned to. */
export const PINNED_DSH = "0.2.1-rc.2";

/** Every place Kivotos relies on a dsh internal, in notice order. */
export const COMPAT_POINTS = [
  /** The safe-area viewport rewrite of the served index. */
  "viewport",
  /** The credentialed manifest rewrite of a mounted page's index. */
  "manifest",
  /** The mount cache's warm-up from a peer's boot graph. */
  "boot-graph",
  /** The desktop guard of a mounted page (boot gate and the shell's handshake). */
  "desktop-boot",
  /** The phone drawer layout of dsh's frame. */
  "phone-layout",
  /** The phone spacing of the conversation header, composer and scroller. */
  "phone-conversation",
  /** The full-screen phone Settings panel. */
  "phone-settings",
  /** Opening a machine on a Session (`localStorage["dsh.sessions.current"]`). */
  "session-store",
] as const;

/** One coupling point. */
export type CompatPoint = (typeof COMPAT_POINTS)[number];

/**
 * How a probe came out. `changed` is a shape that moved, `missing` is one that
 * is not there at all; both turn off the feature the probe guards.
 */
export type ProbeState = "ok" | "changed" | "missing";

/** One probe's answer. `reason` is a diagnostic for logs, not a sentence for a user. */
export interface Probe {
  readonly state: ProbeState;
  readonly reason: string;
}

/** Probe results by coupling point; a point that was not judged is absent. */
export type CompatReport = { [point in CompatPoint]?: Probe };

/** @returns an `ok` probe. */
export function ok(reason: string): Probe {
  return { state: "ok", reason };
}

/** @returns a `changed` probe. */
export function changed(reason: string): Probe {
  return { state: "changed", reason };
}

/** @returns a `missing` probe. */
export function missing(reason: string): Probe {
  return { state: "missing", reason };
}

/**
 * @param report - a report.
 * @param point - a coupling point.
 * @returns whether its feature may run: a point not judged yet is trusted.
 */
export function usable(report: CompatReport, point: CompatPoint): boolean {
  const state = report[point]?.state;
  return state !== "changed" && state !== "missing";
}

/** The page global the host's own results travel in (see {@link injectCompatReport}). */
export const COMPAT_GLOBAL = "__KIVOTOS_COMPAT__";

/**
 * Put markup at the top of a page's head, ahead of every document script,
 * whether or not the page has a head element.
 * @param html - the index page.
 * @param markup - the script or element to inject.
 * @returns the page with the markup first.
 */
export function injectHead(html: string, markup: string): string {
  const open = /<head(?:\s[^>]*)?>/i.exec(html);
  if (open === null) return `${markup}${html}`;
  const at = open.index + open[0].length;
  return `${html.slice(0, at)}${markup}${html.slice(at)}`;
}

/**
 * Carry the host's probe results into the page. Only failures travel: an
 * `ok` page is served unchanged.
 * @param html - index html, rewrites already applied.
 * @param report - the host's probe results for this page.
 * @returns html with the failures as {@link COMPAT_GLOBAL}, merged into whatever
 *   the page already carries (a peer that runs Kivotos reports its own).
 */
export function injectCompatReport(html: string, report: CompatReport): string {
  const failed = failures(report);
  if (Object.keys(failed).length === 0) return html;
  // `<` is escaped so a reason cannot close the script element.
  const data = JSON.stringify(failed).replaceAll("<", "\\u003c");
  return injectHead(
    html,
    `<script>Object.assign(globalThis.${COMPAT_GLOBAL} ??= {}, ${data})</script>`,
  );
}

function failures(report: CompatReport): CompatReport {
  const failed: Partial<Record<CompatPoint, Probe>> = {};
  for (const point of COMPAT_POINTS) {
    const probe = report[point];
    if (probe !== undefined && probe.state !== "ok") failed[point] = probe;
  }
  return failed;
}

/**
 * Read a page's host-side report.
 * @param value - the page's {@link COMPAT_GLOBAL}, of unknown shape.
 * @returns the points it reports; anything else is ignored.
 */
export function compatReportOf(value: unknown): CompatReport {
  if (typeof value !== "object" || value === null) return {};
  const report: Partial<Record<CompatPoint, Probe>> = {};
  for (const point of COMPAT_POINTS) {
    const entry: unknown = Reflect.get(value, point);
    if (typeof entry !== "object" || entry === null) continue;
    const state: unknown = Reflect.get(entry, "state");
    const reason: unknown = Reflect.get(entry, "reason");
    if (state !== "ok" && state !== "changed" && state !== "missing") continue;
    if (typeof reason !== "string") continue;
    report[point] = { state, reason };
  }
  return report;
}

/** How bad each state is, so two probes of one point resolve to the worse one. */
const SEVERITY: Record<ProbeState, number> = { ok: 0, changed: 1, missing: 2 };

/**
 * Merge two reports, keeping the worse answer for each point: the host's
 * markup probes and the page's runtime ones can disagree about one point.
 * @returns the merged report.
 */
export function mergeCompat(base: CompatReport, extra: CompatReport): CompatReport {
  const merged: Partial<Record<CompatPoint, Probe>> = {};
  for (const point of COMPAT_POINTS) {
    const first = base[point];
    const second = extra[point];
    if (first === undefined || second === undefined) {
      const either = first ?? second;
      if (either !== undefined) merged[point] = either;
      continue;
    }
    merged[point] = SEVERITY[second.state] > SEVERITY[first.state] ? second : first;
  }
  return merged;
}

/** @returns each point of a report that is not `ok`, in {@link COMPAT_POINTS} order. */
export function failedPoints(report: CompatReport): { point: CompatPoint; probe: Probe }[] {
  const failed: { point: CompatPoint; probe: Probe }[] = [];
  for (const point of COMPAT_POINTS) {
    const probe = report[point];
    if (probe !== undefined && probe.state !== "ok") failed.push({ point, probe });
  }
  return failed;
}

/**
 * Reports each coupling point once per state change, so an upstream change
 * leaves one line in the host's log and not one per served page.
 */
export class CompatWatch {
  private readonly warn: (message: string) => void;
  private readonly seen = new Map<CompatPoint, ProbeState>();

  /** @param warn - the host's warning channel. */
  constructor(warn: (message: string) => void) {
    this.warn = warn;
  }

  /** @param report - probe results for one served page. */
  observe(report: CompatReport): void {
    for (const point of COMPAT_POINTS) {
      const probe = report[point];
      if (probe === undefined || this.seen.get(point) === probe.state) continue;
      this.seen.set(point, probe.state);
      if (probe.state !== "ok") {
        this.warn(`kivotos: dsh compatibility: ${point} is ${probe.state}: ${probe.reason}`);
      }
    }
  }
}

/**
 * Settles the page's own probes. A page probe reads a live page, which can be
 * caught between two renders, so:
 *
 * - a probe answers undefined while its subject is not on the page (no
 *   Settings panel open, no Session selected), and is asked again later;
 * - `ok` settles the point at once;
 * - a failure settles it only when the next reading, taken in a later frame,
 *   agrees.
 *
 * A settled point is not asked again: dsh does not change shape under a page,
 * and a feature that went off stays off rather than flickering.
 */
export class PageVerdicts {
  private readonly settled: Partial<Record<CompatPoint, Probe>> = {};
  private readonly pending: Partial<Record<CompatPoint, Probe>> = {};

  /**
   * @param readings - this reading of the points still open; undefined ones
   *   are not judged yet.
   * @returns whether anything was settled by it.
   */
  read(readings: CompatReport): boolean {
    let settledAny = false;
    for (const point of COMPAT_POINTS) {
      const probe = readings[point];
      if (probe === undefined || this.settled[point] !== undefined) continue;
      if (probe.state === "ok" || this.pending[point] !== undefined) {
        this.settled[point] = probe;
        settledAny = true;
      } else {
        this.pending[point] = probe;
      }
    }
    for (const point of COMPAT_POINTS) {
      if (readings[point]?.state === "ok") delete this.pending[point];
    }
    return settledAny;
  }

  /** @returns whether the point has its answer. */
  isSettled(point: CompatPoint): boolean {
    return this.settled[point] !== undefined;
  }

  /** @returns the settled points. */
  report(): CompatReport {
    return { ...this.settled };
  }
}
