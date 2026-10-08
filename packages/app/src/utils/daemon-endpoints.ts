import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl as buildSharedRelayWebSocketUrl,
  deriveLabelFromEndpoint,
  extractHostPortFromWebSocketUrl,
  normalizeHostPort,
  parseConnectionUri,
  parseRelayConnectionUri,
  serializeRelayConnectionUri,
  parseHostPort,
  serializeConnectionUri,
  serializeConnectionUriForStorage,
  shouldUseTlsForDefaultHostedRelay,
  type HostPortParts,
} from "@kivotos/protocol/daemon-endpoints";

export { decodeOfferFragmentPayload } from "@kivotos/protocol/connection-offer";

export type { HostPortParts };

export {
  buildDaemonWebSocketUrl,
  deriveLabelFromEndpoint,
  extractHostPortFromWebSocketUrl,
  normalizeHostPort,
  parseConnectionUri,
  parseRelayConnectionUri,
  serializeRelayConnectionUri,
  parseHostPort,
  serializeConnectionUri,
  serializeConnectionUriForStorage,
  shouldUseTlsForDefaultHostedRelay,
};

export function buildRelayWebSocketUrl(params: {
  endpoint: string;
  serverId: string;
  useTls: boolean;
}): string {
  return buildSharedRelayWebSocketUrl({ ...params, role: "client" });
}
