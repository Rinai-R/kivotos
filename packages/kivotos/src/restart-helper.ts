/**
 * The restart helper: a detached process that outlives dsh, quits it, starts
 * it again and watches that Kivotos comes back. Spawned by `restart.ts` with
 * the path of its job file; its stdout and stderr are the restart log.
 *
 * Built into `dist/restart-helper.js`. It imports nothing from dsh and runs
 * on whatever Node the Host ran on (the desktop app's Electron in Node mode).
 */
import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { readJson, writeJson } from "./restart.ts";
import {
  runHelper,
  type HelperDeps,
  type HelperJob,
  type LaunchSpec,
  type RestartRecord,
} from "./restart-core.ts";

function log(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const get = url.startsWith("https:") ? https.get : http.get;
    const req = get(url, { timeout: 5_000, rejectUnauthorized: false }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

/** The environment a launched dsh gets when the job names none. */
function plainEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") out[key] = value;
  }
  return out;
}

function launcher(dir: string, id: string): HelperDeps["launch"] {
  return (spec: LaunchSpec) =>
    new Promise<number | undefined>((resolveOnce, rejectOnce) => {
      let settled = false;
      const resolve = (pid: number | undefined): void => {
        if (!settled) resolveOnce(pid);
        settled = true;
      };
      const reject = (error: unknown): void => {
        if (!settled) rejectOnce(error);
        settled = true;
      };
      const env = spec.env ?? plainEnv();
      if (spec.kind === "desktop" && spec.command === "/usr/bin/open") {
        // LaunchServices starts the app as a click would; `open` itself exits at once.
        const child = spawn(spec.command, spec.args, {
          env,
          stdio: ["ignore", "inherit", "inherit"],
        });
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0 ? resolve(undefined) : reject(new Error(`open exited with ${String(code)}`)),
        );
        return;
      }
      const out = path.join(dir, `dsh-${id}.out`);
      log(`launching; its output goes to ${out}`);
      const fd = openSync(out, "a", 0o600);
      try {
        const child = spawn(spec.command, spec.args, {
          cwd: spec.cwd,
          env,
          detached: true,
          stdio: ["ignore", fd, fd],
        });
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve(child.pid);
        });
      } finally {
        closeSync(fd);
      }
    });
}

/** @returns pids running the spec's executable as a new main process. */
function instances(exclude: Set<number>): HelperDeps["instances"] {
  return (spec) => {
    let text = "";
    try {
      text = execFileSync("/bin/ps", ["-axo", "pid=,command="], {
        encoding: "utf8",
        timeout: 5_000,
      });
    } catch {
      return [];
    }
    const out: number[] = [];
    for (const line of text.split("\n")) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (match === null) continue;
      const pid = Number(match[1]);
      const command = match[2]!;
      if (exclude.has(pid) || command.includes("--type=")) continue;
      if (command.includes("restart-helper") || command.includes("dsh-desktop-host")) continue;
      const isInstance =
        spec.kind === "desktop"
          ? command === spec.executable || command.startsWith(`${spec.executable} `)
          : command.includes(spec.executable);
      if (isInstance) out.push(pid);
    }
    return out;
  };
}

async function main(): Promise<void> {
  const jobFile = process.argv[2];
  if (jobFile === undefined) throw new Error("usage: restart-helper <job.json>");
  const job = JSON.parse(readFileSync(jobFile, "utf8")) as HelperJob;
  const dir = path.dirname(jobFile);
  const stateFile = path.join(dir, "state.json");
  const read = (): RestartRecord | undefined => readJson<RestartRecord>(stateFile);
  const update = (patch: Partial<RestartRecord>): void => {
    const now = read();
    // The new Kivotos owns the record once it is back.
    if (now === undefined || now.id !== job.id || now.phase === "back") return;
    writeJson(stateFile, { ...now, ...patch });
  };
  update({ helperPid: process.pid });
  const deps: HelperDeps = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    alive,
    signal: (pid, signal) => {
      try {
        process.kill(pid, signal);
      } catch (error) {
        log(`${signal} to pid ${pid}: ${(error as Error).message}`);
      }
    },
    launch: launcher(dir, job.id),
    instances: instances(new Set([process.pid, job.quitPid, job.hostPid])),
    read,
    update,
    probe,
    log,
  };
  const outcome = await runHelper(job, deps);
  log(`helper done: ${outcome}`);
}

main().catch((error: unknown) => {
  log(`helper failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exitCode = 1;
});
