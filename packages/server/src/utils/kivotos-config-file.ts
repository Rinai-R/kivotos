import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  KivotosConfigRawSchema,
  type KivotosConfigRaw,
  type KivotosConfigRevision,
  type ProjectConfigRpcError,
} from "@kivotos/protocol/kivotos-config-schema";
export {
  KivotosConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type KivotosConfigRevision,
  type ProjectConfigRpcError,
} from "@kivotos/protocol/kivotos-config-schema";

export const KIVOTOS_CONFIG_FILE_NAME = "kivotos.json";

export type ReadKivotosConfigForEditResult =
  | { ok: true; config: KivotosConfigRaw | null; revision: KivotosConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteKivotosConfigForEditResult =
  | { ok: true; config: KivotosConfigRaw; revision: KivotosConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteKivotosConfigForEditInput {
  repoRoot: string;
  config: KivotosConfigRaw;
  expectedRevision: KivotosConfigRevision | null;
}

export function resolveKivotosConfigPath(repoRoot: string): string {
  return join(repoRoot, KIVOTOS_CONFIG_FILE_NAME);
}

export function statKivotosConfigPath(repoRoot: string): KivotosConfigRevision | null {
  const configPath = resolveKivotosConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readKivotosConfigJson(repoRoot: string): unknown {
  const configPath = resolveKivotosConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readKivotosConfigForEdit(repoRoot: string): ReadKivotosConfigForEditResult {
  try {
    const json = readKivotosConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: KivotosConfigRawSchema.parse(json),
      revision: statKivotosConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeKivotosConfigForEdit(
  input: WriteKivotosConfigForEditInput,
): WriteKivotosConfigForEditResult {
  const parsed = KivotosConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveKivotosConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${KIVOTOS_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statKivotosConfigPath(input.repoRoot);
    if (!kivotosConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempKivotosConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statKivotosConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempKivotosConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function kivotosConfigRevisionsEqual(
  left: KivotosConfigRevision | null,
  right: KivotosConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempKivotosConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
