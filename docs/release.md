# Release

All workspaces share one version and release together.

## Two steps

A release has exactly two steps. The agent does the first, the user authorizes the second.

**Preparation** (local, reversible — agent does this):

- format, lint, typecheck all green
- resolve the release source to one commit and confirm that commit's existing CI is green
- classify the diff from the previous stable to the release source as patch or minor, then show the
  target version and rationale to the user
- draft the changelog, show it to the user, wait for review
- run the pre-release sanity check, surface findings to the user

**Go-ahead** (user says "go ahead"):

- commit the approved release inputs locally
- run the release, which bumps the version and pushes the prepared branch and tag
- create the release heartbeat immediately and babysit it to completion

Rules that apply to both steps:

- Last-minute changes always need approval. Every time.
- No code changes bundled into the changelog commit or the release commit. Code shims live in their own commit, reviewed on their own merits.
- A sanity-check finding is information, not a directive. The agent surfaces it; the user decides.
- Invoking a release skill is intent to start the flow, not blanket authorization to tag and push.
- If the user asks for a release preview, show the prospective changelog/release contents and answer questions, but do not commit, tag, push, or run release commands until they explicitly authorize the release.

## Release source and CI

The default release source is `origin/main`. Fetch `origin`, then record the
resolved commit. The default release checkout is a clean local `main` whose
`HEAD` equals `origin/main`.

An explicit user instruction can select another ref, such as a hotfix commit or
tag. Resolve that ref once and apply every source, diff, and CI check to that
commit instead of `origin/main`.

Before making release-preparation commits, confirm the existing CI run for the
resolved commit is green. Pending CI is watched to completion. Release
preparation then stays local through the changelog, any explicitly requested ACP
catalog update, lockfile preparation, and the version commit. After approval,
commit the prepared inputs locally and run the release command. Its branch and
tag push is the one remote release batch; the branch push to `main` starts
`ci.yml` for the complete release commit.

## Release branch discipline

While you finalize a release on `main`, use a temporary `next` branch for work intended for the following
release. This applies to both beta and stable releases.

- Create each new `next` from freshly fetched `origin/main`. Reuse it while active.
- "This goes to next" means create the PR against `next` or retarget an existing
  PR, and keep that destination through delivery.
- Keep `next` current by merging `origin/main` into it as release fixes land.
  Avoid rebasing this shared branch because agents and open PRs depend on its history.
- After the release ships, bring `next` up to date and open a `next` → `main` PR.
  Pass CI and merge without squashing away the individual PR commits needed for
  the changelog. Retarget remaining PRs based on `next` to `main` and delete the integrated
  `next`. Create it fresh when needed again.

**PR checks:** the only checks this repository runs are `.github/workflows/ci.yml`
(the per-package test suite) and the lefthook pre-commit hooks (format → lint →
typecheck). `ci.yml` targets `main` only, and GitHub permits only squash merges.
If you adopt a `next` integration branch, enable `ci.yml` and required-check
protection for it, run it on its pushes, allow merge commits for the integration
PR, and handle PR base changes (`edited` events) so a retargeted PR runs checks
against its new base; GitHub's default PR events do not cover this.

### Hotfix from a release tag

If `main` contains changes you do not want to release, branch from the affected
release tag and cherry-pick only the required fixes. Run the local checks on that branch, then
use the normal release flow with it as the explicit source, choosing a new patch
or beta version. Ensure the fixes and changelog also reach `main` and any active
`next`, preserving newer development and version changes there. This is a
short-lived hotfix branch, not another maintained release track.

## ACP catalog updates

ACP catalog work enters a release through an explicit user request:

- **Check ACP drift** — run `npm run acp:version-drift:check`. When drift exists,
  run `npm run acp:version-drift:update`, verify the catalog, and include the
  update in the local release-preparation commits.
- **Update ACP** — run `npm run acp:version-drift:update`, verify the catalog, and
  include the update in the local release-preparation commits.

The release authorization covers the requested ACP commit. It ships in the same
release push as the changelog and version commit.

## Two paths

There are two supported release paths:

1. **Direct stable release**: you are ready to ship the resolved release source to everyone immediately (default `origin/main`).
2. **Beta flow**: release candidates on the `beta` channel. Each beta folds into the series' single changelog entry.

Kivotos has one linear release track: a stable tag follows the `vX.Y.Z-beta.N`
tags that led to it, and promotion never reuses a beta tag.

## Release version decision

Every fresh release starts by classifying the full diff from the previous
stable to the resolved release source. The highest-impact change determines the
version:

- **Minor** — a user would experience the release as a significant upgrade. This
  includes substantial new workflows, providers, forges, platforms, integrations,
  or meaningful expansions of existing capabilities. Foundational internal work
  also qualifies when it materially changes reliability, performance,
  compatibility, deployment, or operation; diff size alone does not.
- **Patch** — fixes, polish, small enhancements, and reliability or performance
  improvements within existing capabilities. Follow-up corrections to a minor
  release are patches.

The release agent selects patch or minor during preparation and presents the
target version with the changelog for approval. Agents never select a major
version autonomously. A major release requires an explicit user instruction and
approval; Kivotos remains on major version zero until that deliberate decision.

Version bumps are never used to retry a failed build. Retry the existing version
as described in **Fixing a failed release build**.

## Standard release (stable)

Before running any stable release command:

- Make sure the resolved release source passed CI, the approved release inputs are committed locally on the intended branch, and the working tree is clean.
- **Run `npm run format`, `npm run lint`, and `npm run typecheck` and commit any resulting changes BEFORE you start any `release:*` command.** `release:check` runs `npm install --workspaces --include-workspace-root` as part of `release:prepare`, which can mutate `package-lock.json` (e.g. churning `"dev": true` markers on optional deps). The next step, `version:all:*`, runs `npm version` which aborts when the working tree is dirty. If this happens mid-flight you have to commit the lockfile churn before retrying — and the pre-commit format hook will reject a lockfile-only commit because oxfmt internally skips `package-lock.json` while lefthook's glob still matches it. Avoid the whole mess by running format/lint/typecheck first, then `release:prepare` once on its own to absorb any lockfile churn into a normal commit, then start the release.
- Do not use a release command as a substitute for checking whether the current commit is actually ready.

```bash
npm run release:check
# Run exactly one version command, matching the approved decision:
npm run version:all:patch
npm run version:all:minor
npm run release:push
```

This bumps the version across all workspaces, runs the checks, and pushes the
branch and tag. Nothing publishes: every workspace package is `private`, and the
`release:publish*` scripts are gone, so each composite `release:*` script runs
check → version → tag push.

The push starts `.github/workflows/ci.yml` for the complete release commit, and
that is the only automation. Desktop builds, mobile store submissions, and
release-asset uploads are manual steps; see
[Desktop](#staged-rollout-stable-channel) and [Mobile builds](#mobile-builds).
Register the GitHub Release by hand once the assets are uploaded (see
[Fixing a failed release build](#fixing-a-failed-release-build)).

No image is published for a release: there is no Docker publishing workflow, and tag pushes do not publish `kivotos:X.Y.Z`, `kivotos:latest`, or `kivotos:X.Y.Z-beta.N`. Build the image locally from the release commit and tag it `kivotos:X.Y.Z` (stable) or `kivotos:X.Y.Z-beta.N` (beta); see [Docker](docker.md).

The production relay is the Elixir service in [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay), with its own deployment process. Kivotos releases and pushes to this repository do not deploy it. The Cloudflare relay code and workflow in this repository are legacy and are not used in production.

**Stable means stable.** If the user says "stable" or "ship stable", do not ask whether they want a beta first. They picked stable; treat it as a direct stable release. Only run the beta flow when the user explicitly says "beta".

## Manual step-by-step

```bash
npm run typecheck            # Verify the exact commit you intend to release
npm run release:check        # Typecheck, build, dry-run pack
# Run exactly one approved version command:
npm run version:all:patch
npm run version:all:minor
npm run release:push         # Push HEAD + tag (the branch push starts ci.yml)
```

## Beta flow

```bash
npm run release:check
npm run version:all:beta:patch   # Start the next patch beta line
npm run version:all:beta:minor   # Start the next minor beta line
npm run release:push             # Push HEAD + tag
# ... build and test the desktop and mobile artifacts yourself ...
npm run version:all:beta:next    # Optional: cut X.Y.Z-beta.2, beta.3, ...
npm run version:all:promote      # Promote X.Y.Z-beta.N to stable X.Y.Z
```

- Beta tags use prerelease versions like `v0.1.41-beta.1`, and the matching GitHub release is marked as a prerelease by hand
- Desktop and APK assets for a beta are built and uploaded by hand; nothing builds or uploads them for you
- `version:all:promote` creates a fresh stable tag like `v0.1.41`; the final release never reuses the beta tag
- Desktop assets come from the Electron package at `packages/desktop`
- Run the Linux artifact checks yourself, with both restricted and usable user namespaces, before shipping; see [packaged desktop smoke](testing.md#packaged-desktop-smoke). Keep the installed-package and AppImage checks together.
- Beta releases use Electron's `beta` update channel. Users on the stable channel only receive stable releases; users on the beta channel receive beta releases and the final stable release when it ships.
- **A beta series has one changelog entry.** Each beta folds into it and renames its heading to the new `## X.Y.Z-beta.N`. Promotion renames it to the stable heading. See the Changelog policy section.

Use the beta path when you need to:

- smoke a build yourself before promoting it to everyone
- test a build manually in a Linux or Windows VM
- send a build to a user who is hitting a specific problem
- iterate on `beta.1`, `beta.2`, `beta.3`, and so on before deciding to ship broadly

## Staged rollout (stable channel)

Stable desktop releases go out via a linear time-based rollout for automatic update checks: 0% admitted when the updater manifests appear, 100% admitted 36 hours later, linear ramp in between. Manual checks bypass the rollout so a user can install immediately when they click **Check**. Beta releases bypass the rollout entirely — beta users always receive updates immediately.

The rollout is driven by a `rolloutHours` field in the updater manifests
(`latest-mac.yml`, `latest-linux.yml`, `latest.yml`) alongside a `releaseDate`.
Nothing stamps them for you: build the desktop artifacts, then stamp and upload
the manifests by hand.

Keep the GitHub Release as a draft while you upload the installers/packages
(`.dmg`, `.zip`, `.exe`, `.AppImage`, etc.) and the manifests, then publish it.
Drafts do not appear in GitHub's releases feed, and updater clients keep seeing
the previous complete release until all three manifests are available.

```bash
# Default ramp: 36 hours from the release date.
node scripts/stamp-rollout.mjs \
  --release-date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --rollout-hours 36 \
  latest-mac.yml latest-linux.yml latest.yml
```

A manifest keeps the value it already has for any flag you omit, and at least
one of the two flags is required. The updater renderer polls every 30 minutes,
so an active stable user can take up to that long to be evaluated against the
rollout window. Clicking **Check** is manual and bypasses rollout admission.

### Default behavior

Stamp `--rollout-hours 36` when you upload the manifests. No extra action after that.

### Instant-admit release (rollout_hours=0)

For a release that should admit everyone immediately (low-risk change, doc-only, hotfix, or just a release you want out fast), stamp the manifests with `--rollout-hours 0` before uploading them:

```bash
node scripts/stamp-rollout.mjs --rollout-hours 0 latest-mac.yml latest-linux.yml latest.yml
```

### Adjusting an already-published release

To change the rollout duration on a release that already shipped — flip a hotfix to instant admit, or slow a release down — re-stamp the uploaded manifests and replace them on the GitHub release. Nothing rebuilds; only `rolloutHours` changes, and the existing `releaseDate` is preserved, so the rollout clock keeps ticking from the original publish time.

```bash
# Hotfix (instant admit) on an already-shipped release.
node scripts/stamp-rollout.mjs --rollout-hours 0 latest-mac.yml latest-linux.yml latest.yml

# Slow the rollout down (total duration 72h since the original release).
node scripts/stamp-rollout.mjs --rollout-hours 72 latest-mac.yml latest-linux.yml latest.yml
```

`--rollout-hours` is **total duration since the original release date**, not "extend by N more hours from now." Because the omitted `--release-date` leaves the manifest value in place, the clock keeps running from where it started. If `v0.1.42` was published 2h ago and you stamp `--rollout-hours 72`, the ramp finishes 70h from now.

### Releasing during an active rollout

If you ship N+1 while N is still ramping, N+1 starts a fresh rollout from its own publish timestamp. N's rollout effectively ends — the newer manifest supersedes it. Rollout-aware clients revalidate the manifest for up to five seconds before installing a downloaded update on quit. If N+1 has replaced N but the client is not admitted to N+1 yet, it skips the downloaded N and waits rather than installing two updates in succession. If revalidation times out, the app exits without installing the cached update.

If N+1 is a hotfix for a bug in N, stamp N+1's manifests with `--rollout-hours 0` so the users who already got N reach the fix fast.

### macOS system floor

The desktop app requires macOS 13 or newer. Keep both release guards when the floor changes:

- `packages/desktop/electron-builder.yml` writes the macOS version to `LSMinimumSystemVersion` for new installs.
- `scripts/merge-mac-manifest.mjs` writes the matching Darwin kernel version to `minimumSystemVersion` in the update manifest. Existing clients check this before downloading an update.

macOS 13 maps to Darwin 22. The two values use different version domains; do not copy the macOS version into the update manifest.

### Limitations

- **No pause / kill switch.** To stop new admissions, ship a superseding release. Clients revalidate on quit and will not install the superseded download, but a client that already completed installation cannot be recalled; ship a hotfix `+1` patch.
- **No rollback.** `allowDowngrade = false`. Bad release = ship a hotfix.
- **Bootstrap caveat.** Clients running a build older than the rollout feature ignore `rolloutHours` and admit immediately. Rollout protection only applies to clients running the rollout-aware version or later.

## Mobile builds

Mobile store builds are not automated here: no tag push starts an EAS or store build, and the only workflows under `.github/workflows` are `ci.yml` and `deploy-relay.yml`. Build and submit iOS and Android yourself from `packages/app`.

EAS uses the local app version source. `packages/app/app.config.js` derives the native version from the package version. Android `versionCode` is `major * 1_000_000 + minor * 1_000 + patch`. iOS reserves 1,000 build slots per app version: beta `N` uses slot `N`, and stable uses slot `999`. For example, `0.2.6-beta.2` appears in App Store Connect as version `0.2.6` build `2006002`; stable uses build `2006999`. Rebuilding the same tag produces the same native build number; if a store has already accepted a binary and you need a different binary, cut the next beta or patch instead of relying on EAS remote auto-increment.

Build with the `production` profile and submit from `packages/app`; `eas.json` holds the profiles and the store targets (`submit.production` sends Android to the `production` track and iOS to the app id in `submit.production.ios`):

```bash
cd packages/app
npx eas build --platform ios --profile production
npx eas build --platform android --profile production
npx eas submit --platform ios --profile production
npx eas submit --platform android --profile production
```

Beta testers are managed in App Store Connect. Distribute a beta build from there to the `Kivotos Beta` external group and submit it for Beta App Review.

### Watching mobile builds from the terminal

Use the EAS CLI from `packages/app/`:

```bash
cd packages/app

# Recent builds (newest first). Pipe to jq for status only.
npx eas build:list --limit 8 --non-interactive --json | jq '.[] | {platform, status, appVersion, gitCommitHash}'

# Filter by platform.
npx eas build:list --platform ios --limit 5 --non-interactive --json
npx eas build:list --platform android --limit 5 --non-interactive --json

# Inspect a specific build.
npx eas build:view <build-id>

# Stream logs for a build.
npx eas build:view <build-id> --json | jq '.logFiles[]'
```

A build's `gitCommitHash` must match the release tag commit. `status` walks through `NEW` → `IN_QUEUE` → `IN_PROGRESS` → `FINISHED` (or `ERRORED`/`CANCELED`).

Once a build is `FINISHED`, the release still needs the store submission: Android to its Play Store track, and iOS to TestFlight **and** App Store review. The release is not done until every platform is on its way through the stores. App Store Connect (review state for the matching version/build) and the Play Console track are the final ground truth.

## Release completion and heartbeat

A release is **in progress** after the tag push. Report it as
**shipped** only after every applicable build, asset, manifest, and
store submission passes the completion checklist.

Immediately after every beta, stable, or promotion tag push, create a heartbeat
that resumes the release in the current conversation. Create it automatically
with `create_heartbeat`. The heartbeat owns the release until it either reaches
the completion checklist or finds a failure that needs new user authority.

Each heartbeat checks the release tag commit, the `ci.yml` runs for the
release branch, the GitHub Release body and assets, and the desktop updater
manifests. Inspect the GitHub Release itself and confirm that the macOS, Linux,
Windows, and Android APK assets are present along with the channel manifests
(`latest-mac.yml`, `latest-linux.yml`, and `latest.yml` for stable;
`beta-mac.yml`, `beta-linux.yml`, and `beta.yml` for beta).

For stable releases, also confirm every required mobile build, store
submission, and review submission for the release commit. For betas, confirm
the TestFlight distribution and Beta App Review path. Delete the heartbeat only after every applicable checklist item passes,
then report the release as shipped.

Pattern:

```jsonc
// mcp__kivotos__create_heartbeat arguments
{
  "name": "vX.Y.Z release babysit heartbeat",
  "cron": "*/10 * * * *",
  "timezone": "UTC",
  "maxRuns": 120,
  "expiresIn": "24h",
  "prompt": "Resume the vX.Y.Z release babysit for commit <sha>. Check the `ci.yml` runs for the release branch; the GitHub Release body, expected desktop/APK assets, and channel manifests; the desktop updater manifests; and the Docker image build. Completion requires every applicable checklist item. For stable, require the mobile store submissions to be on their way; for beta, the TestFlight distribution and Beta App Review path. If work is pending, wait for the next heartbeat. If a failure can be retried safely for the same version, follow the failed-release procedure; otherwise report the blocker. When every applicable completion-checklist item passes, delete THIS heartbeat, report shipped, and stop.",
}
```

Run an immediate status check after creating the heartbeat. The heartbeat handles
later transitions and stops itself when the release is complete.

## Release notes on GitHub

Release notes are not synced automatically, and nothing creates the release for
you. Mirror the matching changelog entry into the GitHub Release body with
`scripts/sync-release-notes-from-changelog.mjs`, which reads `CHANGELOG.md` and
writes the entry for the tag through the `gh` CLI:

```bash
node scripts/sync-release-notes-from-changelog.mjs \
  --repo Rinai-R/kivotos \
  --tag vX.Y.Z \
  --create-if-missing
```

Keep `CHANGELOG.md` correct and re-run the script to re-sync; `--create-if-missing`
creates a draft release when none exists yet. Without `--repo` the script reads
`GITHUB_REPOSITORY`.

## Fixing a failed release build

**NEVER bump the version to fix a build problem.** New versions are reserved for meaningful product changes (features, fixes, improvements). Build/CI failures are fixed on the current version.

Nothing here retries a build for you. Fix the source, then re-run the local
commands (`npm run release:check`, the same `version:all:*` command, and
`npm run release:push`) and rebuild the artifacts you need by hand.

For a Docker-only change, **do not push or force-push a `v*` release tag**:
nothing local depends on one. The image is built locally, so rebuild and re-tag
it from the release commit whenever you need it:

```bash
docker build \
  --build-arg KIVOTOS_VERSION=X.Y.Z-beta.N \
  -t kivotos:X.Y.Z-beta.N \
  -f docker/base/Dockerfile \
  .
```

To move a tag you already pushed onto the commit you actually want:

```bash
git tag -f vX.Y.Z HEAD && git push origin vX.Y.Z --force
```

A failed desktop build leaves the GitHub Release as a draft. Nothing uploads
assets or manifests for you, so rebuild the missing platform's artifacts,
re-upload them with the complete manifest set stamped with one release date, and
publish the draft by hand.

If you decide to publish a release without working desktop builds, inspect its
assets first, then publish it manually:

```bash
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo Rinai-R/kivotos --tag vX.Y.Z)
gh release view "$RELEASE_LOOKUP" --json isDraft,isPrerelease,assets
gh release edit "$RELEASE_LOOKUP" --tag vX.Y.Z --draft=false

# Keep a beta marked as a prerelease:
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo Rinai-R/kivotos --tag vX.Y.Z-beta.N)
gh release edit "$RELEASE_LOOKUP" --tag vX.Y.Z-beta.N --draft=false --prerelease
```

This bypasses the updater-manifest guarantee. Use it only when the release is
intentionally unavailable to desktop updater clients.

## Notes

- `version:all:*` bumps root + syncs workspace versions and `@kivotos/*` dependency versions
- The npm `version` lifecycle regenerates F-Droid changelog files from `CHANGELOG.md` for stable releases only (`npm run fdroid:changelogs`) and stages them, so the release tag carries them. Betas are a no-op. A stable run **aborts the release** if `CHANGELOG.md` has no entry for the version being cut — commit the changelog entry first. See [docs/android.md](android.md) for why these files are generated per ABI.
- `release:prepare` refreshes workspace `node_modules` links to prevent stale types
- `npm run dev:desktop` and `npm run build:desktop` target the Electron desktop package in `packages/desktop`

## Changelog format

Release notes depend on the changelog heading format. The heading **must** be strictly followed:

```
## X.Y.Z - YYYY-MM-DD
## X.Y.Z-beta.N - YYYY-MM-DD
```

No prefix (`v`), no extra text. `scripts/sync-release-notes-from-changelog.mjs` matches the `## X.Y.Z` (or `## X.Y.Z-beta.N`) line for the tag to extract the version. A malformed heading breaks the release-notes sync for that tag.

`CHANGELOG.md` on `main` is also what the app's **What's new** sheet fetches and renders, so the file is a shipped product surface, not just a release input. `##` starts a release and `###` starts a section; the app reads section titles from the document, so renaming or adding one needs no app change. Everything under a section is rendered as Markdown: prose, lists, links, inline code, fenced code, block quotes, tables, and images. Raw HTML does not render — the shared Markdown parser runs with `html: false`, so a `<video>`, `<iframe>` or `<embed>` tag reaches the reader as visible markup. Keep media out of the changelog, or link to it. A GitHub callout renders as a block quote with its `[!NOTE]` marker still in the text. A release entry is what a user reads on a phone the moment they are offered the update — write it for them.

## Changelog policy

- `CHANGELOG.md` holds stable releases and at most one entry for the current beta series.
- The first beta of a version inserts a top entry like `## 0.1.60-beta.1 - YYYY-MM-DD`.
- Each subsequent beta rewrites that entry in place: the heading becomes the new beta number and date, and the body describes the full change from the previous stable release to this beta. Never add a second beta entry.
- The entry is a list of changes, not of PRs. When a later beta reverts, reworks, or follows up on something an earlier beta added, rewrite the bullet to the current behavior or delete it. A stable user never saw the earlier beta behavior, so fixes to it are not "Fixed" bullets.
- Anything that already shipped to stable through a patch release on an older line stays out of the beta entry.
- Stable promotion renames the entry to `## 0.1.60 - YYYY-MM-DD` after a final review.

Older prerelease bodies on GitHub keep the notes they were synced with; `scripts/sync-release-notes-from-changelog.mjs` only writes the release whose tag matches the top entry.

## Changelog ownership

- **The agent running the release writes the changelog entry — beta or stable.** The release context and final wording stay with that agent.
- **Commit history is only an index of the changes. Never draft the changelog from commit subjects or diffs alone.** For every PR in the release range, read the full PR description and every issue it links to before deciding what changed, why users care, or how changes should be grouped. Use the implementation only to verify the resulting understanding.
- Every entry, beta or stable, is drafted from the previous stable release to the release source. For a later beta, read the PRs since the previous beta tag, then rework the existing entry so each bullet still describes current behavior. Review the result against the changelog policy below, show it to the user, and wait for approval before committing it.

## Changelog wording

Each bullet is a compact factual record of
product behavior that changed.

- **Name the exact change.** Prefer `Added <capability>`, `Removed <behavior>`,
  `Changed <behavior>`, or `Fixed <failure> when <condition>`.
- **Keep the scope exact.** A conditional bug is not a general reliability problem. Do not
  broaden one failure into claims that Kivotos is now faster, smoother, responsive, or reliable.
- **Use concrete product and runtime terms.** Git polling, persisted cache, provider catalog,
  and WebSocket reconnects can identify the affected behavior. Component names, internal
  modules, code symbols, and implementation techniques cannot: omit `WorkingIndicator`,
  `reconcileAndEmitWorkspaceUpdates`, remounts, memoization, and controlled inputs.
- **State the consequence only when the change itself is unclear.** Keep the condition that
  makes the consequence true. Do not replace a precise change with a broad benefit claim.
- **Do not invent context.** Mention an upgrade, platform, workload, or user action only when
  the PR or linked issue establishes that scope.

| Avoid                                                        | Write                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Kivotos stays responsive with many idle Git workspaces       | Removed periodic Git polling for idle workspaces      |
| Incompatible saved app data no longer crashes after upgrades | Fixed crash when persisted cache was incompatible     |
| Splitting layouts no longer remounts the active agent        | Fixed scroll position resetting when splitting a pane |
| Mobile model selector is faster and more straightforward     | Added search to the mobile model selector             |

Test each bullet against the source PR and issue: can a reviewer point to the exact behavior
that changed, the failure that was fixed, or the capability that was added? If the bullet only
claims a general improvement, rewrite it with the concrete change.

- **Use the entry's release scope.** Include changes within the matching range in **Changelog scope**.
- **Collapse internal iterations within that scope.** Present a feature added and fixed in one range as working.
- **Cut low-signal entries.** "Toolbar buttons have consistent sizing" is too granular. Combine small polish items or drop them.

## Changelog conciseness

Every bullet must be scannable at a glance. The changelog is not release documentation — it's a list.

- **One sentence per bullet, max.** If a bullet contains two sentences, the second one is doing work that belongs in product docs, not the changelog. Cut it.
- **No trailing periods.** Bullets are list items, not prose. Drop the period at the end of every bullet, including the period inside any bolded lead-in. `**Configurable terminal scrollback**` not `**Configurable terminal scrollback.**`.
- **One line per bullet.** If a bullet wraps to three lines in a narrow column, it's too long.
- **Split bullets that pack multiple distinct changes.** If a bullet uses "and", "plus", a comma list, or an em-dash to chain several independent improvements, break them into separate bullets — even when they share a theme or author. One bullet = one user-facing change.
- **Trim qualifying clauses.** Drop "with a hint shown when…", "matching the CLI's behaviour", "across common install shapes". If the detail doesn't change whether a user cares, cut it.
- **Stop after identifying the change.** Do not explain LAN/WAN topology, TLS handshakes, IPC, or other architecture in a changelog bullet. Put necessary background in product docs.
- **Attribution follows the split.** When you split a dense bullet, move each PR/author to the bullet it belongs to. Never duplicate the same PR across multiple bullets.

## Changelog attribution

Every changelog bullet must credit contributors and link to the PR(s) that delivered the change. This is not one-PR-per-line — a single bullet describes a user-facing change and may reference multiple PRs.

Format: append `([#123](https://github.com/Rinai-R/kivotos/pull/123) by [@user](https://github.com/user))` at the end of each bullet. For changes spanning multiple PRs or contributors:

```markdown
- Voice mode now works on tablets with proper microphone permissions. ([#210](https://github.com/Rinai-R/kivotos/pull/210), [#215](https://github.com/Rinai-R/kivotos/pull/215) by [@alice](https://github.com/alice), [@bob](https://github.com/bob))
```

Rules:

- **Always link the PR number** as `[#N](https://github.com/Rinai-R/kivotos/pull/N)`.
- **Always link the contributor's GitHub profile** as `[@user](https://github.com/user)`.
- **One bullet = one user-facing change**, regardless of how many PRs went into it. Group related PRs on the same bullet.
- **De-duplicate contributors.** If the same person authored multiple PRs in one bullet, list them once.
- **Only credit external contributors.** Skip attribution for [@Rinai-R](https://github.com/Rinai-R). The changelog credits community contributions — core team work is the default.
- **Credit the commit author, not the PR opener.** A maintainer often opens a PR that lands work authored by someone else (cherry-pick, rebase of a contributor's branch, manual extraction from a stacked PR). The squash commit preserves the original commit's author, but `gh pr view N --json author` returns the PR opener — using that field will silently mis-credit the work to the maintainer (and then the "skip @Rinai-R" rule drops the attribution entirely). Always resolve attribution from commit authors.

  Use this command to get the GitHub logins for each PR:

  ```bash
  gh pr view N --json commits --jq '[.commits[].authors[].login] | unique | .[]'
  ```

  This returns every distinct GitHub login that authored or co-authored a commit in the PR. Use those logins for attribution. Fall back to `gh pr view N --json author` only if the commits command returns nothing (which should not happen for merged PRs).

  When listing PR numbers, `git log --format='%H %s' v<previous>..<release-source-sha> | grep -E '\(#[0-9]+\)$'` pulls the PR number out of squash commit subjects.

## Changelog ordering

Entries within each section (Added, Improved, Fixed) are ordered by user impact:

1. **User-facing features and changes first** — things users will notice, want to try, or that change their workflow.
2. **Quality-of-life improvements** — polish, performance, smoother interactions.
3. **Internal/infra changes last** — only include if they have a tangible user benefit (e.g. "faster startup" is user-facing even if the fix was internal).

## Pre-release sanity check

Before cutting a **stable** release, the release agent reviews the diff as a last line of defence against shipping bugs. Skip this for betas — the beta itself is the smoke test, and gating each beta on a code review defeats the point of using betas as fast release candidates.

Review the diff between the latest release tag and the resolved release source. Focus on:

1. **Breaking changes** — especially in the WebSocket protocol, agent lifecycle, and any server↔client contract.
2. **Backward compatibility** — the important direction is old app clients talking to newly updated daemons. Users update desktop and daemon first, then keep running the old app for a while. Flag anything that breaks old clients against new daemons or requires both sides to update in lockstep.
3. **Regressions** — anything that looks like it could break existing functionality.

Use `git diff <latest-release-tag>..<release-source-sha>` as the review input. This is a deep sanity check, not a full code review. If anything looks risky, investigate before proceeding and surface the finding to the user.

## Changelog scope

Changelog scope follows the release being described:

Every entry covers `previous stable release → release source`: first beta, later beta, direct stable release, and promotion alike. The beta entry always reads as the stable entry would if the beta were promoted today.

## Completion checklist

### Beta release

- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Fold this beta into the series' single `CHANGELOG.md` entry (heading `## X.Y.Z-beta.N - YYYY-MM-DD`, previous stable → release source), review it against the changelog policy, get approval, and commit it before cutting the release
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] Release preparation stayed local until `release:push` pushed the complete branch and tag
- [ ] `npm run release:check` and the approved `npm run version:all:beta:*` command completed successfully
- [ ] `ci.yml` is green for the complete release commit on `main`
- [ ] The desktop and APK artifacts were built and uploaded by hand, the GitHub release is marked as a prerelease, and it carries the changelog body and the three beta manifests (`beta-mac.yml`, `beta-linux.yml`, `beta.yml`)
- [ ] The release notes were synced into the prerelease body with `scripts/sync-release-notes-from-changelog.mjs`
- [ ] The TestFlight distribution, external beta group, and Beta App Review submission were completed by hand
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed

### Stable release (or promotion)

- [ ] Run the pre-release sanity check (see above) and address any findings
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Ensure the approved release inputs are committed locally and the git worktree is clean before running any release command
- [ ] Ensure local `npm run typecheck` passes on that exact commit before running any release command
- [ ] Update `CHANGELOG.md` with user-facing release notes (features, fixes — not refactors). Promotion renames the series' `## X.Y.Z-beta.N` entry to `## X.Y.Z - YYYY-MM-DD` and re-checks it covers the full release
- [ ] Verify the changelog heading follows strict `## X.Y.Z - YYYY-MM-DD` format
- [ ] Release preparation stayed local until `release:push` pushed the complete branch and tag
- [ ] `npm run release:check` and the approved `npm run version:all:*` command completed successfully
- [ ] `ci.yml` is green for the complete release commit on `main`
- [ ] The desktop artifacts and manifests were built and uploaded by hand, the GitHub Release is published, and it carries the changelog body and every expected macOS, Linux, Windows, and Android APK asset
- [ ] The GitHub Release contains `latest-mac.yml`, `latest-linux.yml`, and `latest.yml`
- [ ] `latest-mac.yml` contains the current `minimumSystemVersion` guard, and the manifests were stamped with the intended `rolloutHours`
- [ ] The mobile store builds, store submissions, and review submissions were completed by hand
- [ ] The release notes were synced into the release body with `scripts/sync-release-notes-from-changelog.mjs` and match the stable changelog entry
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed
