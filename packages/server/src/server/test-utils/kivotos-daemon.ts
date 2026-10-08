import { BuiltinPluginLoader } from "../plugins/builtin/index.js";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";

import pino from "pino";
import {
  createKivotosDaemon,
  type KivotosDaemonConfig,
  type KivotosOpenAIConfig,
  type KivotosSpeechConfig,
} from "../bootstrap.js";
import type { AgentClient, AgentProvider } from "../agent/agent-sdk-types.js";
import { createTestAgentClients } from "./fake-agent-client.js";
import type { PushNotificationSender } from "../push/index.js";
import type { AgentProfile } from "@kivotos/protocol/messages";

interface TestKivotosDaemonOptions {
  daemonVersion?: string;
  desktopManaged?: boolean;
  downloadTokenTtlMs?: number;
  corsAllowedOrigins?: string[];
  listen?: string;
  listenPort?: number;
  logger?: Parameters<typeof createKivotosDaemon>[1];
  mcpEnabled?: boolean;
  mcpDebug?: boolean;
  isDev?: boolean;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  daemonStatusRpcCapability?: boolean;
  relayConfigCapability?: boolean;
  agentClients?: Partial<Record<AgentProvider, AgentClient>>;
  providerOverrides?: KivotosDaemonConfig["providerOverrides"];
  kivotosHomeRoot?: string;
  staticDir?: string;
  cleanup?: boolean;
  openai?: KivotosOpenAIConfig;
  speech?: KivotosSpeechConfig;
  voiceLlmProvider?: KivotosDaemonConfig["voiceLlmProvider"];
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  auth?: KivotosDaemonConfig["auth"];
  pushNotificationSender?: PushNotificationSender;
  serviceProxy?: KivotosDaemonConfig["serviceProxy"];
  webUi?: KivotosDaemonConfig["webUi"];
  trustedProxies?: KivotosDaemonConfig["trustedProxies"];
  agentProfiles?: AgentProfile[];
  autoArchiveAfterMerge?: boolean;
  pluginsEnabled?: KivotosDaemonConfig["pluginsEnabled"];
  builtinPlugins?: BuiltinPluginLoader;
  plugins?: KivotosDaemonConfig["plugins"];
}

export interface TestKivotosDaemon {
  config: KivotosDaemonConfig;
  daemon: Awaited<ReturnType<typeof createKivotosDaemon>>;
  port: number;
  kivotosHome: string;
  staticDir: string;
  close: () => Promise<void>;
}

const TEST_DAEMON_START_TIMEOUT_MS = 20_000;

async function startDaemonWithTimeout(
  daemon: Awaited<ReturnType<typeof createKivotosDaemon>>,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const timeoutError = new Error(
        `Timed out starting test daemon after ${timeoutMs}ms`,
      ) as Error & { code?: string };
      timeoutError.code = "TEST_DAEMON_START_TIMEOUT";
      reject(timeoutError);
    }, timeoutMs);

    daemon.start().then(
      () => {
        clearTimeout(timeoutHandle);
        resolve();
        return;
      },
      (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
}

export async function createTestKivotosDaemon(
  options: TestKivotosDaemonOptions = {},
): Promise<TestKivotosDaemon> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { config, kivotosHomeRoot, kivotosHome, staticDir, createdDirs } =
      await prepareTestDaemonConfig(options);
    const logger = options.logger ?? pino({ level: "silent" });
    const daemon = await createKivotosDaemon(config, logger, {
      builtinPlugins: options.builtinPlugins ?? new BuiltinPluginLoader(undefined, []),
      serverFeatureOverrides: {
        daemonStatusRpc: options.daemonStatusRpcCapability,
        relayConfig: options.relayConfigCapability,
      },
    });
    try {
      await startDaemonWithTimeout(daemon, TEST_DAEMON_START_TIMEOUT_MS);
      const listenTarget = daemon.getListenTarget();
      if (!listenTarget || listenTarget.type !== "tcp") {
        throw new Error("Test daemon did not expose a bound TCP listen target");
      }

      const close = async (): Promise<void> => {
        await daemon.stop().catch(() => undefined);
        await daemon.agentManager.flush().catch(() => undefined);
        if (options.cleanup ?? true) {
          await new Promise((r) => setTimeout(r, 50));
          await removeDirs([kivotosHomeRoot, staticDir]);
        }
      };

      return {
        config,
        daemon,
        port: listenTarget.port,
        kivotosHome,
        staticDir,
        close,
      };
    } catch (error) {
      lastError = error;
      await daemon.stop().catch(() => undefined);
      // A failed attempt removes only what it created: a caller-supplied home keeps its serverId.
      await removeDirs(createdDirs);

      if (
        (!isAddressInUseError(error) && !isStartupTimeoutError(error)) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Failed to start test daemon");
}

interface PreparedTestDaemonConfig {
  config: KivotosDaemonConfig;
  kivotosHomeRoot: string;
  kivotosHome: string;
  staticDir: string;
  createdDirs: string[];
}

async function removeDirs(dirs: string[]): Promise<void> {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })),
  );
}

async function createTempDir(prefix: string, createdDirs: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function prepareTestDaemonConfig(
  options: TestKivotosDaemonOptions,
): Promise<PreparedTestDaemonConfig> {
  const createdDirs: string[] = [];
  const kivotosHomeRoot = options.kivotosHomeRoot ?? (await createTempDir("kivotos-home-", createdDirs));
  const kivotosHome = path.join(kivotosHomeRoot, ".kivotos");
  await mkdir(kivotosHome, { recursive: true });
  const staticDir = options.staticDir ?? (await createTempDir("kivotos-static-", createdDirs));
  const listenHost = options.listen ?? "127.0.0.1";
  const listenPort = options.listenPort ?? 0;
  const config: KivotosDaemonConfig = {
    listen: `${listenHost}:${listenPort}`,
    kivotosHome,
    daemonVersion: options.daemonVersion,
    desktopManaged: options.desktopManaged,
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    hostnames: true,
    mcpEnabled: options.mcpEnabled ?? true,
    staticDir,
    mcpDebug: options.mcpDebug ?? false,
    isDev: options.isDev,
    agentClients: options.agentClients ?? createTestAgentClients(),
    providerOverrides: options.providerOverrides,
    agentStoragePath: path.join(kivotosHome, "agents"),
    relayEnabled: options.relayEnabled ?? false,
    relayEndpoint: options.relayEndpoint ?? "relay.paseo.sh:443",
    relayUseTls: options.relayUseTls,
    relayPublicUseTls: options.relayPublicUseTls,
    appBaseUrl: "https://app.paseo.sh",
    auth: options.auth,
    pushNotificationSender: options.pushNotificationSender,
    serviceProxy: options.serviceProxy,
    webUi: options.webUi,
    trustedProxies: options.trustedProxies,
    openai: options.openai,
    speech: options.speech,
    voiceLlmProvider: options.voiceLlmProvider ?? null,
    voiceLlmProviderExplicit: options.voiceLlmProviderExplicit ?? false,
    voiceLlmModel: options.voiceLlmModel ?? null,
    dictationFinalTimeoutMs: options.dictationFinalTimeoutMs,
    downloadTokenTtlMs: options.downloadTokenTtlMs,
    agentProfiles: options.agentProfiles,
    autoArchiveAfterMerge: options.autoArchiveAfterMerge,
    pluginsEnabled: options.pluginsEnabled,
    plugins: options.plugins,
  };
  return { config, kivotosHomeRoot, kivotosHome, staticDir, createdDirs };
}

function isAddressInUseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "EADDRINUSE";
}

function isStartupTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "TEST_DAEMON_START_TIMEOUT";
}
