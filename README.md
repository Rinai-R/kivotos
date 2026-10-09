<p align="center">
  <img src="assets/kivotos-logo.svg" width="64" height="64" alt="Kivotos logo">
</p>

<h1 align="center">Kivotos</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

Kivotos is a plugin for DeepSeek Harness (dsh). It lets you open and drive every dsh on your tailnet from any dsh, with dsh's full UI, and it gives dsh a complete phone layout. Kivotos has no UI of its own: every screen you see is dsh's own UI.

## Features

- **Federation over Tailscale.** From any dsh, open the complete UI of any other dsh on your tailnet that also runs Kivotos. The remote UI is the remote dsh's own UI served through a reverse proxy, not a reimplementation, so everything works remotely:
  - sessions: new, delete, archive
  - approvals and user questions
  - model listing and switching
  - settings
  - workspace files
  - terminal
- **Machine switcher.** An entry in the dsh sidebar footer, above Settings, lists "this machine" plus the peers the serving host mounts. Selecting one navigates to `/` or `/kivotos/peer/<id>/`.
- **Phone layout.** Below 768px width:
  - single column; the sidebar becomes a slide-in drawer (`min(86vw, 320px)`) with a dimmed backdrop that closes it
  - a drawer toggle button before the conversation title
  - composer pinned at the bottom (dsh's own sticky composer) with safe-area insets and `viewport-fit=cover`
  - 16px inputs, so iOS does not zoom on focus
  - dsh theme tokens only, light and dark

## Requirements

- DeepSeek Harness (dsh) `0.2.1-alpha.1`
- Node `^22.19.0 || >=24`
- Tailscale installed and signed in on each machine, all machines signed in to the same tailnet account

## Install

On each machine:

```sh
git clone git@github.com:Rinai-R/kivotos.git
dsh plugin --profile web add /absolute/path/to/kivotos/packages/kivotos
```

Restart dsh. Repeat on every machine you want to reach or reach from.

Verify that the plugin is registered; the output shows the `kivotos` entry:

```sh
dsh --profile web --dump-config
```

The commands above use the `web` profile. The desktop app uses the `desktop` profile, which has not been tested with Kivotos.

## Use from a computer

Open dsh as usual. The machine switcher in the sidebar footer lists this machine and every peer that was discovered. Select a peer to open its full UI at `/kivotos/peer/<id>/`; select "this machine" to return to `/`.

## Use from a phone

1. Install the Tailscale app on the phone and sign in with the same tailnet account as your computers.
2. Open the computer's tailnet listener in the phone browser:
   - `http://<computer's tailscale IP>:7380/`
   - or `https://<name>.<tailnet>.ts.net:7380/` once HTTPS certificates are enabled for the tailnet
3. Use the machine switcher on that page to reach the other machines.

There is no token and no login: the tailnet identity is the login.

Plain HTTP over Tailscale is encrypted by WireGuard, but the browser does not treat the page as a secure context, so some browser APIs (for example the clipboard) may be unavailable. Enabling HTTPS certificates for the tailnet fixes that; see [Tailscale HTTPS certificates](https://tailscale.com/kb/1153/enabling-https).

The phone layout has been verified in a browser at 390x844. Use on a real phone and between two physical machines has not been verified yet.

## Configuration

The plugin's config row id is `kivotos`. Override it in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`. Defaults:

```yaml
- id: kivotos
  config:
    port: 7380 # tailnet listener port, same on every machine
    tls: auto # auto | on | off
    discover: true # probe same-user tailnet nodes
    refreshSeconds: 30 # 5..3600
    listen: true # run the tailnet listener on this machine
    listenHost: "" # "" = this node's Tailscale IPv4
    allowSelf: false # admit requests from this node's own address (lab only)
    tailscale: tailscale # CLI path
    staticPeers: [] # [{ id, name, host, port, tls?, servername? }]
```

A matching override replaces the complete `config` object of the row; keys you leave out fall back to the defaults above.

`tls: auto` uses HTTPS when the tailnet has HTTPS certificates enabled and issues the certificate with `tailscale cert` into `$DSH_HOME/kivotos/tls/`. `on` requires HTTPS; `off` never uses it. Kivotos never runs `tailscale serve` and never changes Tailscale configuration.

## Security

**Anyone signed in to your tailnet account has full control of every dsh running Kivotos on it**, the same as sitting at that computer: run commands, read and write files, use the terminal, approve tool calls. Only Tailscale identity is checked; there is no second factor. Keep the tailnet account secure and do not share it.

The tailnet listener admits a request only if:

- the `Host` header names this node (its Tailscale IPs or MagicDNS name); otherwise 421
- the request is not cross-site: no `Sec-Fetch-Site: cross-site`, and any `Origin` equals the request authority; otherwise 403
- `tailscale whois` of the remote address belongs to the same tailnet user as this node; otherwise 403. Tagged devices, device sharing, and other users of a shared tailnet are rejected
- it does not come from this node's own address, unless `allowSelf: true`

The listener binds only the Tailscale address, not `0.0.0.0` and not the LAN. Peer mounts on the serving dsh sit behind dsh's own connection fence (dsh login cookie plus Host and Origin checks).

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## How it works

- Every dsh running Kivotos opens a second HTTP listener on its Tailscale address only (default port 7380). dsh itself stays on loopback. Admitted requests are forwarded to the loopback dsh with a dsh login cookie that Kivotos obtains in-process; the browser never sees that cookie.
- Every `refreshSeconds`, Kivotos reads `tailscale status --json`, takes the online nodes of the same tailnet user, probes `GET /kivotos/hello` on `port` (HTTPS first, then HTTP), and mounts those that answer, plus any `staticPeers`.
- Each peer is mounted on the serving dsh at `/kivotos/peer/<id>/`, behind dsh's connection fence, and forwarded to the peer's tailnet listener. Each peer page gets its own `localStorage` namespace so peer UIs on the same origin do not overwrite each other's client state.
- Hops do not chain. A mount marks forwarded requests and refuses marked ones with 508, so `/kivotos/peer/b/kivotos/peer/a/` does not work. The machine list always comes from the serving host.

## Compatibility

Kivotos is pinned to dsh `0.2.1-alpha.1`. dsh ships no phone layout and no slot owns the frame grid, so the phone stylesheet targets dsh internals (CSS-module class names and data attributes of 0.2.1-alpha.1). The index rewrites (viewport meta, manifest link) also match the exact 0.2.1-alpha.1 markup and silently do nothing if it changes. Re-verify Kivotos on every dsh upgrade.

## Development

The plugin lives in `packages/kivotos/`. It is plain ESM JavaScript with no build step and no runtime dependencies. Scripts at the repository root:

```sh
npm run typecheck     # tsc --checkJs
npm run lint          # oxlint
npm run format        # oxfmt
npm run format:check  # oxfmt, check only
npm run build         # node --check
npm test              # node --test
```

The lefthook pre-commit hook runs the format check, lint, and typecheck.

To test federation on one machine, run two dsh instances with Kivotos, give each a distinct `port`, set `allowSelf: true`, and point each at the other through `staticPeers`.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Kivotos is not affiliated with DeepSeek or Tailscale.
