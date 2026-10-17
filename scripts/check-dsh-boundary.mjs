// Keep dsh internals inside packages/kivotos/src/dsh/.
//
// Kivotos reads a handful of dsh 0.2.1-rc.2 internals, and each read is a
// probed coupling point in src/dsh/ (see src/dsh/compat.ts). A selector,
// global or storage key written anywhere else would be a read nobody probes,
// so this fails on one. Comments are not checked.
//
// Usage: node scripts/check-dsh-boundary.mjs [files...]  (default: all of src)
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(repo, "packages", "kivotos", "src");
const adapter = path.join(src, "dsh") + path.sep;

/** What only the adapter may say. */
const INTERNALS = [
  [/\[class\*=/, "a CSS-module class selector"],
  [/\bdata-(shell|shortcut-modal|conversation|sidebar|composer)-/, "a dsh data attribute"],
  [/__DSH_[A-Z_]+__/, "a dsh page global"],
  [/dsh\.sessions\./, "a dsh localStorage key"],
  [/\bdshDesktopBoot\b|\bstreamBaseUrl\b/, "the desktop shell's bridge"],
  [/["'`]\/api\//, "a dsh API path"],
  [/["'`/]\^?\\?\/assets\\?\//, "dsh's asset naming"],
];

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) out.push(...files(file));
    else if (/\.tsx?$/.test(name)) out.push(file);
  }
  return out;
}

/** @returns the file with comments blanked, line numbers kept. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const given = process.argv.slice(2).map((file) => path.resolve(file));
const targets = (given.length > 0 ? given : files(src)).filter(
  (file) => file.startsWith(src + path.sep) && !file.startsWith(adapter) && /\.tsx?$/.test(file),
);

let failed = 0;
for (const file of targets) {
  const lines = code(readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    for (const [pattern, what] of INTERNALS) {
      if (!pattern.test(line)) continue;
      failed++;
      console.error(
        `${path.relative(repo, file)}:${index + 1}: ${what} outside src/dsh/: ${line.trim()}`,
      );
    }
  });
}
if (failed > 0) {
  console.error(
    `\n${failed} dsh internal(s) outside packages/kivotos/src/dsh/. Move each read into the adapter, with its probe.`,
  );
  process.exit(1);
}
