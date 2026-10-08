import { z } from "zod";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

export const KivotosServicePortAllocationSchema = z
  .object({
    range: z.string().trim().regex(TCP_PORT_RANGE_PATTERN).optional(),
    portScript: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.range !== undefined || value.portScript !== undefined,
    "Expected range or portScript",
  )
  .refine((value) => {
    if (!value.range) return true;
    const match = TCP_PORT_RANGE_PATTERN.exec(value.range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start >= 1 && end <= 65_535 && start <= end;
  }, "Expected an inclusive TCP port range from 1-65535");

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const KivotosLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const KivotosScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const KivotosWorktreeConfigRawSchema = z
  .object({
    setup: KivotosLifecycleCommandRawSchema.optional(),
    teardown: KivotosLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
    servicePorts: KivotosServicePortAllocationSchema.optional(),
  })
  .passthrough();

export const KivotosMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const KivotosMetadataGenerationSchema = z
  .object({
    title: KivotosMetadataGenerationEntrySchema.optional(),
    branchName: KivotosMetadataGenerationEntrySchema.optional(),
    commitMessage: KivotosMetadataGenerationEntrySchema.optional(),
    pullRequest: KivotosMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy kivotos.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const KivotosConfigRawSchema = z
  .object({
    worktree: KivotosWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), KivotosScriptEntryRawSchema).optional(),
    metadataGeneration: KivotosMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = KivotosWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = KivotosScriptEntryRawSchema.catch({});

export const KivotosConfigSchema = KivotosConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: KivotosMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const KivotosConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: KivotosConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type KivotosScriptEntryRaw = z.infer<typeof KivotosScriptEntryRawSchema>;
export type KivotosMetadataGenerationEntry = z.infer<typeof KivotosMetadataGenerationEntrySchema>;
export type KivotosMetadataGeneration = z.infer<typeof KivotosMetadataGenerationSchema>;
export type KivotosServicePortAllocation = z.infer<typeof KivotosServicePortAllocationSchema>;
export type KivotosConfigRaw = z.infer<typeof KivotosConfigRawSchema>;
export type KivotosConfig = z.infer<typeof KivotosConfigSchema>;
export type KivotosConfigRevision = z.infer<typeof KivotosConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
