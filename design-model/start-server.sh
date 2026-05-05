#!/bin/bash
# Start the Design Model Phase 9 inference server (DINOv2 ViT-B/14 backbone,
# v8 weights). Older v5/v6/v7 weights are no longer loaded — they require
# the previous MobileNet feature input that was removed in this phase.
# Usage: ./start-server.sh [--warmup] [--port 8234]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_SCRIPT="$SCRIPT_DIR/mlx/inference_server.py"
SOCKET_PATH="/tmp/design-model-v2.sock"
PID_FILE="/tmp/design-model-v2.pid"

# Check if already running
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "[start-server] already running (PID $PID)"
    exit 0
  else
    echo "[start-server] stale PID file, cleaning up"
    rm -f "$PID_FILE" "$SOCKET_PATH"
  fi
fi

# Check dependencies
python3 -c "import mlx, torch, torchvision, PIL, transformers" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "[start-server] ERROR: missing dependencies. Install with:"
  echo "  pip3 install --break-system-packages mlx torch torchvision pillow transformers"
  exit 1
fi

# Clean up old socket
rm -f "$SOCKET_PATH"

# Start server in background
echo "[start-server] starting inference server..."
python3 "$SERVER_SCRIPT" "$@" &
SERVER_PID=$!

# Wait for socket to appear (up to 30 seconds)
for i in $(seq 1 30); do
  if [ -S "$SOCKET_PATH" ]; then
    echo "[start-server] ready (PID $SERVER_PID, socket $SOCKET_PATH)"
    exit 0
  fi
  sleep 1
done

echo "[start-server] ERROR: server did not start within 30 seconds"
kill $SERVER_PID 2>/dev/null
exit 1
