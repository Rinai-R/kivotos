# Kivotos Docker Image

This directory builds the Kivotos daemon image locally. There is no published
image and no publishing CI.

The image runs the daemon headless and serves the bundled web UI from the same
HTTP origin. Build it, start it, then open the daemon URL in a browser.

```bash
docker build -f docker/base/Dockerfile -t kivotos:latest .
docker run -d --name kivotos \
  -p 6767:6767 \
  -e KIVOTOS_PASSWORD=change-me \
  -v "$PWD/kivotos-home:/home/kivotos" \
  -v "$PWD:/workspace" \
  kivotos:latest
```

Then open `http://localhost:6767`.

The base image intentionally does not bundle agent CLIs. Extend it with the
agents you use:

```Dockerfile
FROM kivotos:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code
```

See [docs/docker.md](../docs/docker.md) for Compose, reverse proxy, security,
agent auth, and troubleshooting notes.
