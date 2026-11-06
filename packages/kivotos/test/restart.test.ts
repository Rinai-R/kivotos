import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  inspectQuit,
  launchEnv,
  profileDirOf,
  restartTarget,
  type ProcessFacts,
} from "../src/dsh/restart.ts";
import {
  runHelper,
  versionChanges,
  type HelperDeps,
  type HelperJob,
  type RestartRecord,
} from "../src/restart-core.ts";
import { parseRestartCommand, readVersions, RestartService } from "../src/restart.ts";

const APP = "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness";

function facts(over: Partial<ProcessFacts> = {}): ProcessFacts {
  return {
    platform: "darwin",
    pid: 200,
    ppid: 100,
    execPath: APP,
    execArgv: ["--expose-internals"],
    argv: [
      APP,
      "/x/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js",
      "/x/dsh",
    ],
    cwd: "/",
    env: { ELECTRON_RUN_AS_NODE: "1", NODE_CHANNEL_FD: "3", HOME: "/Users/u" },
    ipc: true,
    commandOf: (pid) => (pid === 100 ? APP : undefined),
    ...over,
  };
}

test("the desktop Host restarts through its main process and LaunchServices", () => {
  const target = restartTarget(facts());
  assert.ok(target.ok);
  assert.equal(target.kind, "desktop");
  assert.equal(target.quitPid, 100);
  assert.equal(target.hostPid, 200);
  assert.deepEqual(target.launch.args, ["/Applications/DeepSeek Harness.app"]);
  assert.equal(target.launch.command, "/usr/bin/open");
});

test("a restart is refused when a relaunch cannot be guaranteed", () => {
  const cases: [Partial<ProcessFacts>, RegExp][] = [
    [{ platform: "win32" }, /Windows/],
    [{ execPath: "/opt/dsh/electron" }, /bundle is unknown/],
    [{ commandOf: () => undefined }, /main process/],
    [{ commandOf: () => `${APP} --user-data-dir=/tmp/x` }, /extra arguments/],
    [{ platform: "linux", execPath: "/opt/DSH.app/Contents/MacOS/DSH" }, /macOS only/],
  ];
  for (const [over, reason] of cases) {
    const target = restartTarget(facts(over));
    assert.equal(target.ok, false);
    if (!target.ok) assert.match(target.reason, reason);
  }
  const systemd = restartTarget(
    facts({
      env: { INVOCATION_ID: "x" },
      ipc: false,
      argv: ["/usr/bin/node", "/x/dsh/lib/bin.js", "web"],
    }),
  );
  assert.equal(systemd.ok, false);
});

test("a test copy started with arguments can name its own relaunch", () => {
  const target = restartTarget(
    facts({ commandOf: () => `${APP} --user-data-dir=/tmp/x` }),
    JSON.stringify([APP, "--user-data-dir=/tmp/x"]),
  );
  assert.ok(target.ok);
  assert.equal(target.launch.command, APP);
  assert.equal(target.launch.env?.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(target.launch.env?.NODE_CHANNEL_FD, undefined);
  assert.equal(restartTarget(facts(), "not json").ok, false);
});

test("a CLI profile restarts as the same command line, without the IPC channel", () => {
  const target = restartTarget(
    facts({
      env: { DSH_HOME: "/tmp/h", NODE_CHANNEL_FD: "3" },
      ipc: false,
      execPath: "/usr/bin/node",
      execArgv: [],
      argv: ["/usr/bin/node", "/x/dsh/lib/bin.js", "web", "--port", "7420"],
      cwd: "/work",
    }),
  );
  assert.ok(target.ok);
  assert.equal(target.kind, "process");
  assert.equal(target.quitPid, 200);
  assert.deepEqual(target.launch.args, ["/x/dsh/lib/bin.js", "web", "--port", "7420"]);
  assert.equal(target.launch.cwd, "/work");
  assert.deepEqual(target.launch.env, { DSH_HOME: "/tmp/h" });
  assert.deepEqual(launchEnv({ A: "1", NODE_CHANNEL_SERIALIZATION_MODE: "json" }), { A: "1" });
});

test("the quit inspection counts what the desktop Host's own inspection counts", async () => {
  const busy = await inspectQuit({
    agents: {
      list: () => [
        { id: "a", status: "running" },
        { id: "b", status: "idle", inbox: { nextTurn: [1], nextStep: [] } },
        { id: "c", status: "idle", inbox: { nextTurn: [], nextStep: [] } },
      ],
    },
    jobs: {
      list: (owner) => {
        if (owner === undefined) return [{ id: "j1", label: "build", status: "running" }];
        if (owner !== "c") return [];
        return [
          { id: "j1", label: "build", status: "running" },
          { id: "j2", label: "done", status: "completed" },
          { id: "j3", label: "stop", status: "stopping", owner: "c" },
        ];
      },
    },
    activity: async (id) => (id === "c" ? [{ kind: "schedule" }] : []),
    title: (agent) => (agent.id === "a" ? "Fix it" : undefined),
  });
  assert.deepEqual(busy, {
    sessions: [{ id: "a", title: "Fix it" }, { id: "b" }],
    jobs: [
      { id: "j1", label: "build" },
      { id: "j3", label: "stop", session: "c" },
    ],
    reminders: true,
  });
  assert.equal(await inspectQuit({}), undefined);
});

test("version changes name dsh, then plugins by name", () => {
  assert.deepEqual(
    versionChanges(
      { dsh: "0.2.1", plugins: { kivotos: "0.3.0", a: "1", gone: "2" } },
      { dsh: "0.2.2", plugins: { kivotos: "0.4.0", a: "1", added: "3" } },
    ),
    [
      { name: "dsh", from: "0.2.1", to: "0.2.2" },
      { name: "added", to: "3" },
      { name: "gone", from: "2" },
      { name: "kivotos", from: "0.3.0", to: "0.4.0" },
    ],
  );
});

test("the profile is found above a plain and a pnpm store layout", () => {
  assert.equal(
    profileDirOf("/h/profiles/desktop/node_modules/kivotos/dist/index.js"),
    "/h/profiles/desktop",
  );
  assert.equal(
    profileDirOf("/h/profiles/web/node_modules/.pnpm/kivotos@1/node_modules/kivotos/dist/index.js"),
    "/h/profiles/web",
  );
  assert.equal(profileDirOf("/src/kivotos/dist/index.js"), undefined);
});

test("the /kivotos command reads restart [now|idle|status|cancel]", () => {
  assert.deepEqual(parseRestartCommand("restart"), { action: "restart", mode: "idle" });
  assert.deepEqual(parseRestartCommand(" restart  now "), { action: "restart", mode: "now" });
  assert.deepEqual(parseRestartCommand("restart status"), { action: "status" });
  assert.deepEqual(parseRestartCommand("restart cancel"), { action: "cancel" });
  assert.deepEqual(parseRestartCommand("restart later"), { action: "help" });
  assert.deepEqual(parseRestartCommand(""), { action: "help" });
});

/** A simulated world for the watchdog: processes, a clock, a state file. */
function world(
  job: HelperJob,
  opts: { quitExits?: boolean; backOn?: number; hostLingers?: boolean },
) {
  let clock = 0;
  const live = new Set([job.quitPid, job.hostPid]);
  const signals: string[] = [];
  const lines: string[] = [];
  let launches = 0;
  let record: RestartRecord = {
    id: job.id,
    mode: "now",
    phase: "armed",
    requestedAt: 0,
    fromPid: job.hostPid,
    from: { plugins: {} },
    log: "/log",
  };
  const deps: HelperDeps = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    alive: (pid) => live.has(pid),
    signal: (pid, signal) => {
      signals.push(`${signal} ${pid}`);
      if (pid === job.quitPid && (signal === "SIGKILL" || opts.quitExits !== false)) {
        live.delete(pid);
        // The Host shuts itself down when its parent goes.
        if (!opts.hostLingers) live.delete(job.hostPid);
      } else if (signal === "SIGKILL" || (signal === "SIGTERM" && pid !== job.quitPid)) {
        live.delete(pid);
      }
    },
    launch: async () => {
      launches++;
      const pid = 1000 + launches;
      live.add(pid);
      if (opts.backOn !== undefined && launches >= opts.backOn) {
        record = { ...record, phase: "back", toPid: pid };
      }
      return pid;
    },
    instances: () => [...live].filter((pid) => pid > 1000),
    read: () => record,
    update: (patch) => {
      if (record.phase !== "back") record = { ...record, ...patch };
    },
    probe: async () => true,
    log: (line) => lines.push(line),
  };
  return { deps, signals, lines, launches: () => launches, record: () => record };
}

const JOB: HelperJob = {
  id: "r1",
  quitPid: 100,
  hostPid: 200,
  launch: { kind: "desktop", command: "/usr/bin/open", args: ["/A.app"], executable: APP },
  startDelayMs: 1_000,
  quitTimeoutMs: 15_000,
  hostExitTimeoutMs: 60_000,
  readyTimeoutMs: 60_000,
  attempts: 3,
};

test("the watchdog quits gracefully, launches once, and is done when Kivotos reports back", async () => {
  const w = world(JOB, { backOn: 1 });
  assert.equal(await runHelper(JOB, w.deps), "back");
  assert.deepEqual(w.signals, ["SIGTERM 100"]);
  assert.equal(w.launches(), 1);
  assert.equal(w.record().forced, undefined);
});

test("a quit that hangs (a confirmation on screen) is forced only after the timeout, and logged", async () => {
  const w = world(JOB, { quitExits: false, backOn: 1 });
  assert.equal(await runHelper(JOB, w.deps), "back");
  assert.deepEqual(w.signals, ["SIGTERM 100", "SIGKILL 100"]);
  assert.ok(w.lines.some((line) => /graceful quit timed out after 15 s/.test(line)));
  assert.deepEqual(w.record().forced, ["quit pid 100 after 15 s"]);
});

test("a Host that outlives its app is stopped before the launch", async () => {
  const w = world(JOB, { hostLingers: true, backOn: 1 });
  assert.equal(await runHelper(JOB, w.deps), "back");
  assert.deepEqual(w.signals, ["SIGTERM 100", "SIGTERM 200"]);
});

test("a launch that never reports back is cleared and retried", async () => {
  const w = world(JOB, { backOn: 3 });
  assert.equal(await runHelper(JOB, w.deps), "back");
  assert.equal(w.launches(), 3);
  assert.ok(w.signals.includes("SIGTERM 1001") && w.signals.includes("SIGTERM 1002"));
});

test("every attempt failing ends as failed in the state file", async () => {
  const w = world(JOB, {});
  assert.equal(await runHelper(JOB, w.deps), "failed");
  assert.equal(w.launches(), 3);
  assert.equal(w.record().phase, "failed");
  assert.match(w.record().error ?? "", /3 attempts/);
});

test("the probe of the tailnet listener must answer too", async () => {
  const job = { ...JOB, probe: "https://100.64.0.1:7380/kivotos/hello", attempts: 1 };
  const w = world(job, { backOn: 1 });
  w.deps.probe = async () => false;
  assert.equal(await runHelper(job, w.deps), "failed");
});

function home(): string {
  return mkdtempSync(path.join(tmpdir(), "kivotos-restart-test-"));
}

test("the service refuses when the helper does not come up, and leaves dsh running", async () => {
  const dir = home();
  try {
    writeFileSync(path.join(dir, "helper.js"), "");
    let killed = false;
    const service = new RestartService({
      home: dir,
      helper: path.join(dir, "helper.js"),
      moduleFile: "/x/index.js",
      services: () => ({ agents: { list: () => [] }, jobs: { list: () => [] } }),
      listenerUrl: () => undefined,
      warn: () => undefined,
      facts: facts(),
      spawnHelper: () => ({ pid: 1, kill: () => (killed = true) }),
      helperAckMs: 300,
    });
    const refused = await service.request("now");
    assert.match(refused ?? "", /did not start/);
    assert.ok(killed);
    assert.equal(service.record()?.phase, "failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the service hands off once the helper acknowledges, and the next Host marks it back", async () => {
  const dir = home();
  try {
    writeFileSync(path.join(dir, "helper.js"), "");
    const profile = path.join(dir, "profile");
    mkdirSync(path.join(profile, "node_modules", "kivotos"), { recursive: true });
    writeFileSync(
      path.join(profile, "package.json"),
      JSON.stringify({ dependencies: { kivotos: "x" } }),
    );
    const pkg = path.join(profile, "node_modules", "kivotos", "package.json");
    writeFileSync(pkg, JSON.stringify({ version: "0.3.1" }));
    const options = {
      home: dir,
      helper: path.join(dir, "helper.js"),
      moduleFile: "/x/index.js",
      profileDir: profile,
      services: () => ({ agents: { list: () => [] }, jobs: { list: () => [] } }),
      listenerUrl: () => "https://100.64.0.1:7380/",
      warn: () => undefined,
      facts: facts(),
    };
    const service = new RestartService({
      ...options,
      spawnHelper: (_helper, job) => {
        const state = path.join(path.dirname(job), "state.json");
        const record = JSON.parse(readFileSync(state, "utf8")) as RestartRecord;
        writeFileSync(state, JSON.stringify({ ...record, helperPid: 4242 }));
        return { pid: 4242, kill: () => undefined };
      },
    });
    assert.equal(await service.request("now"), undefined);
    const job = JSON.parse(
      readFileSync(path.join(dir, "kivotos", "restart", "job.json"), "utf8"),
    ) as HelperJob;
    assert.equal(job.quitPid, 100);
    assert.equal(job.probe, "https://100.64.0.1:7380/kivotos/hello");
    assert.equal(job.quitTimeoutMs, 90_000);
    assert.equal((await service.status()).pending?.phase, "armed");
    assert.match((await service.request("now")) ?? "", /already under way/);

    // The same pid cannot mark its own restart back.
    assert.equal(service.markBack(), undefined);
    writeFileSync(pkg, JSON.stringify({ version: "0.4.0" }));
    const next = new RestartService({ ...options, facts: facts({ pid: 300 }) });
    // A RestartService reads its own process pid; fake a new process by editing the record.
    const record = service.record()!;
    writeFileSync(
      service.stateFile,
      JSON.stringify({ ...record, fromPid: -1, phase: "launching" }),
    );
    const back = next.markBack();
    assert.equal(back?.phase, "back");
    assert.deepEqual(back?.changes, [{ name: "kivotos", from: "0.3.1", to: "0.4.0" }]);
    assert.deepEqual(readVersions(profile, "0.2.2-rc.1"), {
      dsh: "0.2.2-rc.1",
      plugins: { kivotos: "0.4.0" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restart when idle waits for running work, then hands off", async () => {
  const dir = home();
  try {
    writeFileSync(path.join(dir, "helper.js"), "");
    let running = true;
    let spawned = 0;
    const service = new RestartService({
      home: dir,
      helper: path.join(dir, "helper.js"),
      moduleFile: "/x/index.js",
      services: () => ({
        agents: { list: () => [{ id: "a", status: running ? "running" : "idle" }] },
        jobs: { list: () => [] },
      }),
      listenerUrl: () => undefined,
      warn: () => undefined,
      facts: facts(),
      idlePollMs: 20,
      spawnHelper: (_helper, job) => {
        spawned++;
        const state = path.join(path.dirname(job), "state.json");
        const record = JSON.parse(readFileSync(state, "utf8")) as RestartRecord;
        writeFileSync(state, JSON.stringify({ ...record, helperPid: 1 }));
        return { kill: () => undefined };
      },
    });
    assert.equal(await service.request("idle"), undefined);
    assert.equal((await service.status()).pending?.phase, "waiting");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(spawned, 0);
    running = false;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(spawned, 1);
    assert.equal(service.record()?.mode, "idle");
    // A wait can be cancelled.
    assert.equal(service.cancel(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
