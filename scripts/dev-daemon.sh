#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export KIVOTOS_LISTEN="${KIVOTOS_LISTEN:-127.0.0.1:6768}"
configure_dev_kivotos_home

if [ -z "${KIVOTOS_LOCAL_MODELS_DIR}" ]; then
  export KIVOTOS_LOCAL_MODELS_DIR="$HOME/.kivotos/models/local-speech"
  mkdir -p "$KIVOTOS_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  Kivotos Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${KIVOTOS_HOME}"
echo "  Models:  ${KIVOTOS_LOCAL_MODELS_DIR}"
echo "  Listen:  ${KIVOTOS_LISTEN}"
echo "══════════════════════════════════════════════════════"

export KIVOTOS_CORS_ORIGINS="${KIVOTOS_CORS_ORIGINS:-*}"
export KIVOTOS_NODE_INSPECT="${KIVOTOS_NODE_INSPECT:---inspect=0}"

if [ "${KIVOTOS_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
