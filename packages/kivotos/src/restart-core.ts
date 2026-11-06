/**
 * Safe restart: the pieces shared by the Host plugin, the detached helper and
 * the tests. Nothing here touches a process, a file or the network; the
 * helper's watchdog (`runHelper`) takes all of that as `HelperDeps`.
 *
 * The restart is a hand-off between three parties:
 *
 * 1. The running Kivotos (Host plugin) checks that a relaunch can be
 *    guaranteed, writes the state file and spawns the helper detached.
 * 2. The helper outlives dsh: it asks dsh to quit gracefully, waits for the
 *    old processes to exit (forcing only after a timeout, and saying so),
 *    launches dsh again and waits for the new Kivotos to report back,
 *    retrying the launch a few times.
 * 3. The new Kivotos, once its links are up, finds the state file in the
 *    `launching` phase and marks it `back` with what changed.
 */

/** How a restart may begin: right away, or once no task is running. */
export type RestartMode = "now" | "idle";

export function isRestartMode(value: unknown): value is RestartMode {
  return value === "now" || value === "idle";
}

/** Versions on one side of a restart. */
export interface Versions {
  /** The dsh release, when known. */
  dsh?: string;
  /** Every plugin package in the profile, by name. */
  plugins: Record<string, string>;
}

/** One version that differs across a restart. */
export interface VersionChange {
  name: string;
  /** Absent: added by the restart. */
  from?: string;
  /** Absent: removed by the restart. */
  to?: string;
}

/** @returns what differs between two version sets, dsh first, then plugins by name. */
export function versionChanges(from: Versions, to: Versions): VersionChange[] {
  const out: VersionChange[] = [];
  if (from.dsh !== to.dsh && (from.dsh !== undefined || to.dsh !== undefined)) {
    out.push(change("dsh", from.dsh, to.dsh));
  }
  const names = [...new Set([...Object.keys(from.plugins), ...Object.keys(to.plugins)])].sort();
  for (const name of names) {
    const a = from.plugins[name];
    const b = to.plugins[name];
    if (a !== b) out.push(change(name, a, b));
  }
  return out;
}

function change(name: string, from: string | undefined, to: string | undefined): VersionChange {
  const out: VersionChange = { name };
  if (from !== undefined) out.from = from;
  if (to !== undefined) out.to = to;
  return out;
}

/**
 * Where a restart is. `armed`: the helper is up and about to ask dsh to quit;
 * `quitting`: dsh was asked; `launching`: the old processes are gone and a
 * launch is out; `back`: the new Kivotos answered; `failed`: every attempt
 * ran out (the log says what happened).
 */
export type RestartPhase = "armed" | "quitting" | "launching" | "back" | "failed";

/** The state file, `$DSH_HOME/kivotos/restart/state.json`. */
export interface RestartRecord {
  id: string;
  mode: RestartMode;
  phase: RestartPhase;
  /** ms since the epoch. */
  requestedAt: number;
  /** The Host process that asked; the new one must differ. */
  fromPid: number;
  from: Versions;
  /** Where the helper writes its account of the restart. */
  log: string;
  helperPid?: number;
  /** Launches made so far. */
  attempts?: number;
  /** The graceful quit timed out and a process was killed. */
  forced?: string[];
  backAt?: number;
  /** The Host process that answered. */
  toPid?: number;
  to?: Versions;
  changes?: VersionChange[];
  error?: string;
}

/** What the helper is told to do, written next to the state file. */
export interface HelperJob {
  id: string;
  /** The process asked to quit: the desktop app's main process, or the dsh process itself. */
  quitPid: number;
  /** The process that runs the Host, which must be gone before the launch (may equal `quitPid`). */
  hostPid: number;
  launch: LaunchSpec;
  /** When set, also require this URL (the tailnet listener) to answer before calling it back. */
  probe?: string;
  /** Pause before asking dsh to quit, so the request that started the restart gets its answer. */
  startDelayMs: number;
  /** How long a graceful quit may take before the quitting process is killed. */
  quitTimeoutMs: number;
  /** How long the Host may take to shut down after the quitting process is gone. */
  hostExitTimeoutMs: number;
  /** How long one launch may take to report back. */
  readyTimeoutMs: number;
  /** Launches before giving up. */
  attempts: number;
}

/** How dsh is started again. */
export interface LaunchSpec {
  /** `desktop`: through LaunchServices (`open <bundle>`); `process`: the same command line again. */
  kind: "desktop" | "process";
  command: string;
  args: string[];
  cwd?: string;
  /** Replaces the helper's environment when set. */
  env?: Record<string, string>;
  /** The executable a launched instance runs as, to find it again for a retry. */
  executable: string;
}

/** Everything the watchdog does to the world. */
export interface HelperDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  alive(pid: number): boolean;
  signal(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  /** @returns the launched process's pid when the launch made one directly. */
  launch(spec: LaunchSpec): Promise<number | undefined>;
  /** @returns the pids now running `spec.executable` as a new instance. */
  instances(spec: LaunchSpec): number[];
  read(): RestartRecord | undefined;
  /** Merge into the state file. */
  update(patch: Partial<RestartRecord>): void;
  /** @returns whether the URL answered at all. */
  probe(url: string): Promise<boolean>;
  log(line: string): void;
}

const POLL_MS = 250;

/** @returns true once `pid` has exited, false when it is still there after `ms`. */
export async function waitExit(deps: HelperDeps, pid: number, ms: number): Promise<boolean> {
  const until = deps.now() + ms;
  while (deps.alive(pid)) {
    if (deps.now() >= until) return false;
    await deps.sleep(POLL_MS);
  }
  return true;
}

/**
 * Stop one process: SIGTERM, then SIGKILL after `graceMs`.
 * @returns "gone" when it was already gone, "graceful" or "forced".
 */
export async function stopProcess(
  deps: HelperDeps,
  pid: number,
  graceMs: number,
  what: string,
): Promise<"gone" | "graceful" | "forced"> {
  if (!deps.alive(pid)) return "gone";
  deps.signal(pid, "SIGTERM");
  if (await waitExit(deps, pid, graceMs)) return "graceful";
  deps.log(`${what} (pid ${pid}) did not exit within ${secs(graceMs)} of SIGTERM; sending SIGKILL`);
  deps.signal(pid, "SIGKILL");
  await waitExit(deps, pid, 5_000);
  return "forced";
}

function secs(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

/** @returns whether the new Kivotos reported back within the job's ready timeout. */
async function awaitBack(job: HelperJob, deps: HelperDeps, oldPid: number): Promise<boolean> {
  const until = deps.now() + job.readyTimeoutMs;
  let probed = false;
  while (deps.now() < until) {
    const record = deps.read();
    if (record?.id === job.id && record.phase === "back" && record.toPid !== oldPid) {
      if (job.probe === undefined || probed) return true;
      if (await deps.probe(job.probe)) {
        deps.log(`the tailnet listener answers at ${job.probe}`);
        probed = true;
        return true;
      }
    }
    await deps.sleep(500);
  }
  return false;
}

/**
 * The helper's whole run: quit, wait, launch, watch, retry.
 * @returns the final phase, also written to the state file.
 */
export async function runHelper(job: HelperJob, deps: HelperDeps): Promise<"back" | "failed"> {
  const forced: string[] = [];
  deps.log(
    `restart ${job.id}: armed; quit pid ${job.quitPid}, host pid ${job.hostPid}, launch ${job.launch.kind}: ${[job.launch.command, ...job.launch.args].join(" ")}`,
  );
  await deps.sleep(job.startDelayMs);

  // 1. Ask dsh to quit the way its own Quit does.
  deps.update({ phase: "quitting" });
  if (deps.alive(job.quitPid)) {
    deps.log(`asking pid ${job.quitPid} to quit (SIGTERM, graceful)`);
    deps.signal(job.quitPid, "SIGTERM");
    if (!(await waitExit(deps, job.quitPid, job.quitTimeoutMs))) {
      // The desktop app shows a confirmation when work would be interrupted;
      // nobody at the screen answers it for a remote user.
      deps.log(
        `graceful quit timed out after ${secs(job.quitTimeoutMs)} (dsh may be asking for confirmation on screen); force-quitting pid ${job.quitPid} with SIGKILL`,
      );
      deps.signal(job.quitPid, "SIGKILL");
      forced.push(`quit pid ${job.quitPid} after ${secs(job.quitTimeoutMs)}`);
      deps.update({ forced: [...forced] });
      await waitExit(deps, job.quitPid, 5_000);
    } else {
      deps.log(`pid ${job.quitPid} quit gracefully`);
    }
  } else {
    deps.log(`pid ${job.quitPid} is already gone`);
  }

  // 2. The Host shuts itself down when its parent goes; it must be gone before
  // a new one binds the same ports and profile.
  if (job.hostPid !== job.quitPid && deps.alive(job.hostPid)) {
    if (await waitExit(deps, job.hostPid, job.hostExitTimeoutMs)) {
      deps.log(`host pid ${job.hostPid} shut down`);
    } else {
      deps.log(
        `host pid ${job.hostPid} still running after ${secs(job.hostExitTimeoutMs)}; stopping it`,
      );
      const how = await stopProcess(deps, job.hostPid, 20_000, "host");
      if (how === "forced") forced.push(`host pid ${job.hostPid}`);
      deps.update({ forced: [...forced] });
    }
  }

  // 3. Launch and watch; a launch that does not come back is retried.
  for (let attempt = 1; attempt <= job.attempts; attempt++) {
    deps.update({ phase: "launching", attempts: attempt });
    deps.log(`launch ${attempt}/${job.attempts}`);
    let launched: number | undefined;
    try {
      launched = await deps.launch(job.launch);
    } catch (error) {
      deps.log(
        `launch ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await deps.sleep(2_000);
      continue;
    }
    if (await awaitBack(job, deps, job.hostPid)) {
      const record = deps.read();
      deps.log(
        `back after launch ${attempt}: host pid ${record?.toPid ?? "?"}${forced.length > 0 ? `; forced: ${forced.join(", ")}` : ""}`,
      );
      return "back";
    }
    deps.log(`launch ${attempt} did not report back within ${secs(job.readyTimeoutMs)}`);
    if (attempt === job.attempts) break;
    // Clear what this launch left before the next one.
    const stale = new Set([
      ...(launched === undefined ? [] : [launched]),
      ...deps.instances(job.launch),
    ]);
    for (const pid of stale) {
      const how = await stopProcess(deps, pid, 15_000, "unresponsive instance");
      if (how === "forced") forced.push(`unresponsive instance pid ${pid}`);
    }
    deps.update({ forced: [...forced] });
  }
  deps.update({ phase: "failed", error: `no launch reported back after ${job.attempts} attempts` });
  deps.log(`restart ${job.id} failed: no launch reported back after ${job.attempts} attempts`);
  return "failed";
}

/** What the Host serves at `GET /kivotos/restart`. */
export interface RestartStatus {
  /** Whether this dsh can be restarted safely; `reason` says why not. */
  supported: boolean;
  reason?: string;
  kind?: "desktop" | "process";
  /** This Host process; changes with every restart. */
  pid: number;
  startedAt: number;
  versions: Versions;
  busy: Busy;
  /** The desktop app will show its quit confirmation, which Kivotos then has to force past. */
  confirmOnScreen: boolean;
  /** A restart under way: waiting for idle, or handed to the helper. */
  pending: { id: string; mode: RestartMode; phase: "waiting" | RestartPhase; since: number } | null;
  /** The last restart that finished, back or failed. */
  last: RestartRecord | null;
  /** The restart log on this machine. */
  log: string;
}

/** Work a restart would interrupt. */
export interface Busy {
  sessions: { id: string; title?: string }[];
  jobs: { id: string; label: string; session?: string }[];
  /** Armed scheduled reminders in loaded sessions. */
  reminders: boolean;
}

export function isIdle(busy: Busy): boolean {
  return busy.sessions.length === 0 && busy.jobs.length === 0;
}
