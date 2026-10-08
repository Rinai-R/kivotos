import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenProjectPathFromArgv } from "./open-project-routing";

describe("open-project-routing", () => {
  it("returns a bare absolute path argument", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "kivotos-open-project-"));

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Kivotos.app/Contents/MacOS/Kivotos", projectPath],
        isDefaultApp: false,
      }),
    ).toBe(projectPath);
  });

  it("finds a bare absolute path even when Chromium noise args appear first", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "kivotos-open-project-"));

    expect(
      parseOpenProjectPathFromArgv({
        argv: [
          "/Applications/Kivotos.app/Contents/MacOS/Kivotos",
          "--allow-file-access-from-files",
          "--no-sandbox",
          projectPath,
        ],
        isDefaultApp: false,
      }),
    ).toBe(projectPath);
  });

  it("does not treat flags as project paths", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "kivotos-open-project-"));
    const flagLikeDirectory = path.join(projectPath, "--version");
    mkdirSync(flagLikeDirectory);

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Kivotos.app/Contents/MacOS/Kivotos", "--version", flagLikeDirectory],
        isDefaultApp: false,
      }),
    ).toBe(flagLikeDirectory);

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Kivotos.app/Contents/MacOS/Kivotos", "--version"],
        isDefaultApp: false,
      }),
    ).toBeNull();
  });

  it("returns the path from an explicit --open-project flag for backward compatibility", () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "kivotos-open-project-"));

    expect(
      parseOpenProjectPathFromArgv({
        argv: ["/Applications/Kivotos.app/Contents/MacOS/Kivotos", "--open-project", projectPath],
        isDefaultApp: false,
      }),
    ).toBe(projectPath);
  });
});
