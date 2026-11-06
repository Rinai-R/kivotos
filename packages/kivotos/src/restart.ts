/**
 * Safe restart, Host side: what a restart would interrupt, whether this dsh
 * can be relaunched, the helper hand-off, and the routes and command the
 * clients use. See `restart-core.ts` for the hand-off as a whole.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import net from "node:net";
import path from "node:path";
import {
  inspectQuit,
  launchEnv,
  processFacts,
  profileDirOf,
  restartTarget,
  type ProcessFacts,
  type QuitServices,
  type RestartTarget,
} from "./dsh/restart.ts";
import {
  isIdle,
  isRestartMode,
  versionChanges,
  type Busy,
  type HelperJob,
  type RestartMode,
  type RestartRecord,
  type RestartStatus,
  type Versions,
} from "./restart-core.ts";

export const RESTART_PATH = "/kivotos/restart";
const IDLE_POLL_MS = 3_000;
const HELPER_ACK_MS = 5_000;
const NO_BUSY: Busy = { sessions: [], jobs: [], reminders: false };

/** @returns the parsed JSON file, or undefined when it is missing or unreadable. */
export function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Write a JSON file atomically (temp file, rename). */
export function writeJson(file: string, value: unknown): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

/** @returns the versions of a profile's plugin packages and of dsh. */
export function readVersions(profileDir: string | undefined, dsh: string | undefined): Versions {
  const plugins: Record<string, string> = {};
  if (profileDir !== undefined) {
    const manifest = readJson<{ dependencies?: Record<string, string> }>(
      path.join(profileDir, "package.json"),
    );
    for (const name of Object.keys(manifest?.dependencies ?? {})) {
      const pkg = readJson<{ version?: string }>(
        path.join(profileDir, "node_modules", name, "package.json"),
      );
      if (typeof pkg?.version === "string") plugins[name] = pkg.version;
    }
  }
  return dsh === undefined ? { plugins } : { dsh, plugins };
}

/** @returns the version of the `@deepseek-ai/dsh` package a CLI entry belongs to. */
function dshVersionNear(entry: string | undefined): string | undefined {
  let dir = entry === undefined ? undefined : path.dirname(entry);
  for (let i = 0; dir !== undefined && i < 6; i++) {
    const pkg = readJson<{ name?: string; version?: string }>(path.join(dir, "package.json"));
    if (pkg?.name === "@deepseek-ai/dsh" && typeof pkg.version === "string") return pkg.version;
    // The desktop app's CLI runs from a sibling package of `@deepseek-ai/dsh`.
    const sibling = readJson<{ version?: string }>(
      path.join(dir, "node_modules", "@deepseek-ai", "dsh", "package.json"),
    );
    if (typeof sibling?.version === "string") return sibling.version;
    const up = path.dirname(dir);
    dir = up === dir ? undefined : up;
  }
  return undefined;
}

export interface RestartOptions {
  /** `$DSH_HOME`. */
  home: string;
  /** The built helper script (`dist/restart-helper.js`). */
  helper: string;
  /** This module's own file, to find the profile when dsh does not say. */
  moduleFile: string;
  profileDir?: string;
  services: () => QuitServices;
  /** The tailnet listener's base URL, which the new instance must answer at. */
  listenerUrl: () => string | undefined;
  warn: (message: string, error?: unknown) => void;
  facts?: ProcessFacts;
  /** Starts the helper; the default spawns it detached. */
  spawnHelper?: (helper: string, job: string, log: string) => { pid?: number; kill(): void };
  idlePollMs?: number;
  helperAckMs?: number;
}

/** The restart state of this Host. */
export class RestartService {
  readonly pid = process.pid;
  readonly startedAt = Date.now();
  private readonly options: RestartOptions;
  private readonly dir: string;
  readonly stateFile: string;
  readonly logFile: string;
  private waiting:
    | { id: string; mode: RestartMode; since: number; timer?: ReturnType<typeof setTimeout> }
    | undefined;
  private disposed = false;
  /** What this Host loaded: the versions on disk when it started. */
  readonly loaded: Versions;

  constructor(options: RestartOptions) {
    this.options = options;
    this.dir = path.join(options.home, "kivotos", "restart");
    this.stateFile = path.join(this.dir, "state.json");
    this.logFile = path.join(this.dir, "restart.log");
    this.loaded = this.versions();
  }

  private facts(): ProcessFacts {
    return this.options.facts ?? processFacts();
  }

  target(): RestartTarget {
    const facts = this.facts();
    return restartTarget(facts, facts.env.KIVOTOS_RESTART_LAUNCH);
  }

  versions(): Versions {
    const facts = this.facts();
    const dsh = facts.env.DSH_CLIENT_VERSION ?? dshVersionNear(facts.argv[1]);
    return readVersions(this.options.profileDir ?? profileDirOf(this.options.moduleFile), dsh);
  }

  record(): RestartRecord | undefined {
    return readJson<RestartRecord>(this.stateFile);
  }

  async busy(): Promise<Busy | undefined> {
    return inspectQuit(this.options.services());
  }

  async status(): Promise<RestartStatus> {
    const target = this.target();
    const busy = (await this.busy()) ?? NO_BUSY;
    const record = this.record();
    let pending: RestartStatus["pending"] = null;
    if (this.waiting !== undefined) {
      pending = {
        id: this.waiting.id,
        mode: this.waiting.mode,
        phase: "waiting",
        since: this.waiting.since,
      };
    } else if (
      record !== undefined &&
      record.fromPid === this.pid &&
      (record.phase === "armed" || record.phase === "quitting" || record.phase === "launching")
    ) {
      pending = {
        id: record.id,
        mode: record.mode,
        phase: record.phase,
        since: record.requestedAt,
      };
    }
    const last =
      record !== undefined && (record.phase === "back" || record.phase === "failed")
        ? record
        : null;
    const status: RestartStatus = {
      supported: target.ok,
      pid: this.pid,
      startedAt: this.startedAt,
      versions: this.loaded,
      busy,
      confirmOnScreen: target.ok && target.kind === "desktop" && (!isIdle(busy) || busy.reminders),
      pending,
      last,
      log: this.logFile,
    };
    if (target.ok) status.kind = target.kind;
    else status.reason = target.reason;
    return status;
  }

  /**
   * Start a restart.
   * @returns the refusal reason, or undefined when the restart is under way.
   */
  async request(mode: RestartMode): Promise<string | undefined> {
    if (this.disposed) return "Kivotos is unloading";
    const target = this.target();
    if (!target.ok) return target.reason;
    if (this.waiting !== undefined) return "a restart is already waiting for the tasks to finish";
    const record = this.record();
    if (
      record?.fromPid === this.pid &&
      (record.phase === "armed" || record.phase === "quitting" || record.phase === "launching")
    ) {
      return "a restart is already under way";
    }
    if (!existsSync(this.options.helper))
      return `the restart helper is missing (${this.options.helper})`;
    const busy = await this.busy();
    if (mode === "idle") {
      if (busy === undefined) return "dsh's task services are unavailable, so idle cannot be told";
      if (!isIdle(busy)) {
        this.waitForIdle(randomUUID());
        return undefined;
      }
    }
    return this.handOff(target, mode, randomUUID(), busy ?? NO_BUSY);
  }

  /** Stop waiting for idle. @returns whether a wait was cancelled. */
  cancel(): boolean {
    if (this.waiting === undefined) return false;
    clearTimeout(this.waiting.timer);
    this.waiting = undefined;
    return true;
  }

  private waitForIdle(id: string): void {
    const waiting: NonNullable<RestartService["waiting"]> = { id, mode: "idle", since: Date.now() };
    this.waiting = waiting;
    const poll = async (): Promise<void> => {
      if (this.waiting !== waiting || this.disposed) return;
      const busy = await this.busy();
      if (this.waiting !== waiting) return;
      if (busy !== undefined && isIdle(busy)) {
        this.waiting = undefined;
        const target = this.target();
        const refused = target.ok ? await this.handOff(target, "idle", id, busy) : target.reason;
        if (refused !== undefined)
          this.options.warn(`kivotos: restart when idle refused: ${refused}`);
        return;
      }
      waiting.timer = setTimeout(() => void poll(), this.options.idlePollMs ?? IDLE_POLL_MS);
    };
    waiting.timer = setTimeout(() => void poll(), this.options.idlePollMs ?? IDLE_POLL_MS);
  }

  /** Write the job, start the helper and wait for it to say it is up. */
  private async handOff(
    target: Extract<RestartTarget, { ok: true }>,
    mode: RestartMode,
    id: string,
    busy: Busy,
  ): Promise<string | undefined> {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    } catch (error) {
      return `cannot write ${this.dir}: ${error instanceof Error ? error.message : String(error)}`;
    }
    const confirm = target.kind === "desktop" && (!isIdle(busy) || busy.reminders);
    const listener = this.options.listenerUrl();
    const job: HelperJob = {
      id,
      quitPid: target.quitPid,
      hostPid: target.hostPid,
      launch: target.launch,
      startDelayMs: 1_500,
      // A confirmation nobody can answer is forced past sooner; a clean quit
      // includes the Host's whole shutdown, which can take a while.
      quitTimeoutMs: confirm ? 15_000 : 90_000,
      hostExitTimeoutMs: 60_000,
      readyTimeoutMs: 120_000,
      attempts: 3,
      ...(listener === undefined ? {} : { probe: new URL("/kivotos/hello", listener).href }),
    };
    const record: RestartRecord = {
      id,
      mode,
      phase: "armed",
      requestedAt: Date.now(),
      fromPid: this.pid,
      from: this.loaded,
      log: this.logFile,
    };
    const jobFile = path.join(this.dir, "job.json");
    try {
      writeJson(jobFile, job);
      writeJson(this.stateFile, record);
    } catch (error) {
      return `cannot write the restart state: ${error instanceof Error ? error.message : String(error)}`;
    }
    let child: { pid?: number; kill(): void };
    try {
      child = (this.options.spawnHelper ?? spawnDetached)(
        this.options.helper,
        jobFile,
        this.logFile,
      );
    } catch (error) {
      this.writeFailed(record, "the restart helper could not be started");
      return `the restart helper could not be started: ${error instanceof Error ? error.message : String(error)}`;
    }
    const until = Date.now() + (this.options.helperAckMs ?? HELPER_ACK_MS);
    while (Date.now() < until) {
      const now = this.record();
      if (now?.id === id && now.helperPid !== undefined) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    child.kill();
    this.writeFailed(record, "the restart helper did not start");
    return "the restart helper did not start; dsh was left running";
  }

  private writeFailed(record: RestartRecord, error: string): void {
    try {
      writeJson(this.stateFile, { ...record, phase: "failed", error });
    } catch {
      // nothing more to do
    }
  }

  /**
   * Called once this Kivotos is serving: a restart that handed off to a
   * helper is marked back, with what changed.
   * @returns the record marked back, if any.
   */
  markBack(): RestartRecord | undefined {
    const record = this.record();
    if (
      record === undefined ||
      record.fromPid === this.pid ||
      !(record.phase === "armed" || record.phase === "quitting" || record.phase === "launching")
    ) {
      return undefined;
    }
    const to = this.loaded;
    const back: RestartRecord = {
      ...record,
      phase: "back",
      backAt: Date.now(),
      toPid: this.pid,
      to,
      changes: versionChanges(record.from, to),
    };
    try {
      writeJson(this.stateFile, back);
    } catch (error) {
      this.options.warn("kivotos: cannot mark the restart back", error);
      return undefined;
    }
    return back;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }
}

/**
 * Wait until dsh's webServer accepts connections on loopback.
 * @returns whether it did within `ms`.
 */
export async function waitListening(port: () => number, ms = 60_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const at = port();
    if (at > 0) {
      const ok = await new Promise<boolean>((resolve) => {
        const socket = net.connect({ host: "127.0.0.1", port: at });
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
      });
      if (ok) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/** Start the helper in its own session, so it outlives dsh. */
function spawnDetached(helper: string, job: string, log: string): { pid?: number; kill(): void } {
  const fd = openSync(log, "a", 0o600);
  try {
    const child = spawn(process.execPath, [helper, job], {
      detached: true,
      stdio: ["ignore", fd, fd],
      cwd: path.dirname(job),
      // The desktop Host's executable is Electron: keep it in Node mode.
      env: { ...launchEnv(process.env), ELECTRON_RUN_AS_NODE: "1" },
    });
    child.unref();
    return { pid: child.pid, kill: () => child.kill("SIGKILL") };
  } finally {
    closeSync(fd);
  }
}

/** Parse `restart [now|idle|cancel|status]` (the `/kivotos` command's input). */
export function parseRestartCommand(
  raw: string,
):
  | { action: "restart"; mode: RestartMode }
  | { action: "cancel" }
  | { action: "status" }
  | { action: "help" } {
  const words = raw
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words[0] !== "restart") return { action: "help" };
  const arg = words[1] ?? "idle";
  if (arg === "cancel") return { action: "cancel" };
  if (arg === "status") return { action: "status" };
  if (isRestartMode(arg) && words.length <= 2) return { action: "restart", mode: arg };
  return { action: "help" };
}

const COMMAND_HELP =
  "Usage: /kivotos restart [now|idle|status|cancel]. `idle` (the default) waits until no task runs; `now` restarts right away.";

/** @returns the text the `/kivotos` command answers with. */
export async function runRestartCommand(
  service: RestartService,
  raw: string,
): Promise<{ ok: boolean; text: string }> {
  const parsed = parseRestartCommand(raw);
  if (parsed.action === "help") return { ok: false, text: COMMAND_HELP };
  if (parsed.action === "cancel") {
    return service.cancel()
      ? { ok: true, text: "The restart waiting for idle is cancelled." }
      : { ok: false, text: "No restart is waiting." };
  }
  const status = await service.status();
  if (parsed.action === "status") return { ok: true, text: statusText(status) };
  const refused = await service.request(parsed.mode);
  if (refused !== undefined) return { ok: false, text: `Not restarting: ${refused}.` };
  const busy = describeBusy(status.busy);
  if (parsed.mode === "idle" && !isIdle(status.busy)) {
    return {
      ok: true,
      text: `dsh will restart once no task runs (now: ${busy}). Cancel with /kivotos restart cancel. Log: ${service.logFile}`,
    };
  }
  return {
    ok: true,
    text: `dsh is restarting${busy === "nothing running" ? "" : ` (interrupting ${busy})`}${status.confirmOnScreen ? "; the desktop app's quit confirmation will be forced past after 15 s" : ""}. It comes back by itself; log: ${service.logFile}`,
  };
}

export function describeBusy(busy: Busy): string {
  const parts: string[] = [];
  if (busy.sessions.length > 0) parts.push(`${busy.sessions.length} running session(s)`);
  if (busy.jobs.length > 0) parts.push(`${busy.jobs.length} running job(s)`);
  if (busy.reminders) parts.push("armed reminders");
  return parts.length === 0 ? "nothing running" : parts.join(", ");
}

function statusText(status: RestartStatus): string {
  const lines = [
    status.supported
      ? `Restart: available (${status.kind}).`
      : `Restart: unavailable: ${status.reason}.`,
    `Running: ${describeBusy(status.busy)}.`,
  ];
  if (status.pending !== null)
    lines.push(`Pending: ${status.pending.mode}, ${status.pending.phase}.`);
  if (status.last !== null) {
    lines.push(
      `Last: ${status.last.phase} ${new Date(status.last.backAt ?? status.last.requestedAt).toISOString()}${status.last.error === undefined ? "" : ` (${status.last.error})`}.`,
    );
  }
  return lines.join("\n");
}

/** `GET` (status) and `POST {mode}` / `POST {action: "cancel"}` on {@link RESTART_PATH}. */
export async function serveRestart(
  service: RestartService,
  req: IncomingMessage,
  res: ServerResponse,
  readBody: () => Promise<unknown>,
): Promise<void> {
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" || req.method === "HEAD") {
    send(200, await service.status());
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "GET, POST" });
    res.end();
    return;
  }
  const body = await readBody();
  const field = (key: string): unknown =>
    typeof body === "object" && body !== null ? Reflect.get(body, key) : undefined;
  if (field("action") === "cancel") {
    service.cancel();
    send(200, await service.status());
    return;
  }
  const mode = field("mode");
  if (!isRestartMode(mode)) {
    send(400, { error: "expected {mode: now | idle} or {action: cancel}" });
    return;
  }
  const refused = await service.request(mode);
  if (refused !== undefined) {
    send(409, { error: refused, status: await service.status() });
    return;
  }
  send(202, await service.status());
}
