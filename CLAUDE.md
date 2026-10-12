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
- `packages/kivotos/src/relay-host.ts`: `RelayHost`: stored identity and membership (`$DSH_HOME/kivotos/identity.json`, `relay.json`, mode 0600), sessions served to the `Frontend`, relay peers published to `PeerRoutes`.
- `packages/kivotos/src/x509.ts`: the node's self-signed P-256 certificate, DER-encoded by hand (no dependency).
- `packages/kivotos/src/settings.tsx`: the "Remote access" section of dsh Settings, a tab per link.
- `packages/kivotos/src/tailscale.ts`: `tailscale` CLI wrapper (`status --json`, `whois --json`, `cert`).
- `packages/kivotos/src/dsh.ts`: the slice of the dsh Host API Kivotos uses (`webServer`, `connection`, `logger`, `on`, optional `sessionProjections`), typed locally.
- `packages/kivotos/src/attention.ts`: `AttentionTracker`, which folds every Session's log (`approval/asked`, `approval/decided`, `ask_user_question` calls and answers, `turn/end`) into attention frames for `/kivotos/events`.
- `packages/kivotos/src/attention-hub.ts`: `AttentionHub` and `AttentionBoard`, the other machines' attention gathered on this Host for its own pages. See "Desktop attention" below.
- `packages/kivotos/src/sse.ts`: `SseReader`, the Server-Sent Events parser both the hub and the client module use (no Node imports).
- `packages/kivotos/src/client.tsx`: client module (machine switcher, pairing QR, drawer toggle, phone stylesheet and backdrop).
- `packages/kivotos/scripts/build.mjs`: esbuild build. `dist/index.js` is one ESM file for Node; `dist/client.js` is wrapped in `window.__ModuleLoader__.load` with `react` taken from dsh's module `require`.
- `packages/kivotos/locale/en.json`, `packages/kivotos/locale/zh.json`: locale dictionaries.
- `packages/kivotos/icon.svg`, `packages/kivotos/cordis.patch.yml`, `packages/kivotos/package.json`: plugin icon, dsh config patch, plugin manifest.
- `packages/kivotos/test/*.test.ts`: `node:test` regression tests, run directly on the TypeScript sources (Node type stripping).
- `packages/mobile/`: Android app, Expo SDK 57 / React Native, Android only. `App.tsx` and `src/` are the React Native screens; `src/bridge.ts` is the script injected into dsh pages (reports the on-screen Session, opens a Session).
- `packages/mobile/modules/kivotos-attention/`: local Expo module in Kotlin. `AttentionService` (foreground service, one SSE stream per machine), `Notifier` (channels, heads-up notifications, the monochrome status-bar icon), `AttentionState`, `KivotosAttentionPackage` (activity lifecycle: visibility, notification taps), `BootReceiver`.
- `packages/mobile/modules/kivotos-attention/.../Network.kt`, `WsStream.kt`, `RelayClient.kt`: the app's relay side; each relay connection is a `RelayClient.dial` session (Keystore-held node key, pinned node id, proofs).
- `packages/mobile/modules/kivotos-attention/.../MachineProxy.kt`, `Http.kt`, `HttpCache.kt`, `Prefetch.kt`: the app's machine doors, its disk cache and pre-fetch. See "Phone cache" below.
- `packages/relay/`: the relay server, a Go module (`github.com/Rinai-R/kivotos/packages/relay`). See "Relay" below.

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

The lefthook pre-commit hook runs format check, lint, and typecheck. Never skip hooks (`--no-verify` or similar). Fix the failure instead.

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

Pairing: `/kivotos/peers` exposes `self.url` only after the tailnet listener starts successfully. The dsh sidebar QR carries `kivotos://pair?url=<encoded listener base URL>` without credentials. Android's camera accepts only this format with a tailnet address, calls `/kivotos/hello` before storing it, and keeps manual address entry as fallback. Do not infer the computer's address from the phone's Tailscale IP; the Tailscale Android app does not expose its peer list to Kivotos.

Android app:

- Session screens stay dsh's own UI in a WebView. App-owned screens are limited to the machine list and settings; do not rebuild dsh features natively.
- The app talks only to each machine's tailnet listener or, for a relay machine, its relay sessions: `/kivotos/hello`, `/kivotos/events`, and the dsh UI. It stores no token; the listener admits by Tailscale identity.
- The WebView loads every machine through the machine's loopback door (`MachineProxy`), never directly; `/kivotos/hello` and a tailnet machine's `/kivotos/events` go directly.
- Notifications come from `/kivotos/events` held open by `AttentionService`; there is no push service. A frame for the Session on screen (`AttentionState.isOnScreen`) posts nothing; `resolved` cancels the matching notification by key.
- Opening a Session works by writing `localStorage['dsh.sessions.current'] = {"sessionId": ...}` and reloading (dsh restores it at startup). This is another dsh 0.2.0-rc.2 internal; re-verify on upgrade.
- React Native components keep props stable (memoized style sheets via `useStyles`, `useCallback` handlers); the repo's react-perf lint rules apply here too.

## Deliberate exception: version-pinned phone stylesheet

dsh ships no phone layout and no slot owns the frame grid. The phone stylesheet in `src/client.tsx` therefore reads dsh 0.2.0-rc.2 internals, which breaks the dsh plugin rule "do not read another plugin's DOM or stylesheet". This is intentional and pinned to dsh 0.2.0-rc.2.

It depends on:

- CSS-module class suffixes `_sidebarCol`, `_centerCol`, `_rightbarCol`, `_handle`, `_root`, `_header`, `_composerSeat` (matched with `[class*="..."]`).
- The frame, found as `div:has(> [data-shell-overlay])`.
- The attributes `[data-sidebar-collapsed]`, `[data-conversation-header-leading]`, `[data-conversation-scroll]`.
- The Settings panel, found as `[data-shortcut-modal="settings"]`, its direct `nav` child, and the class suffixes `_navList`, `_navCell`, `_navLabel`, `_content`, `_header`, `_options`, `_themeCube`. On phones the panel fills the screen and its section rail becomes a horizontally scrolling tab row; the markup stays dsh's.

The index rewrites in `src/index.ts` (`coverViewport` for the viewport meta, `credentialedManifest` for the manifest link) match the exact dsh 0.2.0-rc.2 `index.html` markup and silently do nothing if it changes.

Re-verify all of the above on every dsh upgrade. Keep the exception confined to these places; everything else follows the dsh plugin rules.

## Desktop app (DeepSeek Harness 0.2.0-rc.2)

- The target version is the one the desktop app bundles. Its update feed (`download.deepseek.com/dsh-desk/feeds/mac-arm64/`, channel nightly) decides upgrades; npm `alpha` releases do not reach it.
- The `desktop` profile is reserved: the regular `dsh` CLI refuses it. Install with the app's own CLI while the app is fully quit: `"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add <spec>`.
- Only one running profile may carry Kivotos: every instance binds port 7380 on the Tailscale address.
- The Electron window builds its `index.html` itself and applies only `webserver/index-inject` rows, not `tapIndex` transforms. The phone path is unaffected: pages served through the tailnet listener come from the host's own frontend.
- A peer opened from the machine switcher inside the Electron window is a page of `dsh-app://app`, so the desktop preload exposes `dshDesktopBoot` to it, and dsh's web entry would apply the local Host's boot rows (registration facade, graph, `__DSH_TRANSPORT__` with the local `streamBaseUrl`) on top of the peer's own. That races the peer's boot and killed the window with `web boot: N entries did not activate` (#3). `guardDesktopBoot` (`index.ts`), injected first into every mounted page, takes the desktop handshake itself, rebases `streamBaseUrl` under the mount so the WebSocket reaches the peer through it, holds `__DSH_BOOT_READY__` until then, and refuses the entry's own transport so the local rows are never applied. It depends on dsh 0.2.0-rc.2's `apps/web/src/main.ts` order (transport first, then `applyIndexInjections`); re-verify on upgrade. `test/desktop-boot.test.ts` replays that sequence.
- Mounted pages post their load timings to the absolute `/kivotos/trace/client`, which reaches this machine's webServer rather than the tailnet listener; `registerTraceClientRoute` records them as `client` events with `via: "webServer"`.

## Links

A machine is reachable through independent links: the tailnet listener and a relay network. Both admit a caller their own way and then hand it to the same `Frontend` (`index.ts`), which serves Kivotos' routes and forwards the rest to the loopback dsh. `PeerRoutes.update(via, peers)` keeps one peer list per link and mounts the union. Adding a link means: admit, call `Frontend`, publish peers; nothing else changes.

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

- Doors (`MachineProxy`): every machine gets a loopback address `http://127.0.0.1:<port>` (port derived from the relay node id or the listener URL, so the page's origin and dsh's localStorage survive restarts). Each WebView connection gets its own connection to the machine: a relay session, or TCP (TLS with hostname verification for an `https` listener) to the tailnet listener. The door reads requests one at a time (`Http.kt`: heads, `Content-Length` and chunked framing) and copies bodies as they arrive, flushing every read, so SSE streams promptly; after an `Upgrade` (`/api/remote.mux`) it only pumps bytes both ways. A machine connection idle for more than 4 s is replaced before the next request (Node closes idle kept-alive connections after 5 s). Removing a machine closes its door and every live connection of it.
- Admission through a door: the first request of a connection must carry `MachineProxy.cookie`; the door strips that cookie before forwarding. A request whose `Origin` is not the door's own origin (a page of another door) is refused with `403`. For a tailnet machine the door sends the listener's authority as `Host` and its origin as `Origin`, which is what `Admission.check` requires; `Sec-Fetch-Site` passes unchanged (a door's own page is same-origin).
- Cache (`HttpCache`): the mount cache's rules, applied in the door: `GET`, no `Range`, no `Upgrade`, not a navigation, the WebView accepts gzip; answered `200` without `Set-Cookie`, `Vary` at most `Accept-Encoding`, `immutable` without `no-store`/`no-cache`/`private`. Content-hashed Vite assets without `cache-control` get the immutable header in the door too (machines with an older Kivotos). Cacheable requests go upstream with `accept-encoding: gzip` exactly. Key: machine id, the `gzip` variant and the full request target with query. Entries live in `<cacheDir>/kivotos-http/<sha256(machine id)>/` as `<name>.body` plus `<name>.json`, written to temp files, synced, renamed, `.json` last, and only when the whole body reached the WebView and matched any `content-length`; opening the cache deletes everything else. Concurrent misses fetch once (`claim`/`release`). The cap is 256 MB over all machines (the computer-side default; a dsh client is ~6 MB and batches change with every dsh launch), least recently used first; Android may also reclaim `cacheDir`. A removed machine's directory is deleted on the next `setMachines`.
- Pre-fetch (`Prefetch`): when the app starts (first `setMachines` of the process), when a machine is added, and when a machine is reachable again (its `AttentionService` stream connects, or a network comes up after a failed try), the app reads the machine's index through its door, parses it like `bootResources` (boot graph batches and `./assets/` links), and fetches the missing resources through the door, two at a time over all machines, so they are stored by the rules above. A graph `rev` equal to the last complete pre-fetch (`<machine dir>/rev`) skips it; an index is read at most once a minute per machine. On a metered network it runs only while the app is in the foreground and otherwise waits for the next foreground. Failures only reach logcat (tag `KivotosCache`, which also logs `hit` and `stored`).
- `AttentionService` reaches relay machines through their doors (it needs the relay session) and tailnet machines directly: the event stream needs nothing the door adds.

## Security invariants

These must never regress. `packages/kivotos/test/fences.test.ts` covers the pure parts; run `npm test` after touching `src/index.ts` or `src/proxy.ts`.

- Listener admission (`Admission.check`), applied to every HTTP request and every WebSocket upgrade, in this order:
  1. `Host` names this node (bind address, Tailscale IPs, MagicDNS name), else `421`.
  2. `sameSite`: no `Sec-Fetch-Site: cross-site`, and any `Origin` equals the request authority (`Origin: null` refused), else `403`.
  3. Source address is not one of this node's own IPs unless `allowSelf`, else `403`.
  4. `tailscale whois` user equals this node's user, else `403`. Tagged devices and non-tailnet addresses have no user.
- The listener binds only the Tailscale address (`listenHost` or the node's Tailscale IPv4), never `0.0.0.0` or a LAN address.
- The loopback login cookie never reaches the browser. `forwardHeaders` drops the browser's `Origin`, `Referer`, `Cookie`, `Host`, and `Sec-Fetch-*`; `forwardHttp` and `forwardUpgrade` strip `Set-Cookie` from upstream responses.
- Every dsh-side route (`/kivotos/peer/<id>/`, `/kivotos/peer/<id>/api/remote.mux`, `/kivotos/peers`, `/kivotos/links`, `/kivotos/relay`, `/kivotos/trace/client`, `/kivotos/attention`, `/kivotos/attention/seen`) checks `ctx.connection.requestRejection` before doing anything else.
- Hop guard: peer mounts set `x-kivotos-hop` on forwarded requests and answer `508` to requests that already carry it. Hops never chain.
- The mount cache answers only after the mount's `requestRejection` check, and stores only responses that are identical for every caller (rules in "Mount cache"): never one with `Set-Cookie` or a `Vary` beyond `Accept-Encoding`. Trace records never hold a query string, only `tracePath`'s fingerprint.
- `injectStorageNamespace` and `guardDesktopBoot` escape the peer id or mount prefix so it cannot close the injected script.
- Kivotos never runs `tailscale serve` and never changes Tailscale configuration.
- Relay sessions: nothing is served or sent before `secureAccept` / `secureDial` returns. The dialing side pins the target's node id; both sides check a proof that binds the federation key to both certificates of that session. `test/relay.test.ts` covers outsiders and a relay in the middle.
- The federation key, the peer proof key and the node's private key never go to the relay; only the network id and relay token do.
- `/kivotos/links` and `/kivotos/relay` check `ctx.connection.requestRejection` first: the invite they return is the federation key.
- The app's loopback doors serve only connections whose first request carries `MachineProxy.cookie`, never forward that cookie, and refuse requests with any `Origin` other than the door's own.

## Two-instance lab

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
