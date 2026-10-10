/**
 * A relay federation as its members know it: the values derived from the
 * shared secret, the invite that carries the secret, and the proof members
 * give each other. Pure functions; the relay's side of this contract is
 * packages/relay/wire/wire.go.
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const INVITE_SCHEME = "kivotos:";
const INVITE_HOST = "join";
const SECRET_BYTES = 32;
/** Domain separation for the proof members exchange inside their TLS session. */
const PROOF_CONTEXT = "kivotos-peer-v1";
export const PROOF_BYTES = 32;

/** What a member derives from the federation secret. */
export interface Network {
  /** Relay WebSocket endpoint, e.g. `wss://relay.example.com/v1/connect`. */
  relay: string;
  /** The shared secret itself, base64url. Never sent to the relay. */
  secret: string;
  /** Public name of the network on the relay. */
  id: string;
  /** Shown to the relay in every hello; says "may use this relay", nothing more. */
  token: string;
  /** Members prove this to each other; the relay never sees it. */
  proofKey: Buffer;
}

function derive(secret: Buffer, info: string, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), info, length));
}

/**
 * Normalize what a person types as the relay address into its WebSocket endpoint.
 * `1.2.3.4:7443` is plain `ws://`; an `https://` or `wss://` address is TLS.
 * @returns the endpoint URL.
 */
export function relayEndpoint(input: string): string {
  const text = input.trim();
  if (text === "") throw new Error("relay address is empty");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `ws://${text}`;
  const url = new URL(withScheme);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("relay address must be a host, or an http(s) or ws(s) URL");
  }
  if (url.hostname === "") throw new Error("relay address has no host");
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/v1/connect";
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

/**
 * @param relay - relay address as typed or stored.
 * @param secret - federation secret, base64url; a fresh one when omitted.
 * @returns the network a member of that federation sees.
 */
export function networkOf(relay: string, secret?: string): Network {
  const raw = secret === undefined ? randomBytes(SECRET_BYTES) : Buffer.from(secret, "base64url");
  if (raw.length !== SECRET_BYTES) throw new Error("federation key is malformed");
  return {
    relay: relayEndpoint(relay),
    secret: raw.toString("base64url"),
    id: derive(raw, "kivotos network id", 16).toString("base64url"),
    token: derive(raw, "kivotos relay token", 32).toString("base64url"),
    proofKey: derive(raw, "kivotos peer proof", 32),
  };
}

/** @returns the invite link that lets another device join this network. */
export function inviteOf(network: Network): string {
  const query = new URLSearchParams({ relay: network.relay, key: network.secret });
  return `${INVITE_SCHEME}//${INVITE_HOST}?${query.toString()}`;
}

/**
 * @param invite - an invite link as shown by a member.
 * @returns the network it describes.
 */
export function parseInvite(invite: string): Network {
  let url: URL;
  try {
    url = new URL(invite.trim());
  } catch {
    throw new Error("this is not a Kivotos invite link");
  }
  const relay = url.searchParams.get("relay");
  const key = url.searchParams.get("key");
  if (
    url.protocol !== INVITE_SCHEME ||
    url.host !== INVITE_HOST ||
    relay === null ||
    key === null
  ) {
    throw new Error("this is not a Kivotos invite link");
  }
  return networkOf(relay, key);
}

/** @returns what the relay operator registers once: `<network id>.<relay token>`. */
export function registrationOf(network: Network): string {
  return `${network.id}.${network.token}`;
}

/** @returns a member's node id: the SHA-256 of its certificate, base64url. */
export function nodeIdOf(certDer: Uint8Array): string {
  return createHash("sha256").update(certDer).digest("base64url");
}

/**
 * The proof one side of a member-to-member TLS session gives the other. It
 * binds the federation key to both certificates of this session, so a relay
 * that sits in the middle with its own certificates cannot pass it on.
 * @param role - which side is proving.
 * @param serverNode - node id of the certificate the accepting side presented.
 * @param clientNode - node id of the certificate the dialing side presented.
 * @returns PROOF_BYTES bytes.
 */
export function proofOf(
  proofKey: Buffer,
  role: "client" | "server",
  serverNode: string,
  clientNode: string,
): Buffer {
  return createHmac("sha256", proofKey)
    .update(`${PROOF_CONTEXT}\n${role}\n${serverNode}\n${clientNode}`)
    .digest();
}

/** Constant-time proof check. */
export function proofMatches(given: Buffer, expected: Buffer): boolean {
  return given.length === expected.length && timingSafeEqual(given, expected);
}
