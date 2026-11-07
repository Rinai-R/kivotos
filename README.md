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
- **Android app:** The full dsh UI, with notifications for approvals, questions, and finished tasks; an approval that maps to one tool call can be allowed or denied right from the notification.
- **Safe restart:** Restart dsh from anywhere, even when you are only connected remotely: it quits cleanly, starts again by itself, and the page reconnects.
- **Self-hosted:** No account, no telemetry, no push service.

## Getting Started

### Prerequisites

- DeepSeek Harness `0.2.2-rc.1` (`>=0.2.1-rc.5 <0.3.0-0`)
- [Tailscale](https://tailscale.com) signed in to the same account on every device, or your own relay server

### Plugin

Install it on every machine. In dsh, open **Plugins → Install a third-party plugin** and enter `kivotos`. Or from the terminal:

```bash
dsh plugin --profile web add kivotos
```

Restart dsh. Your other machines appear under **Machines** at the bottom of the sidebar.

### Phone

Install the APK from the [releases page](https://github.com/Rinai-R/kivotos/releases). On the computer, open **Machines → Pair phone** and scan the code in the app.

### Relay

Run the relay with Docker Compose on a server with a public address:

```bash
curl -O https://raw.githubusercontent.com/Rinai-R/kivotos/main/packages/relay/docker-compose.yml
docker compose up -d
```

On the first computer, open **Settings → Remote access → Own relay**, enter the relay's address, and create a network. Register it on the relay by running the command the page shows after `docker compose exec relay`. Other computers and phones join with the invite link or its QR code.

The session event stream (`/api/remote.mux`) is compressed with `permessage-deflate` wherever both ends support it. With dsh 0.2.2 or newer the browser and dsh negotiate it end to end and Kivotos passes the frames through unchanged; with an older dsh Kivotos compresses the hop to the browser itself (off when it would not help). A 600 KB history snapshot costs about a third of its bytes on a throttled link. The extension is per message with context takeover off, and messages under 1 KB are left alone. Set `muxCompression: "off"` in the plugin config to disable it; the CPU cost is one deflate/inflate per large message on the computer serving the page.

A relay connection that drops only takes that connection down: the computer reconnects with backoff, and a dropped session closes by itself. On a link whose network queue can run longer than the relay's 20 s ping (`relaySilenceSeconds`, default 70 s) the control connection can be declared dead late; the plugin config key `relaySilenceSeconds` (30..600) raises it.

Anyone with the invite link, or signed in to your Tailscale account, has full control of your machines.

### Restarting dsh remotely

Quitting dsh would also end the connection you are using, so Kivotos restarts it for you: **Machines → Restart dsh…** (on a computer and on the phone), or type `/kivotos restart` in a conversation (`now`, `idle` (the default), `status`, `cancel`). The dialog lists what is running and offers **Restart when idle** or **Restart now**. dsh quits cleanly, a helper process starts it again and checks that Kivotos answers (retrying the launch up to three times), and the page reconnects by itself and shows which plugins changed. If something goes wrong, the helper's log is at `$DSH_HOME/kivotos/restart/restart.log`. Supported for the macOS desktop app and for `dsh web` started from a terminal; not on Windows or under systemd.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) to build, test and contribute, and `npm run dev` to start a relay and two dsh instances locally. Architecture and conventions are in [AGENTS.md](AGENTS.md); report vulnerabilities through [SECURITY.md](SECURITY.md).

## License

Apache-2.0. Kivotos is not affiliated with DeepSeek or Tailscale.
