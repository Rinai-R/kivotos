# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-bookworm-slim
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS source-pack

ARG KIVOTOS_VERSION

ENV ONNXRUNTIME_NODE_INSTALL=skip

WORKDIR /tmp/kivotos-src
COPY . .

RUN set -eux; \
    if [ -n "${KIVOTOS_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${KIVOTOS_VERSION}"; \
    fi; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

RUN set -eux; \
    mkdir -p /tmp/kivotos-packs; \
    npm pack --workspace=@kivotos/highlight --pack-destination /tmp/kivotos-packs; \
    npm pack --workspace=@kivotos/relay --pack-destination /tmp/kivotos-packs; \
    npm pack --workspace=@kivotos/protocol --pack-destination /tmp/kivotos-packs; \
    npm pack --workspace=@kivotos/client --pack-destination /tmp/kivotos-packs; \
    npm pack --workspace=@kivotos/plugin --pack-destination /tmp/kivotos-packs; \
    npm pack --workspace=@kivotos/server --pack-destination /tmp/kivotos-packs; \
    npm pack --workspace=@kivotos/cli --pack-destination /tmp/kivotos-packs

FROM ${NODE_IMAGE}

ENV HOME=/home/kivotos \
    KIVOTOS_HOME=/home/kivotos/.kivotos \
    KIVOTOS_LISTEN=0.0.0.0:6767 \
    KIVOTOS_WEB_UI_ENABLED=true \
    KIVOTOS_LOG_FORMAT=json \
    KIVOTOS_LOG_LEVEL=info \
    CLAUDE_CONFIG_DIR=/home/kivotos/.claude \
    CODEX_HOME=/home/kivotos/.codex \
    XDG_CONFIG_HOME=/home/kivotos/.config \
    XDG_DATA_HOME=/home/kivotos/.local/share \
    XDG_STATE_HOME=/home/kivotos/.local/state \
    XDG_CACHE_HOME=/home/kivotos/.cache \
    ONNXRUNTIME_NODE_INSTALL=skip

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      gosu \
      lbzip2 \
      openssh-client \
      procps \
      tini; \
    rm -rf /var/lib/apt/lists/*

COPY --from=source-pack /tmp/kivotos-packs /tmp/kivotos-packs
RUN set -eux; \
	npm install -g /tmp/kivotos-packs/*.tgz; \
    rm -rf /tmp/kivotos-packs; \
    npm cache clean --force; \
    server_entry="$(npm root -g)/@kivotos/server/dist/scripts/supervisor-entrypoint.js"; \
    test -f "$server_entry"; \
    printf '%s\n' "$server_entry" > /etc/kivotos-server-entry; \
    node --check "$server_entry"

RUN set -eux; \
    existing_group="$(getent group 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_group" ] && [ "$existing_group" != "kivotos" ]; then \
      groupmod --new-name kivotos "$existing_group"; \
    elif [ -z "$existing_group" ]; then \
      groupadd --gid 1000 kivotos; \
    fi; \
    existing_user="$(getent passwd 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_user" ] && [ "$existing_user" != "kivotos" ]; then \
      usermod --login kivotos --gid kivotos --home /home/kivotos --shell /bin/bash "$existing_user"; \
    elif [ -z "$existing_user" ]; then \
      useradd --uid 1000 --gid kivotos --create-home --home-dir /home/kivotos --shell /bin/bash kivotos; \
    fi; \
    mkdir -p \
      /workspace \
      "$KIVOTOS_HOME" \
      "$CLAUDE_CONFIG_DIR" \
      "$CODEX_HOME" \
      "$XDG_CONFIG_HOME" \
      "$XDG_DATA_HOME" \
      "$XDG_STATE_HOME" \
      "$XDG_CACHE_HOME"; \
    chown -R kivotos:kivotos /home/kivotos /workspace

COPY docker/base/rootfs/ /
RUN chmod +x /usr/local/bin/kivotos-docker-entrypoint

WORKDIR /workspace

EXPOSE 6767
VOLUME ["/home/kivotos"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const listen=process.env.KIVOTOS_LISTEN||'0.0.0.0:6767'; const m=listen.match(/:(\\d+)$/); const port=m?Number(m[1]):6767; require('http').get({hostname:'127.0.0.1',port,path:'/api/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kivotos-docker-entrypoint"]
