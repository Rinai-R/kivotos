/** Thin wrapper over the local `tailscale` CLI: status, whois, cert. */
import { execFile } from "node:child_process";

/**
 * @typedef {object} TailnetNode
 * @property {string} id - stable node id.
 * @property {string} name - host name.
 * @property {string} dnsName - MagicDNS name without trailing dot ("" when absent).
 * @property {string} os - operating system.
 * @property {boolean} online - reachable now.
 * @property {number} userId - owning tailnet user.
 * @property {string[]} ips - Tailscale addresses, IPv4 first.
 */

/**
 * @typedef {object} TailnetStatus
 * @property {TailnetNode} self - this node.
 * @property {TailnetNode[]} peers - other nodes.
 * @property {string[]} certDomains - names `tailscale cert` can issue for.
 */

/**
 * Run the tailscale CLI and parse its JSON output.
 * @param {string} binary - tailscale executable.
 * @param {string[]} args - arguments.
 * @param {number} timeoutMs - kill after.
 * @returns {Promise<string>} stdout.
 */
export function runTailscale(binary, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/**
 * @param {Record<string, unknown>} raw - one `status --json` node.
 * @returns {TailnetNode} normalized node.
 */
function nodeOf(raw) {
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
 * @param {string} binary - tailscale executable.
 * @returns {Promise<TailnetStatus>} status.
 */
export async function readStatus(binary) {
  const raw = JSON.parse(await runTailscale(binary, ["status", "--json"], 10_000));
  const self = nodeOf(raw.Self ?? {});
  // Self is always reachable from itself; status reports Online only for peers.
  self.online = true;
  const peers = Object.values(raw.Peer ?? {}).map((peer) => nodeOf(peer));
  const certDomains = Array.isArray(raw.CertDomains) ? raw.CertDomains.map(String) : [];
  return { self, peers, certDomains };
}

/**
 * Identify the tailnet node and user behind a remote address.
 * @param {string} binary - tailscale executable.
 * @param {string} ip - remote address.
 * @returns {Promise<{ userId: number, node: string } | undefined>} identity, or undefined
 *   when the address is not on the tailnet.
 */
export async function whois(binary, ip) {
  let out;
  try {
    out = await runTailscale(binary, ["whois", "--json", ip], 5_000);
  } catch {
    // `whois` exits non-zero for addresses outside the tailnet: no identity.
    return undefined;
  }
  const raw = JSON.parse(out);
  const user = Number(raw?.Node?.User ?? raw?.UserProfile?.ID ?? 0);
  if (!Number.isFinite(user) || user === 0) return undefined;
  return { userId: user, node: String(raw?.Node?.Name ?? "") };
}

/**
 * Issue (or refresh) the node's HTTPS certificate into the given files.
 * @param {string} binary - tailscale executable.
 * @param {string} domain - MagicDNS name.
 * @param {string} certFile - PEM certificate output.
 * @param {string} keyFile - PEM key output.
 */
export async function issueCert(binary, domain, certFile, keyFile) {
  await runTailscale(
    binary,
    ["cert", "--cert-file", certFile, "--key-file", keyFile, domain],
    60_000,
  );
}
