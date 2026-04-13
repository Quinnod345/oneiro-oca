"""
Design Model Server — MLX GPU inference server for M4 Max.
Replaces the JS Unix socket server with GPU-accelerated inference.
Same socket path (/tmp/design-model.sock) for backward compatibility.

Usage:
  python serve.py              # Start server
  python serve.py --port 8234  # HTTP mode instead of Unix socket
"""

import argparse
import asyncio
import json
import os
import signal
import time
from pathlib import Path

import mlx.core as mx
import numpy as np
from PIL import Image

from model import create_model, OUTPUT_DIM
from data import SCORE_NAMES, load_and_preprocess_image

SOCKET_PATH = "/tmp/design-model.sock"


class DesignModelServer:
    """GPU-accelerated design evaluation server."""

    def __init__(self, version: int = 1):
        self.model = create_model(load=True, version=version)
        self.model.eval()
        self.version = version
        print(f"[serve] model loaded: {self.model.param_count():,} params on {mx.default_device()}")

    def evaluate(self, screenshot_path: str = None, code_features: list = None):
        """Evaluate a design from screenshot and/or code features."""
        t0 = time.time()

        # Load and preprocess image
        if screenshot_path and os.path.exists(screenshot_path):
            img = load_and_preprocess_image(screenshot_path)
            img_tensor = mx.array(img[None])  # (1, 224, 224, 3)
        else:
            img_tensor = mx.zeros((1, 224, 224, 3))

        # Code features
        feat_tensor = None
        if code_features and len(code_features) == 64:
            feat_tensor = mx.array(np.array([code_features], dtype=np.float32))

        # Forward pass
        scores = self.model(img_tensor, feat_tensor)
        mx.eval(scores)

        elapsed_ms = (time.time() - t0) * 1000
        scores_list = scores[0].tolist()

        return {
            "scores": {name: round(scores_list[i], 4) for i, name in enumerate(SCORE_NAMES)},
            "overall": round(scores_list[-1], 4),
            "norman": {
                "visceral": round(scores_list[8], 4),
                "behavioral": round(scores_list[9], 4),
                "reflective": round(scores_list[10], 4),
            },
            "model_version": self.version,
            "param_count": self.model.param_count(),
            "device": str(mx.default_device()),
            "inference_ms": round(elapsed_ms, 2),
        }

    def status(self):
        return {
            "model_version": self.version,
            "param_count": self.model.param_count(),
            "device": str(mx.default_device()),
            "phase": "mlx_gpu",
            "architecture": self.model.summary(),
        }


async def handle_client(reader, writer, server: DesignModelServer):
    """Handle a single Unix socket client."""
    try:
        data = await asyncio.wait_for(reader.read(1024 * 1024), timeout=30)
        request = json.loads(data.decode())

        action = request.get("action", "evaluate")

        if action == "evaluate":
            result = server.evaluate(
                screenshot_path=request.get("input", {}).get("screenshot"),
                code_features=request.get("input", {}).get("code_features"),
            )
        elif action == "status":
            result = server.status()
        else:
            result = {"error": f"Unknown action: {action}"}

        writer.write(json.dumps(result).encode())
        await writer.drain()
    except Exception as e:
        try:
            writer.write(json.dumps({"error": str(e)}).encode())
            await writer.drain()
        except:
            pass
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except:
            pass


async def run_unix_socket_server(server: DesignModelServer, socket_path: str = SOCKET_PATH):
    """Run the Unix socket server."""
    # Clean up stale socket
    if os.path.exists(socket_path):
        os.unlink(socket_path)

    srv = await asyncio.start_unix_server(
        lambda r, w: handle_client(r, w, server),
        path=socket_path,
    )

    print(f"[serve] listening on {socket_path}")

    def cleanup(signum=None, frame=None):
        if os.path.exists(socket_path):
            os.unlink(socket_path)
        srv.close()

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    async with srv:
        await srv.serve_forever()


async def run_http_server(server: DesignModelServer, port: int = 8234):
    """Run a simple HTTP server for evaluation."""
    from http.server import HTTPServer, BaseHTTPRequestHandler

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            request = json.loads(body)

            if self.path == "/evaluate":
                result = server.evaluate(
                    screenshot_path=request.get("screenshot"),
                    code_features=request.get("code_features"),
                )
            elif self.path == "/status":
                result = server.status()
            else:
                result = {"error": f"Unknown path: {self.path}"}

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())

        def log_message(self, format, *args):
            pass  # Suppress default logging

    httpd = HTTPServer(("127.0.0.1", port), Handler)
    print(f"[serve] HTTP server on http://127.0.0.1:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Design model inference server")
    parser.add_argument("--version", type=int, default=1)
    parser.add_argument("--port", type=int, default=None, help="Use HTTP instead of Unix socket")
    parser.add_argument("--socket", type=str, default=SOCKET_PATH)
    args = parser.parse_args()

    server = DesignModelServer(version=args.version)

    if args.port:
        asyncio.run(run_http_server(server, args.port))
    else:
        asyncio.run(run_unix_socket_server(server, args.socket))
