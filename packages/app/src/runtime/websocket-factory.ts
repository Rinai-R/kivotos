import { nativeWebSocketFactory } from "@kivotos/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@kivotos/client/internal/daemon-client-transport-types";

export function createAppWebSocketFactory(): WebSocketFactory {
  return nativeWebSocketFactory;
}
