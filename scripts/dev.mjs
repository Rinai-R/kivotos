// Bring up a local Kivotos lab in one command: a relay built from
// packages/relay and two dsh instances with their own DSH_HOME directories,
// already members of the same relay network. `npm run dev`.
//
// Nothing here touches ~/.dsh or an installed dsh; every file it writes lives
// under --lab-dir, which it removes again when stopped unless --keep is given.
// A start that fails keeps the directory, so the log its error names is there.
import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inviteOf, networkOf, registrationOf } from "../packages/kivotos/src/federation.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = `Usage: npm run dev -- [options]

Start a relay and two dsh instances, joined to one relay network.

  --lab-dir DIR       where the lab lives (default: .lab in the repository)
  --relay-port N      relay port (default 7411)
  --web-a-port N      machine A's dsh web port (default 7412)
  --web-b-port N      machine B's dsh web port (default 7413)
  --dsh PATH          the dsh to run (default: $DSH_BIN, else dsh on PATH)
  --keep              keep the lab directory when stopped
  -h, --help          show this help`;
/** Marks a directory this script made, so it never deletes one it did not. */
const MARKER = ".kivotos-lab";
/** How long a stopped process gets before it is killed. */
const STOP_GRACE_MS = 10_000;

class Failure extends Error {
  /** @param {string} message @param {number} [code] */
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

function options() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        "lab-dir": { type: "string", default: path.join(repo, ".lab") },
        "relay-port": { type: "string", default: "7411" },
        "web-a-port": { type: "string", default: "7412" },
        "web-b-port": { type: "string", default: "7413" },
        dsh: { type: "string", default: process.env.DSH_BIN ?? "dsh" },
        keep: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    }).values;
  } catch (error) {
    throw new Failure(`${error.message}\n\n${USAGE}`, 2);
  }
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  for (const name of ["relay-port", "web-a-port", "web-b-port"]) {
    const port = Number(parsed[name]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Failure(`--${name} must be a port number, not ${parsed[name]}`, 2);
    }
  }
  return parsed;
}

/** @returns the executable `name` resolves to on PATH, or undefined. */
function onPath(name) {
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const extension of extensions) {
      const file = path.join(dir, name + extension);
      try {
        accessSync(file, constants.X_OK);
        if (statSync(file).isFile()) return file;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}

/** @returns the dsh to run: a path to an executable, or a command on PATH. */
function resolveDsh(given) {
  if (given.includes("/") || given.includes("\\")) {
    try {
      accessSync(given, constants.X_OK);
      return path.resolve(given);
    } catch {
      return undefined;
    }
  }
  return onPath(given);
}

function requirePrerequisites(dshGiven) {
  for (const [tool, why] of [
    ["go", "Go, to build packages/relay"],
    ["pnpm", "pnpm, which dsh plugin add runs"],
  ]) {
    if (onPath(tool) === undefined) throw new Failure(`${tool} is required (${why})`);
  }
  const dsh = resolveDsh(dshGiven);
  if (dsh === undefined) {
    throw new Failure("dsh not found; install it or pass --dsh <path> (or DSH_BIN)");
  }
  return dsh;
}

/**
 * The lab deletes its directory on start and when stopped, so it only takes
 * one that is new, empty, or marked as its own.
 * @returns the directory's real path.
 */
function claimLabDir(given) {
  const dir = path.resolve(given);
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) throw new Failure(`${dir} exists and is not a directory`, 2);
    if (!existsSync(path.join(dir, MARKER)) && readdirSync(dir).length > 0) {
      throw new Failure(
        `refusing to use ${dir}: it is not empty and was not made by this script`,
        2,
      );
    }
  }
  mkdirSync(dir, { recursive: true });
  const real = realpathSync(dir);
  const forbidden = ["/", homedir(), repo].map((each) =>
    existsSync(each) ? realpathSync(each) : each,
  );
  if (forbidden.includes(real) || path.parse(real).root === real) {
    throw new Failure(`refusing to use ${real} as the lab directory`, 2);
  }
  return real;
}

/** Runs a command to completion; a failure is an error naming it. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
    ...options,
  });
  if (result.error !== undefined)
    throw new Failure(`${path.basename(command)}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Failure(`${path.basename(command)} ${args.join(" ")} exited with ${result.status}`);
  }
  return result;
}

/** @returns the last non-empty line of a log, for an error message. */
function lastLine(file) {
  try {
    return readFileSync(file, "utf8").trim().split("\n").at(-1) ?? "";
  } catch {
    return "";
  }
}

const children = [];

/** Starts a long-running process with its output in a log file. */
function start(command, args, log, env = process.env) {
  const out = openSync(log, "w");
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", out, out],
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
  });
  // A process that could not be started fires "error" and never "exit".
  child.exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ code: null, signal: null, error }));
  });
  child.exited.then(() => {
    child.done = true;
  });
  children.push(child);
  return child;
}

function alive(child) {
  return child.done !== true;
}

/** Waits for `ready()` while `child` runs; false when it exited or time ran out. */
async function waitFor(child, ready, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ready()) return true;
    if (!alive(child)) return false;
    await sleep(100);
  }
  return ready();
}

/** Stops every started process: SIGTERM, then SIGKILL after a grace period. */
async function stopAll() {
  await Promise.all(
    children.filter(alive).map(async (child) => {
      child.kill("SIGTERM");
      const killed = await Promise.race([
        child.exited.then(() => true),
        sleep(STOP_GRACE_MS, false),
      ]);
      if (!killed && alive(child)) {
        child.kill("SIGKILL");
        await child.exited;
      }
    }),
  );
}

let labDir;
let keep = false;
let stopping = false;

/** Stops the lab and exits; a failed start keeps its directory. */
async function shutdown(code, message) {
  if (stopping) return;
  stopping = true;
  if (message !== undefined) console.error(`dev: ${message}`);
  await stopAll();
  if (labDir !== undefined) {
    const failed = code !== 0 && code !== 130 && code !== 143;
    if (keep || failed) console.error(`dev: files kept in ${labDir}`);
    else rmSync(labDir, { recursive: true, force: true });
  }
  process.exit(code);
}

process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));

async function main() {
  const opts = options();
  keep = opts.keep;
  const dsh = requirePrerequisites(opts.dsh);
  const dir = claimLabDir(opts["lab-dir"]);

  if (!existsSync(path.join(repo, "packages", "kivotos", "dist", "index.js"))) {
    if (!existsSync(path.join(repo, "node_modules"))) {
      throw new Failure(`run 'npm install' in ${repo} first`);
    }
    console.log("dev: building the plugin (packages/kivotos/dist is missing)");
    run("npm", ["run", "build", "-w", "packages/kivotos"], {
      cwd: repo,
      shell: process.platform === "win32",
    });
  }

  rmSync(dir, { recursive: true, force: true });
  labDir = dir;
  for (const sub of ["relay/data", "home-a/kivotos", "home-b/kivotos"]) {
    mkdirSync(path.join(dir, sub), { recursive: true });
  }
  writeFileSync(path.join(dir, MARKER), "");

  console.log("dev: building the relay");
  const relay = path.join(
    dir,
    "relay",
    process.platform === "win32" ? "kivotos-relay.exe" : "kivotos-relay",
  );
  run("go", ["build", "-o", relay, "."], { cwd: path.join(repo, "packages", "relay") });

  // Relay-only: the instances never bind a tailnet port, and nothing outside
  // this lab is mounted.
  const patch = path.join(dir, "lab.patch.yml");
  writeFileSync(patch, "- id: kivotos\n  config:\n    listen: false\n    discover: false\n");

  // The plugin's own federation module, so the invite is exactly what the
  // settings page would show.
  const relayAddr = `127.0.0.1:${opts["relay-port"]}`;
  const network = networkOf(relayAddr);
  const membership = JSON.stringify({ relay: network.relay, secret: network.secret }, null, 2);
  for (const home of ["home-a", "home-b"]) {
    writeFileSync(path.join(dir, home, "kivotos", "relay.json"), membership);
  }
  const invite = inviteOf(network);
  writeFileSync(path.join(dir, "invite.txt"), invite);

  console.log(`dev: starting the relay on ${relayAddr}`);
  const data = path.join(dir, "relay", "data");
  const relayLog = path.join(dir, "relay.log");
  const relayProcess = start(relay, ["serve", "--listen", relayAddr, "--data-dir", data], relayLog);
  const socket = path.join(data, "admin.sock");
  if (!(await waitFor(relayProcess, () => existsSync(socket), 10_000))) {
    throw new Failure(`the relay did not start (${lastLine(relayLog)}); see ${relayLog}`);
  }
  run(relay, ["network", "add", registrationOf(network), "--data-dir", data]);

  for (const home of ["home-a", "home-b"]) {
    console.log(`dev: installing the plugin into ${home}`);
    run(dsh, ["plugin", "--profile", "web", "add", path.join(repo, "packages", "kivotos")], {
      env: { ...process.env, DSH_HOME: path.join(dir, home) },
    });
  }

  console.log("dev: starting the two dsh instances");
  const urls = [];
  for (const [home, port, name] of [
    ["home-a", opts["web-a-port"], "dsh-a"],
    ["home-b", opts["web-b-port"], "dsh-b"],
  ]) {
    const log = path.join(dir, `${name}.log`);
    const child = start(
      dsh,
      ["web", "--patch", patch, "--port", port, "--host", "127.0.0.1", "--no-open"],
      log,
      { ...process.env, DSH_HOME: path.join(dir, home) },
    );
    let url;
    const printed = () => {
      url = /^dsh web: (http\S+)/m.exec(existsSync(log) ? readFileSync(log, "utf8") : "")?.[1];
      return url !== undefined;
    };
    if (!(await waitFor(child, printed, 60_000))) {
      throw new Failure(`${name} did not start (${lastLine(log)}); see ${log}`);
    }
    urls.push(url);
  }

  // Online means the relay sees both members' links.
  let online = 0;
  for (let i = 0; i < 60 && online < 2; i++) {
    const list = spawnSync(relay, ["network", "list", "--data-dir", data], { encoding: "utf8" });
    online = (list.stdout ?? "").split("\n").filter((line) => line.startsWith("  node ")).length;
    if (online < 2) await sleep(500);
  }

  console.log(`
Kivotos lab is up. Press Ctrl-C to stop it.

  machine A   ${urls[0]}
  machine B   ${urls[1]}
  relay       ${relayAddr}  (log: ${relayLog})
  members     ${online} of 2 online

  invite      ${invite}

Open machine A, then Machines in the sidebar: machine B is in the list.
The invite is what a phone (packages/mobile) or another machine pastes into
Settings -> Remote access -> Join network.`);
  if (online < 2) {
    console.error(
      `dev: warning: only ${online} member registered; see ${path.join(dir, "dsh-a.log")} and dsh-b.log`,
    );
  }

  // The lab runs until it is stopped; a process that dies takes it down.
  const ended = await Promise.race(
    children.map((child, i) => child.exited.then((exit) => ({ i, exit }))),
  );
  // Ctrl-C reaches the children too; let the signal handler, not their exit,
  // decide how the lab ends.
  await sleep(500);
  if (!stopping) {
    const names = ["relay", "dsh-a", "dsh-b"];
    await shutdown(
      1,
      `${names[ended.i]} exited (${ended.exit.error?.message ?? ended.exit.signal ?? ended.exit.code}); see its log in ${dir}`,
    );
  }
}

main().catch((error) => {
  void shutdown(
    error instanceof Failure ? error.code : 1,
    error instanceof Error ? error.message : String(error),
  );
});
