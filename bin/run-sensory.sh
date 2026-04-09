#!/bin/bash
# Wrapper: source .env then exec the Swift sensory binary
set -euo pipefail
ENV_FILE="/Users/quinnodonnell/.openclaw/workspace/oneiro-core/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi
exec /Users/quinnodonnell/.openclaw/workspace/oneiro-core/cognitive/sensory/swift/.build/release/oneiro-sensory "$@"
