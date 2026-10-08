import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveKivotosHome } from "./kivotos-home.js";
describe("resolveKivotosHome", () => {
  test("resolves KIVOTOS_HOME without creating it", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "kivotos-home-parent-"));
    const kivotosHome = path.join(parent, "home");
    try {
      expect(resolveKivotosHome({ KIVOTOS_HOME: kivotosHome })).toBe(kivotosHome);
      expect(existsSync(kivotosHome)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
