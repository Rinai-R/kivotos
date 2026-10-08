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

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code agents.</p>

Kivotos is an open source agentic development environment for desktop, mobile, web, and CLI. Open the desktop app and work: agents, editor, terminals, diffs, pull requests, and a browser in one window. Run many agents at once, each in its own worktree, on one machine or several. The mobile app is the full app, native on iOS and Android.

- **Parallel agents:** Run many agents at once, each in its own worktree.
- **Built-in orchestration:** Agents in Kivotos can create worktrees, launch other agents, and talk to them, across providers.
- **Complete development workflow:** Edit files, review diffs, open pull requests, and run terminals, in split panes you arrange how you want.
- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** iOS, Android, desktop, web, and CLI. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** Kivotos doesn't have any telemetry, tracking, or forced log-ins.

[Run parallel tasks in Kivotos](https://github.com/Rinai-R/kivotos/tree/main/docs): start agents in separate worktrees, review their diffs, run each app, and check it in the built-in browser.

## Plugins

Plugins run on the daemon and show up in every client you connect, with the same UI on desktop, web,
iOS, and Android. Write a plugin once and it is on your phone.

- **UI:** screens, sidebar items, workspace panels, Command Center items, slash commands, composer pills, attachment sources, timeline items, themes.
- **Agent lifecycle:** change configuration, environment, and MCP servers, answer permissions, follow up when a turn ends.
- **Providers:** add a coding agent as a provider.

Install from the registry with `kivotos plugin add owner/slug`, or from Git or a local directory.

**[Plugin docs](https://github.com/Rinai-R/kivotos/blob/main/docs/plugins.md)**

Plugins run with access to your daemon machine and inside connected clients; install only code you trust.

## Getting Started

Kivotos runs a local server called the daemon that manages your coding agents. Clients like the desktop app, mobile app, web app, and CLI connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)
- [Antigravity](https://github.com/Rinai-R/kivotos/blob/main/docs/providers.md)
- [Muse Code](https://github.com/Rinai-R/kivotos/blob/main/docs/providers.md)

### Desktop app (recommended)

Download it from the [releases page](https://github.com/Rinai-R/kivotos/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, open **Settings → your host → Pair Device**.

### Server

For a server, a VM, or any machine without the desktop app. Install the CLI and start the daemon:

```bash
npm install -g @kivotos/cli
kivotos
```

Kivotos starts, then asks whether to enable the end-to-end encrypted relay for device pairing. If you decline, connect directly over TCP, Tailscale, or another VPN. The desktop, mobile, and web apps connect to this daemon like any other host.

For full setup and configuration, see:

- [Docs](https://github.com/Rinai-R/kivotos/tree/main/docs)
- [Connectivity guide](https://github.com/Rinai-R/kivotos/tree/main/docs)
- [Configuration reference](https://github.com/Rinai-R/kivotos/tree/main/docs)

### Docker

Build the image locally, then run the Kivotos daemon and self-hosted web UI in Docker. No image is published:

```bash
docker build -f docker/base/Dockerfile -t kivotos:latest .

docker run -d --name kivotos \
  -p 6767:6767 \
  -e KIVOTOS_PASSWORD=change-me \
  -v "$PWD/kivotos-home:/home/kivotos" \
  -v "$PWD:/workspace" \
  kivotos:latest
```

Open `http://localhost:6767` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/kivotos` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
kivotos run --provider claude/opus-4.6 "implement user authentication"
kivotos run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

kivotos ls                           # list running agents
kivotos attach abc123                # stream live output
kivotos send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
kivotos run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

See the [full CLI reference](https://github.com/Rinai-R/kivotos/blob/main/docs/development.md) for more.

## TypeScript SDK

Build issue integrations, dashboards, and orchestration services with `@kivotos/client`:

```ts
import { createKivotosClient } from "@kivotos/client";

const client = createKivotosClient({ url: "ws://127.0.0.1:6767/ws" });
await client.connect();

const agent = await client.agents.create({
  config: { provider: "codex/gpt-5.5" },
  cwd: "/Users/me/dev/storefront",
  prompt: "Review the current diff and name the riskiest change.",
});

const result = await agent.waitForFinish();
console.log(result.lastMessage);

await client.close();
```

See the [SDK quickstart](https://github.com/Rinai-R/kivotos/tree/main/docs), [recipes](https://github.com/Rinai-R/kivotos/tree/main/docs), and [API reference](https://github.com/Rinai-R/kivotos/tree/main/docs).

## Skills

Skills teach your agent to use Kivotos to orchestrate other agents.

```bash
npx skills add Rinai-R/kivotos
```

Then use them in any agent conversation:

- `/kivotos-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/kivotos-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/kivotos-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Kivotos daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `kivotos` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients

Common commands:

```bash
# run all local dev services
npm run dev

# run individual surfaces
npm run dev:server
npm run dev:app
npm run dev:desktop

# build the server stack
npm run build:server

# repo-wide checks
npm run typecheck
```

## Related projects

- [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay) — official distributed relay, written in Elixir
- [kivotos-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.kivotos-vscode) — VS Code extension

## License

Apache-2.0
