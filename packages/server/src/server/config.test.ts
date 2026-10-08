import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveBundledWebUiDistDir, resolveConfigFromPersisted } from "./config.js";
import { loadPersistedConfig } from "./persisted-config.js";

const roots: string[] = [];

describe("server config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("records when the daemon is managed by Kivotos Desktop", async () => {
    const kivotosHome = await mkdtemp(path.join(os.tmpdir(), "kivotos-config-desktop-managed-"));
    roots.push(kivotosHome);

    const desktopConfig = loadConfig(kivotosHome, {
      env: { KIVOTOS_DESKTOP_MANAGED: "1" },
    });
    const standaloneConfig = loadConfig(kivotosHome, { env: {} });

    expect(desktopConfig.desktopManaged).toBe(true);
    expect(standaloneConfig.desktopManaged).toBe(false);
  });

  test("loads the provider catalog refresh timeout", async () => {
    const kivotosHome = await mkdtemp(path.join(os.tmpdir(), "kivotos-config-provider-timeout-"));
    roots.push(kivotosHome);
    await writeFile(
      path.join(kivotosHome, "config.json"),
      JSON.stringify({ agents: { catalogRefreshTimeoutMs: 180_000 } }),
    );

    const config = loadConfig(kivotosHome, { env: {} });

    expect(config.providerCatalogRefreshTimeoutMs).toBe(180_000);
  });

  test("resolves reload state from the supplied validated snapshot", async () => {
    const kivotosHome = await mkdtemp(path.join(os.tmpdir(), "kivotos-config-snapshot-"));
    roots.push(kivotosHome);
    const snapshot = loadPersistedConfig(kivotosHome);
    await writeFile(
      path.join(kivotosHome, "config.json"),
      JSON.stringify({
        ...snapshot,
        daemon: { ...snapshot.daemon, browserTools: { enabled: true } },
      }),
    );

    expect(resolveConfigFromPersisted(kivotosHome, snapshot, { env: {} }).browserToolsEnabled).toBe(
      false,
    );
    expect(loadConfig(kivotosHome, { env: {} }).browserToolsEnabled).toBe(true);
  });

  test("records mutable and startup launch overrides by persisted leaf", async () => {
    const kivotosHome = await mkdtemp(path.join(os.tmpdir(), "kivotos-config-overrides-"));
    roots.push(kivotosHome);
    const config = loadConfig(kivotosHome, {
      env: {
        KIVOTOS_LISTEN: "127.0.0.1:7000",
        KIVOTOS_PASSWORD: "secret",
        KIVOTOS_RELAY_ENDPOINT: "relay.example.test:443",
        KIVOTOS_TRUSTED_PROXIES: "true",
        KIVOTOS_WEB_UI_ENABLED: "true",
        KIVOTOS_LOG_FILE_PATH: "custom.log",
        KIVOTOS_VOICE_LLM_PROVIDER: "codex",
      },
      cli: { relayUseTls: false },
    });

    expect(config.configReload?.overrideControlledPaths).toEqual([
      "daemon.auth.password",
      "daemon.listen",
      "daemon.relay.endpoint",
      "daemon.relay.useTls",
      "daemon.trustedProxies",
      "features.voiceMode.llm.provider",
      "features.webUi.enabled",
      "log.file.path",
    ]);
    expect(config.listen).toBe("127.0.0.1:7000");
    expect(config.trustedProxies).toBe(true);
    expect(config.log?.file?.path).toBe("custom.log");
    expect(config.voiceLlmProvider).toBe("codex");
  });

  test.each([
    {
      name: "local speech providers",
      providers: { dictation: "local", voiceStt: "local", voiceTts: "local" },
      expected: [
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
    {
      name: "OpenAI speech providers",
      providers: { dictation: "openai", voiceStt: "openai", voiceTts: "openai" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
        "features.voiceMode.tts.voice",
      ],
    },
    {
      name: "mixed local and OpenAI speech providers",
      providers: { dictation: "local", voiceStt: "openai", voiceTts: "local" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
  ])("classifies speech overrides for $name", ({ providers, expected }) => {
    const config = resolveConfigFromPersisted(
      "/tmp/kivotos-speech-override-classification",
      {
        version: 1,
        features: {
          dictation: { enabled: true, stt: { provider: providers.dictation } },
          voiceMode: {
            enabled: true,
            stt: { provider: providers.voiceStt },
            tts: { provider: providers.voiceTts },
          },
        },
      },
      {
        env: {
          OPENAI_API_KEY: "test-api-key",
          KIVOTOS_DICTATION_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          KIVOTOS_VOICE_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          KIVOTOS_VOICE_LOCAL_TTS_MODEL: "kokoro-en-v0_19",
          STT_CONFIDENCE_THRESHOLD: "0.5",
          STT_MODEL: "whisper-1",
          TTS_MODEL: "tts-1",
          TTS_VOICE: "alloy",
        },
      },
    );

    expect(config.configReload?.overrideControlledPaths).toEqual(expected);
  });

  test("resolves bundled web UI path from source-tree modules", () => {
    const root = path.parse(process.cwd()).root;
    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(root, "repo", "packages", "server", "src", "server", "config.ts"),
        ),
      }),
    ).toBe(path.join(root, "repo", "packages", "server", "dist", "server", "web-ui"));
  });

  test("resolves bundled web UI path from globally installed compiled modules", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "kivotos-config-compiled-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "dist", "server", "web-ui"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(path.join(packageRoot, "dist", "server", "server", "config.js")),
      }),
    ).toBe(path.join(packageRoot, "dist", "server", "web-ui"));
  });

  test("resolves packaged desktop web UI path from resources app-dist", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "kivotos-config-packaged-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "app-dist"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(
            packageRoot,
            "app.asar",
            "node_modules",
            "@kivotos",
            "server",
            "dist",
            "server",
            "server",
            "config.js",
          ),
        ),
        resourcesPath: packageRoot,
      }),
    ).toBe(path.join(packageRoot, "app-dist"));
  });
});

test("loads private plugin registry settings through the configuration boundary", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "kivotos-registry-config-"));
  try {
    const pluginRegistries = { "plugins.example.test": { authorization: "Bearer fixture" } };
    await writeFile(path.join(home, "config.json"), JSON.stringify({ pluginRegistries }));
    const config = loadConfig(home, {
      env: { KIVOTOS_PLUGIN_REGISTRY: "https://plugins.example.test/internal" },
    });
    expect(config.pluginRegistryUrl).toBe("https://plugins.example.test/internal");
    expect(config.pluginRegistries).toEqual(pluginRegistries);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
