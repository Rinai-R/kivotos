#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$ROOT_DIR/node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export KIVOTOS_LISTEN="${KIVOTOS_LISTEN:-127.0.0.1:6768}"
configure_dev_kivotos_home

EXPO_PORT="${EXPO_PORT:-8081}"
DAEMON_ENDPOINT="$(resolve_dev_daemon_endpoint)"
DEV_BUILD_LABEL="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || true)"

echo "══════════════════════════════════════════════════════"
echo "  Kivotos App Dev"
echo "══════════════════════════════════════════════════════"
echo "  Metro:   http://localhost:${EXPO_PORT}"
echo "  Daemon:  ${DAEMON_ENDPOINT}"
echo "  Home:    ${KIVOTOS_HOME}"
echo "══════════════════════════════════════════════════════"

exec cross-env \
  BROWSER="${BROWSER:-none}" \
  APP_VARIANT=development \
  EXPO_PUBLIC_KIVOTOS_DEV_BUILD_LABEL="$DEV_BUILD_LABEL" \
  EXPO_PUBLIC_LOCAL_DAEMON="$DAEMON_ENDPOINT" \
  npm run start:expo --workspace=@kivotos/app -- --port "$EXPO_PORT"
