import { join } from "node:path";

import { getKivotosWorktreesRoot, isKivotosOwnedWorktreeCwd } from "../../utils/worktree.js";
import {
  archiveByScope,
  resolveWorkspaceIdAtPath,
  type ArchiveDependencies,
  type ArchiveScope,
} from "../workspace-archive-service.js";
import type {
  CreateKivotosWorktreeInput,
  CreateKivotosWorktreeResult,
} from "../kivotos-worktree-service.js";
import { toWorktreeWireError, type WorktreeWireError } from "../worktree-errors.js";
import type { WorkspaceGitService, WorkspaceGitWorktreeInfo } from "../workspace-git-service.js";

export interface ListKivotosWorktreesCommandDependencies {
  workspaceGitService: Pick<WorkspaceGitService, "listWorktrees">;
}

export interface ListKivotosWorktreesCommandInput {
  cwd: string;
  reason?: string;
}

export async function listKivotosWorktreesCommand(
  dependencies: ListKivotosWorktreesCommandDependencies,
  input: ListKivotosWorktreesCommandInput,
): Promise<WorkspaceGitWorktreeInfo[]> {
  if (input.reason) {
    return dependencies.workspaceGitService.listWorktrees(input.cwd, { reason: input.reason });
  }
  return dependencies.workspaceGitService.listWorktrees(input.cwd);
}

type CreateKivotosWorktreeWorkflow<Result extends CreateKivotosWorktreeResult> = (
  input: CreateKivotosWorktreeInput,
) => Promise<Result>;

export interface CreateKivotosWorktreeCommandDependencies<
  Result extends CreateKivotosWorktreeResult = CreateKivotosWorktreeResult,
> {
  kivotosHome?: string;
  worktreesRoot?: string;
  createKivotosWorktreeWorkflow?: CreateKivotosWorktreeWorkflow<Result>;
}

export type CreateKivotosWorktreeCommandInput = Omit<
  CreateKivotosWorktreeInput,
  "kivotosHome" | "runSetup"
> & {
  kivotosHome?: string;
  worktreesRoot?: string;
};

export type CreateKivotosWorktreeCommandResult<Result extends CreateKivotosWorktreeResult> =
  | {
      ok: true;
      createdWorktree: Result;
    }
  | {
      ok: false;
      error: WorktreeWireError;
      cause: unknown;
    };

export async function createKivotosWorktreeCommand<Result extends CreateKivotosWorktreeResult>(
  dependencies: CreateKivotosWorktreeCommandDependencies<Result>,
  input: CreateKivotosWorktreeCommandInput,
): Promise<CreateKivotosWorktreeCommandResult<Result>> {
  try {
    if (!dependencies.createKivotosWorktreeWorkflow) {
      throw new Error("Kivotos worktree service is not configured");
    }

    const createdWorktree = await dependencies.createKivotosWorktreeWorkflow({
      ...input,
      runSetup: false,
      kivotosHome: input.kivotosHome ?? dependencies.kivotosHome,
      worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
    });
    return { ok: true, createdWorktree };
  } catch (error) {
    return {
      ok: false,
      error: toWorktreeWireError(error),
      cause: error,
    };
  }
}

export interface ArchiveCommandDependencies extends Omit<
  ArchiveDependencies,
  "workspaceGitService"
> {
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees">;
}

export interface ArchiveCommandInput {
  requestId: string;
  repoRoot?: string | null;
  worktreePath?: string;
  worktreeSlug?: string;
  branchName?: string;
  workspaceId?: string;
  scope?: ArchiveScope["kind"];
}

export type ArchiveCommandResult =
  | {
      ok: true;
      removedAgents: string[];
    }
  | {
      ok: false;
      code: "NOT_ALLOWED";
      message: string;
      removedAgents: [];
    };

export async function archiveCommand(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<ArchiveCommandResult> {
  const targetPath = await resolveArchiveTarget(dependencies, input);
  const scope = input.scope ?? "workspace";
  const ownership = await isKivotosOwnedWorktreeCwd(targetPath, {
    kivotosHome: dependencies.kivotosHome,
    worktreesRoot: dependencies.kivotosWorktreesBaseRoot,
  });

  if (scope === "worktree") {
    if (!ownership.allowed) {
      return {
        ok: false,
        code: "NOT_ALLOWED",
        message: "Worktree is not a Kivotos-owned worktree",
        removedAgents: [],
      };
    }

    const result = await archiveByScope(dependencies, {
      scope: { kind: "worktree", targetPath },
      requestId: input.requestId,
    });

    return {
      ok: true,
      removedAgents: result.archivedAgentIds,
    };
  }

  const workspaceId =
    input.workspaceId ?? (await resolveWorkspaceIdAtPath(dependencies, targetPath));

  if (!workspaceId) {
    dependencies.sessionLogger?.warn(
      { targetPath },
      "Could not resolve workspace for archive; skipping",
    );
    return {
      ok: true,
      removedAgents: [],
    };
  }

  const result = await archiveByScope(dependencies, {
    scope: { kind: "workspace", workspaceId },
    requestId: input.requestId,
  });

  return {
    ok: true,
    removedAgents: result.archivedAgentIds,
  };
}

async function resolveArchiveTarget(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<string> {
  const repoRoot = input.repoRoot ?? null;
  if (input.worktreePath) {
    return input.worktreePath;
  }

  if (input.worktreeSlug) {
    if (!repoRoot) {
      throw new Error("repoRoot is required when worktreeSlug is supplied");
    }
    return resolveWorktreeSlugPath(dependencies, repoRoot, input.worktreeSlug);
  }

  if (repoRoot && input.branchName) {
    const worktrees = await dependencies.workspaceGitService.listWorktrees(repoRoot);
    const match = worktrees.find((entry) => entry.branchName === input.branchName);
    if (!match) {
      throw new Error(`Kivotos worktree not found for branch ${input.branchName}`);
    }
    return match.path;
  }

  throw new Error("worktreePath, worktreeSlug, or repoRoot+branchName is required");
}

async function resolveWorktreeSlugPath(
  dependencies: ArchiveCommandDependencies,
  repoRoot: string,
  worktreeSlug: string,
): Promise<string> {
  const worktreesRoot = await getKivotosWorktreesRoot(
    repoRoot,
    dependencies.kivotosHome,
    dependencies.kivotosWorktreesBaseRoot,
  );
  return join(worktreesRoot, worktreeSlug);
}
