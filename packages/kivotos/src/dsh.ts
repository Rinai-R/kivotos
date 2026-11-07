/**
 * The slice of the dsh 0.2.2-rc.1 Host API that Kivotos uses.
 *
 * Declared locally, the way dsh's own open-in-app plugin types `connection`:
 * the real declarations live in packages whose type graphs pull in most of
 * dsh, and Kivotos calls only these members. Shapes follow
 * `@deepseek-ai/dsh-host-webserver` and `@deepseek-ai/dsh-client-connection`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

/** One named HTTP route on the dsh webServer. */
export interface WebRoute {
  kind: "exact" | "prefix";
  /** Absolute pathname, no trailing slash. */
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

/** One exact-path HTTP upgrade route on the dsh webServer. */
export interface WebUpgradeRoute {
  path: string;
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
}

/** `ctx.webServer`. */
export interface WebServer {
  /** Listening port; assigned once the server listens, so read it lazily. */
  readonly port: number;
  register(route: WebRoute): () => void;
  registerUpgrade(route: WebUpgradeRoute): () => void;
  tapIndex(transform: (html: string) => string): () => void;
}

/** `ctx.connection` on the Host. */
export interface HostConnection {
  /** 403 for an untrusted Host/Origin, 401 when unauthenticated, otherwise undefined. */
  requestRejection(request: {
    readonly headers: IncomingMessage["headers"];
  }): 401 | 403 | undefined;
  /** `baseUrl` with the process login token attached. */
  authenticatedUrl(baseUrl: string): string;
}

/** `ctx.logger`. */
export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

/** A dsh Session as the `session/event` feed passes it (`@deepseek-ai/dsh-session`). */
export interface Session {
  readonly id: string;
}

/** One appended Session event (`SessionEvent` in `@deepseek-ai/dsh-session`). */
export interface SessionEvent {
  type: string;
  seq: number;
  /** Unix epoch milliseconds. */
  time: number;
  data: unknown;
}

/** An approval outcome dsh's `approval/request` answerers return (`@deepseek-ai/dsh-user-approval`). */
export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";

/** One `approval/request` as the answerer chain passes it. */
export interface ApprovalRequest {
  readonly id: string;
  readonly toolName: string;
  readonly callId?: string;
  readonly reason?: string;
  /** Withdrawn by the asker: the request settles `cancelled` at once. */
  readonly signal?: AbortSignal;
}

/** Root Context events Kivotos listens to. */
export interface HostEvents {
  /** Waterfall of answerers; the last one decides an approval the UI did not. */
  "approval/request": (
    request: ApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ) => Promise<ApprovalOutcome>;
  /** Post-commit append feed of every Session in the store. */
  "session/event": (session: Session, event: SessionEvent) => void;
  "session/disposed": (session: Session) => void;
}

/**
 * `ctx.sessionTitle` (`@deepseek-ai/dsh-session-title`), read for a Session's
 * current title. Kivotos reads the title service rather than the deprecated
 * `sessionProjections.stateOf(session, "title")`, which dsh 0.2.2 warns on.
 */
export interface SessionTitles {
  /** @returns the latest accepted title, or undefined before any is accepted. */
  get(session: Session): { readonly title: string } | undefined;
}

/** `ctx.agents` (`@deepseek-ai/dsh-agent`), read for what a restart would interrupt. */
export interface Agents {
  list(): readonly {
    readonly id: string;
    readonly status: string;
    readonly session?: Session;
    readonly inbox?: {
      readonly nextTurn?: readonly unknown[];
      readonly nextStep?: readonly unknown[];
    };
  }[];
}

/** `ctx.jobs` (`@deepseek-ai/dsh-jobs`). */
export interface Jobs {
  list(caller?: string): readonly {
    readonly id: string;
    readonly label?: string;
    readonly owner?: string;
    readonly status: string;
  }[];
}

/** `ctx.profileContext`, provided by dsh's profile boot. */
export interface ProfileContext {
  readonly name: string;
  readonly dir: string;
}

/** `ctx.commands` (`@deepseek-ai/dsh-commands`): slash commands. */
export interface Commands {
  register(definition: {
    name: string;
    description: string;
    input?: { hint: string };
    recordInput?: boolean;
    handler: (invocation: {
      rawInput: string;
    }) =>
      | { kind: "success"; text?: string }
      | { kind: "error"; text: string }
      | Promise<{ kind: "success"; text?: string } | { kind: "error"; text: string }>;
  }): () => void;
}

/** Services read optionally, through `ctx.get`, so Kivotos does not require them. */
export interface OptionalServices {
  sessionTitle: SessionTitles;
  agents: Agents;
  jobs: Jobs;
  profileContext: ProfileContext;
  commands: Commands;
}

/** The plugin Context with the services Kivotos injects. */
export interface HostContext {
  readonly webServer: WebServer;
  readonly connection: HostConnection;
  readonly logger: Logger;
  effect(factory: () => () => void | Promise<void>, label?: string): void;
  /** @returns the service when it is currently provided. */
  get<K extends keyof OptionalServices>(name: K): OptionalServices[K] | undefined;
  /** @returns the listener's disposer. */
  on<K extends keyof HostEvents>(event: K, listener: HostEvents[K]): () => void;
  /** cordis `waterfall`, read for `workspace/session-activity`. */
  waterfall?(name: string, ...args: unknown[]): unknown;
  /** cordis `inject`: run `callback` in a child context while the services are provided. */
  inject?(deps: string[], callback: (ctx: HostContext) => void): unknown;
}
