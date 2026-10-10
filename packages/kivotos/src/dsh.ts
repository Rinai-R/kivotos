/**
 * The slice of the dsh 0.2.0-rc.2 Host API that Kivotos uses.
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

/** Root Context events Kivotos listens to. */
export interface HostEvents {
  /** Post-commit append feed of every Session in the store. */
  "session/event": (session: Session, event: SessionEvent) => void;
  "session/disposed": (session: Session) => void;
}

/** `ctx.sessionProjections` (`@deepseek-ai/dsh-session-projection`), read for the `title` unit. */
export interface SessionProjections {
  /** @returns the unit's current state, or undefined when the key is not registered. */
  stateOf(session: Session, key: "title"): string | null | undefined;
}

/** Services read optionally, through `ctx.get`, so Kivotos does not require them. */
export interface OptionalServices {
  sessionProjections: SessionProjections;
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
}
