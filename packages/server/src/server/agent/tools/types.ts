import type { z } from "zod";
import type { ProviderKivotosToolsPolicy } from "@kivotos/protocol/provider-config";

export interface KivotosToolExecutionContext {
  signal?: AbortSignal;
  sendUpdate?: (update: KivotosToolResult) => void;
}

export interface KivotosToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface KivotosToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape;
}

export interface KivotosToolDefinition extends KivotosToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: KivotosToolExecutionContext) => Promise<KivotosToolResult>;
}

export interface KivotosToolCatalog {
  tools: ReadonlyMap<string, KivotosToolDefinition>;
  getTool(name: string): KivotosToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: KivotosToolExecutionContext,
  ): Promise<KivotosToolResult>;
}

export interface KivotosToolRuntimeContext {
  callerAgentId?: string;
  kivotosToolPolicy?: ProviderKivotosToolsPolicy;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type KivotosToolCatalogFactory = (
  context: KivotosToolRuntimeContext,
) => KivotosToolCatalog | Promise<KivotosToolCatalog>;
