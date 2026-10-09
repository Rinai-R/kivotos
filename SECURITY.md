# Security

Kivotos is a DeepSeek Harness (dsh) plugin that lets one dsh open and drive the full UI of other dsh instances on the same tailnet. This document describes what it trusts, what it checks, and how to report a vulnerability.

## Trust model

**Anyone signed in to your tailnet account has full control of every dsh running Kivotos on that tailnet.** That is the same as sitting at the computer: they can run commands, read and write files, use the terminal, and approve tool calls. Tailscale identity is the only check. There is no token, no password, and no second factor.

- A request is admitted only when `tailscale whois` attributes its source address to the same tailnet user that owns the node running Kivotos. Other users of a shared tailnet and devices shared into your tailnet from other accounts are rejected.
- Tagged devices have no owning user and are rejected.
- Do not share your tailnet account. Anyone who can sign in to it is trusted completely.

## What the tailnet listener checks

Every dsh running Kivotos opens a second HTTP listener (default port `7380`). dsh itself stays on loopback. The listener binds only this node's Tailscale address (`listenHost`, default: the node's Tailscale IPv4). It does not bind `0.0.0.0` or any LAN address.

Each HTTP request and each WebSocket upgrade passes these checks in order. The first failure ends the request with `kivotos: not admitted`.

1. `Host` must name this node: its bind address, one of its Tailscale IPs, or its MagicDNS name. Otherwise `421`. This defends against DNS rebinding.
2. The request must not be cross-site: `Sec-Fetch-Site: cross-site` is refused, and an `Origin` header, when present, must equal the request authority. `Origin: null` is refused. Otherwise `403`. This applies to WebSocket handshakes as well, because a WebSocket handshake is not subject to CORS and the forwarded hop no longer carries the browser's `Origin`, so the loopback dsh cannot apply its own check.
3. The source address must not be one of this node's own Tailscale IPs unless `allowSelf: true`. Otherwise `403`. `allowSelf` defaults to `false` and is meant only for a lab setup on one machine.
4. `tailscale whois` of the source address must report the same user as this node. Addresses outside the tailnet and tagged devices have no user. Otherwise `403`. Results are cached per address for 60 seconds.

Admitted requests are forwarded to the loopback dsh. The browser's `Origin`, `Referer`, `Cookie`, and `Sec-Fetch-*` headers are not forwarded.

## The dsh side

### Peer mounts

On the serving dsh, each discovered peer is mounted at `/kivotos/peer/<id>/` (an HTTP prefix route and the gateway WebSocket `/kivotos/peer/<id>/api/remote.mux`). The machine list at `/kivotos/peers` is served the same way. All of these sit behind dsh's own connection fence (`ctx.connection.requestRejection`): the dsh login cookie and dsh's Host and Origin checks. A request without a valid dsh login is rejected with dsh's status (for example `401`) before anything is forwarded to the peer.

### Loopback login cookie

To forward admitted requests, the tailnet listener needs a dsh login cookie for the loopback dsh. Kivotos obtains it in-process through dsh's token exchange (`ctx.connection.authenticatedUrl`).

- The cookie is held in the dsh process and attached only to requests sent to the loopback dsh.
- It is never sent to the browser: `Set-Cookie` is removed from every forwarded HTTP response and WebSocket upgrade response.
- It is refreshed every 12 hours, and immediately after the loopback dsh answers `401`.

## Peer pages

A peer's index HTML is rewritten as it passes through the mount:

- `__DSH_TRANSPORT__.ownsHost = true` is injected (by the peer's tailnet listener). Without it, dsh would treat the page as a remote viewer and settings that persist on the host would not work. The page is the operator's own dsh, reached by the operator, so this is accurate.
- A per-peer `localStorage` namespace (`kivotos:<id>:`) is injected. All peer UIs are served from the serving host's origin and would otherwise read and overwrite each other's client state. The peer id is escaped so it cannot break out of the injected script.
- The web manifest link is made credentialed so the manifest request passes the dsh fence.

Hops never chain. A peer mount marks every request it forwards with `x-kivotos-hop`, and a mount refuses any request that already carries the mark with `508`. A path such as `/kivotos/peer/b/kivotos/peer/a/` therefore does not reach a third machine, and A to B to A loops are impossible. The machine list always comes from the serving host.

## Attention stream

The tailnet listener also serves `/kivotos/events` (Server-Sent Events) and `/kivotos/events/pending` for the Android app's notifications. They are derived from every Session's log on that machine and carry, per event: the Session id and title, the approval request id and its reason (for example the command to approve), the first question of an `ask_user_question` call, and the error message of a failed turn.

- Both endpoints sit behind the same admission as the rest of the listener (Host, same-site, own address, same tailnet user). They are not reachable through dsh's loopback port.
- They only read. Answering an approval or a question still happens in dsh's own UI.
- The Host keeps the last 200 events in memory and nothing on disk. A restart starts a new stream (`epoch`).

## Transport

- Traffic between tailnet devices is encrypted by WireGuard, including plain HTTP to the tailnet listener.
- A page loaded over plain HTTP is not a secure context in the browser. Some browser APIs, such as clipboard access, may be unavailable.
- With `tls: auto` (default), the listener uses HTTPS when the tailnet has HTTPS certificates enabled. Kivotos then issues the certificate with `tailscale cert` into `$DSH_HOME/kivotos/tls/` (directory mode `0700`). `tls: on` requires certificates and fails to start the listener without them; `tls: off` always uses HTTP. See [Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https).
- Kivotos never runs `tailscale serve` and never changes Tailscale configuration. It only reads `tailscale status`, runs `tailscale whois`, and, for HTTPS, runs `tailscale cert`.

## Recommendations

- Secure the tailnet account: use a strong sign-in method with multi-factor authentication at your identity provider, and do not share the account.
- Follow Tailscale's guidance on device approval and key expiry so that a new or stale device cannot silently join your tailnet with your identity.
- Remove devices you no longer use from the tailnet.
- Set `listen: false` on machines that should open other machines but never be opened.
- Leave `allowSelf` at `false` outside a lab.
- Enable HTTPS certificates for the tailnet if you use Kivotos from a browser that needs a secure context.

## Reporting vulnerabilities

Report vulnerabilities privately through a GitHub security advisory:

https://github.com/Rinai-R/kivotos/security/advisories/new

Do not open public issues for security problems.
