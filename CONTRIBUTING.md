# Contributing to Kivotos

Kivotos is a plugin for DeepSeek Harness (dsh), plus an Android app and a relay server. This file is how to build and test each of them, and how a change gets merged. Architecture and conventions live in [CLAUDE.md](CLAUDE.md); read the part of it that covers what you are about to change.

## Prerequisites

| Tool                               | Version                                                                                  | Needed for                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [Node](https://nodejs.org)         | `^22.19.0 \|\| >=24`                                                                     | the plugin, the app, the build and test tooling           |
| [Go](https://go.dev/dl/)           | `1.25` or newer                                                                          | the relay                                                 |
| JDK                                | 17 (Temurin tested)                                                                      | the Android APK                                           |
| Android SDK                        | `platforms;android-36`, `build-tools;36.0.0` (React Native 0.86 compiles against SDK 36) | the Android APK                                           |
| [dsh](https://deepseek.com)        | `0.2.0-rc.2`                                                                             | running the plugin (`npm install` alone does not need it) |
| [pnpm](https://pnpm.io)            | 11                                                                                       | `dsh plugin add`, which the lab and the dsh check run     |
| [Tailscale](https://tailscale.com) | any                                                                                      | only if you want to exercise federation over a tailnet    |

`npm install` runs the plugin's `prepare` script, which builds `dist/` — no separate build step is needed before the first test run.

## Build and test

From the repository root:

```sh
npm install            # installs tooling, sets up the git hooks, builds packages/kivotos/dist
npm run build          # rebuild dist/ after changing packages/kivotos/src
npm run typecheck      # tsc for packages/kivotos and packages/mobile
npm run lint           # oxlint
npm run format         # oxfmt, in place; `npm run format:check` only reports
npm test               # node --test on packages/kivotos/test/*.test.ts
```

`npm test` runs the plugin's regression tests directly on the TypeScript sources (Node type stripping): the admission fences, index rewrites, the federation derivation, relay sessions, the phone's machine list, the mount cache, the trace log and the proxy helpers.

The relay is its own Go module and its own test run:

```sh
cd packages/relay
gofmt -l .             # must print nothing
go vet ./...
go test -race ./...    # includes end-to-end tests against a real relay on loopback
go build -o kivotos-relay .
```

The Android APK needs the JDK and the Android SDK:

```sh
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/Android/sdk
npm run apk -w packages/mobile
# packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

`expo prebuild` regenerates `packages/mobile/android/` on every run, and that directory is gitignored: change native behavior in `packages/mobile/modules/` or in `app.json`, never in the generated project.

## Run a lab in one command

`scripts/lab.sh` starts a relay built from `packages/relay` and two dsh instances, each with its own `DSH_HOME`, both already members of the same relay network. It prints each instance's UI URL and the invite link, and removes everything it created when you stop it with Ctrl-C.

```sh
scripts/lab.sh                                   # relay on 7411, dsh on 7412 and 7413
scripts/lab.sh --lab-dir /tmp/kivotos-lab --relay-port 8411 --web-a-port 8412 --web-b-port 8413
scripts/lab.sh --keep                            # keep the files for inspection
```

The script needs `dsh` on `PATH` (`--dsh <path>` or `$DSH_BIN` override it) and Go. It never touches `~/.dsh` or an installed dsh: everything it writes is under `--lab-dir`, which defaults to `.lab/` in the repository root.

The two instances run relay-only (`listen: false`, `discover: false`), so the lab needs no Tailscale and never mounts the machines of your own tailnet. To exercise the tailnet listener, the phone layout, or an Android device against a lab, use the two-instance lab in [CLAUDE.md](CLAUDE.md#two-instance-lab) instead — it sets `allowSelf` and `staticPeers` and runs the listener on the tailnet address.

## Relay (`packages/relay/`)

The relay is deliberately split into domain packages — `wire`, `registry`, `admission`, `tunnel`, `admin`, `config`, `cmd` — instead of the single flat root package the Go skill recommends by default. Dependencies point one way: `wire` is imported by all; `registry`, `admission` and `tunnel` never import each other (they meet through interfaces declared by the consumer); `admin` sits on `registry` and `tunnel`; `cmd` assembles everything. Put a change in the package that owns the thing it changes, and keep that shape.

Federation, the wire protocol and the relay's security invariants are documented in [CLAUDE.md](CLAUDE.md#relay-packagesrelay); anything touching the protocol must stay in step with `packages/kivotos/src/federation.ts` and the app's `Network.kt`.

## Commits

- Write commit messages in English, imperative mood, one line (`Add the relay's member roster`). Add a body when the reason is not obvious from the diff.
- The lefthook pre-commit hook runs the formatter check, the linter and the typecheck on what you staged, and it runs by itself after `npm install`. Fix what it reports and re-stage; never commit with `--no-verify` or similar.
- Format the files you touched before committing: `npx oxfmt <files>` (or `npm run format`).
- Add a line under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md) for anything a user can notice.
- Update [CLAUDE.md](CLAUDE.md) when you change the area it describes — architecture, conventions, invariants, or the lab.

## Pull requests

Open the PR against `main`, in English, and say what the change does and how you verified it. Reference the issue it closes.

A PR runs these CI jobs; all of them must pass:

| Job                                  | What it checks                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `check (node 22)`, `check (node 24)` | format, lint, typecheck, the built `dist/`, `npm test`                                                       |
| `relay (go)`                         | `gofmt -l`, `go vet`, `go test -race`, a build, the container image starting, and the compose file           |
| `relay image`                        | the relay image builds for amd64 and arm64 (pushed only on `main` and tags)                                  |
| `android apk`                        | `expo prebuild` and `gradlew assembleRelease`; uploads the APK as an artifact                                |
| `dsh compatibility` (nightly)        | boots the npm `latest`/`next` dsh with the plugin and checks every coupling point (`scripts/dsh-compat.mjs`) |

Pushes to `main` and `v*` tags additionally publish the image, and a tag also publishes the npm package and the GitHub Release (`publish npm package`, `publish GitHub Release`). Do not tag or release from a PR.

Report security problems privately through [SECURITY.md](SECURITY.md), never in an issue or a PR.
