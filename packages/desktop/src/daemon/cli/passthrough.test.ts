import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parsePassthroughCliArgs,
  parsePassthroughCliArgsFromArgv,
  runPassthroughCli,
} from "./passthrough";

const originalDefaultApp = process.defaultApp;
const originalDesktopCli = process.env.KIVOTOS_DESKTOP_CLI;

function setDefaultApp(value: boolean): void {
  Object.defineProperty(process, "defaultApp", {
    configurable: true,
    value,
  });
}

describe("passthrough CLI", () => {
  afterEach(() => {
    setDefaultApp(originalDefaultApp);
    if (originalDesktopCli === undefined) {
      delete process.env.KIVOTOS_DESKTOP_CLI;
    } else {
      process.env.KIVOTOS_DESKTOP_CLI = originalDesktopCli;
    }
  });

  it("returns null when no CLI args are provided", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Kivotos.app/Contents/MacOS/Kivotos"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores macOS GUI launch arguments", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Kivotos.app/Contents/MacOS/Kivotos", "-psn_0_12345"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores --no-sandbox injected by Linux wrapper", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/Kivotos", "--no-sandbox", "status"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["status"]);
  });

  it("returns null when only --no-sandbox is present", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/Kivotos", "--no-sandbox"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("ignores Linux desktop identity arguments injected by the Nix wrapper", () => {
    expect(
      parsePassthroughCliArgs({
        argv: [
          "/nix/store/electron/bin/electron",
          "/nix/store/kivotos-desktop/share/kivotos-desktop/electron-app",
          "--no-sandbox",
          "--class=kivotos-desktop",
          "daemon",
          "status",
        ],
        isDefaultApp: true,
        forceCli: false,
      }),
    ).toEqual(["daemon", "status"]);
  });

  it("ignores Electron remote debugging switches", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/usr/bin/Kivotos", "--remote-debugging-port=9233"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toBeNull();
  });

  it("preserves CLI flags for direct app invocations", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Kivotos.app/Contents/MacOS/Kivotos", "--version"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["--version"]);
  });

  it("passes --open-project through as a normal CLI arg", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Kivotos.app/Contents/MacOS/Kivotos", "--open-project", "/tmp/project"],
        isDefaultApp: false,
        forceCli: false,
      }),
    ).toEqual(["--open-project", "/tmp/project"]);
  });

  it("forces CLI mode for shim launches even without args", () => {
    expect(
      parsePassthroughCliArgs({
        argv: ["/Applications/Kivotos.app/Contents/MacOS/Kivotos"],
        isDefaultApp: false,
        forceCli: true,
      }),
    ).toEqual([]);
  });

  it("parses terminal args for direct app CLI passthrough", () => {
    setDefaultApp(false);
    delete process.env.KIVOTOS_DESKTOP_CLI;

    expect(
      parsePassthroughCliArgsFromArgv([
        "/Applications/Kivotos.app/Contents/MacOS/Kivotos",
        "daemon",
        "set-password",
      ]),
    ).toEqual(["daemon", "set-password"]);
  });

  it("runs passthrough CLI through the programmatic entrypoint", async () => {
    const runCli = vi.fn(async () => 7);

    await expect(runPassthroughCli(["daemon", "set-password"], { runCli })).resolves.toBe(7);

    expect(runCli).toHaveBeenCalledWith(["daemon", "set-password"]);
  });
});
