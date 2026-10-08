import { describe, expect, test } from "vitest";

import { MutableDaemonConfigPatchSchema, MutableDaemonConfigSchema } from "./messages.js";
import { ProviderOverrideSchema, ProviderKivotosToolsPolicySchema } from "./provider-config.js";

describe("provider Kivotos-tool policy", () => {
  test("accepts arbitrary tool IDs and leaves an empty policy enabled by default", () => {
    expect(
      ProviderKivotosToolsPolicySchema.parse({
        disabledTools: ["future_tool", "browser_future_tool"],
      }),
    ).toEqual({
      disabledTools: ["future_tool", "browser_future_tool"],
    });
    expect(ProviderKivotosToolsPolicySchema.parse({})).toEqual({});
    expect(ProviderOverrideSchema.parse({}).kivotosTools).toBeUndefined();
  });

  test("accepts kivotosTools on persisted provider overrides", () => {
    expect(
      ProviderOverrideSchema.parse({
        extends: "claude",
        kivotosTools: {
          enabled: false,
          disabledTools: ["create_workspace"],
        },
      }).kivotosTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["create_workspace"],
    });
  });

  test("accepts kivotosTools when reading and patching mutable daemon providers", () => {
    expect(
      MutableDaemonConfigSchema.parse({
        mcp: { injectIntoAgents: true },
        providers: {
          codex: {
            kivotosTools: { enabled: false, disabledTools: ["future_tool"] },
          },
        },
      }).providers.codex?.kivotosTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["future_tool"],
    });

    expect(
      MutableDaemonConfigPatchSchema.parse({
        providers: {
          codex: {
            kivotosTools: { disabledTools: ["browser_future_tool"] },
          },
        },
      }).providers?.codex?.kivotosTools,
    ).toEqual({ disabledTools: ["browser_future_tool"] });
  });
});
