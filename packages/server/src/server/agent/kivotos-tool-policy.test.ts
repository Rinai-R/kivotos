import { describe, expect, test } from "vitest";
import type { ProviderKivotosToolsPolicy } from "@kivotos/protocol/provider-config";

import { isKivotosToolEnabled, resolveKivotosToolPolicy } from "./kivotos-tool-policy.js";

describe("Kivotos tool policy", () => {
  test("defaults to all Kivotos tools and resolves only the exact provider ID", () => {
    const customPolicy = {
      enabled: true,
      disabledTools: ["list_agents"],
    } satisfies ProviderKivotosToolsPolicy;

    expect(
      resolveKivotosToolPolicy("custom-claude", {
        claude: { kivotosTools: { enabled: false } },
        "custom-claude": { kivotosTools: customPolicy },
      }),
    ).toBe(customPolicy);
    expect(resolveKivotosToolPolicy("other-custom", { claude: { kivotosTools: customPolicy } })).toBe(
      undefined,
    );
    expect(isKivotosToolEnabled(undefined, "list_agents")).toBe(true);
  });

  test("applies the provider gate and sparse disabled tools without filtering speak", () => {
    expect(isKivotosToolEnabled({ enabled: false }, "list_agents")).toBe(false);
    expect(isKivotosToolEnabled({ enabled: false }, "speak")).toBe(true);
    expect(
      isKivotosToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "list_agents"),
    ).toBe(false);
    expect(
      isKivotosToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "create_agent"),
    ).toBe(true);
  });
});
