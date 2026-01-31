#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PNPM=()
if command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  echo "error: pnpm not found."
  echo "Install pnpm (recommended via corepack) then retry:"
  echo "  corepack enable"
  exit 1
fi

cmd="${1:-}"

install_deps() {
  if [[ ! -d node_modules ]]; then
    echo "Installing dependencies..."
    "${PNPM[@]}" install
  fi
}

ensure_logs() {
  local dir="${BSM_LOG_DIR:-$ROOT/logs}"
  mkdir -p "$dir"
  touch "$dir/analysis.log" "$dir/trade.log" "$dir/wallet.log" "$dir/error.log"
}

list_next_dev_pids() {
  # Only match Next dev instances that belong to this repo.
  pgrep -af "next dev" 2>/dev/null \
    | rg -F "$ROOT" \
    | awk '{print $1}' \
    | rg "^[0-9]+$" || true
}

stop_next_dev() {
  local pids
  pids="$(list_next_dev_pids || true)"
  if [[ -z "${pids:-}" ]]; then
    return 0
  fi

  echo "Stopping existing next dev instance(s): ${pids//$'\n'/ }"
  # Try graceful termination first.
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid" >/dev/null 2>&1 || true
  done <<<"$pids"

  # Give it a moment to release the dev lock.
  sleep 1

  # Clean up any stale dev lock if nothing is running anymore.
  if [[ -f "$ROOT/.next/dev/lock" ]] && [[ -z "$(list_next_dev_pids || true)" ]]; then
    rm -f "$ROOT/.next/dev/lock" >/dev/null 2>&1 || true
  fi
}

start_sync_loop() {
  local url="$1"
  local interval_s="$2"

  if ! command -v curl >/dev/null 2>&1; then
    echo "warning: curl not found; skipping background DB sync."
    return 0
  fi

  (
    while true; do
      # Avoid hanging if the dev server is down or the endpoint stalls.
      curl -sf --connect-timeout 2 --max-time 10 \
        -X POST "$url" -H "content-type: application/json" -d '{}' >/dev/null || true
      sleep "$interval_s"
    done
  ) </dev/null >/dev/null 2>&1 &

  echo $!
}

case "$cmd" in
  "" )
    install_deps
    ensure_logs
    dev_hostname="${BSM_HOSTNAME:-127.0.0.1}"
    dev_port="${PORT:-3000}"
    host="${BSM_DEV_HOST:-http://${dev_hostname}:${dev_port}}"
    sync_url="${BSM_SYNC_URL:-$host/api/sync/hyperliquid}"
    sync_interval="${BSM_SYNC_INTERVAL_SECONDS:-600}"

    sync_pid=""
    dev_pid=""
    cleanup() {
      if [[ -n "${dev_pid:-}" ]]; then
        kill "$dev_pid" >/dev/null 2>&1 || true
      fi
      if [[ -n "${sync_pid:-}" ]]; then
        kill "$sync_pid" >/dev/null 2>&1 || true
      fi
    }
    trap cleanup EXIT INT TERM

    sync_pid="$(start_sync_loop "$sync_url" "$sync_interval" || true)"
    if [[ -n "${sync_pid:-}" ]]; then
      echo "Background DB sync: POST $sync_url every ${sync_interval}s (pid $sync_pid)"
    fi

    # If a prior instance is running (or left a lock), stop it so re-running
    # `./run.sh` "just works".
    stop_next_dev

    echo "Starting dev server at $host ..."
    # NOTE: Next's CLI treats a literal "--" here as a positional project dir.
    "${PNPM[@]}" dev --hostname "$dev_hostname" &
    dev_pid="$!"
    wait "$dev_pid"
    ;;
  "--no-sync" )
    install_deps
    ensure_logs
    dev_hostname="${BSM_HOSTNAME:-127.0.0.1}"
    dev_port="${PORT:-3000}"
    echo "Starting dev server at http://${dev_hostname}:${dev_port} ..."
    stop_next_dev
    "${PNPM[@]}" dev --hostname "$dev_hostname"
    ;;
  "--install-only" )
    install_deps
    echo "Done."
    ;;
  "--stop" )
    stop_next_dev
    echo "Done."
    ;;
  "--check" )
    install_deps
    ensure_logs
    "${PNPM[@]}" lint
    "${PNPM[@]}" test
    "${PNPM[@]}" build
    ;;
  "-h" | "--help" )
    cat <<'EOF'
Usage:
  ./run.sh              # install deps (if needed), background-sync, and start dev server
  ./run.sh --no-sync
  ./run.sh --install-only
  ./run.sh --stop       # stop any running next dev instance for this repo
  ./run.sh --check      # lint + test + build

Env:
  BSM_DB_PATH                 # default: ./data/bsm.sqlite
  BSM_LOG_DIR                 # default: ./logs
  BSM_HOSTNAME                # default: 127.0.0.1 (Next dev hostname)
  BSM_DEV_HOST                # default: http://$BSM_HOSTNAME:${PORT:-3000}
  BSM_SYNC_URL                # default: $BSM_DEV_HOST/api/sync/hyperliquid
  BSM_SYNC_INTERVAL_SECONDS   # default: 600
EOF
    ;;
  * )
    echo "error: unknown argument: $cmd"
    echo "Try: ./run.sh --help"
    exit 2
    ;;
esac
