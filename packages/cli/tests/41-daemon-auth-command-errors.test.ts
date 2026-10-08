#!/usr/bin/env npx tsx

import assert from "node:assert";
import { runLocalKivotos } from "./helpers/local-cli.ts";
import { startTestDaemon } from "./helpers/test-daemon.ts";

console.log("=== Daemon Auth Command Errors ===\n");

const daemon = await startTestDaemon({
  env: { KIVOTOS_PASSWORD: "shared-secret" },
});

async function lsError(password: string, remoteClient = false) {
  const result = await runLocalKivotos(["ls", "--json"], {
    KIVOTOS_HOME: remoteClient ? "" : daemon.kivotosHome,
    KIVOTOS_HOST: remoteClient ? `127.0.0.1:${daemon.port}` : "",
    KIVOTOS_PASSWORD: password,
  });
  assert.notStrictEqual(result.exitCode, 0, "ls should fail without a valid password");
  return JSON.parse(result.stderr).error as {
    code: string;
    message: string;
    details: string;
  };
}

try {
  {
    console.log("Test 1: a client outside the daemon home needs KIVOTOS_PASSWORD");
    const error = await lsError("", true);
    assert.strictEqual(error.code, "AUTH_REQUIRED");
    assert.match(error.message, /Password required/);
    assert.match(error.details, /KIVOTOS_PASSWORD/);
    assert.doesNotMatch(error.details, /daemon start/);
    console.log("✓ client without the local credential is asked for KIVOTOS_PASSWORD\n");
  }

  {
    console.log("Test 2: wrong password asks for KIVOTOS_PASSWORD, not a daemon start");
    const error = await lsError("wrong-secret");
    assert.strictEqual(error.code, "AUTH_FAILED");
    assert.match(error.message, /Incorrect password/);
    assert.match(error.details, /KIVOTOS_PASSWORD/);
    assert.doesNotMatch(error.details, /daemon start/);
    console.log("✓ wrong password points at KIVOTOS_PASSWORD\n");
  }
} finally {
  await daemon.stop();
}

console.log("=== Daemon Auth Command Errors Tests Passed ===");
