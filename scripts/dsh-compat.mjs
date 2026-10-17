// Check that Kivotos still fits the dsh release a dist-tag points at.
//
// Kivotos proxies dsh's own UI and reads a handful of its internals
// (packages/kivotos/src/compat.ts). This installs dsh from npm into a scratch
// directory, installs this checkout's plugin into a scratch DSH_HOME, boots
// the web profile, and checks:
//
// - the plugin's host half applied: its index rewrite is in the page and its
//   settings route answers;
// - every index probe passes on the index that dsh serves;
// - the markers the page probes and the phone stylesheet read are still in
//   dsh's client bundles.
//
// It never touches ~/.dsh or an installed dsh. Exit status 1 means a check
// failed. Usage: node scripts/dsh-compat.mjs [--tag latest] [--tag next]
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPAT_GLOBAL, PINNED_DSH } from "../packages/kivotos/src/dsh/compat.ts";
import {
  MARKERS as DESKTOP_MARKERS,
  guardDesktopBoot,
} from "../packages/kivotos/src/dsh/desktop.ts";
import { MARKERS as FRAME_MARKERS } from "../packages/kivotos/src/dsh/frame.ts";
import { MARKERS as OPEN_IN_APP_MARKERS } from "../packages/kivotos/src/dsh/open-in-app.ts";
import {
  MARKERS as INDEX_MARKERS,
  bootGraphOf,
  coverViewport,
  credentialedManifest,
} from "../packages/kivotos/src/dsh/index-html.ts";
import { MARKERS as SESSION_MARKERS } from "../packages/kivotos/src/dsh/sessions.ts";
import { MARKERS as WEB_MARKERS } from "../packages/kivotos/src/dsh/web-server.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOT_TIMEOUT_MS = 120_000;

/**
 * What the adapter (packages/kivotos/src/dsh/) relies on in dsh's client and
 * server bundles. Finding a marker says it still exists somewhere, not that it
 * sits where Kivotos expects it; the page probes judge that at run time.
 */
const MARKERS = [
  ...new Set([
    ...INDEX_MARKERS,
    ...DESKTOP_MARKERS,
    ...SESSION_MARKERS,
    ...FRAME_MARKERS,
    ...OPEN_IN_APP_MARKERS,
    ...WEB_MARKERS,
  ]),
];

const tags = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--tag") tags.push(process.argv[++i]);
  else {
    console.error(`unknown argument ${process.argv[i]}`);
    process.exit(2);
  }
}
if (tags.length === 0) tags.push("latest", "next");

/** @returns every .js file under dir. */
function scripts(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    const info = statSync(file);
    if (info.isDirectory()) out.push(...scripts(file));
    else if (name.endsWith(".js")) out.push(file);
  }
  return out;
}

/** Boot `dsh web` and resolve with its sign-in URL; the child is returned for cleanup. */
function boot(bin, home, patch, log) {
  const child = spawn(
    process.execPath,
    [bin, "web", "--patch", patch, "--port", "0", "--host", "127.0.0.1", "--no-open"],
    { env: { ...process.env, DSH_HOME: home }, stdio: ["ignore", "pipe", "pipe"] },
  );
  const url = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("dsh web did not print its URL")),
      BOOT_TIMEOUT_MS,
    );
    const read = (chunk) => {
      const text = chunk.toString();
      log.push(text);
      const match = /dsh web: (http\S+)/.exec(text);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`dsh web exited with ${code}`));
    });
  });
  return { child, url };
}

/** Sign in with the token URL dsh printed; @returns the session cookie. */
async function signIn(url) {
  const response = await fetch(url, { redirect: "manual" });
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  if (cookie === "") throw new Error(`signing in answered ${response.status} with no cookie`);
  return cookie;
}

async function check(tag) {
  const results = [];
  const record = (name, ok, detail) => results.push({ name, ok, detail });
  const work = mkdtempSync(path.join(tmpdir(), "kivotos-dsh-compat-"));
  const log = [];
  let child;
  let version = "?";
  try {
    execFileSync(
      "npm",
      ["install", "--prefix", work, "--no-audit", "--no-fund", `@deepseek-ai/dsh@${tag}`],
      {
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    const dsh = path.join(work, "node_modules", "@deepseek-ai", "dsh");
    version = JSON.parse(readFileSync(path.join(dsh, "package.json"), "utf8")).version;
    const bin = path.join(dsh, "lib", "bin.js");
    const home = path.join(work, "home");
    execFileSync(
      process.execPath,
      [bin, "plugin", "--profile", "web", "add", path.join(repo, "packages", "kivotos")],
      {
        env: { ...process.env, DSH_HOME: home },
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
    // Relay-only and no discovery: the check binds nothing but its web port.
    const patch = path.join(work, "patch.yml");
    writeFileSync(patch, "- id: kivotos\n  config:\n    listen: false\n    discover: false\n");

    const booted = boot(bin, home, patch, log);
    child = booted.child;
    const url = await booted.url;
    const origin = new URL(url).origin;
    const cookie = await signIn(url);
    const get = (where) => fetch(new URL(where, origin), { headers: { cookie } });

    const index = await (await get("/")).text();
    record(
      "plugin rewrote the index",
      index.includes("viewport-fit=cover"),
      "the viewport meta carries viewport-fit=cover",
    );
    record(
      "plugin reported no host probe failure",
      !index.includes(COMPAT_GLOBAL),
      index.includes(COMPAT_GLOBAL) ? `the page carries ${COMPAT_GLOBAL}` : "none in the page",
    );
    const links = await get("/kivotos/links");
    record("plugin routes answer", links.ok, `GET /kivotos/links -> ${links.status}`);

    // The host's own rewrite has run on this index; a mounted page gets the
    // others, which are judged on the same index here.
    for (const [name, probe] of [
      ["viewport", coverViewport(index).probe],
      ["manifest", credentialedManifest(index).probe],
      ["boot-graph", bootGraphOf(index).probe],
      ["desktop-boot", guardDesktopBoot(index, "/kivotos/peer/check").probe],
    ]) {
      record(`index probe ${name}`, probe.state === "ok", `${probe.state}: ${probe.reason}`);
    }

    const bundles = scripts(path.join(work, "node_modules", "@deepseek-ai")).map((file) =>
      readFileSync(file, "utf8"),
    );
    for (const marker of MARKERS) {
      const found = bundles.some((text) => text.includes(marker));
      record(`bundle marker ${marker}`, found, found ? "present" : "not in any dsh bundle");
    }
  } catch (error) {
    record("boot", false, error instanceof Error ? error.message : String(error));
    console.error(log.join(""));
  } finally {
    child?.kill("SIGTERM");
    rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  }
  return { tag, version, results };
}

const seen = new Map();
let failed = false;
const summary = [`# dsh compatibility (pinned ${PINNED_DSH})`, ""];
for (const tag of tags) {
  const version = execFileSync("npm", ["view", `@deepseek-ai/dsh@${tag}`, "version"], {
    encoding: "utf8",
  }).trim();
  if (seen.has(version)) {
    summary.push(
      `## \`${tag}\` = ${version}`,
      "",
      `Same release as \`${seen.get(version)}\`; checked once.`,
      "",
    );
    continue;
  }
  seen.set(version, tag);
  const report = await check(tag);
  summary.push(
    `## \`${tag}\` = ${report.version}`,
    "",
    "| check | result | detail |",
    "|---|---|---|",
  );
  for (const { name, ok, detail } of report.results) {
    if (!ok) failed = true;
    summary.push(`| ${name} | ${ok ? "ok" : "**failed**"} | ${detail.replaceAll("|", "\\|")} |`);
  }
  summary.push("");
}
const text = summary.join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
process.exit(failed ? 1 : 0);
