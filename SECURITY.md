# Security policy

## Reporting a vulnerability

Please report privately through a GitHub security advisory, not in a public issue:

https://github.com/Rinai-R/kivotos/security/advisories/new

Include the version, how the machines are connected (tailnet, relay, or both), and the steps that reproduce the problem.

## Who is trusted

Kivotos gives the people it admits the same power as sitting at the computer: running commands, reading and writing files, and approving tool calls in dsh. There is no extra password or second factor. It admits:

- **Over Tailscale**: devices signed in to the same Tailscale user as the machine. Other users of a shared tailnet, devices shared in from other accounts, and tagged devices are refused.
- **Over a relay**: devices holding the network's invite link. The link carries the network key, so treat it like a password. To retire a leaked one, create a new network and remove the old one from the relay with `kivotos-relay network remove <network-id>`.

Protect the Tailscale account (strong sign-in, multi-factor authentication, device approval) and remove devices you no longer use.

## Tailnet listener

Each machine running Kivotos opens a second HTTP listener (port `7380` by default) on its Tailscale address only, never on `0.0.0.0` or a LAN address; dsh itself stays on loopback. Every request and WebSocket upgrade must pass, in this order:

1. `Host` names this machine (its listener address, a Tailscale IP or its MagicDNS name), against DNS rebinding. Else `421`.
2. The request is same-site: no `Sec-Fetch-Site: cross-site`, and an `Origin`, when sent, equals the request authority (`Origin: null` is refused). This covers WebSocket handshakes, which CORS does not. Else `403`.
3. The source is not this machine's own address, unless `allowSelf` is set (lab use only). Else `403`.
4. `tailscale whois` attributes the source to this machine's user. Else `403`.

Admitted requests reach the loopback dsh with a login cookie Kivotos obtains in-process. The browser's `Origin`, `Referer`, `Cookie` and `Sec-Fetch-*` headers are dropped on the way in, and `Set-Cookie` on the way out, so the cookie never reaches a browser.

Traffic between tailnet devices is encrypted by WireGuard. With `tls: auto` the listener also serves HTTPS when the tailnet has certificates enabled (`tailscale cert`). Kivotos never changes Tailscale's configuration.

## Relay

The relay pairs connections and copies bytes; it is not trusted with the traffic.

- Machines in a network talk TLS 1.3 to each other through the relay. Each side pins the other's node id (the hash of its certificate) and proves knowledge of the network key with a value bound to both certificates of that session, so a relay that answers with its own certificates is refused.
- The network key, the proof key and the node keys never leave the members. The relay learns only the network id and a relay token, and stores the token as a salted SHA-256.
- The relay does see which machines are online, their names, and when and how much they send. Served over plain HTTP, the relay token is visible on the network too: put the relay behind a TLS reverse proxy or give it its own certificate. A stolen token lets someone connect to the relay as the network, but not read the traffic or pass a member's proof.
- Only networks the operator registered are served, failed attempts are rate-limited per address, and the admin API is a Unix socket readable by its owner only.

On Android the node key lives in the Android Keystore and cannot be exported.

## Opening other machines

The machine switcher mounts each other machine under `/kivotos/peer/<id>/` on the serving dsh. Every Kivotos route there is behind dsh's own login and origin checks before anything is forwarded. A mounted page gets its own `localStorage` namespace and keeps its own boot in the desktop app, and a mount refuses requests another mount forwarded, so hops never chain.

The serving dsh caches only responses that are the same for everyone and never change at their URL (`immutable`, without `Set-Cookie`, never a page), under `$DSH_HOME/kivotos/cache/`.

## Notifications

`/kivotos/events` tells the phone app when a session needs an approval, asks a question or finishes, including the session title and the text of the request. It is served only by the tailnet listener and over the relay, behind the checks above, is read-only, and keeps the last 200 events in memory only.

## Hardening

- Set `listen: false` on machines that should open others but never be opened.
- Leave `allowSelf` off outside a lab.
- Enable HTTPS certificates for the tailnet if you use Kivotos from a browser that needs a secure context.
