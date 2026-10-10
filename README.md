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

<p align="center">Every DeepSeek Harness you run, from any computer or your phone.</p>

Kivotos is an open source plugin for DeepSeek Harness (dsh). Open any of your machines' dsh from any other, with its full UI: sessions, approvals, models, settings, files, and terminal. It adds a phone layout to dsh and comes with an Android app.

- **All your machines:** Switch between them from the dsh sidebar. What you see is the remote dsh's own UI, so everything works.
- **Two ways to connect:** Tailscale, or a relay server you run yourself. A machine can use both at once.
- **Untrusted relay:** The relay only forwards end-to-end encrypted data. It cannot read it or join your network.
- **Phone layout:** Drawer sidebar, composer at the bottom, safe areas, light and dark.
- **Android app:** The full dsh UI, with notifications for approvals, questions, and finished tasks.
- **Self-hosted:** No account, no telemetry, no push service.

## Getting Started

### Prerequisites

- DeepSeek Harness `0.2.0-rc.2`
- [Tailscale](https://tailscale.com) signed in to the same account on every device, or your own relay server

### Plugin

Install it on every machine and restart dsh:

```bash
dsh plugin --profile web add kivotos
```

For the desktop app, quit it first and use the CLI inside it:

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add kivotos
```

Your other machines appear under **Machines** at the bottom of the sidebar.

### Phone

Install the APK from the [releases page](https://github.com/Rinai-R/kivotos/releases). On the computer, open **Machines → Pair phone** and scan the code in the app.

### Relay

Run the relay on a server with a public address:

```bash
docker build -t kivotos-relay packages/relay
docker run -d --name kivotos-relay -p 7443:7443 -v kivotos-relay:/data kivotos-relay
```

On the first computer, open **Settings → Remote access → Own relay**, enter the relay's address, and create a network. Register it on the relay with the command the page shows. Other computers and phones join with the invite link or its QR code.

Anyone with the invite link, or signed in to your Tailscale account, has full control of your machines.

## Development

- `packages/kivotos`: the dsh plugin (TypeScript)
- `packages/mobile`: the Android app (Expo, Kotlin)
- `packages/relay`: the relay server (Go)

```bash
npm install          # install tools and build the plugin
npm run build        # rebuild the plugin after changing src/
npm run typecheck
npm test

npm run apk -w packages/mobile     # Android APK (JDK 17, Android SDK)
cd packages/relay && go test ./...
```

See [AGENTS.md](AGENTS.md) for architecture and conventions, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

Apache-2.0. Kivotos is not affiliated with DeepSeek or Tailscale.
