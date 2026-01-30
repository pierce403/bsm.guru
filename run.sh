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

case "$cmd" in
  "" )
    install_deps
    echo "Starting dev server at http://localhost:3000 ..."
    exec $PNPM dev
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
  ./run.sh              # install deps (if needed) and start dev server
  ./run.sh --install-only
  ./run.sh --check      # lint + test + build
EOF
    ;;
  * )
    echo "error: unknown argument: $cmd"
    echo "Try: ./run.sh --help"
    exit 2
    ;;
esac

