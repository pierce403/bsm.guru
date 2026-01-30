#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PNPM=""
if command -v corepack >/dev/null 2>&1; then
  PNPM="corepack pnpm"
elif command -v pnpm >/dev/null 2>&1; then
  PNPM="pnpm"
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
    $PNPM install
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
      curl -sf -X POST "$url" -H "content-type: application/json" -d '{}' >/dev/null || true
      sleep "$interval_s"
    done
  ) &

  echo $!
}

case "$cmd" in
  "" )
    install_deps
    dev_hostname="${BSM_HOSTNAME:-127.0.0.1}"
    dev_port="${PORT:-3000}"
    host="${BSM_DEV_HOST:-http://${dev_hostname}:${dev_port}}"
    sync_url="${BSM_SYNC_URL:-$host/api/sync/hyperliquid}"
    sync_interval="${BSM_SYNC_INTERVAL_SECONDS:-60}"

    sync_pid="$(start_sync_loop "$sync_url" "$sync_interval" || true)"
    if [[ -n "${sync_pid:-}" ]]; then
      trap 'kill "$sync_pid" >/dev/null 2>&1 || true' EXIT
      echo "Background DB sync: POST $sync_url every ${sync_interval}s (pid $sync_pid)"
    fi

    echo "Starting dev server at $host ..."
    exec $PNPM dev -- --hostname "$dev_hostname"
    ;;
  "--no-sync" )
    install_deps
    dev_hostname="${BSM_HOSTNAME:-127.0.0.1}"
    dev_port="${PORT:-3000}"
    echo "Starting dev server at http://${dev_hostname}:${dev_port} ..."
    exec $PNPM dev -- --hostname "$dev_hostname"
    ;;
  "--install-only" )
    install_deps
    echo "Done."
    ;;
  "--check" )
    install_deps
    $PNPM lint
    $PNPM test
    $PNPM build
    ;;
  "-h" | "--help" )
    cat <<'EOF'
Usage:
  ./run.sh              # install deps (if needed), background-sync, and start dev server
  ./run.sh --no-sync
  ./run.sh --install-only
  ./run.sh --check      # lint + test + build

Env:
  BSM_DB_PATH                 # default: ./data/bsm.sqlite
  BSM_HOSTNAME                # default: 127.0.0.1 (Next dev hostname)
  BSM_DEV_HOST                # default: http://$BSM_HOSTNAME:${PORT:-3000}
  BSM_SYNC_URL                # default: $BSM_DEV_HOST/api/sync/hyperliquid
  BSM_SYNC_INTERVAL_SECONDS   # default: 60
EOF
    ;;
  * )
    echo "error: unknown argument: $cmd"
    echo "Try: ./run.sh --help"
    exit 2
    ;;
esac
