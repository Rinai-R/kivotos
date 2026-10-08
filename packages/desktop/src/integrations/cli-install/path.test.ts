import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { resolveCliInstallSourcePath, resolveCliShimPath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Kivotos.app/Contents/MacOS/Kivotos",
        shimPath: "/Applications/Kivotos.app/Contents/Resources/bin/kivotos",
      }),
    ).toBe("/Applications/Kivotos.app/Contents/Resources/bin/kivotos");
  });

  it("prefers the original AppImage path on linux", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_kivotos123/kivotos",
        shimPath: "/tmp/.mount_kivotos123/resources/bin/kivotos",
        appImagePath: "/home/user/Applications/Kivotos.AppImage",
      }),
    ).toBe("/home/user/Applications/Kivotos.AppImage");
  });

  it("uses the bundled shim for packaged linux installs outside an AppImage", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/opt/Kivotos/Kivotos",
        shimPath: "/opt/Kivotos/resources/bin/kivotos",
      }),
    ).toBe("/opt/Kivotos/resources/bin/kivotos");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Kivotos\\Kivotos.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\Kivotos\\resources\\bin\\kivotos.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\Kivotos\\resources\\bin\\kivotos.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/Kivotos/kivotos",
        shimPath: "/opt/Kivotos/resources/bin/kivotos",
      }),
    ).toBe("/opt/Kivotos/resources/bin/kivotos");
  });
});

describe("CLI executable selection", () => {
  const resolveWorkspaceCli = () =>
    createRequire(import.meta.url).resolve("@kivotos/cli/bin/kivotos");

  it("uses the workspace CLI for an unpackaged Electron launcher", () => {
    expect(
      resolveCliShimPath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/nix/store/electron/bin/electron",
        resolveWorkspaceCli,
      }),
    ).toBe(resolveWorkspaceCli());
  });

  it("uses the application shim for a packaged launcher", () => {
    expect(
      resolveCliShimPath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/opt/Kivotos/kivotos",
        resolveWorkspaceCli,
      }),
    ).toBe(path.join("/opt/Kivotos", "resources", "bin", "kivotos"));
    expect(
      resolveCliShimPath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Kivotos.app/Contents/MacOS/Kivotos",
        resolveWorkspaceCli,
      }),
    ).toBe(path.join("/Applications/Kivotos.app", "Contents", "Resources", "bin", "kivotos"));
  });
});
