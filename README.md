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

Kivotos is a plugin for DeepSeek Harness (dsh). It lets you open and drive every dsh on your tailnet from any dsh, with dsh's full UI, gives dsh a complete phone layout, and comes with an Android app that notifies you when a session needs you. Kivotos has no UI of its own for sessions: every session screen is dsh's own UI.

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
- **Android app.** Opens each machine's full dsh UI and notifies you, with a system notification and a pop-up, when a session needs an approval, asks a question, or finishes a task while you are not looking at it. Tapping the notification opens that session.

## Requirements

- DeepSeek Harness (dsh) `0.2.0-rc.2`
- Node `^22.19.0 || >=24`
- Tailscale installed and signed in on each machine, all machines signed in to the same tailnet account

## Install

On each machine, install the published package from npm:

```sh
dsh plugin --profile web add @kivotos/dsh-plugin
```

Restart dsh. Repeat on every machine you want to reach or reach from.

To run from source instead (for development), build the plugin and add its directory:

```sh
git clone git@github.com:Rinai-R/kivotos.git
cd kivotos
npm install   # installs the build tools and builds packages/kivotos/dist/
dsh plugin --profile web add "$PWD/packages/kivotos"
```

Verify that the plugin is registered; the output shows the `kivotos` entry:

```sh
dsh --profile web --dump-config
```

The commands above use the `web` profile. For the DeepSeek Harness desktop app, which uses the `desktop` profile, fully quit the app and install with the CLI that ships inside it (the regular `dsh` refuses the `desktop` profile), then reopen the app:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add @kivotos/dsh-plugin
```

Install Kivotos in only one profile that you run at a time: every Kivotos listens on port 7380.

## Use from a computer

Open dsh as usual. The machine switcher in the sidebar footer lists this machine and every peer that was discovered. Select a peer to open its full UI at `/kivotos/peer/<id>/`; select "this machine" to return to `/`.

## Use from a phone

### Android app

1. Install the Tailscale app on the phone and sign in with the same tailnet account as your computers.
2. Install the Kivotos APK from the latest [GitHub Release](https://github.com/Rinai-R/kivotos/releases) (`Kivotos-v*.apk`). For an unreleased build, download `kivotos-android` from GitHub Actions or build it yourself (see Development).
3. Keep dsh with Kivotos running on the computer. In its sidebar machine switcher choose **Pair phone** to show a QR code. In the phone app choose **Scan code** and scan it; the app checks that the computer responds and admits the phone. Repeat for each computer. If scanning is unavailable, enter the **computer's** Tailscale IP and listener port manually (not the phone's IP).
4. Turn on **Notifications**. Android asks for permission; allow Kivotos to run in the background when the app offers it, or the system may stop notifications to save battery.
5. Tap a machine to open its full dsh UI.

While notifications are on, the app keeps one connection per machine open (Android shows an ongoing "Watching N machines" notification for it). You get a system notification with a pop-up when a session:

- needs an approval (the notification shows what it wants to run),
- asks you a question,
- finishes a task or fails.

No notification is shown for the session you are looking at in the app; opening a session clears its notifications, and an approval or question answered anywhere withdraws its notification. Tapping a notification opens the app on that machine, in that session. While the app is open on another screen, the same events also appear as an in-app banner.

The app is Android only and built with Expo (React Native); the dsh screens are dsh's own UI in a WebView. Notifications come from Kivotos on each computer, not from a push service, so no Google services are needed.

The QR code contains only the computer's tailnet listener address, never a login token. Tailscale's Android app does not expose its peer list to Kivotos: scanning pairs a computer once, and the app remembers it thereafter.

### Browser

You can also open the computer's tailnet listener in the phone browser:

- `http://<computer's tailscale IP>:7380/`
- or `https://<name>.<tailnet>.ts.net:7380/` once HTTPS certificates are enabled for the tailnet

Use the machine switcher on that page to reach the other machines. The browser gets no notifications.

There is no token and no login in either case: the tailnet identity is the login.

Plain HTTP over Tailscale is encrypted by WireGuard, but the browser does not treat the page as a secure context, so some browser APIs (for example the clipboard) may be unavailable. Enabling HTTPS certificates for the tailnet fixes that; see [Tailscale HTTPS certificates](https://tailscale.com/kb/1153/enabling-https).

The app and the phone layout have been verified on an Android 15 emulator and in a browser at 390x844. Use on a physical phone and between two physical machines has not been verified yet.

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

Kivotos is pinned to dsh `0.2.0-rc.2`. dsh ships no phone layout and no slot owns the frame grid, so the phone stylesheet targets dsh internals (CSS-module class names and data attributes of 0.2.0-rc.2). The index rewrites (viewport meta, manifest link) also match the exact 0.2.0-rc.2 markup and silently do nothing if it changes. Re-verify Kivotos on every dsh upgrade.

## Development

The plugin lives in `packages/kivotos/`: TypeScript sources in `src/`, built with esbuild into `dist/`, which dsh loads. It has no runtime dependencies. Scripts at the repository root:

```sh
npm run build         # esbuild: src/ -> dist/ (npm install also runs it)
npm run typecheck     # tsc --noEmit
npm run lint          # oxlint
npm run format        # oxfmt
npm run format:check  # oxfmt, check only
npm test              # node --test on the TypeScript sources
```

After changing `src/`, run `npm run build` and restart dsh.

The lefthook pre-commit hook runs the format check, lint, and typecheck.

To test federation on one machine, run two dsh instances with Kivotos, give each a distinct `port`, set `allowSelf: true`, and point each at the other through `staticPeers`.

The Android app lives in `packages/mobile/` (Expo SDK 57, React Native). Its notification service is a local Expo module in Kotlin, `packages/mobile/modules/kivotos-attention/`. To build the APK you need JDK 17 and the Android SDK (`ANDROID_HOME`):

```sh
npm install
npm run apk -w packages/mobile   # expo prebuild, then gradlew assembleRelease
# -> packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

`packages/mobile/android/` is generated by `expo prebuild` and is not committed. The release APK is signed with the debug key; it installs directly but is not meant for an app store.

To publish a version, update `version` in the root, plugin, and mobile `package.json` files and `expo.version` in `packages/mobile/app.json` to the same value; increment `expo.android.versionCode` for Android upgrades. Then push a matching `v<version>` tag (for example `v0.1.2`). CI runs the checks and builds the APK, publishes `@kivotos/dsh-plugin` to npm (with provenance), then attaches `Kivotos-v<version>.apk` and `Kivotos-v<version>.sha256` to a GitHub Release. Tags containing a hyphen create a prerelease and publish to npm under the `next` dist-tag. Ordinary commits on `main` keep the temporary Actions artifact. The published APK still uses Expo's debug signing key: this is for direct installation, not store distribution or a production signing identity.

```sh
git tag v0.1.2
git push origin v0.1.2
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Kivotos is not affiliated with DeepSeek or Tailscale.
