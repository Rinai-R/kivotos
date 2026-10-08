import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";
import { isBearerTokenValidAsync } from "./auth.js";

const roots: string[] = [];
const CONFIG_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

async function createKivotosHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "kivotos-config-auth-"));
  roots.push(root);
  const kivotosHome = path.join(root, ".kivotos");
  await mkdir(kivotosHome, { recursive: true });
  await writeFile(path.join(kivotosHome, "config.json"), JSON.stringify(config, null, 2));
  return kivotosHome;
}

describe("daemon auth config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("loads optional auth password hash from config.json", async () => {
    const kivotosHome = await createKivotosHome({
      version: 1,
      daemon: {
        auth: { password: CONFIG_PASSWORD_HASH },
      },
    });

    const config = loadConfig(kivotosHome, { env: {} });

    expect(config.auth?.password).toBe(CONFIG_PASSWORD_HASH);
    expect(
      await isBearerTokenValidAsync({ password: config.auth?.password, token: "correct-password" }),
    ).toBe(true);
  });

  test("lets KIVOTOS_PASSWORD override config.json auth password hash", async () => {
    const kivotosHome = await createKivotosHome({
      version: 1,
      daemon: {
        auth: { password: CONFIG_PASSWORD_HASH },
      },
    });

    const config = loadConfig(kivotosHome, {
      env: { KIVOTOS_PASSWORD: "from-env" },
    });

    expect(config.auth?.password).not.toBe(CONFIG_PASSWORD_HASH);
    expect(config.auth?.password).toMatch(/^\$2[aby]\$12\$/);
    expect(
      await isBearerTokenValidAsync({ password: config.auth?.password, token: "from-env" }),
    ).toBe(true);
  });
});
