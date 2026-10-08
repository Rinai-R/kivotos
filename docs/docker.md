# Running Kivotos in Docker

Kivotos builds a container image for running the daemon on a server, VM, NAS,
or homelab box. Nothing is published: build the image locally from the
checked-out source tree (see [Building Locally](#building-locally) below). The
image also serves the bundled browser web UI, so one container gives you both
the daemon API and a self-hosted UI.

The image source lives in [`docker/`](../docker/).

## How it works

The image:

- builds `@kivotos/server` and `@kivotos/cli` from source-built workspace tarballs
- runs the daemon as the non-root `kivotos` user
- listens on `0.0.0.0:6767` inside the container
- enables the bundled daemon web UI with `KIVOTOS_WEB_UI_ENABLED=true`
- stores daemon state and agent credentials under `/home/kivotos`
- leaves agent CLIs out of the base image

Open the container's HTTP origin, for example `http://localhost:6767`, to load
the web UI. The served app receives a same-origin connection hint and connects
back to that daemon. Static UI files load without daemon auth; API and
WebSocket requests still require `KIVOTOS_PASSWORD` when one is configured.

Host-side CLI commands select the container explicitly, for example `kivotos project ls --host 127.0.0.1:6767`. Without an endpoint selector the CLI looks for a local home’s supervisor. Container environment settings are deployment overrides; worker restart preserves them. Your container manager owns full supervisor replacement.

## Quick Start

Build the image locally:

```bash
docker build -f docker/base/Dockerfile -t kivotos:latest .
```

Then run it:

```bash
docker run -d --name kivotos \
  -p 6767:6767 \
  -e KIVOTOS_PASSWORD=change-me \
  -v "$PWD/kivotos-home:/home/kivotos" \
  -v "$PWD:/workspace" \
  kivotos:latest
```

Then open:

```text
http://localhost:6767
```

If you set `KIVOTOS_PASSWORD`, enter the same password when adding the direct
daemon connection in the web UI or another Kivotos client.

## Docker Compose

Use [`docker/docker-compose.example.yml`](../docker/docker-compose.example.yml):

```bash
cp docker/docker-compose.example.yml docker-compose.yml
$EDITOR docker-compose.yml
docker compose up -d
```

Minimal example (the locally built `kivotos:latest` image from [Quick Start](#quick-start)):

```yaml
services:
  kivotos:
    image: kivotos:latest
    restart: unless-stopped
    ports:
      - "6767:6767"
    environment:
      KIVOTOS_PASSWORD: "change-me"
    volumes:
      - ./kivotos-home:/home/kivotos
      - ./workspace:/workspace
```

## Installing Agents

The base image does not preinstall Claude Code, Codex, OpenCode, Copilot, Pi, or
other agent CLIs. That keeps the default image small and avoids coupling Kivotos
releases to third-party agent release cycles.

Create a child image for the agents you use:

```Dockerfile
FROM kivotos:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai
```

Build it:

```bash
docker build -f Dockerfile -t kivotos-with-agents .
```

Then use `image: kivotos-with-agents` in Compose.

Leave the child image user as root. The base entrypoint uses root only for
first-run directory setup, then drops the daemon and launched agents to the
non-root `kivotos` user.

An example child image is in
[`docker/Dockerfile.agents.example`](../docker/Dockerfile.agents.example).

You can also mount credentials from the host or run agent login once inside the
container:

```bash
docker exec -it --user kivotos kivotos codex
docker exec -it --user kivotos kivotos claude
```

Agent credentials and config persist in `/home/kivotos`, alongside daemon state.
Provider environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENAI_BASE_URL`, or `ANTHROPIC_BASE_URL` can be passed through `docker run -e`
or `compose.environment`; Kivotos passes them to launched agents.

## Volumes

| Mount           | Purpose                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `/home/kivotos` | Kivotos state under `.kivotos` plus agent config such as `.codex`, `.claude` |
| `/workspace`    | Code that Kivotos and launched agents can read and write                     |

The image defaults:

| Variable         | Default                  |
| ---------------- | ------------------------ |
| `HOME`           | `/home/kivotos`          |
| `KIVOTOS_HOME`   | `/home/kivotos/.kivotos` |
| `KIVOTOS_LISTEN` | `0.0.0.0:6767`           |

If you bind-mount host directories on Linux, make sure the container user can
write them. The built-in `kivotos` user has uid/gid `1000:1000`. For a different
host uid/gid, either adjust ownership on the mounted directories or run the
container with Docker's `--user` / Compose `user:` option.

## Reverse Proxies

When serving Kivotos behind a reverse proxy, forward normal HTTP requests and
WebSocket upgrades to the same daemon port.

Caddy example:

```caddy
kivotos.example.com {
  reverse_proxy 127.0.0.1:6767
}
```

Nginx example:

```nginx
server {
    listen 443 ssl;
    server_name kivotos.example.com;

    location / {
        proxy_pass http://127.0.0.1:6767;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you reach the daemon by DNS name, set `KIVOTOS_HOSTNAMES` so host-header
validation allows that name:

```yaml
environment:
  KIVOTOS_HOSTNAMES: "kivotos.example.com,.lan"
```

IPs and `localhost` are allowed by default.

## Security

- Set `KIVOTOS_PASSWORD` for any published port or network-reachable deployment.
- Prefer HTTPS at the reverse proxy for direct browser access.
- Use the [official Kivotos relay](https://github.com/getpaseo/paseo-relay) for
  untrusted networks or mobile access when you do not want to expose the daemon
  port directly.
- The container is the isolation boundary for agents. Agents can read and write
  whatever you mount into `/workspace` and whatever credentials you place in
  `/home/kivotos`.
- The bundled web UI static files are public on the daemon origin. The daemon
  API and WebSocket remain protected by password auth when configured.

See [SECURITY.md](../SECURITY.md) for the daemon trust model.

## Building Locally

```bash
docker build -f docker/base/Dockerfile -t kivotos:local .
```

To assert the source tree version while building:

```bash
docker build \
  --build-arg KIVOTOS_VERSION=0.1.102 \
  -t kivotos:0.1.102 \
  -f docker/base/Dockerfile \
  .
```

Nothing is published from CI: tag pushes do not build or publish
`kivotos:X.Y.Z`, `kivotos:X.Y.Z-beta.N`, or `kivotos:latest`. The image you run
is the one you build locally from the checked-out source tree, so tag the build
you keep (`kivotos:local`, `kivotos:X.Y.Z`, or `kivotos:latest`).

To replace the image without rebuilding desktop, APK, or EAS mobile release
artifacts, rebuild and re-tag it from the release commit:

```bash
docker build \
  --build-arg KIVOTOS_VERSION=X.Y.Z-beta.N \
  -t kivotos:X.Y.Z-beta.N \
  -f docker/base/Dockerfile \
  .
```

## Troubleshooting

- **The web UI loads but cannot connect**: if `KIVOTOS_PASSWORD` is set, add a
  direct connection with the same password.
- **403 Host not allowed**: set `KIVOTOS_HOSTNAMES` to the DNS names you use.
- **Provider not available**: install that agent CLI in a child image or mount a
  runtime where the binary is on `PATH`.
- **Permission errors in `/workspace`**: make the mounted directory writable by
  uid/gid `1000:1000`, or run the container as the host uid/gid.
- **Logs**: inspect `docker logs kivotos` or
  `/home/kivotos/.kivotos/daemon.log` inside the container.
