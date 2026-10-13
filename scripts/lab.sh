#!/usr/bin/env bash
# Bring up a local Kivotos lab in one command: a relay built from
# packages/relay and two dsh instances with their own DSH_HOME directories,
# already members of the same relay network.
#
# Nothing here touches ~/.dsh or an installed dsh; every file it writes lives
# under --lab-dir, which it removes again on exit unless --keep is given.
#
# Usage: scripts/lab.sh [--lab-dir DIR] [--relay-port N] [--web-a-port N]
#                       [--web-b-port N] [--dsh PATH] [--keep]
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

lab_dir="$repo_root/.lab"
relay_port=7411
web_a_port=7412
web_b_port=7413
dsh_bin="${DSH_BIN:-dsh}"
keep=0

usage() {
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --lab-dir) lab_dir="$2"; shift 2 ;;
    --relay-port) relay_port="$2"; shift 2 ;;
    --web-a-port) web_a_port="$2"; shift 2 ;;
    --web-b-port) web_b_port="$2"; shift 2 ;;
    --dsh) dsh_bin="$2"; shift 2 ;;
    --keep) keep=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

mkdir -p "$lab_dir"
lab_dir="$(cd "$lab_dir" && pwd -P)"
case "$lab_dir" in
  /|"$HOME"|"$repo_root")
    echo "refusing to use $lab_dir as the lab directory" >&2
    exit 2
    ;;
esac

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "lab: $1 is required ($2)" >&2; exit 1; }
}

need node "Node ^22.19.0 || >=24"
need go "Go, to build packages/relay"
need pnpm "pnpm, which dsh plugin add runs"
# A path to a dsh entry point works too; --dsh and $DSH_BIN win over PATH.
if [ ! -x "$dsh_bin" ]; then
  command -v "$dsh_bin" >/dev/null 2>&1 ||
    { echo "lab: dsh not found; install it or pass --dsh <path> (or DSH_BIN)" >&2; exit 1; }
fi

if [ ! -f "$repo_root/packages/kivotos/dist/index.js" ]; then
  echo "lab: building the plugin (packages/kivotos/dist is missing)"
  [ -d "$repo_root/node_modules" ] ||
    { echo "lab: run 'npm install' in $repo_root first" >&2; exit 1; }
  (cd "$repo_root" && npm run build -w packages/kivotos)
fi

pids=()

# dsh shuts down gracefully on SIGTERM but can take a moment, and a hung lab
# would keep its ports bound: wait, then insist.
stop() {
  local pid="$1"
  kill -TERM "$pid" 2>/dev/null || return 0
  for _ in $(seq 1 100); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  for pid in "${pids[@]:-}"; do
    if [ -n "$pid" ]; then stop "$pid"; fi
  done
  for pid in "${pids[@]:-}"; do
    if [ -n "$pid" ]; then wait "$pid" 2>/dev/null || true; fi
  done
  if [ "$keep" -eq 0 ]; then rm -rf "$lab_dir"; else echo "lab: files kept in $lab_dir"; fi
  exit "$status"
}
trap cleanup EXIT INT TERM

rm -rf "$lab_dir"
mkdir -p "$lab_dir/relay/data" "$lab_dir/home-a/kivotos" "$lab_dir/home-b/kivotos"

echo "lab: building the relay"
(cd "$repo_root/packages/relay" && go build -o "$lab_dir/relay/kivotos-relay" .)

relay="$lab_dir/relay/kivotos-relay"
relay_addr="127.0.0.1:$relay_port"

# The two dsh instances that make up the lab: relay-only, so they never touch
# the tailnet or bind a second port, and nothing outside this lab is mounted.
cat >"$lab_dir/lab.patch.yml" <<'YAML'
- id: kivotos
  config:
    listen: false
    discover: false
YAML

# Derive the network from the plugin's own federation module, so the invite
# this script prints is exactly what the settings page would show.
invite="$(cd "$repo_root" && node --input-type=module -e '
  import { networkOf, inviteOf, registrationOf } from "./packages/kivotos/src/federation.ts";
  import { mkdirSync, writeFileSync } from "node:fs";
  const [lab, relay] = process.argv.slice(1);
  const network = networkOf(relay);
  const membership = JSON.stringify({ relay: network.relay, secret: network.secret }, null, 2);
  for (const home of ["home-a", "home-b"]) {
    mkdirSync(`${lab}/${home}/kivotos`, { recursive: true });
    writeFileSync(`${lab}/${home}/kivotos/relay.json`, membership);
  }
  writeFileSync(`${lab}/registration.txt`, registrationOf(network));
  writeFileSync(`${lab}/invite.txt`, inviteOf(network));
  console.log(inviteOf(network));
' "$lab_dir" "$relay_addr" | tail -n 1)"

echo "lab: starting the relay on $relay_addr"
"$relay" serve --listen "$relay_addr" --data-dir "$lab_dir/relay/data" \
  >"$lab_dir/relay.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 100); do
  [ -S "$lab_dir/relay/data/admin.sock" ] && break
  sleep 0.1
done
[ -S "$lab_dir/relay/data/admin.sock" ] ||
  { echo "lab: the relay did not start; see $lab_dir/relay.log" >&2; exit 1; }

"$relay" network add "$(cat "$lab_dir/registration.txt")" --data-dir "$lab_dir/relay/data" >/dev/null

# Starts one instance and leaves its UI URL in ui_url. It must set a variable
# rather than print: a command substitution would run it in a subshell, which
# would lose the pid this script has to keep to stop the instance again.
ui_url=""
start_dsh() {
  local home="$1" port="$2" name="$3" log="$lab_dir/$3.log"
  (DSH_HOME="$lab_dir/$home" exec "$dsh_bin" web \
    --patch "$lab_dir/lab.patch.yml" --port "$port" --host 127.0.0.1 --no-open) \
    >"$log" 2>&1 &
  pids+=($!)
  local url=""
  for _ in $(seq 1 300); do
    url="$(sed -n 's/^dsh web: \(http[^ ]*\).*/\1/p' "$log" | head -n 1)"
    [ -n "$url" ] && break
    sleep 0.2
  done
  [ -n "$url" ] || { echo "lab: $name did not start; see $log" >&2; exit 1; }
  ui_url="$url"
}

for home in home-a home-b; do
  echo "lab: installing the plugin into $home"
  DSH_HOME="$lab_dir/$home" "$dsh_bin" plugin --profile web add "$repo_root/packages/kivotos" >/dev/null
done

echo "lab: starting the two dsh instances"
start_dsh home-a "$web_a_port" dsh-a
url_a="$ui_url"
start_dsh home-b "$web_b_port" dsh-b
url_b="$ui_url"

# Online means the relay sees both members' links.
online=0
for _ in $(seq 1 60); do
  online="$("$relay" network list --data-dir "$lab_dir/relay/data" |
    awk '/^  node / { n++ } END { print n + 0 }')"
  [ "$online" -ge 2 ] && break
  sleep 0.5
done

cat <<EOF

Kivotos lab is up. Press Ctrl-C to stop it.

  machine A   $url_a
  machine B   $url_b
  relay       $relay_addr  (log: $lab_dir/relay.log)
  members     $online of 2 online

  invite      $invite

Open machine A, then Machines in the sidebar: machine B is in the list.
The invite is what a phone (packages/mobile) or another machine pastes into
Settings -> Remote access -> Join network.
EOF

if [ "$online" -lt 2 ]; then
  echo "lab: warning: only $online member registered; see $lab_dir/dsh-a.log and $lab_dir/dsh-b.log" >&2
fi

wait
