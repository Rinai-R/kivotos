# AGENTS.md

Guidance for coding agents working in this repository.

## What this repository is

Kivotos is a plugin for DeepSeek Harness (dsh) 0.2.0-rc.2. Package `kivotos` in `packages/kivotos/`. TypeScript sources in `src/`, built with esbuild into `dist/`; no runtime dependencies.

Kivotos has no UI of its own for sessions. It adds four things:

1. Federation over Tailscale: from any dsh, open the complete UI of any other dsh on the same tailnet that also runs Kivotos, through a reverse proxy.
2. A machine switcher in the dsh sidebar footer.
3. A phone layout (slide-in sidebar drawer, backdrop, drawer toggle, safe-area insets, full-screen Settings). It applies below 768px width when the page runs in the Kivotos app, which appends `Kivotos` to its WebView User-Agent, or, for a phone's own browser, when `(pointer: coarse)` matches. A narrowed desktop window must keep dsh's own layout.
4. An Android app (`packages/mobile/`) that shows each machine's dsh UI in a WebView and posts system notifications when a session needs an approval, asks a question, or finishes.

## Repository map

- `packages/kivotos/src/index.ts`: host plugin. `Config` (Standard Schema validation and defaults), tailnet listener and its admission, loopback login session, peer mounts, discovery, index rewrites.
- `packages/kivotos/src/proxy.ts`: HTTP and WebSocket forwarding helpers, header filtering, hop marking, `Location` rewriting.
- `packages/kivotos/src/cache.ts`: `MountCache`, the serving-side disk cache of peer mounts, and its warming from a peer's boot graph. See "Mount cache" below.
- `packages/kivotos/src/trace.ts`: trace log (`TraceLog`, daily JSONL under `$DSH_HOME/kivotos/logs/`, 7-day retention, 50 MB/day) and `WsFrameReader`, a passive WebSocket frame-header parser for `trace: frames`.
- `packages/kivotos/src/trace-path.ts`: `tracePath`, which every trace record and the page's load report use for request targets. It never writes the query (it can carry a login token), only a fingerprint: dsh's `rev` value, the query length and a 32-bit FNV-1a hash (`/plugins/?{rev=… len=… h=…}`). No Node imports: `client.tsx` bundles it.
- `packages/kivotos/src/federation.ts`: a relay network as a member sees it: the values derived from the federation key, invite links, the registration, and the member-to-member proof. Must stay in step with `packages/relay/wire/wire.go` and the app's `Network.kt`.
- `packages/kivotos/src/relay.ts`: member side of the relay protocol: WebSocket byte streams, `secureDial` / `secureAccept` (TLS 1.3 with both certificates, node id pinned, proofs both ways), `RelayLink` (control connection with reconnect), `relayAgent`.
- `packages/kivotos/src/relay-host.ts`: `RelayHost`: stored identity and membership (`$DSH_HOME/kivotos/identity.json`, `relay.json`, mode 0600), sessions served to the `Frontend`, relay members probed and published to `PeerRoutes`.
- `packages/kivotos/src/machines.ts`: the machine model shared by the plugin, its client module and the phone app (which imports it): links, states, reasons, connection modes, route choice (`routeOf(machine, mode)`, `pinnedVia`), the mode control's choices (`modeOptions`), `statusOf`, and the phone's list merging (`addPhoneMachines`, `applyPhoneProbe`, `leavePhoneNetwork`, `tailnetDownOnPhone`). No imports. See "Links and machines" below.
- `packages/kivotos/src/machine-book.ts`: `MachineBook`, which merges what each link sees into one machine per Kivotos node and keeps machines after they go away (`$DSH_HOME/kivotos/machines.json`); `probeFailure`, the probe error to reason mapping.
- `packages/kivotos/src/x509.ts`: the node's self-signed P-256 certificate, DER-encoded by hand (no dependency).
- `packages/kivotos/src/settings.tsx`: the "Remote access" section of dsh Settings, one page: this computer's links, then its machines with their link chips and modes; also the pairing dialog (`PairDialog`) the switcher opens. Its `statusText`/`linkText` word the machine model for the switcher too.
- `packages/kivotos/src/tailscale.ts`: `tailscale` CLI wrapper (`status --json`, `whois --json`, `cert`).
- `packages/kivotos/src/dsh.ts`: the slice of the dsh Host API Kivotos uses (`webServer`, `connection`, `logger`, `on`, optional `sessionProjections`), typed locally.
- `packages/kivotos/src/attention.ts`: `AttentionTracker`, which folds every Session's log (`approval/asked`, `approval/decided`, `ask_user_question` calls and answers, `turn/end`) into attention frames for `/kivotos/events`.
- `packages/kivotos/src/attention-hub.ts`: `AttentionHub` and `AttentionBoard`, the other machines' attention gathered on this Host for its own pages. See "Desktop attention" below.
- `packages/kivotos/src/sse.ts`: `SseReader`, the Server-Sent Events parser both the hub and the client module use (no Node imports).
- `packages/kivotos/src/client.tsx`: client module (machine switcher, pairing QR, drawer toggle, phone shell and backdrop, the dsh compatibility notice).
- `packages/kivotos/src/dsh/`: the dsh adapter, the only code that knows dsh internals. See "The dsh adapter" below.
- `packages/kivotos/scripts/build.mjs`: esbuild build. `dist/index.js` is one ESM file for Node; `dist/client.js` is wrapped in `window.__ModuleLoader__.load` with `react` taken from dsh's module `require`.
- `packages/kivotos/locale/en.json`, `packages/kivotos/locale/zh.json`: locale dictionaries.
- `packages/kivotos/icon.svg`, `packages/kivotos/cordis.patch.yml`, `packages/kivotos/package.json`: plugin icon, dsh config patch, plugin manifest.
- `packages/kivotos/test/*.test.ts`: `node:test` regression tests, run directly on the TypeScript sources (Node type stripping).
- `packages/mobile/`: Android app, Expo SDK 57 / React Native, Android only. `App.tsx` and `src/` are the React Native screens; `src/bridge.ts` is the script injected into dsh pages (reports the on-screen Session, opens a Session, tells the switcher the app takes `kivotos.switch`); `src/views.ts` keeps machine pages loaded.
- `packages/mobile/modules/kivotos-attention/`: local Expo module in Kotlin. `AttentionService` (foreground service, one SSE stream per machine), `Notifier` (channels, heads-up notifications, the monochrome status-bar icon), `AttentionState`, `KivotosAttentionPackage` (activity lifecycle: visibility, notification taps), `BootReceiver`.
- `packages/mobile/modules/kivotos-attention/.../Network.kt`, `WsStream.kt`, `RelayClient.kt`: the app's relay side; each relay connection is a `RelayClient.dial` session (Keystore-held node key, pinned node id, proofs).
- `packages/mobile/modules/kivotos-attention/.../MachineProxy.kt`, `Http.kt`, `HttpCache.kt`, `Prefetch.kt`: the app's machine doors, its disk cache and pre-fetch. See "Phone cache" below.
- `packages/mobile/modules/kivotos-attention/.../Links.kt`: the app's link probe (`probeLinks`) and the doors' route memory. `packages/mobile/src/LinksScreen.tsx`: the app's Connections screen; `packages/mobile/src/MachineSheet.tsx`: a machine's long-press sheet; `packages/mobile/src/StateDot.tsx`: the state dot of rows, link rows and chips.
- `packages/relay/`: the relay server, a Go module (`github.com/Rinai-R/kivotos/packages/relay`). See "Relay" below.
- `scripts/dev.mjs` (`npm run dev`): one command that builds the relay and starts it with two dsh instances, each with its own `DSH_HOME`, joined to one relay network; prints each UI URL and the invite. Relay-only, so it needs no Tailscale. See "Two-instance lab" below.
- `scripts/install-hooks.mjs`: installs the lefthook pre-commit hook (run by `npm install`).
- `CONTRIBUTING.md`: prerequisites, the build and test commands for all three packages, the lab, the commit and PR conventions, and the CI jobs a PR must pass.

## Commands

Run from the repository root.

```sh
npm install           # installs dev dependencies and builds dist/ (prepare)
npm run build         # esbuild: src/ -> dist/
npm run typecheck     # tsc --noEmit for packages/kivotos and packages/mobile
npm run lint          # oxlint
npm run format        # oxfmt (write)
npm run format:check  # oxfmt --check
npm test              # node --test on test/*.test.ts
```

Android APK (needs JDK 17 and the Android SDK in `ANDROID_HOME`):

```sh
npm run apk -w packages/mobile   # expo prebuild --clean, then gradlew assembleRelease
```

`packages/mobile/android/` is generated by `expo prebuild` and gitignored. Change native behavior in the local module or `app.json`, never in `android/`. CI builds the APK in the `android apk` job and uploads it as the `kivotos-android` artifact. A pushed `v<version>` tag must match the root, plugin, mobile, and Expo versions; increment `expo.android.versionCode` with each Android release. `CHANGELOG.md` must have a `## v<version>` section, in English followed by a `### 中文` translation: the tag check fails without it, and the release job publishes it as the GitHub Release description. After the checks pass, CI publishes the unscoped `kivotos` package to npm (with provenance, which npm accepts only with `publishConfig.access: "public"`, even for an unscoped package; prereleases under `next`; an already-published version is skipped), then the APK and its SHA-256 file as GitHub Release assets. The plugin has no runtime dependencies: everything it imports, `qrcode-generator` included, is bundled into `dist/`, so keep such packages in `devDependencies`. APKs are debug-key signed, not store-ready. Do not claim a release exists until the tag workflow succeeds.

The lefthook pre-commit hook runs format check, lint, the dsh boundary check, and typecheck. Never skip hooks (`--no-verify` or similar). Fix the failure instead.

A local lab, no Tailscale needed (`--lab-dir`, `--relay-port`, `--web-a-port`, `--web-b-port`, `--dsh`, `--keep`; `dsh` must be on `PATH` or given as `--dsh`/`$DSH_BIN`). It removes what it created when stopped and keeps it when a start fails; `CONTRIBUTING.md` covers it:

```sh
npm run dev    # relay on 7411, dsh instances on 7412 and 7413; npm run dev -- --help
```

## Relay (`packages/relay/`)

A Go server on the public internet that joins the members of a federation ("network") when Tailscale cannot connect them directly. It is **untrusted by design**: it forwards bytes of an end-to-end TLS session between two members and must never be given a way to read them or to pose as a member.

```sh
cd packages/relay
go test -race ./...     # includes end-to-end tests against a real relay on loopback
go vet ./... && gofmt -l .
go build -o kivotos-relay . && ./kivotos-relay serve --data-dir /var/lib/kivotos-relay
./kivotos-relay network add <registration> --name home   # talks to the running relay over its admin socket
```

Container image: `packages/relay/Dockerfile` cross-compiles on the build platform (`--platform=$BUILDPLATFORM`, `GOOS=$TARGETOS GOARCH=$TARGETARCH`) and runs as the non-root `relay` user with its data in the `/data` volume. The `relay (go)` CI job builds it for the runner and starts it as a smoke test. After that job and `check` pass (so a tag failing the version or changelog check publishes nothing), the `relay image` job builds it with Buildx for `linux/amd64` and `linux/arm64` and publishes `ghcr.io/rinai-r/kivotos-relay` (GITHUB_TOKEN, job-level `packages: write`): pull requests only build; a push to `main` pushes `main` and `sha-<short>`; a `v<version>` tag pushes `<version>`, `<major>.<minor>` and `latest`, except a prerelease (a tag with `-`), which pushes only `<version>` and never moves `latest`. The `VERSION` build-arg is the tag without its `v`, else the short commit.

`packages/relay/docker-compose.yml` is what the READMEs tell a server to download from `main` and run (`docker compose up -d`; networks are registered with `docker compose exec relay kivotos-relay network add …`). It runs the published `latest` image with the `/data` volume, and lists the reverse-proxy and TLS environment variables as comments. The `relay (go)` job checks it with `docker compose config`.

Packages, one job each. Dependencies point one way: `wire` is imported by all; `registry`, `admission` and `tunnel` do not import each other (they meet through small interfaces declared by the consumer); `admin` sits on `registry` and `tunnel`; `cmd` assembles everything.

- `wire/`: the protocol before a connection becomes raw bytes. One JSON object per line: `Hello`, `Reply`, and `Control` messages on a node's control connection.
- `registry/`: registered networks in `registry.json` (rewritten atomically and synced on every change). Per network: its ID and a salted SHA-256 of its relay token, never the token.
- `admission/`: `Gate` reads the hello, validates it, and checks the token against the registry. Counts refused hellos per source address.
- `tunnel/`: `Hub` holds each node's control connection per network, asks the node to dial back for every stream, and splices the two connections. `Server` is the WebSocket endpoint (`http.Handler`).
- `admin/`: operator HTTP API on a unix socket (mode 0600) and its client.
- `config/`, `cmd/`, `main.go`: configuration struct, Cobra commands with Viper (`kivotos-relay.yaml`, `KIVOTOS_RELAY_*`), entry point.

Federation secret: a network is one random 32-byte secret that its members share (in the invite link and QR code). Members derive three values from it with HKDF-SHA256, no salt, and the info strings in `wire/wire.go`:

- network ID (16 bytes, public): names the network on the relay.
- relay token (32 bytes): sent to the relay in every hello; the relay compares it with the salted hash the operator registered. It only says "may use this relay".
- peer proof key (32 bytes): never sent to the relay. Members prove it to each other inside their own TLS session. This is what keeps a compromised relay out.

The registration the operator runs once per network is `<network id>.<relay token>`; it does not reveal the secret or the proof key.

Transport: every connection is a WebSocket to `GET /v1/connect` (plain HTTP for a reverse proxy to front, or HTTPS with `tls.cert` and `tls.key`); `GET /healthz` answers 204. A WebSocket carries one byte stream in binary messages, and message boundaries mean nothing: the hello and reply lines and the later raw bytes are read as a stream, never one message at a time. A WebSocket cannot be half-closed, so either side closing ends the stream.

Protocol: the peer sends a hello with protocol version, network ID, relay token, its node ID (SHA-256 of the certificate it shows other members) and a role: `node` (a computer's control connection; it becomes visible and dialable), `accept` (a computer's data connection for one stream), `dial` (any member asking for a stream to a node), or `peers` (list the network's online nodes). The relay cannot verify a node ID and does not need to: the dialing member checks the certificate and the proof end to end.

Invariants:

- The relay never terminates the inner TLS and never parses stream bytes.
- The federation secret and the peer proof key never reach the relay, in any message.
- The relay token is never stored; only its salted hash.
- Nodes are visible and dialable only from inside their own network.
- A node can accept only streams opened to itself.
- Removing a network closes its live connections.
- The admin API is never exposed on TCP.
- `behind-proxy` is off unless a reverse proxy is the only way in; otherwise `X-Forwarded-For` is the peer's to forge and defeats the per-address refusal limit.

This module deliberately does not follow the Go skill's "flat, everything in the root package" default: it is split into the domain packages above. Its other rules apply (packages named for what they do, interfaces declared by the consumer, standard library first, no `utils`).

## Conventions

- TypeScript, strict, `erasableSyntaxOnly` (no enums, namespaces, or parameter properties) so tests run on the sources with Node type stripping. Relative imports use the `.ts` extension.
- `dist/` is build output and is not committed. dsh loads `dist/index.js` and `dist/client.js` through the package `exports`.
- `client.tsx` uses the classic JSX transform against `react`, which the build marks external so it resolves to dsh's React. It must not import dsh client packages at run time; the Client and Host APIs Kivotos uses are typed locally (`src/dsh.ts`, the `ClientContext` interface in `client.tsx`).
- Register every resource inside `ctx.effect` or `ctx.on`, and return its cleanup. Unloading the plugin must leave nothing behind.
- All visible text goes through `ctx.locale`. Add every new key to both the `en` and `zh` dictionaries.
- Style only with dsh theme tokens (`--dsw-*`). Literal colors are allowed only in icon artwork.
- Contribute UI through slots with `ctx.slots.inject`.

Pairing: `/kivotos/peers` exposes `self.url` only after the tailnet listener starts successfully. `/kivotos/hello` answers `{kivotos, name, os, node}`; `node` lets the app tie a paired computer to the same computer in a relay network. The dsh sidebar QR carries `kivotos://pair?url=<encoded listener base URL>` without credentials. Android's camera accepts only this format with a tailnet address, calls `/kivotos/hello` before storing it, and keeps manual address entry as fallback. Do not infer the computer's address from the phone's Tailscale IP; the Tailscale Android app does not expose its peer list to Kivotos.

Android app:

- Session screens stay dsh's own UI in a WebView. App-owned screens are limited to the machine list and settings; do not rebuild dsh features natively.
- The app talks only to each machine's tailnet listener and, for a machine of a joined relay network, its relay sessions: `/kivotos/hello`, `/kivotos/events`, and the dsh UI. It stores no token; the listener admits by Tailscale identity.
- Connection mode: stored with the machine in the app's list (`PhoneMachine.mode`, absent = auto; `setPhoneMode`) and passed to the native side. A home row is one line: name, then a dot and one word, as the computer's switcher says it (`summaryOf` in `strings.ts`, from `statusOf`): the route ("Tailscale", "Relay"), the mode when it holds the machine to one link ("Tailscale only"), "Unstable", how long ago it was seen when offline, or the short reason ("Not running"). Long-press opens `MachineSheet`: one line per link ("Tailscale ● Online", the link in use in bold with a ringed dot), then for a machine with both links the three options of `modeOptions` with their descriptions ("Falls back to the relay", "No fallback"), a link that is down disabled with "Unavailable now: <reason>" (the current choice stays checked and shows it), then for a relay machine a "Relay network <host> ›" row that opens Connections, and for a machine added by address only, "Remove from this phone" (confirmed). A door (`MachineProxy`) dials only the chosen link; the relay-first memory (`Links.prefersRelay`) applies in auto only. `AttentionService` follows the same mode (a machine held to Tailscale is streamed directly), and a mode change reopens the door on the same port and restarts the machine's stream.
- One row per machine: a computer added by pairing code or address and met again in a joined relay network is one entry with both links (merged by node id, `addPhoneMachines`/`applyPhoneProbe`); the entry that was there first keeps its id, because the door port, the cache and the notification cursor hang on it. Leaving a network (Connections screen only, confirmed by an alert naming the machines that leave) removes the machines only it reaches and keeps the others' tailnet URL; a machine's sheet never leaves a network.
- Links (`Links.kt`, `probeLinks`): while the app's own screens are up, every 15 s and on return to the app, the app probes each machine's `/kivotos/hello` directly and asks each joined network's relay who is online. The result (`PhoneProbe` in `machines.ts`) gives every machine row its route and state in the computer's words, per-link last-seen times (kept in SharedPreferences `kivotos.links`), whether its `/kivotos/events` stream is connected, and the Connections screen's relay state. The phone holds no standing relay connection, so its relay state is what the relay answered that probe. A relay whose TLS handshake is reset or closed by the other end (`TlsReset`, from `WsStream` for the relay's own TLS and `TlsChannel` for a member's) is `unreachable` with reason `tls-reset` on the network and on its machines' relay links; it is not one of the transient failures the grace covers. A refused tailnet connection is told apart from other connect failures with a plain socket (`ECONNREFUSED` → `no-listener`), since Android's HTTP stack drops the cause. "No answer" with "No machine answers over Tailscale" and Open Tailscale shows when the phone has a network and every tailnet machine failed with a timeout or no route (`tailnetDownOnPhone`): Android does not show another app's VPN to Kivotos. Open Tailscale launches `com.tailscale.ipn` (declared in the module manifest's `<queries>`), else its Play Store page.
- The WebView loads every machine through the machine's loopback door (`MachineProxy`), never directly; `/kivotos/hello` and a tailnet machine's `/kivotos/events` go directly.
- Pages stay loaded (`src/views.ts`, `App.tsx`): Back hides a machine's WebView instead of unmounting it, so opening it again shows it at once (no dsh boot). At most `LIVE_MAX` (2) stay, about 220 MB each; the least recently shown goes first. A hidden one is `display: none`, out of touch and of the accessibility tree, and paused (`setPageVisible`, `WebView.onPause`: Chromium reads only the WebView's own visibility, so without it the page would keep rendering and stay `visible` to its document). A page goes when its row is removed, when its door changes (`doorOf`: url, node, relay, mode; the one on screen loads again), on memory pressure (`onMemoryPressure`: trim levels RUNNING_LOW, RUNNING_CRITICAL and BACKGROUND and up; the one on screen stays) and when its renderer is gone (`onRenderProcessGone`; the one on screen loads again). Only the shown page takes the hardware Back and reports its Session as on screen; the splash covers a page's first load only.
- Notifications come from `/kivotos/events` held open by `AttentionService`; there is no push service. A frame for the Session on screen (`AttentionState.isOnScreen`) posts nothing; `resolved` cancels the matching notification by key.
- Opening a Session works by writing `localStorage['dsh.sessions.current'] = {"sessionId": ...}` and reloading (dsh restores it at startup). This is another dsh 0.2.0-rc.2 internal; re-verify on upgrade.
- React Native components keep props stable (memoized style sheets via `useStyles`, `useCallback` handlers); the repo's react-perf lint rules apply here too.

## The dsh adapter (`packages/kivotos/src/dsh/`)

Kivotos proxies dsh's own UI, so it relies on some dsh 0.2.0-rc.2 internals that are not plugin API. `src/dsh/` is the **only** place that may know one. Everything else calls its functions and never writes a dsh selector, page global, storage key, API path or asset pattern itself; `npm run check:dsh` (`scripts/check-dsh-boundary.mjs`, in the pre-commit hook and the `check` job) fails on one. dsh's plugin API (`ctx.slots`, `ctx.webServer`, `ctx.layout`, typed in `src/dsh.ts`) is not an internal and is used directly.

| Module          | dsh part it owns                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `compat.ts`     | the machinery: coupling points, `Probe`, `CompatWatch` (host log), `PageVerdicts` (page probes), the `__KIVOTOS_COMPAT__` page report |
| `index-html.ts` | the served index: viewport and manifest rewrites, `__DSH_BOOT__` graph, `__DSH_BOOT_READY__` gate, `__DSH_TRANSPORT__`/`ownsHost`     |
| `desktop.ts`    | the desktop shell's `dshDesktopBoot` bridge and `guardDesktopBoot` (#3)                                                               |
| `sessions.ts`   | `localStorage["dsh.sessions.current"]`, the per-peer storage namespace, `#kivotos-session=`                                           |
| `frame.ts`      | the rendered frame, conversation and Settings panel, and the phone stylesheet built from them                                         |
| `web-server.ts` | `/api/remote.mux` and the Vite asset naming (not probed; degrades by itself)                                                          |

Every function that relies on an internal probes it in the same place it uses it, so the two cannot disagree: a rewrite returns `{ html, probe }` and leaves the page as dsh served it when the probe fails; the phone stylesheet is built from `frame.ts` `PARTS`, and a test fails if it uses a selector that is not a declared part.

The phone stylesheet is a deliberate, version-pinned exception to the dsh plugin rule "do not read another plugin's DOM": dsh ships no phone layout and no slot owns the frame grid. It matches CSS-module class suffixes (`[class*="_sidebarCol"]`; the prefix is a build hash) and data attributes, in three groups, one per point.

| Point                | Judged on                                                                                                 | Off when it fails                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `viewport`           | host, the served index                                                                                    | the safe-area viewport rewrite                                   |
| `manifest`           | host, a mounted peer's index                                                                              | the credentialed manifest rewrite                                |
| `boot-graph`         | host, a mounted peer's index (same parser as the warm-up)                                                 | the mount cache's warm-up                                        |
| `desktop-boot`       | host, the `__DSH_BOOT_READY__` tail; desktop window, the handshake answering `streamBaseUrl`              | opening another machine inside the desktop window                |
| `phone-layout`       | the frame: `[data-shell-overlay]` beside the three `_*Col` columns, `_root` in the sidebar                | the drawer layout and the drawer toggle                          |
| `phone-conversation` | an open conversation: header leading inside `_header`, `_composerSeat`, `[data-conversation-scroll]`      | header, composer and scroller spacing                            |
| `phone-settings`     | the Settings panel while open: `nav > _navList`, `_navCell`, `_navLabel`, `_content > _header`/`_options` | the full-screen Settings panel                                   |
| `session-store`      | while dsh shows a Session: the key holds `{ sessionId }`                                                  | opening a machine on a Session (it opens at its own current one) |

A failed point turns off only its feature, logs once on the host, and shows a dismissible notice in `shell.overlay` naming it. Host results travel into the page as `__KIVOTOS_COMPAT__` (failures only; an `ok` page is served unchanged). Page probes run after DOM changes, in the next frame, until each point is settled: a probe whose subject is not on the page (Settings closed, no Session shown) waits; `ok` settles at once; a failure settles only when the next frame agrees; a settled point is final.

`test/compat.test.ts` runs the index rewrites against `test/fixtures/dsh-0.2.0-rc.2.index.html` (the index rc.2 serves, byte for byte; excluded from formatting) and altered copies, and the page probes against the rc.2 frame, conversation and Settings markup and renamed copies. `scripts/dsh-compat.mjs` installs dsh from npm into a scratch directory, installs this checkout's plugin into a scratch `DSH_HOME`, boots `dsh web` relay-only, signs in, and checks that the plugin applied, that every index rewrite's probe passes on the served index, and that every adapter `MARKERS` string is still in dsh's bundles. `.github/workflows/dsh-compat.yml` runs it nightly (and on changes to it) against the npm `latest` and `next` dist-tags — the rc line the desktop app ships, never `alpha`.

On a dsh upgrade: run `node scripts/dsh-compat.mjs --tag <tag>`, fix what fails inside `src/dsh/`, re-capture the fixture.

## Desktop app (DeepSeek Harness 0.2.0-rc.2)

- The target version is the one the desktop app bundles. Its update feed (`download.deepseek.com/dsh-desk/feeds/mac-arm64/`, channel nightly) decides upgrades; npm `alpha` releases do not reach it.
- The `desktop` profile is reserved: the regular `dsh` CLI refuses it. Install with the app's own CLI while the app is fully quit: `"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add <spec>`.
- Only one running profile may carry Kivotos: every instance binds port 7380 on the Tailscale address.
- The Electron window builds its `index.html` itself and applies only `webserver/index-inject` rows, not `tapIndex` transforms. The phone path is unaffected: pages served through the tailnet listener come from the host's own frontend.
- A peer opened from the machine switcher inside the Electron window is a page of `dsh-app://app`, so the desktop preload exposes `dshDesktopBoot` to it, and dsh's web entry would apply the local Host's boot rows (registration facade, graph, `__DSH_TRANSPORT__` with the local `streamBaseUrl`) on top of the peer's own. That races the peer's boot and killed the window with `web boot: N entries did not activate` (#3). `guardDesktopBoot` (`index.ts`), injected first into every mounted page, takes the desktop handshake itself, rebases `streamBaseUrl` under the mount so the WebSocket reaches the peer through it, holds `__DSH_BOOT_READY__` until then, and refuses the entry's own transport so the local rows are never applied. It depends on dsh 0.2.0-rc.2's `apps/web/src/main.ts` order (transport first, then `applyIndexInjections`); re-verify on upgrade. `test/desktop-boot.test.ts` replays that sequence.
- Mounted pages post their load timings to the absolute `/kivotos/trace/client`, which reaches this machine's webServer rather than the tailnet listener; `registerTraceClientRoute` records them as `client` events with `via: "webServer"`.

## Links

A machine is reachable through independent links: the tailnet listener and a relay network. Both admit a caller their own way and then hand it to the same `Frontend` (`index.ts`), which serves Kivotos' routes and forwards the rest to the loopback dsh. Adding a link means: admit, call `Frontend`, publish sightings; nothing else changes.

## Links and machines

One model on both the computer and the phone (`src/machines.ts`, #11): each machine appears once, whatever links reach it, with a route and a state per link.

- Identity: every Kivotos has a node id, base64url SHA-256 of its certificate (`x509.ts`, `$DSH_HOME/kivotos/identity.json`), created at the first start whether or not a relay network is joined. The tailnet listener advertises it in `/kivotos/hello`; relay members report it to the relay. Entries of one node merge into one machine with mount id `node-<first 16 chars>` (`machineIdOf`), stable across links. An entry whose node id is not known yet (an older Kivotos, a probe that never succeeded) keeps its old id: the static peer id or the tailnet node id.
- Sightings: every refresh, each link reports what it sees to `PeerRoutes.update(via, sightings, absent)`. The tailnet side probes every static peer and, with `discover`, the same user's tailnet nodes (not android or iOS ones): an online node is probed, an offline node is reported (with the tailnet's LastSeen) only when it has been a Kivotos machine before. The relay side probes each online member's `/kivotos/hello` through a secured session. `absent` says how the link shows remembered machines it does not report: `offline`, or, when the link itself is down, `unreachable` with `not-on-tailnet`, `relay-connecting` or `relay-unreachable`, or `denied`.
- States: `online`; `offline` (the link says it is away); `unreachable` with a reason (`no-listener` for a refused connection, `not-kivotos`, `forbidden` for 403/421, `timeout`, `tls`, `tls-reset` for a TLS handshake with or through the relay that was reset, `network`, or this computer's own link being down); `denied` (the relay refused this network). `probeFailure` maps Node error codes; when HTTPS and HTTP both fail, the more telling reason wins.
- Connection mode (#16), per machine, owned by the dialing device: `auto` (default), `tailscale` or `relay`. The computer keeps it in `machines.json` (`modes`, by machine id; auto is not stored) and sets it with `POST /kivotos/mode` `{machine, mode}` (fenced; `400` for bad input, `404` for an unknown machine; answers the `/kivotos/peers` body). A machine with one link has no choice (`pinnedVia` is null) and keeps its mode for when the other link appears; a mode goes when the book drops the machine.
- Route (`routeOf(machine, mode)`): in auto, Tailscale when its link is online (direct), else the relay; held to one link, only that link, and when it fails the machine is unreachable with that link's reason, never rerouted. None when nothing works. Only machines with a route are mounted; a route change updates the mount in place (same id, cache and attention feed); the feed reconnects through the new link at once, and when a mode holds the machine to one link the mount's open exchanges on the other link (WebSockets, streams) are closed. In auto only, a mount request that gets no answer over Tailscale triggers a tailnet re-probe at once (at most every 5 s), so the relay takes over within seconds. Trace records `peer.http`, `peer.ws.open` and `peer.events` carry `via`.
- Flaky links (`FAILURE_GRACE` in `machine-book.ts`, mirrored in `Links.kt`): each `/kivotos/hello` waits 6 s. A link that was online and then fails transiently (`timeout`, `network`, `relay-unreachable`, `relay-connecting`) stays online with `unstable: true`, keeping its route and mount, until the third failure in a row; then it is unreachable with that reason. Only a link seen working within the last 5 minutes gets the grace, so a failure after a gap (a restart, a sleeping laptop) is believed at once; refusals and wrong services are believed at once too. One answer clears the count.
- Retention: a machine stays listed after its links stop reporting it, as offline with its last-seen time, for `offlineDays` (default 7, 1..365) after it was last seen; a static peer stays while it is configured; a tailnet node stays while the tailnet lists it. Leaving the relay network forgets its members. The book survives restarts in `machines.json` (times to the minute; no secrets).
- `/kivotos/peers` (behind the fence like every dsh-side route): `{ self: {name, os, url?, node?}, peers: [{id, name, os, via}], machines: [MachineInfo] }`, where `MachineInfo` is `{ id, name, os, node?, mode: "auto" | "tailscale" | "relay", route: "tailscale" | "relay" | null, links: [{ via, state, reason?, lastSeen?, address?, unstable? }] }` (`lastSeen` in ms since the epoch). `peers` lists only the mounted machines and is what clients from before `machines` read; a client reading an older Host builds machines from `peers` (`machineListOf`).
- `/kivotos/links`: `{ tailscale: {url, name, joined, address, listen}, relay: RelayView }`.
- Computer UI: one vocabulary on every surface (`settings.tsx` words the machine model for the switcher too). A link cell is a dot, a word and a short qualifier (the reason when unreachable, the time when offline); weight 600 and a ring around the dot mark the link in use, and colour marks only a failing link. Unstable is amber and stays in use until the third failed check. The full text (`{link}: {word}[, in use]`, then the detail, then last seen) is each cell's `title` and accessible name, a tooltip on hover, and a popover that a tap toggles where there is no hover. Sentences appear only in notices that apply now, in tooltips and in dialogs the user opened.
  - Switcher: the trigger shows the current machine's dot and name over "This computer · N ready". The menu lists each machine on one line: dot, name, the attention badge, and a right-aligned meta (`machineSummary`: "This computer · Current", the route, Unstable, or why the preferred link fails, or when it was last seen). A machine no link reaches is disabled, with its full status (`machineTip`) as tooltip and accessible name. The footer has Pair phone (not on phones). There is no entry into Settings: dsh 0.2.0-rc.2 has no plugin API to open a given section. Inside the phone app, when the app's bridge sets `__kivotosSwitch`, a peer row does not navigate: it posts `{type: "kivotos.switch", machine: {id, name, node?, address?}, sessionId?, fallback}` to React Native (`navigate` in `client.tsx`), which shows the phone's own row for that machine (`machineForTarget`: same node, else same tailnet listener `host:port`, and not one its last probe found unreachable) in its own kept-alive WebView, through its own door. With no such row the app injects `location.assign(fallback)`, the mount path this page would have opened, so the switch goes through the computer as outside the app (the tap's user activation still holds, so Back returns). Each WebView's switcher shows its own computer as "This computer"; "This computer" on a mounted peer's page navigates by itself.
  - Settings → Remote access is one page, no tabs. The links card has a row per link of this computer: a tag, a facts line and labelled actions. Tailscale: Connected, Not connected, Starting or Off; this computer's name and listener address; Pair phone (not inside the phone app). Own relay: Connected, Connecting, Not registered or Relay unreachable; the relay host and machines online; Invite (a dialog with the QR code and the link) and Leave network (a dialog naming what goes: the machines only the relay reaches, this computer's reachability, the saved key; its confirm button is primary). Under the row, one-line notices only while they apply: the registration command while the relay refuses the network, "Connection reset" while the TLS handshake with the relay is reset (`RelayView.reason` `tls-reset`), and plaintext `ws://`. Not in a network: Join (by invite) and Create (on a relay) side by side, a failure as one danger line. The network id is not shown.
  - Machines table: a column per link this computer has, then, with both links, Route: a dropdown of `modeOptions` (Auto, Tailscale only, Relay only, each with a short description; a down link is disabled with "Unavailable now: <reason>" unless it is the current choice). A machine with one link reads "Only link". Below 520 px (the section's container query) link rows put their actions under the text, and machine rows stack the name and route over a two-column grid of labelled cells.
  - Phone (`packages/mobile/src/`): the same words (`strings.ts`) and the same option rule in the sheet, on one-line rows (above). Connections has two cards. Tailscale: the tag says what was observed ("Answering", or "No answer" with one line and Open Tailscale), and each machine added by address is a chip with its dot. Own relay: a tag (Connected, Not registered, Relay unreachable), the relay host, "Computers online" as chips, a one-line "Connection reset: the host may be blocking this domain" callout only while the reason is `tls-reset`, and Leave network in its own section. Not joined: Scan invite code first, then paste a link and Join, with one-line errors. No network id and no explanatory sentences.

## Desktop attention

A computer shows the other machines' approvals, questions and finished or failed turns (#12). The phone gets these from each machine's `/kivotos/events`; a computer gets them from the Host it is served by.

- Route: `AttentionHub` (`src/attention-hub.ts`) holds one `/kivotos/events` subscription per mounted peer, through the peer's upstream (tailnet listener or relay session, with the hop header, no new credential). It folds the frames into `AttentionBoard` and serves the result on this Host's webServer as `/kivotos/attention` (SSE: a `state` event now and after each change, a `notice` event per frame that is news). `/kivotos/attention/seen` (POST `{peer}`) clears a machine's finished turns. Both are absolute paths like `/kivotos/peers`: a mounted page reads the serving Host's board, never one through a mount, so nothing chains. One connection per page, not one per machine.
- `/kivotos/events` sends an `event: live` (data `{epoch}`) after the replayed frames on every connection, reconnects included. The hub treats frames before it as history: they update the board (an open wait still shows) but raise no notification. The app parses only `data:` of frames and skips it.
- Dedupe: a wait is identified by Session id plus key, unique across machines; two mounts of one machine report it once, and a `resolved` from any mount settles it for good (a late copy cannot reopen it). Turns are told once by kind, Session id and key. A new peer epoch drops the waits that peer alone reported.
- This Host's own Sessions are not on the board: dsh shows them on its own page, and the issue left it open; the board covers only other machines.
- Client (`client.tsx`, `followAttention`): reads `/kivotos/attention` with `fetch` (the desktop's `dsh-app://` scheme is registered for Fetch and streaming). The machine switcher shows a count badge per machine with waits, a dot for finished (red when one failed), and on the closed trigger the distinct wait count (a single dot when narrow). A row with waits opens that machine on its oldest wait (else the latest finished turn): `/kivotos/peer/<id>/#kivotos-session=<id>`, which `injectStorageNamespace` stores as `dsh.sessions.current` in the peer's namespace before dsh starts. Opening a machine's page marks its finished turns seen.
- System notifications: Web Notification API, one tag per wait or turn, only when the window is not focused and never for the Session on screen; `resolved` closes it. Permission is requested on a click of the switcher. Config: `notify` (approvals and questions, default `true`) and `notifyFinished` (finished and failed turns, default `true`). The desktop app (0.2.0-rc.2 `lib/main.js`) leaves every permission but `media` to `callback(true)`, so `Notification` is allowed for `dsh-app://`; not verified in the running app.

## Mount cache

Opening a peer loads its whole dsh client over the link (about 6 MB in dsh 0.2.0-rc.2, 5.3 MB of it one gzip plugin batch). `MountCache` (`src/cache.ts`) keeps what can never change at its URL on the serving dsh, under `$DSH_HOME/kivotos/cache/<peer id>/`, and answers it from disk to every client, the desktop window included (its `dsh-app://` pages bypass Chromium's HTTP cache, so only a serving-side cache helps it).

- Config: `cacheMegabytes` (default 256, `0` turns the cache off and deletes the directory; least recently used entries go past the cap) and `cacheWarm` (default `true`).
- Stored only when every condition holds: `GET`, no `Range`, not a navigation (`Accept` without `text/html`), the client accepts gzip, a peer id that is one path segment; answered `200` without `Set-Cookie`, `Vary` at most `Accept-Encoding`, and `cache-control` with `immutable` and without `no-store`/`no-cache`/`private`. dsh marks its `plugins/??…&rev=…` batches so; Vite assets (`HASHED_ASSET`: `/assets/…/<name>-<8-char hash>.<ext>`) carry no cache headers, and both the mount and the `Frontend` (tailnet listener and relay sessions, `markImmutable`) add `public, max-age=31536000, immutable` to them on every `200` without `cache-control`, cached or not.
- One encoding variant: cacheable requests from gzip clients go upstream with `accept-encoding: gzip` exactly, so all of them share one entry; other clients bypass the cache.
- An entry is `<name>.body` (bytes as received) plus `<name>.json` (status, replayed headers, size); `name` hashes peer, encoding and full path with query. Bodies stream to the client while they are teed into temp files; an entry is committed (fsync, rename, `.json` last) only when the whole body reached the client and matches any `content-length`. `open()` deletes everything that is not a complete entry. Concurrent misses for one entry fetch once (`flights`); the others wait and are served from disk.
- A peer's directory is deleted ten minutes after it stops being mounted; directories from an earlier run get the same grace at startup.
- dsh revisions its plugin batches on every launch, so batch entries help only while the peer's dsh keeps running; content-hashed assets survive until dsh is upgraded. Identical batch URLs never exist across machines, which is why there is no shared cross-peer URL.
- Warming: when a peer is mounted, and then at most every ten minutes on `PeerRoutes.update`, the cache fetches the peer's `/`, reads `globalThis["__DSH_BOOT__"]` (`WebBootGraph`, rendered by dsh's `webserver/injections.ts`) and the `./assets/` links, and prefetches the batches and hashed assets two at a time. An unchanged graph `rev` skips the prefetch. Failures only reach the trace (`peer.warm`, `peer.prefetch`).
- Trace: `peer.http` records carry `cache: hit | miss | bypass` (`miss` = fetched and stored).

## Phone cache

The phone loads the same ~6 MB client from each machine it opens. The app keeps what never changes at its URL on the phone and fills it before the WebView asks.

- Doors (`MachineProxy`): every machine gets a loopback address `http://127.0.0.1:<port>` (port derived from the machine id, which is its listener URL or `relay:<node>` and never changes, so the page's origin and dsh's localStorage survive restarts and added links). Each WebView connection gets its own connection to the machine: TCP (TLS with hostname verification for an `https` listener) to the tailnet listener, or a relay session. A machine with both links dials the listener first (4 s connect timeout) and the relay when that fails; after a failed tailnet dial the relay goes first for two minutes, or until a probe reaches the listener again (`Links.prefersRelay`). A door whose machine gained or lost a link is reopened on the same port. The door reads requests one at a time (`Http.kt`: heads, `Content-Length` and chunked framing) and copies bodies as they arrive, flushing every read, so SSE streams promptly; after an `Upgrade` (`/api/remote.mux`) it only pumps bytes both ways. A machine connection idle for more than 4 s is replaced before the next request (Node closes idle kept-alive connections after 5 s). Removing a machine closes its door and every live connection of it.
- Admission through a door: the first request of a connection must carry `MachineProxy.cookie`; the door strips that cookie before forwarding. A request whose `Origin` is not the door's own origin (a page of another door) is refused with `403`. Over the tailnet the door sends the listener's authority as `Host` and its origin as `Origin`, which is what `Admission.check` requires; `Sec-Fetch-Site` passes unchanged (a door's own page is same-origin).
- Cache (`HttpCache`): the mount cache's rules, applied in the door: `GET`, no `Range`, no `Upgrade`, not a navigation, the WebView accepts gzip; answered `200` without `Set-Cookie`, `Vary` at most `Accept-Encoding`, `immutable` without `no-store`/`no-cache`/`private`. Content-hashed Vite assets without `cache-control` get the immutable header in the door too (machines with an older Kivotos). Cacheable requests go upstream with `accept-encoding: gzip` exactly. Key: machine id, the `gzip` variant and the full request target with query. Entries live in `<cacheDir>/kivotos-http/<sha256(machine id)>/` as `<name>.body` plus `<name>.json`, written to temp files, synced, renamed, `.json` last, and only when the whole body reached the WebView and matched any `content-length`; opening the cache deletes everything else. Concurrent misses fetch once (`claim`/`release`). The cap is 256 MB over all machines (the computer-side default; a dsh client is ~6 MB and batches change with every dsh launch), least recently used first; Android may also reclaim `cacheDir`. A removed machine's directory is deleted on the next `setMachines`.
- Pre-fetch (`Prefetch`): when the app starts (first `setMachines` of the process), when a machine is added, and when a machine is reachable again (its `AttentionService` stream connects, or a network comes up after a failed try), the app reads the machine's index through its door, parses it like `bootResources` (boot graph batches and `./assets/` links), and fetches the missing resources through the door, two at a time over all machines, so they are stored by the rules above. A graph `rev` equal to the last complete pre-fetch (`<machine dir>/rev`) skips it; an index is read at most once a minute per machine. On a metered network it runs only while the app is in the foreground and otherwise waits for the next foreground. Failures only reach logcat (tag `KivotosCache`, which also logs `hit` and `stored`).
- `AttentionService` reaches machines with a relay link through their doors (the relay session, and the tailnet-to-relay fallback) and tailnet-only machines directly: the event stream needs nothing else the door adds. `AttentionService.live` is the set of connected streams the machine rows read.

## Security invariants

These must never regress. `packages/kivotos/test/fences.test.ts` covers the pure parts; run `npm test` after touching `src/index.ts` or `src/proxy.ts`.

- Listener admission (`Admission.check`), applied to every HTTP request and every WebSocket upgrade, in this order:
  1. `Host` names this node (bind address, Tailscale IPs, MagicDNS name), else `421`.
  2. `sameSite`: no `Sec-Fetch-Site: cross-site`, and any `Origin` equals the request authority (`Origin: null` refused), else `403`.
  3. Source address is not one of this node's own IPs unless `allowSelf`, else `403`.
  4. `tailscale whois` user equals this node's user, else `403`. Tagged devices and non-tailnet addresses have no user.
- The listener binds only the Tailscale address (`listenHost` or the node's Tailscale IPv4), never `0.0.0.0` or a LAN address.
- The loopback login cookie never reaches the browser. `forwardHeaders` drops the browser's `Origin`, `Referer`, `Cookie`, `Host`, and `Sec-Fetch-*`; `forwardHttp` and `forwardUpgrade` strip `Set-Cookie` from upstream responses.
- Every dsh-side route (`/kivotos/peer/<id>/`, `/kivotos/peer/<id>/api/remote.mux`, `/kivotos/peers`, `/kivotos/mode`, `/kivotos/links`, `/kivotos/relay`, `/kivotos/trace/client`, `/kivotos/attention`, `/kivotos/attention/seen`) checks `ctx.connection.requestRejection` before doing anything else.
- Hop guard: peer mounts set `x-kivotos-hop` on forwarded requests and answer `508` to requests that already carry it. Hops never chain.
- The mount cache answers only after the mount's `requestRejection` check, and stores only responses that are identical for every caller (rules in "Mount cache"): never one with `Set-Cookie` or a `Vary` beyond `Accept-Encoding`. Trace records never hold a query string, only `tracePath`'s fingerprint.
- `injectStorageNamespace` and `guardDesktopBoot` escape the peer id or mount prefix so it cannot close the injected script.
- Kivotos never runs `tailscale serve` and never changes Tailscale configuration.
- Relay sessions: nothing is served or sent before `secureAccept` / `secureDial` returns. The dialing side pins the target's node id; both sides check a proof that binds the federation key to both certificates of that session. `test/relay.test.ts` covers outsiders and a relay in the middle.
- The federation key, the peer proof key and the node's private key never go to the relay; only the network id and relay token do.
- `/kivotos/links` and `/kivotos/relay` check `ctx.connection.requestRejection` first: the invite they return is the federation key.
- The app's loopback doors serve only connections whose first request carries `MachineProxy.cookie`, never forward that cookie, and refuse requests with any `Origin` other than the door's own.

## Two-instance lab

`npm run dev` (`scripts/dev.mjs`) brings up the relay variant of this lab in one command: it builds the relay from `packages/relay`, registers one network on it, starts two dsh instances on separate web ports with separate `DSH_HOME` directories (both pre-joined to that network through `$DSH_HOME/kivotos/relay.json`), waits until the relay sees both members online, and prints each instance's URL, the relay address, and the invite link. It passes the profile an extra patch layer (`--patch`) that sets `listen: false` and `discover: false`, so it never binds a tailnet port and never mounts the machines of the runner's own tailnet, and it writes nothing outside `--lab-dir` (default `.lab/`, removed when the lab is stopped unless `--keep`; a failed start keeps it for its logs; a non-empty directory the script did not make is refused). Use it for relay, plugin-host and client work.

Use the tailnet lab below — which runs the listener with `allowSelf: true` and `staticPeers` — when the tailnet listener, the phone layout, or an Android device is what you are testing.

To exercise federation on one machine, run two dsh instances that federate with each other.

1. Give each instance its own `DSH_HOME` directory so profiles, config, and certificates stay separate.
2. Build once with `npm install` at the repository root, then add the plugin to each instance with an absolute path:

   ```sh
   dsh plugin --profile web add /absolute/path/to/kivotos/packages/kivotos
   ```

   After changing `src/`, run `npm run build` and restart the instances.

3. Override the `kivotos` row in `$DSH_HOME/profiles/web/cordis.patch.yml` of each instance. Give each a distinct `port`, set `allowSelf: true` (both instances share this node's Tailscale address), and point `staticPeers` at the other instance. Discovery does not list the node itself, so the static peer is required. An override replaces the complete `config` object of the row; Kivotos fills omitted keys from its defaults. Example for instance A, with B listening on 7381:

   ```yaml
   - id: kivotos
     config:
       port: 7380
       allowSelf: true
       staticPeers:
         - id: lab-b
           name: lab-b
           host: 100.64.0.1 # this node's Tailscale IPv4
           port: 7381
   ```

4. Restart both dsh instances. `dsh --profile web --dump-config` shows the `kivotos` entry.
5. Open A's UI and use the machine switcher, or go to `/kivotos/peer/lab-b/`.

Keep `allowSelf: false` everywhere outside the lab.

## Verification bar for UI changes

A change to `src/client.tsx` or to the index rewrites is not done until it has been checked in a running dsh:

- Screenshots at 1280px wide and at 390x844.
- On the phone size, drawer open and drawer closed.
- Light and dark themes.
- No console errors.
- No `slot entry crashed` messages.

A change to the Android app or to `/kivotos/events` is not done until it has been checked on a device or emulator against the two-instance lab:

- An Android emulator reaches the lab's tailnet listeners through the Mac (`adb shell` pings `100.x` addresses once Wi-Fi is on), and the lab's `allowSelf: true` admits it.
- Approval, question, and finished each post a heads-up notification with the monochrome K icon while the app is in the background.
- Answering elsewhere withdraws the notification; tapping a notification opens that exact Session; the on-screen Session gets no notification; an in-app banner appears on other app screens.
- Restarting a lab dsh makes the service reconnect and keep notifying.
- Reboot the device with notifications on: no crash in `adb logcat -b crash`, and `BootReceiver` restarts the service. It runs as `specialUse` on Android 14+ (Android 15 caps dataSync at 6 hours a day and forbids it from `BOOT_COMPLETED`), where `adb shell dumpsys activity services com.rinai.kivotos` shows `types=0x40000000`, and as `dataSync` on 10-13.
- Phone screens at several sizes (at least 1440x3200@560dpi as on the Xiaomi 15 Ultra, 720x1280@320dpi, and a 1600x2560 tablet), light and dark.
- The bridge (`src/bridge.ts`) can only be checked in a running WebView: it relies on dsh's `dsh.sessions.current` key.
