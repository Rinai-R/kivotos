import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestKivotosDaemon } from "./kivotos-daemon.js";

describe("createTestKivotosDaemon", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  test("keeps a caller-owned home when startup on a taken port fails", async () => {
    const kivotosHomeRoot = await mkdtemp(path.join(os.tmpdir(), "kivotos-owned-home-"));
    cleanups.push(() => rm(kivotosHomeRoot, { recursive: true, force: true }));
    const ownedFile = path.join(kivotosHomeRoot, "owned-by-caller");
    await writeFile(ownedFile, "keep");
    const takenPort = await occupyPort(cleanups);

    await expect(
      createTestKivotosDaemon({
        listenPort: takenPort,
        kivotosHomeRoot,
        staticDir: path.join(kivotosHomeRoot, "static"),
        cleanup: false,
        mcpEnabled: false,
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });

    expect(existsSync(ownedFile)).toBe(true);
  }, 60_000);

  test("removes the directories it created when startup on a taken port fails", async () => {
    const scratchTmp = await mkdtemp(path.join(os.tmpdir(), "kivotos-daemon-scratch-"));
    cleanups.push(() => rm(scratchTmp, { recursive: true, force: true }));
    for (const name of ["TMPDIR", "TMP", "TEMP"]) vi.stubEnv(name, scratchTmp);
    const takenPort = await occupyPort(cleanups);

    await expect(
      createTestKivotosDaemon({ listenPort: takenPort, cleanup: false, mcpEnabled: false }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });

    expect(await readdir(scratchTmp)).toEqual([]);
  }, 60_000);
});

async function occupyPort(cleanups: Array<() => Promise<void>>): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Port holder did not bind a TCP port");
  }
  return address.port;
}
