#!/bin/bash
# Wrapper: source the engine's .env, then exec the Swift motor binary built in this repo
# (cd motor/swift && swift build -c release).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ONEIRO_CORE_DIR:-$HOME/oneiro/runtime/workspace/oneiro-core}/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi
exec "$ROOT/motor/swift/.build/release/oneiro-motor" "$@"
