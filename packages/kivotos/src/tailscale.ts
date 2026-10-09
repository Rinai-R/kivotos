/** Thin wrapper over the local `tailscale` CLI: status, whois, cert. */
import { execFile } from "node:child_process";

/** One node from `tailscale status --json`, normalized. */
export interface TailnetNode {
  /** Stable node id. */
  id: string;
  /** Host name. */
  name: string;
  /** MagicDNS name without trailing dot ("" when absent). */
  dnsName: string;
  os: string;
  /** Reachable now. */
  online: boolean;
  /** Owning tailnet user. */
  userId: number;
  /** Tailscale addresses, IPv4 first. */
  ips: string[];
}

/** The parts of `tailscale status --json` Kivotos reads. */
export interface TailnetStatus {
  self: TailnetNode;
  peers: TailnetNode[];
  /** Names `tailscale cert` can issue for. */
  certDomains: string[];
}

/**
 * Run the tailscale CLI.
 * @param binary - tailscale executable.
 * @param args - arguments.
 * @param timeoutMs - kill after.
 * @returns stdout.
 */
export function runTailscale(binary: string, args: string[], timeoutMs: number): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(binary, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
  return promise;
}

function nodeOf(raw: Record<string, unknown>): TailnetNode {
  const ips = Array.isArray(raw.TailscaleIPs) ? raw.TailscaleIPs.map(String) : [];
  ips.sort((a, b) => Number(a.includes(":")) - Number(b.includes(":")));
  return {
    id: String(raw.ID ?? raw.PublicKey ?? ""),
    name: String(raw.HostName ?? ""),
    dnsName: String(raw.DNSName ?? "").replace(/\.$/, ""),
    os: String(raw.OS ?? ""),
    online: raw.Online === true,
    userId: Number(raw.UserID ?? 0),
    ips,
  };
}

/**
 * Read `tailscale status --json`.
 * @param binary - tailscale executable.
 * @returns status.
 */
export async function readStatus(binary: string): Promise<TailnetStatus> {
  const raw = JSON.parse(await runTailscale(binary, ["status", "--json"], 10_000)) as {
    Self?: Record<string, unknown>;
    Peer?: Record<string, Record<string, unknown>>;
    CertDomains?: unknown;
  };
  const self = nodeOf(raw.Self ?? {});
  // Self is always reachable from itself; status reports Online only for peers.
  self.online = true;
  const peers = Object.values(raw.Peer ?? {}).map((peer) => nodeOf(peer));
  const certDomains = Array.isArray(raw.CertDomains) ? raw.CertDomains.map(String) : [];
  return { self, peers, certDomains };
}

/**
 * Identify the tailnet node and user behind a remote address.
 * @param binary - tailscale executable.
 * @param ip - remote address.
 * @returns identity, or undefined when the address is not on the tailnet or has no user.
 */
export async function whois(
  binary: string,
  ip: string,
): Promise<{ userId: number; node: string } | undefined> {
  let out: string;
  try {
    out = await runTailscale(binary, ["whois", "--json", ip], 5_000);
  } catch {
    // `whois` exits non-zero for addresses outside the tailnet: no identity.
    return undefined;
  }
  const raw = JSON.parse(out) as {
    Node?: { User?: unknown; Name?: unknown };
    UserProfile?: { ID?: unknown };
  };
  const user = Number(raw.Node?.User ?? raw.UserProfile?.ID ?? 0);
  if (!Number.isFinite(user) || user === 0) return undefined;
  return { userId: user, node: String(raw.Node?.Name ?? "") };
}

/**
 * Issue (or refresh) the node's HTTPS certificate into the given files.
 * @param binary - tailscale executable.
 * @param domain - MagicDNS name.
 * @param certFile - PEM certificate output.
 * @param keyFile - PEM key output.
 */
export async function issueCert(
  binary: string,
  domain: string,
  certFile: string,
  keyFile: string,
): Promise<void> {
  await runTailscale(
    binary,
    ["cert", "--cert-file", certFile, "--key-file", keyFile, domain],
    60_000,
  );
}
