/**
 * The slice of the dsh 0.2.1-alpha.1 Host API that Kivotos uses.
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

/** The plugin Context with the services Kivotos injects. */
export interface HostContext {
  readonly webServer: WebServer;
  readonly connection: HostConnection;
  readonly logger: Logger;
  effect(factory: () => () => void | Promise<void>, label?: string): void;
}
