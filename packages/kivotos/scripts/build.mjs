/**
 * Build the plugin into dist/.
 *
 * - Host: src/index.ts and its imports → dist/index.js, one ESM file for Node.
 * - Client: src/client.tsx → dist/client.js, wrapped in the
 *   `window.__ModuleLoader__.load` form dsh's Client loader expects. React is
 *   not bundled: dsh supplies it through the loader's `require`.
 */
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";

const here = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", here), "utf8"));
const dist = new URL("dist/", here);

await rm(dist, { recursive: true, force: true });

await build({
  absWorkingDir: here.pathname,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  legalComments: "none",
});

// The Client bundle runs inside the loader's factory: `require` is the
// loader's, so react resolves to the instance dsh renders with.
const client = await build({
  absWorkingDir: here.pathname,
  entryPoints: ["src/client.tsx"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  external: ["react"],
  legalComments: "none",
});

const body = client.outputFiles[0].text;
const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
    ${body}
    return module.exports;
  },
});
`;

await build({
  stdin: { contents: wrapped, loader: "js", sourcefile: "client.js" },
  outfile: new URL("dist/client.js", here).pathname,
  minify: false,
  target: "es2022",
  legalComments: "none",
});
