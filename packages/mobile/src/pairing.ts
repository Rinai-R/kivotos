/** Accept only the credential-free pairing URI produced by the host's QR dialog. */
export function parsePairingUrl(data: string): string | null {
  const pair = /^kivotos:\/\/pair\?url=([^&#]+)$/.exec(data);
  if (pair === null || pair[0] !== data) return null;

  let endpoint: string;
  try {
    endpoint = decodeURIComponent(pair[1]);
  } catch {
    return null;
  }
  // A URL parser can normalize paths, credentials and odd numeric hosts. Do not
  // let any of those transformations turn an untrusted QR into a different URL.
  const address = /^(https?):\/\/([a-zA-Z0-9.-]+):([0-9]{1,5})$/.exec(endpoint);
  if (address === null || address[0] !== endpoint) return null;
  const [, scheme, host, portText] = address;
  const port = Number(portText);
  if (port < 1 || port > 65535) return null;

  if (scheme === "http") {
    const octets = host.split(".");
    if (
      octets.length !== 4 ||
      octets.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255) ||
      octets[0] !== "100" ||
      Number(octets[1]) < 64 ||
      Number(octets[1]) > 127
    )
      return null;
  } else if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/i.test(host)) {
    return null;
  }

  return `${scheme}://${host.toLowerCase()}:${port}`;
}
