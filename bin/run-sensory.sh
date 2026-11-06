#!/bin/bash
# Wrapper: source the engine's .env, then exec the Swift sensory binary built in this repo
# (cd sensory/swift && swift build -c release).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ONEIRO_CORE_DIR:-/Users/quinnodonnell/oneiro/runtime/workspace/oneiro-core}/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi
exec "$ROOT/sensory/swift/.build/release/oneiro-sensory" "$@"
