/**
 * dsh 0.2.2-rc.1's process layout and quit path, as a safe restart meets them.
 *
 * Desktop app (`apps/desktop`, `lib/main.js`): the Electron main process
 * spawns the Host as a child (`dsh-desktop-host/lib/index.js`, run with
 * `ELECTRON_RUN_AS_NODE=1` and an IPC channel); plugins, Kivotos included,
 * run in that child. A plugin cannot reach `app.relaunch()`, so the restart
 * asks the main process to quit with SIGTERM, which Electron turns into
 * `app.quit()`: the same `before-quit` path as the Quit menu. That path asks
 * the Host what quitting would interrupt (`quit-inspection`: active tasks, or
 * armed scheduled reminders of the loaded sessions) and shows a native
 * confirmation when there is any; otherwise it closes the Host gracefully
 * (`backend.close()`, the Host's `shutdown`) and exits. The Host also shuts
 * itself down gracefully when its IPC channel to the main process
 * disconnects, so even a main process that has to be killed leaves the
 * session logs closed properly. The app is relaunched through LaunchServices
 * (`open <bundle>`), as a click on its icon would.
 *
 * `dsh web` and other CLI profiles (`@deepseek-ai/dsh` `profile-boot`
 * `runProfile`): one process; SIGTERM interrupts it with code 0 and disposes
 * the root fiber. It is relaunched with the same command line.
 *
 * Quit inspection mirrors the desktop Host's own `installDesktopQuitInspection`:
 * `agents.list()` with `status === "running"` or queued inbox input, the
 * `jobs` registry's running or stopping jobs, and `workspace/session-activity`
 * entries of kind `schedule`.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Busy, LaunchSpec } from "../restart-core.ts";

/** How this Host process can be restarted, or why it cannot. */
export type RestartTarget =
  | {
      ok: true;
      kind: "desktop" | "process";
      /** The process asked to quit. */
      quitPid: number;
      /** The process running the Host (this one). */
      hostPid: number;
      launch: LaunchSpec;
    }
  | { ok: false; reason: string };

/** The environment a relaunched process must not inherit from this one. */
const CHILD_ONLY_ENV = new Set(["NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE"]);

/** @returns the environment with this process's IPC channel removed. */
export function launchEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !CHILD_ONLY_ENV.has(key)) out[key] = value;
  }
  return out;
}

/** What the target is read from; injectable for the tests. */
export interface ProcessFacts {
  platform: NodeJS.Platform;
  pid: number;
  ppid: number;
  execPath: string;
  execArgv: string[];
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Whether this process has an IPC channel to its parent. */
  ipc: boolean;
  /** @returns a process's full command line, or undefined when it is gone. */
  commandOf(pid: number): string | undefined;
}

export function processFacts(): ProcessFacts {
  return {
    platform: process.platform,
    pid: process.pid,
    ppid: process.ppid,
    execPath: process.execPath,
    execArgv: [...process.execArgv],
    argv: [...process.argv],
    cwd: process.cwd(),
    env: process.env,
    ipc: typeof process.send === "function",
    commandOf: (pid) => {
      try {
        return execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], {
          encoding: "utf8",
          timeout: 2_000,
        }).trim();
      } catch {
        return undefined;
      }
    },
  };
}

/** The `.app` bundle an executable lives in, `<bundle>.app/Contents/MacOS/<name>`. */
const BUNDLE_EXECUTABLE = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/;

/**
 * Decide how this Host can be restarted.
 * @param override - a launch command line (JSON array) replacing the desktop
 *   relaunch, from `KIVOTOS_RESTART_LAUNCH`; used to restart a desktop copy
 *   started with its own arguments (tests), never needed for the installed app.
 */
export function restartTarget(facts: ProcessFacts, override?: string): RestartTarget {
  if (facts.platform === "win32") {
    return { ok: false, reason: "restarting dsh is not supported on Windows yet" };
  }
  const desktopHost =
    facts.env.ELECTRON_RUN_AS_NODE === "1" &&
    facts.ipc &&
    facts.argv.some((arg) => arg.includes("dsh-desktop-host"));
  if (desktopHost) {
    if (facts.platform !== "darwin") {
      return { ok: false, reason: "restarting the desktop app is supported on macOS only" };
    }
    const bundle = BUNDLE_EXECUTABLE.exec(facts.execPath)?.[1];
    if (bundle === undefined) {
      return { ok: false, reason: `the desktop app's bundle is unknown (${facts.execPath})` };
    }
    const parent = facts.commandOf(facts.ppid);
    if (parent === undefined || !parent.startsWith(facts.execPath)) {
      return {
        ok: false,
        reason: `the desktop app's main process (pid ${facts.ppid}) is not ${facts.execPath}`,
      };
    }
    let launch: LaunchSpec = {
      kind: "desktop",
      command: "/usr/bin/open",
      args: [bundle],
      executable: facts.execPath,
    };
    if (override !== undefined && override !== "") {
      const argv = parseArgv(override);
      if (argv === undefined)
        return { ok: false, reason: "KIVOTOS_RESTART_LAUNCH is not a JSON array of strings" };
      const [command, ...args] = argv;
      launch = {
        kind: "desktop",
        command: command!,
        args,
        executable: facts.execPath,
        env: launchEnvForApp(facts.env),
      };
    } else if (parent !== facts.execPath) {
      // Started with its own arguments: `open` would not pass them on.
      return {
        ok: false,
        reason: "the desktop app was started with extra arguments, which a relaunch would lose",
      };
    }
    return { ok: true, kind: "desktop", quitPid: facts.ppid, hostPid: facts.pid, launch };
  }
  if (facts.env.INVOCATION_ID !== undefined) {
    return {
      ok: false,
      reason:
        "dsh runs under systemd; restart it with systemctl so the service manager stays in charge",
    };
  }
  const script = facts.argv[1];
  if (script === undefined) return { ok: false, reason: "this dsh's command line is unknown" };
  return {
    ok: true,
    kind: "process",
    quitPid: facts.pid,
    hostPid: facts.pid,
    launch: {
      kind: "process",
      command: facts.execPath,
      args: [...facts.execArgv, ...facts.argv.slice(1)],
      cwd: facts.cwd,
      env: launchEnv(facts.env),
      executable: script,
    },
  };
}

/** The desktop app's own environment, as the Host inherited it without the Node-mode switches. */
function launchEnvForApp(env: NodeJS.ProcessEnv): Record<string, string> {
  const out = launchEnv(env);
  delete out.ELECTRON_RUN_AS_NODE;
  delete out.DSH_CLIENT_VERSION;
  return out;
}

function parseArgv(text: string): string[] | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === "string")
    ) {
      return value as string[];
    }
  } catch {
    // fall through
  }
  return undefined;
}

/** The services read for the quit inspection, typed to what is read. */
interface AgentLike {
  readonly id: string;
  readonly status: string;
  readonly session?: unknown;
  readonly inbox?: {
    readonly nextTurn?: readonly unknown[];
    readonly nextStep?: readonly unknown[];
  };
}
interface JobLike {
  readonly id: string;
  readonly label?: string;
  readonly owner?: string;
  readonly status: string;
}
export interface QuitServices {
  agents?: { list(): readonly AgentLike[] };
  jobs?: { list(caller?: string): readonly JobLike[] };
  /** `ctx.waterfall` for `workspace/session-activity`. */
  activity?: (sessionId: string) => Promise<readonly { kind?: string }[]>;
  title?: (agent: AgentLike) => string | undefined;
}

/**
 * What quitting now would interrupt, the way the desktop Host's quit
 * inspection counts it.
 * @returns undefined when the task services are missing (inspection impossible).
 */
export async function inspectQuit(services: QuitServices): Promise<Busy | undefined> {
  const { agents, jobs } = services;
  if (agents === undefined || jobs === undefined) return undefined;
  const live = agents.list();
  const sessions = live
    .filter(
      (agent) =>
        agent.status === "running" ||
        (agent.inbox?.nextTurn?.length ?? 0) > 0 ||
        (agent.inbox?.nextStep?.length ?? 0) > 0,
    )
    .map((agent) => {
      const title = services.title?.(agent);
      return title === undefined ? { id: agent.id } : { id: agent.id, title };
    });
  const seen = new Set<string>();
  const running: Busy["jobs"] = [];
  for (const owner of [undefined, ...live.map((agent) => agent.id)]) {
    for (const job of jobs.list(owner)) {
      if ((job.status !== "running" && job.status !== "stopping") || seen.has(job.id)) continue;
      seen.add(job.id);
      running.push({
        id: job.id,
        label: job.label ?? job.id,
        ...(job.owner === undefined ? {} : { session: job.owner }),
      });
    }
  }
  let reminders = false;
  if (services.activity !== undefined) {
    for (const agent of live) {
      try {
        if ((await services.activity(agent.id)).some((entry) => entry.kind === "schedule")) {
          reminders = true;
          break;
        }
      } catch {
        // An activity provider failing says nothing about reminders.
      }
    }
  }
  return { sessions, jobs: running, reminders };
}

/** @returns the directory of a profile's plugin packages, from Kivotos' own location. */
export function profileDirOf(moduleFile: string): string | undefined {
  const marker = `${path.sep}node_modules${path.sep}`;
  // The first one: a pnpm store path nests more under it.
  const at = moduleFile.indexOf(marker);
  return at < 0 ? undefined : moduleFile.slice(0, at);
}
