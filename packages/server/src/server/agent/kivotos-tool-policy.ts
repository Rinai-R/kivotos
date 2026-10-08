import type { ProviderKivotosToolsPolicy } from "@kivotos/protocol/provider-config";

interface ProviderKivotosToolSettings {
  kivotosTools?: ProviderKivotosToolsPolicy;
}

export function resolveKivotosToolPolicy(
  providerId: string,
  providerSettings: Readonly<Record<string, ProviderKivotosToolSettings>> | undefined,
): ProviderKivotosToolsPolicy | undefined {
  return providerSettings?.[providerId]?.kivotosTools;
}

export function isKivotosToolEnabled(
  policy: ProviderKivotosToolsPolicy | undefined,
  toolName: string,
): boolean {
  if (toolName === "speak") {
    return true;
  }
  if (!isKivotosToolPolicyEnabled(policy)) {
    return false;
  }
  return !policy?.disabledTools?.includes(toolName);
}

export function isKivotosToolPolicyEnabled(policy: ProviderKivotosToolsPolicy | undefined): boolean {
  return policy?.enabled !== false;
}
