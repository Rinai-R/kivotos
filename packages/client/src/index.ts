import type { OwnedSubscription } from "./connection/index.js";
export type { OwnedSubscription, SubscriptionObserver } from "./connection/index.js";
import type { DaemonClientConfig } from "./daemon-client.js";
import type { AgentPermissionResponse } from "@kivotos/protocol/agent-types";
import type {
  AgentSnapshotPayload,
  CreationSnapshot,
  CreateAgentRequestMessage,
  FetchWorkspacesRequestMessage,
  FetchWorkspacesResponseMessage,
  GetProvidersSnapshotResponseMessage,
  ListAvailableProvidersResponse,
  ListCommandsResponse,
  ListProviderFeaturesRequestMessage,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ProjectListRequestMessage,
  ProjectListResponseMessage,
  ListProviderModesResponseMessage,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  ProviderDiagnosticResponseMessage,
  ProviderUsageListResponseMessage,
  ProjectPlacementPayload,
  WorkspaceProjectDescriptorPayload,
  RefreshProvidersSnapshotResponseMessage,
  SessionOutboundMessage,
  WorkspaceDescriptorPayload,
  WorkspaceCreateRequest,
} from "@kivotos/protocol/messages";
import { DaemonClient, type CreateAgentRequestOptions } from "./daemon-client.js";
import {
  createTerminalActions,
  type KivotosTerminalActions,
  type KivotosWorkspaceTerminalActions,
} from "./terminals/index.js";
export type {
  KivotosTerminal,
  KivotosTerminalActions,
  KivotosTerminalHandle,
  KivotosTerminalCreateOptions,
  KivotosTerminalListOptions,
  KivotosTerminalListResult,
  KivotosTerminalCaptureOptions,
  KivotosTerminalCaptureResult,
  KivotosWorkspaceTerminalActions,
} from "./terminals/index.js";
import type { PluginTimelineItem } from "@kivotos/protocol/agent-types";
import type {
  FetchAgentsEntry,
  FetchAgentsOptions,
  FetchAgentsPageInfo,
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
  SendMessageOptions,
  WaitForFinishResult,
} from "./daemon-client.js";

/**
 * Coding turns routinely run for minutes, so the handle waits far longer than
 * the transport's own conservative default.
 */
const DEFAULT_WAIT_FOR_FINISH_MS = 10 * 60_000;

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export interface KivotosLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface KivotosClientConfig {
  capabilities?: DaemonClientConfig["capabilities"];
  url: string;
  clientId?: string;
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  logger?: KivotosLogger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
}

export type KivotosWorkspace = WorkspaceDescriptorPayload;
export type KivotosAgent = AgentSnapshotPayload;
export type KivotosAgentListOptions = FetchAgentsOptions;
export type KivotosProject = WorkspaceProjectDescriptorPayload;
export type KivotosProjectListOptions = Omit<ProjectListRequestMessage, "type" | "requestId"> & {
  requestId?: string;
};
export type KivotosProjectListResult = ProjectListResponseMessage["payload"];
export type KivotosProjectUpdate = Extract<
  SessionOutboundMessage,
  { type: "project.update" }
>["payload"];
export type KivotosProjectUpdateHandler = (update: KivotosProjectUpdate) => void;

export interface KivotosAgentListResult {
  subscription?: OwnedSubscription<KivotosAgentListResult>;
  requestId: string;
  subscriptionId?: string | null;
  entries: FetchAgentsEntry[];
  pageInfo: FetchAgentsPageInfo;
}
export type KivotosWorkspaceListOptions = Omit<
  FetchWorkspacesRequestMessage,
  "type" | "requestId"
> & {
  requestId?: string;
};

export interface KivotosWorkspaceListResult {
  subscription?: OwnedSubscription<KivotosWorkspaceListResult>;
  requestId: string;
  subscriptionId?: string | null;
  entries: KivotosWorkspace[];
  pageInfo: FetchWorkspacesResponseMessage["payload"]["pageInfo"];
}

export interface KivotosWorkspaceOpenOptions {
  cwd: string;
  requestId?: string;
}

export type KivotosWorkspaceCreateOptions = Omit<
  WorkspaceCreateRequest,
  "type" | "requestId" | "agent" | "subscribe"
> & {
  requestId?: string;
  agent?: Omit<
    KivotosAgentCreateOptions,
    "worktree" | "git" | "onEvent" | "idempotencyKey" | "requestId"
  >;
  onEvent?: (snapshot: CreationSnapshot) => void;
};

export interface KivotosWorkspaceArchiveResult {
  requestId: string;
  workspaceId: string;
  archivedAt: string | null;
  error: string | null;
}

export type KivotosWorkspaceUpdate = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export type KivotosWorkspaceUpdateHandler = (update: KivotosWorkspaceUpdate) => void;

export interface KivotosWorkspaceHandle {
  readonly id: string;
  readonly projectId: string | null;
  readonly directory: string | null;
  readonly name: string | null;
  readonly status: KivotosWorkspace["status"] | null;
  readonly agents: {
    create(options: KivotosWorkspaceAgentCreateOptions): Promise<KivotosAgentHandle>;
  };
  readonly terminals: KivotosWorkspaceTerminalActions;
  current(): KivotosWorkspace | null;
  refresh(options?: { requestId?: string }): Promise<KivotosWorkspace | null>;
  setTitle(title: string | null, requestId?: string): Promise<{ title: string | null }>;
  archive(requestId?: string): Promise<KivotosWorkspaceArchiveResult>;
  /**
   * Subscribes to already-emitted daemon workspace_update events for this id.
   * This returns a local unsubscribe function; it does not own app cache state or
   * send a daemon unsubscribe RPC. Call `workspaces.list({ subscribe: {} })` when
   * the daemon should start streaming workspace directory updates.
   */
  subscribe(handler: (update: KivotosWorkspaceUpdate) => void): () => void;
}

export interface KivotosProjectActions {
  list(options?: KivotosProjectListOptions): Promise<KivotosProjectListResult>;
  subscribe(handler: KivotosProjectUpdateHandler): () => void;
}

export interface KivotosWorkspaceActions {
  list(options: KivotosWorkspaceListOptions & { subscribe: {} }): Promise<
    KivotosWorkspaceListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<KivotosWorkspaceListResult>;
    }
  >;
  list(options?: KivotosWorkspaceListOptions): Promise<KivotosWorkspaceListResult>;
  ref(workspace: string | KivotosWorkspace): KivotosWorkspaceHandle;
  open(
    input: string | KivotosWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<KivotosWorkspaceHandle>;
  create(options: KivotosWorkspaceCreateOptions): Promise<KivotosWorkspaceHandle>;
  archive(
    workspace: string | KivotosWorkspaceHandle,
    requestId?: string,
  ): Promise<KivotosWorkspaceArchiveResult>;
  /**
   * Local event subscription over the low-level driver's workspace_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: KivotosWorkspaceUpdateHandler): () => void;
}

type KivotosAgentSessionConfig = CreateAgentRequestMessage["config"];
export type KivotosAgentProvider = KivotosAgentSessionConfig["provider"];

export type KivotosProviderFeatureValues = Record<string, unknown>;

export interface KivotosAgentConfig {
  /** Provider and model in `provider/model` format. */
  provider: string;
  modeId?: KivotosAgentSessionConfig["modeId"];
  thinkingOptionId?: KivotosAgentSessionConfig["thinkingOptionId"];
  featureValues?: KivotosProviderFeatureValues;
  /** JSON-safe provider-native settings, validated by the selected provider. */
  options?: KivotosAgentSessionConfig["providerOptions"];
  systemPrompt?: KivotosAgentSessionConfig["systemPrompt"];
  toolPolicy?: KivotosAgentSessionConfig["toolPolicy"];
  mcpServers?: KivotosAgentSessionConfig["mcpServers"];
}

export interface KivotosAgentCreateOptions {
  idempotencyKey?: string;
  agentId?: string;
  onEvent?: (snapshot: CreationSnapshot) => void;
  config: KivotosAgentConfig;
  cwd: string;
  parent?: string | KivotosAgentHandle;
  title?: KivotosAgentSessionConfig["title"];
  env?: CreateAgentRequestMessage["env"];
  prompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktree?: CreateAgentRequestMessage["worktree"];
  autoArchive?: CreateAgentRequestMessage["autoArchive"];
  requestId?: string;
  labels?: Record<string, string>;
}

export type KivotosWorkspaceAgentCreateOptions = Omit<KivotosAgentCreateOptions, "cwd">;

export interface KivotosAgentRefetchResult {
  agent: KivotosAgent;
  project: ProjectPlacementPayload | null;
}

export interface KivotosAgentTimelineRefetchOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
}

export type KivotosAgentSendOptions = SendMessageOptions;

export interface KivotosAgentRunOptions extends KivotosAgentSendOptions {
  timeoutMs?: number;
}

export type KivotosAgentRunResult = WaitForFinishResult;
export type KivotosAgentPermissionResponse = AgentPermissionResponse;

export interface KivotosAgentRespondToPermissionOptions {
  requestId: string;
  response: KivotosAgentPermissionResponse;
}

export interface KivotosAgentCommandsOptions {
  requestId?: string;
}

export type KivotosAgentCommandsResult = ListCommandsResponse["payload"];

export type KivotosAgentUpdate = Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];

export type KivotosAgentStream = Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"];

export type KivotosAgentUpdateHandler = (update: KivotosAgentUpdate) => void;

export type KivotosAgentTimelineEvent =
  | KivotosAgentStream
  | {
      agentId: string;
      event: { type: "replacement"; epoch: string };
    }
  | {
      agentId: string;
      subscriptionId: string;
      event: { type: "subscription_restored" };
    }
  | { agentId: string; event: { type: "error"; error: string } };

export type KivotosAgentTimelineSubscription = ReturnType<DaemonClient["subscribeAgentTimeline"]>;

export interface KivotosAgentTimelineHandle {
  append(item: Omit<PluginTimelineItem, "pluginId">): Promise<{ seq: number; epoch: string }>;
  /**
   * Fetches a fresh timeline page through the existing daemon RPC. If the daemon
   * includes an agent snapshot in the response, the parent handle is updated to
   * that value.
   */
  refetch(options?: KivotosAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Delivers live events only. After reconnect, subscription_restored precedes
   * subsequent updates. History may have been missed; use refetch() to request
   * the range you need. No history is fetched automatically. A replacement event
   * invalidates the previous epoch. Subscription errors release this observation.
   * Await the returned unsubscribe function's `ready` promise before starting
   * work that must be observed. It rejects if establishment fails.
   */
  subscribe(handler: (event: KivotosAgentTimelineEvent) => void): KivotosAgentTimelineSubscription;
}

export interface KivotosAgentHandle {
  readonly id: string;
  /**
   * `workspaceId` through `archivedAt` mirror the last snapshot this handle
   * observed. A handle from `ref()` reads `null` for all of them until
   * `refresh()`, `run()`, `waitForFinish()`, a timeline refetch, or
   * `subscribe()` delivers a snapshot. Optional snapshot values also read as
   * `null`; use `current()` when you need to distinguish those states.
   */
  readonly workspaceId: string | null;
  readonly cwd: string | null;
  readonly status: KivotosAgent["status"] | null;
  readonly capabilities: KivotosAgent["capabilities"] | null;
  readonly availableModes: KivotosAgent["availableModes"] | null;
  readonly pendingPermissions: KivotosAgent["pendingPermissions"] | null;
  readonly activeTurn: NonNullable<KivotosAgent["activeTurn"]> | null;
  readonly lastUsage: NonNullable<KivotosAgent["lastUsage"]> | null;
  readonly lastError: NonNullable<KivotosAgent["lastError"]> | null;
  readonly features: NonNullable<KivotosAgent["features"]> | null;
  readonly runtimeInfo: NonNullable<KivotosAgent["runtimeInfo"]> | null;
  readonly archivedAt: NonNullable<KivotosAgent["archivedAt"]> | null;
  readonly timeline: KivotosAgentTimelineHandle;
  current(): KivotosAgent | null;
  refresh(requestId?: string): Promise<KivotosAgentRefetchResult | null>;
  send(text: string, options?: KivotosAgentSendOptions): Promise<void>;
  respondToPermission(options: KivotosAgentRespondToPermissionOptions): Promise<void>;
  /** Sends a prompt and resolves when that turn finishes or needs attention. */
  run(text: string, options?: KivotosAgentRunOptions): Promise<KivotosAgentRunResult>;
  /** Waits for the current turn, including one started with `prompt`. */
  waitForFinish(timeoutMs?: number): Promise<KivotosAgentRunResult>;
  /**
   * Asks the running session for the slash commands and skills it actually
   * loaded. Providers answer from the live session, so this sees built-in and
   * bundled entries that no directory scan can find. The payload carries its own
   * `error` string; a provider that cannot answer reports it there rather than
   * rejecting.
   */
  commands(options?: KivotosAgentCommandsOptions): Promise<KivotosAgentCommandsResult>;
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
  subscribe(handler: (update: KivotosAgentUpdate) => void): () => void;
}

export interface KivotosAgentActions {
  list(options: KivotosAgentListOptions & { subscribe: {} }): Promise<
    KivotosAgentListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<KivotosAgentListResult>;
    }
  >;
  list(options?: KivotosAgentListOptions): Promise<KivotosAgentListResult>;
  ref(agent: string | KivotosAgent): KivotosAgentHandle;
  create(options: KivotosAgentCreateOptions): Promise<KivotosAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: KivotosAgentUpdateHandler): () => void;
}

export type KivotosProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type KivotosProviderModesResult = ListProviderModesResponseMessage["payload"];
type KivotosProviderFeaturesDraft = ListProviderFeaturesRequestMessage["draftConfig"];
export interface KivotosProviderFeaturesInput extends Omit<
  KivotosProviderFeaturesDraft,
  "provider" | "model"
> {
  /** Provider and model in `provider/model` format. */
  provider: string;
}
export type KivotosProviderFeaturesResult = ListProviderFeaturesResponseMessage["payload"];
export type KivotosProviderAvailabilityResult = ListAvailableProvidersResponse["payload"];
export type KivotosProviderSnapshotResult = GetProvidersSnapshotResponseMessage["payload"];
export type KivotosProviderSnapshotUpdate = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>["payload"];
export type KivotosProviderRefreshResult = RefreshProvidersSnapshotResponseMessage["payload"];
export type KivotosProviderDiagnosticResult = ProviderDiagnosticResponseMessage["payload"];
export type KivotosProviderUsageResult = ProviderUsageListResponseMessage["payload"];
export interface KivotosProviderUsageOptions {
  requestId?: string;
}

export interface KivotosProviderListOptions {
  cwd?: string;
  requestId?: string;
}

export interface KivotosProviderRefreshOptions {
  cwd?: string;
  providers?: KivotosAgentProvider[];
  requestId?: string;
}

export interface KivotosProviderWaitOptions extends KivotosProviderListOptions {
  timeoutMs?: number;
}

export interface KivotosProviderActions {
  listModels(
    provider: KivotosAgentProvider,
    options?: KivotosProviderListOptions,
  ): Promise<KivotosProviderModelsResult>;
  listModes(
    provider: KivotosAgentProvider,
    options?: KivotosProviderListOptions,
  ): Promise<KivotosProviderModesResult>;
  listFeatures(
    draftConfig: KivotosProviderFeaturesInput,
    options?: { requestId?: string },
  ): Promise<KivotosProviderFeaturesResult>;
  listAvailable(options?: { requestId?: string }): Promise<KivotosProviderAvailabilityResult>;
  snapshot(options?: KivotosProviderListOptions): Promise<KivotosProviderSnapshotResult>;
  /** Resolves after the daemon's lazy provider discovery has finished. */
  waitForReady(options?: KivotosProviderWaitOptions): Promise<KivotosProviderSnapshotResult>;
  refresh(options?: KivotosProviderRefreshOptions): Promise<KivotosProviderRefreshResult>;
  diagnostic(
    provider: KivotosAgentProvider,
    options?: { requestId?: string },
  ): Promise<KivotosProviderDiagnosticResult>;
  listUsage(options?: KivotosProviderUsageOptions): Promise<KivotosProviderUsageResult>;
  subscribe(handler: (update: KivotosProviderSnapshotUpdate) => void): () => void;
}

export interface KivotosConfigActions {
  /**
   * Reads daemon config through the existing config RPC. Provider profiles,
   * custom provider entries, keys/env, custom binaries, and provider enablement
   * are currently config-file-shaped daemon state, so the SDK exposes this raw
   * typed surface instead of pretending there are higher-level provider-settings
   * RPCs.
   */
  get(requestId?: string): Promise<{ requestId: string; config: MutableDaemonConfig }>;
  /**
   * Patches daemon config through the existing config RPC. The daemon validates
   * and persists supported fields; unsupported provider/settings workflows remain
   * daemon gaps until first-class RPCs exist.
   */
  patch(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }>;
}

export interface KivotosApi {
  dispose(): Promise<void>;
  observeEvents: DaemonClient["observeEvents"];
  readonly terminals: KivotosTerminalActions;
  readonly workspaces: KivotosWorkspaceActions;
  readonly projects: KivotosProjectActions;
  readonly agents: KivotosAgentActions;
  readonly providers: KivotosProviderActions;
  readonly config: KivotosConfigActions;
}

export interface KivotosClient extends KivotosApi {
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureConnected(): void;
  getConnectionState(): ConnectionState;
}

export function createKivotosClient(config: KivotosClientConfig): KivotosClient {
  const daemonClient = new DaemonClient({
    ...config,
    clientId: config.clientId ?? createGeneratedClientId(),
    clientType: "cli",
  });
  const api = createKivotosApi(daemonClient);
  return {
    ...api,
    connect: () => daemonClient.connect(),
    close: async () => {
      try {
        await api.dispose();
      } finally {
        await daemonClient.close();
      }
    },
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState(),
  };
}

function toDaemonAgentCreateOptions(
  options: KivotosAgentCreateOptions,
  placement?: { workspaceId: string; cwd: string },
): CreateAgentRequestOptions {
  const { config: agentConfig, cwd, parent, title, prompt, ...requestOptions } = options;
  const { provider: providerModel, options: providerOptions, ...runtimeConfig } = agentConfig;
  const { provider, model } = parseProviderModel(providerModel);
  return {
    ...requestOptions,
    config: {
      ...runtimeConfig,
      provider,
      model,
      cwd: placement?.cwd ?? cwd,
      ...(title !== undefined ? { title } : {}),
      ...(providerOptions !== undefined ? { providerOptions } : {}),
    },
    ...(placement ? { workspaceId: placement.workspaceId } : {}),
    ...(parent ? { callerAgentId: resolveAgentId(parent) } : {}),
    ...(prompt !== undefined ? { initialPrompt: prompt } : {}),
  };
}

export function createKivotosApi(
  daemonClient: DaemonClient,
  scopeOptions?: { signal?: AbortSignal },
): KivotosApi {
  const handles = new Set<{ release(): Promise<void> }>();
  const agentListeners = new Set<KivotosAgentUpdateHandler>();
  const workspaceListeners = new Set<KivotosWorkspaceUpdateHandler>();
  const lifetime = new AbortController();
  const own = <T extends { release(): Promise<void> }>(create: () => T): T => {
    if (lifetime.signal.aborted) throw new Error("Kivotos API is disposed");
    const handle = create();
    handles.add(handle);
    const release = handle.release.bind(handle);
    handle.release = async () => {
      await release();
      handles.delete(handle);
    };
    return handle;
  };
  const listenAgents = (handler: KivotosAgentUpdateHandler) => {
    if (lifetime.signal.aborted) throw new Error("Kivotos API is disposed");
    agentListeners.add(handler);
    return () => {
      agentListeners.delete(handler);
    };
  };
  const listenWorkspaces = (handler: KivotosWorkspaceUpdateHandler) => {
    if (lifetime.signal.aborted) throw new Error("Kivotos API is disposed");
    workspaceListeners.add(handler);
    return () => {
      workspaceListeners.delete(handler);
    };
  };
  const createAgentHandle = createAgentHandleFactory(
    daemonClient,
    listenAgents,
    (agentId, handler) => own(() => daemonClient.subscribeAgentTimeline(agentId, handler)),
  );
  const createAgent = async (
    options: KivotosAgentCreateOptions,
    placement?: { workspaceId: string; cwd: string },
  ) => {
    const agent = await daemonClient.createAgent(toDaemonAgentCreateOptions(options, placement));
    return createAgentHandle(agent);
  };
  const terminals = createTerminalActions(daemonClient, async (workspaceId) => {
    const workspace = await createWorkspaceHandle(workspaceId).refresh();
    if (!workspace?.workspaceDirectory) {
      throw new Error(`Workspace ${workspaceId} is not active or has no available directory`);
    }
    return workspace.workspaceDirectory;
  });
  const createWorkspaceHandle = createWorkspaceHandleFactory(
    daemonClient,
    createAgent,
    terminals,
    listenWorkspaces,
  );

  let disposal: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    lifetime.abort();
    scopeOptions?.signal?.removeEventListener("abort", abort);
    agentListeners.clear();
    workspaceListeners.clear();
    disposal = Promise.allSettled([...handles].map((handle) => handle.release())).then(
      (results) => {
        handles.clear();
        const failures = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (failures.length)
          throw new AggregateError(failures, "Failed to release API subscriptions");
        return undefined;
      },
    );
    return disposal;
  };
  const abort = () => {
    void dispose().catch((error) => console.error("API subscription cleanup failed", error));
  };
  if (scopeOptions?.signal?.aborted) abort();
  else scopeOptions?.signal?.addEventListener("abort", abort, { once: true });

  const observeEvents: DaemonClient["observeEvents"] = (events, options) =>
    own(() => daemonClient.observeEvents(events, options));

  const subscribeEvent = (
    event: "project.update" | "providers_snapshot_update",
    update: (message: SessionOutboundMessage) => void,
  ): (() => void) => {
    const observation = observeEvents([event]);
    observation.subscribe({ snapshot: () => {}, update });
    return () => {
      void observation
        .release()
        .catch((error) => console.error("Event subscription cleanup failed", error));
    };
  };

  function listWorkspaces(options: KivotosWorkspaceListOptions & { subscribe: {} }): Promise<
    KivotosWorkspaceListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<KivotosWorkspaceListResult>;
    }
  >;
  function listWorkspaces(options?: KivotosWorkspaceListOptions): Promise<KivotosWorkspaceListResult>;
  async function listWorkspaces(
    options?: KivotosWorkspaceListOptions,
  ): Promise<KivotosWorkspaceListResult> {
    if (!options?.subscribe) return daemonClient.fetchWorkspaces(options);
    if (options.subscribe.subscriptionId !== undefined)
      throw new Error("Subscription IDs are assigned by the host");
    const subscription = own(() => daemonClient.observeWorkspaces(options));
    subscription.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type === "workspace_update")
          for (const listener of workspaceListeners) listener(message.payload);
      },
    });
    return { ...(await subscription.ready), subscription };
  }

  function listAgents(options: KivotosAgentListOptions & { subscribe: {} }): Promise<
    KivotosAgentListResult & {
      subscriptionId: string;
      subscription: OwnedSubscription<KivotosAgentListResult>;
    }
  >;
  function listAgents(options?: KivotosAgentListOptions): Promise<KivotosAgentListResult>;
  async function listAgents(options?: KivotosAgentListOptions): Promise<KivotosAgentListResult> {
    if (!options?.subscribe) return daemonClient.fetchAgents(options);
    if (options.subscribe.subscriptionId !== undefined)
      throw new Error("Subscription IDs are assigned by the host");
    const subscription = own(() => daemonClient.observeAgents(options));
    subscription.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type === "agent_update")
          for (const listener of agentListeners) listener(message.payload);
      },
    });
    return { ...(await subscription.ready), subscription };
  }

  return {
    dispose,
    observeEvents,
    terminals,
    projects: {
      list: (options) => daemonClient.listProjects(options),
      subscribe: (handler) => {
        return subscribeEvent("project.update", (message) => {
          if (message.type === "project.update") handler(message.payload);
        });
      },
    },
    workspaces: {
      list: listWorkspaces,
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: async ({ requestId, agent, ...options }) => {
        const result = await daemonClient.createWorkspace(
          { ...options, ...(agent ? { agent: toDaemonAgentCreateOptions(agent) } : {}) },
          requestId,
        );
        if (result.error || !result.workspace) {
          throw new Error(result.error ?? "The daemon did not create a workspace");
        }
        return createWorkspaceHandle(result.workspace);
      },
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: listenWorkspaces,
    },
    agents: {
      list: listAgents,
      ref: (agent) => createAgentHandle(agent),
      create: (options) => createAgent(options),
      subscribe: listenAgents,
    },
    providers: {
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: ({ provider: providerModel, ...draftConfig }, options) => {
        const { provider, model } = parseProviderModel(providerModel);
        return daemonClient.listProviderFeatures({ ...draftConfig, provider, model }, options);
      },
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      waitForReady: (options) =>
        waitForProvidersReady(
          daemonClient,
          observeEvents(["providers_snapshot_update"]),
          lifetime.signal,
          options,
        ),
      refresh: (options) => daemonClient.refreshProvidersSnapshot(options),
      diagnostic: (provider, options) => daemonClient.getProviderDiagnostic(provider, options),
      listUsage: (options) => listProviderUsage(daemonClient, options),
      subscribe: (handler) => {
        return subscribeEvent("providers_snapshot_update", (message) => {
          if (message.type === "providers_snapshot_update") handler(message.payload);
        });
      },
    },
    config: {
      get: (requestId) => daemonClient.getDaemonConfig(requestId),
      patch: (patch, requestId) => daemonClient.patchDaemonConfig(patch, requestId),
    },
  };
}

type WorkspaceHandleFactory = (workspace: string | KivotosWorkspace) => KivotosWorkspaceHandle;
type AgentHandleFactory = (agent: string | KivotosAgent) => KivotosAgentHandle;
type CreateAgent = (
  options: KivotosAgentCreateOptions,
  placement?: { workspaceId: string; cwd: string },
) => Promise<KivotosAgentHandle>;

function createWorkspaceHandleFactory(
  daemonClient: DaemonClient,
  createAgent: CreateAgent,
  terminals: KivotosTerminalActions,
  listen: (handler: KivotosWorkspaceUpdateHandler) => () => void,
): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let current = typeof workspace === "string" ? null : workspace;

    const refresh = async (options?: { requestId?: string }) => {
      let cursor: string | undefined;
      let requestId = options?.requestId;
      do {
        const result = await daemonClient.fetchWorkspaces({
          requestId,
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        });
        const match = result.entries.find((entry) => entry.id === id);
        if (match) {
          current = match;
          return current;
        }
        cursor = result.pageInfo.nextCursor ?? undefined;
        requestId = undefined;
      } while (cursor);
      current = null;
      return current;
    };

    return {
      id,
      get projectId() {
        return current?.projectId ?? null;
      },
      get directory() {
        return current?.workspaceDirectory ?? null;
      },
      get name() {
        return current?.name ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      agents: {
        create: async (options) => {
          const snapshot = current ?? (await refresh());
          if (!snapshot?.workspaceDirectory) {
            throw new Error(`Workspace ${id} has no available directory`);
          }
          return createAgent(
            { ...options, cwd: snapshot.workspaceDirectory },
            { workspaceId: id, cwd: snapshot.workspaceDirectory },
          );
        },
      },
      terminals: {
        create: (options) => terminals.create({ ...options, workspaceId: id }),
        list: (options) => terminals.list({ ...options, workspaceId: id }),
      },
      current: () => current,
      refresh,
      setTitle: (title, requestId) => daemonClient.setWorkspaceTitle(id, title, requestId),
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (current) {
          current = { ...current, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        listen((update) => {
          if (update.kind === "upsert" && update.workspace.id === id) {
            current = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(
  daemonClient: DaemonClient,
  listen: (handler: KivotosAgentUpdateHandler) => () => void,
  subscribeTimeline: DaemonClient["subscribeAgentTimeline"],
): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let current = typeof agent === "string" ? null : agent;

    const handle: KivotosAgentHandle = {
      id,
      timeline: {
        append: (item) => daemonClient.appendAgentTimelineItem(id, item),
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            current = result.agent;
          }
          return result;
        },
        subscribe: (handler) =>
          subscribeTimeline(id, (message) => {
            switch (message.type) {
              case "agent_stream":
                return handler(message.payload);
              case "agent.timeline.subscription_restored":
                return handler({
                  agentId: id,
                  subscriptionId: message.payload.subscriptionId,
                  event: { type: "subscription_restored" },
                });
              case "agent.timeline.error":
                return handler({
                  agentId: id,
                  event: { type: "error", error: message.payload.error },
                });
              case "agent.timeline.replacement":
                return handler({
                  agentId: id,
                  event: { type: "replacement", epoch: message.payload.epoch },
                });
            }
          }),
      },
      get workspaceId() {
        return current?.workspaceId ?? null;
      },
      get cwd() {
        return current?.cwd ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      get capabilities() {
        return current?.capabilities ?? null;
      },
      get availableModes() {
        return current?.availableModes ?? null;
      },
      get pendingPermissions() {
        return current?.pendingPermissions ?? null;
      },
      get activeTurn() {
        return current?.activeTurn ?? null;
      },
      get lastUsage() {
        return current?.lastUsage ?? null;
      },
      get lastError() {
        return current?.lastError ?? null;
      },
      get features() {
        return current?.features ?? null;
      },
      get runtimeInfo() {
        return current?.runtimeInfo ?? null;
      },
      get archivedAt() {
        return current?.archivedAt ?? null;
      },
      current: () => current,
      refresh: async (requestId) => {
        const result = await daemonClient.fetchAgent({ agentId: id, requestId });
        current = result?.agent ?? null;
        return result;
      },
      send: async (text, options) => {
        await daemonClient.sendAgentMessage(id, text, options);
      },
      respondToPermission: async ({ requestId, response }) => {
        await daemonClient.respondToPermission(id, requestId, response);
      },
      run: async (text, options) => {
        const { timeoutMs, ...sendOptions } = options ?? {};
        await daemonClient.sendAgentMessage(id, text, sendOptions);
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      waitForFinish: async (timeoutMs) => {
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      commands: (options) => daemonClient.listCommands({ agentId: id, ...options }),
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (current) {
          current = { ...current, archivedAt: result.archivedAt };
        }
        return result;
      },
      detach: async () => {
        await daemonClient.detachAgent(id);
      },
      subscribe: (handler) =>
        listen((update) => {
          if (update.kind === "upsert" && update.agent.id === id) {
            current = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            handler(update);
          }
        }),
    };

    return handle;
  };
}

async function openWorkspace(
  daemonClient: DaemonClient,
  createWorkspaceHandle: WorkspaceHandleFactory,
  input: string | KivotosWorkspaceOpenOptions,
  requestId?: string,
): Promise<KivotosWorkspaceHandle> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  if (result.error || !result.workspace) {
    throw new Error(result.error ?? `The daemon did not open a workspace for ${options.cwd}`);
  }
  return createWorkspaceHandle(result.workspace);
}

function resolveWorkspaceId(workspace: string | KivotosWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function resolveAgentId(agent: string | KivotosAgentHandle): string {
  return typeof agent === "string" ? agent : agent.id;
}

function parseProviderModel(selection: string): { provider: string; model: string } {
  const separator = selection.indexOf("/");
  if (separator <= 0 || separator === selection.length - 1) {
    throw new Error('Expected config.provider in "provider/model" format');
  }
  return {
    provider: selection.slice(0, separator),
    model: selection.slice(separator + 1),
  };
}

function listProviderUsage(
  daemonClient: DaemonClient,
  options?: KivotosProviderUsageOptions,
): Promise<KivotosProviderUsageResult> {
  // COMPAT(providerUsageList): added in v0.1.98, remove after 2027-02-28 once daemon floor >= v0.1.98.
  if (daemonClient.getLastServerInfoMessage()?.features?.providerUsageList !== true) {
    return Promise.reject(new Error("Update the host to list provider usage."));
  }
  return daemonClient.listProviderUsage(options);
}

async function waitForProvidersReady(
  daemonClient: DaemonClient,
  observation: ReturnType<DaemonClient["observeEvents"]>,
  signal: AbortSignal,
  options: KivotosProviderWaitOptions = {},
): Promise<KivotosProviderSnapshotResult> {
  const { timeoutMs = 60_000, ...snapshotOptions } = options;

  try {
    await observation.ready;
    signal.throwIfAborted();
    return await new Promise<KivotosProviderSnapshotResult>((resolve, reject) => {
      let settled = false;
      let requestId: string | null = null;
      let snapshotCwd: string | undefined;
      const pendingUpdates = new Map<string | undefined, KivotosProviderSnapshotUpdate>();
      let latestEntries: KivotosProviderSnapshotResult["entries"] = [];

      const cleanup = () => {
        clearTimeout(timeout);
        unsubscribe();
        signal.removeEventListener("abort", abort);
      };
      const finish = (snapshot: KivotosProviderSnapshotResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(snapshot);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const updateMatches = (update: KivotosProviderSnapshotUpdate) => update.cwd === snapshotCwd;

      const unsubscribe = observation.subscribe({
        snapshot: () => {},
        update: (message) => {
          if (message.type !== "providers_snapshot_update") return;
          const update = message.payload;
          if (!requestId) {
            pendingUpdates.set(update.cwd, update);
            return;
          }
          if (!updateMatches(update)) return;
          latestEntries = update.entries;
          if (update.entries.some((entry) => entry.status === "loading")) return;
          finish({ ...update, requestId });
        },
      });
      const abort = () => fail(new Error("Kivotos API is disposed"));
      signal.addEventListener("abort", abort, { once: true });

      const timeout = setTimeout(() => {
        const loading = latestEntries
          .filter((entry) => entry.status === "loading")
          .map((entry) => entry.provider)
          .join(", ");
        fail(
          new Error(
            loading
              ? `Timed out waiting for providers: ${loading}`
              : "Timed out waiting for provider discovery",
          ),
        );
      }, timeoutMs);

      void daemonClient
        .getProvidersSnapshot(snapshotOptions)
        .then((snapshot) => {
          requestId = snapshot.requestId;
          snapshotCwd = snapshot.cwd;
          latestEntries = snapshot.entries;
          if (!snapshot.entries.some((entry) => entry.status === "loading")) {
            finish(snapshot);
            return;
          }
          const pendingUpdate = pendingUpdates.get(snapshotCwd);
          if (pendingUpdate && !pendingUpdate.entries.some((entry) => entry.status === "loading")) {
            finish({ ...pendingUpdate, requestId });
          }
          return undefined;
        })
        .catch(fail);
    });
  } finally {
    await observation.release();
  }
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `kivotos-sdk-${randomId}`;
}
