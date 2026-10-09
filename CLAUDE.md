# AGENTS.md

Guidance for coding agents working in this repository.

## What this repository is

Kivotos is a plugin for DeepSeek Harness (dsh) 0.2.1-alpha.1. Package `@kivotos/dsh-plugin` in `packages/kivotos/`. Plain ESM JavaScript, no build step, no runtime dependencies.

Kivotos has no UI of its own. It adds three things to dsh:

1. Federation over Tailscale: from any dsh, open the complete UI of any other dsh on the same tailnet that also runs Kivotos, through a reverse proxy.
2. A machine switcher in the dsh sidebar footer.
3. A phone layout below 768px width (slide-in sidebar drawer, backdrop, drawer toggle, safe-area insets).

The repository previously hosted a fork of Paseo. That code is gone; do not reintroduce it or reference it.

## Repository map

- `packages/kivotos/index.js`: host plugin. `Config` (Standard Schema validation and defaults), tailnet listener and its admission, loopback login session, peer mounts, discovery, index rewrites.
- `packages/kivotos/proxy.js`: HTTP and WebSocket forwarding helpers, header filtering, hop marking, `Location` rewriting.
- `packages/kivotos/tailscale.js`: `tailscale` CLI wrapper (`status --json`, `whois --json`, `cert`).
- `packages/kivotos/client.js`: client module (machine switcher, drawer toggle, phone stylesheet and backdrop). `client-env.d.ts` holds its ambient types.
- `packages/kivotos/locale/en.json`, `packages/kivotos/locale/zh.json`: locale dictionaries.
- `packages/kivotos/icon.svg`, `packages/kivotos/cordis.patch.yml`, `packages/kivotos/package.json`: plugin icon, dsh config patch, plugin manifest.
- `packages/kivotos/test/fences.test.js`: `node:test` regression tests.

## Commands

Run from the repository root.

```sh
npm run typecheck     # tsc --checkJs via tsconfig.json
npm run lint          # oxlint
npm run format        # oxfmt (write)
npm run format:check  # oxfmt --check
npm run build         # node --check on index.js and client.js
npm test              # node --test packages/kivotos/test/
```

The lefthook pre-commit hook runs format check, lint, and typecheck. Never skip hooks (`--no-verify` or similar). Fix the failure instead.

## Conventions

- Plain ESM JavaScript with JSDoc types, checked by `tsc --checkJs`. Do not add TypeScript sources or a build step.
- `client.js` builds elements with `React.createElement` (obtained from the dsh module `require("react")`). It must not import dsh client packages.
- Register every resource inside `ctx.effect` or `ctx.on`, and return its cleanup. Unloading the plugin must leave nothing behind.
- All visible text goes through `ctx.locale`. Add every new key to both the `en` and `zh` dictionaries.
- Style only with dsh theme tokens (`--dsw-*`). Literal colors are allowed only in icon artwork.
- Contribute UI through slots with `ctx.slots.inject`.

## Deliberate exception: version-pinned phone stylesheet

dsh ships no phone layout and no slot owns the frame grid. The phone stylesheet in `client.js` therefore reads dsh 0.2.1-alpha.1 internals, which breaks the dsh plugin rule "do not read another plugin's DOM or stylesheet". This is intentional and pinned to dsh 0.2.1-alpha.1.

It depends on:

- CSS-module class suffixes `_sidebarCol`, `_centerCol`, `_rightbarCol`, `_handle`, `_root`, `_header`, `_composerSeat` (matched with `[class*="..."]`).
- The frame, found as `div:has(> [data-shell-overlay])`.
- The attributes `[data-sidebar-collapsed]`, `[data-conversation-header-leading]`, `[data-conversation-scroll]`.

The index rewrites in `index.js` (`coverViewport` for the viewport meta, `credentialedManifest` for the manifest link) match the exact dsh 0.2.1-alpha.1 `index.html` markup and silently do nothing if it changes.

Re-verify all of the above on every dsh upgrade. Keep the exception confined to these places; everything else follows the dsh plugin rules.

## Security invariants

These must never regress. `packages/kivotos/test/fences.test.js` covers the pure parts; run `npm test` after touching `index.js` or `proxy.js`.

- Listener admission (`Admission.check`), applied to every HTTP request and every WebSocket upgrade, in this order:
  1. `Host` names this node (bind address, Tailscale IPs, MagicDNS name), else `421`.
  2. `sameSite`: no `Sec-Fetch-Site: cross-site`, and any `Origin` equals the request authority (`Origin: null` refused), else `403`.
  3. Source address is not one of this node's own IPs unless `allowSelf`, else `403`.
  4. `tailscale whois` user equals this node's user, else `403`. Tagged devices and non-tailnet addresses have no user.
- The listener binds only the Tailscale address (`listenHost` or the node's Tailscale IPv4), never `0.0.0.0` or a LAN address.
- The loopback login cookie never reaches the browser. `forwardHeaders` drops the browser's `Origin`, `Referer`, `Cookie`, `Host`, and `Sec-Fetch-*`; `forwardHttp` and `forwardUpgrade` strip `Set-Cookie` from upstream responses.
- Every dsh-side route (`/kivotos/peer/<id>/`, `/kivotos/peer/<id>/api/remote.mux`, `/kivotos/peers`) checks `ctx.connection.requestRejection` before doing anything else.
- Hop guard: peer mounts set `x-kivotos-hop` on forwarded requests and answer `508` to requests that already carry it. Hops never chain.
- `injectStorageNamespace` escapes the peer id so it cannot close the injected script.
- Kivotos never runs `tailscale serve` and never changes Tailscale configuration.

## Two-instance lab

To exercise federation on one machine, run two dsh instances that federate with each other.

1. Give each instance its own `DSH_HOME` directory so profiles, config, and certificates stay separate.
2. In each instance, add the plugin with an absolute path:

   ```sh
   dsh plugin --profile web add /absolute/path/to/kivotos/packages/kivotos
   ```

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

A change to `client.js` or to the index rewrites is not done until it has been checked in a running dsh:

- Screenshots at 1280px wide and at 390x844.
- On the phone size, drawer open and drawer closed.
- Light and dark themes.
- No console errors.
- No `slot entry crashed` messages.
