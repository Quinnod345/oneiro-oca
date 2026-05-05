#!/usr/bin/env python3
"""
Design Model Inference Server — Phase 9 (DINOv2).

Provides real-time design evaluation via Unix socket or HTTP.
Any process (Node.js, Python, CLI) can query design scores.

Architecture
  v8  DINOv2 ViT-B/14 (PyTorch, frozen) → 768-d CLS token → MLX
      adapter → trunk → 4 heads (scores, uncertainty, pref, aux).
      DINOv2 features capture design quality far more crisply than
      ImageNet's MobileNet — innovation/distinctiveness MAE dropped
      14-25% vs v7 in the deployment retrain.

Older v5/v6/v7 weight files require the 1280-d MobileNet feature
input; this server no longer loads them.  To revive that path:
revert mlx/inference_server.py to the pre-v8 commit.

Actions:
  evaluate       — screenshot → DINOv2 features → 16 design scores
                   (with per-dim uncertainty)
  extract_features — screenshot → 768-d DINOv2 CLS features
  status         — model info, uptime, request count, phase
  reload         — hot-reload DesignHead weights without restart

Usage:
  python inference_server.py                     # Unix socket mode
  python inference_server.py --port 8234         # HTTP mode
  python inference_server.py --warmup            # Pre-warm MLX JIT
"""

import argparse
import json
import os
import signal
import socket
import sys
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import numpy as np
from mlx.utils import tree_flatten

# Add parent for imports
sys.path.insert(0, str(Path(__file__).parent))
from train_v8 import DesignHeadV8, SCORE_NAMES, OUTPUT_DIM, VISUAL_DIM

WEIGHTS_DIR = Path(__file__).parent.parent / "weights"
V8_WEIGHTS_PATH = WEIGHTS_DIR / "design-head-v8.safetensors"
SOCKET_PATH = "/tmp/design-model-v2.sock"
PID_PATH = "/tmp/design-model-v2.pid"

DINOV2_MODEL_ID = "facebook/dinov2-base"

# ═══════════════════════════════════════════════════
# MOBILENET V2 FEATURE EXTRACTOR (PyTorch)
# ═══════════════════════════════════════════════════


class Dinov2Extractor:
    """Persistent DINOv2 ViT-B/14 feature extractor using PyTorch.

    Returns the 768-dim CLS token from the last hidden state — DINOv2's
    global summary representation.  86M params, ~340MB weights, ~40ms
    per forward pass on M4 Max after warmup.
    """

    def __init__(self, model_id: str = DINOV2_MODEL_ID):
        import torch
        from transformers import AutoModel, AutoImageProcessor
        self.torch = torch
        self.model_id = model_id

        # Use MPS (Apple Silicon GPU) when available — ~30x faster than CPU
        # for ViT forward passes.  Falls back to CPU if MPS isn't built in.
        if torch.backends.mps.is_available():
            self.device = torch.device("mps")
        else:
            self.device = torch.device("cpu")

        print(f"[server] loading {model_id} on {self.device}...")
        self.model = AutoModel.from_pretrained(model_id).to(self.device)
        self.model.eval()
        self.processor = AutoImageProcessor.from_pretrained(model_id)
        self.feature_dim = self.model.config.hidden_size

    def extract(self, image_path: str) -> np.ndarray:
        """Extract 768-dim CLS-token features."""
        from PIL import Image
        img = Image.open(image_path).convert("RGB")
        inputs = self.processor(images=img, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        with self.torch.no_grad():
            out = self.model(**inputs)
        # Last hidden state: (1, 257, 768) — index 0 = CLS, indices 1-256 = patches
        return out.last_hidden_state[0, 0, :].cpu().numpy().astype(np.float32)


# ═══════════════════════════════════════════════════
# DESIGN HEAD (MLX)
# ═══════════════════════════════════════════════════


def load_design_model():
    """Load the v8 design head."""
    if not V8_WEIGHTS_PATH.exists():
        raise FileNotFoundError(
            f"No v8 weights at {V8_WEIGHTS_PATH}.  Run "
            f"`python mlx/extract_dinov2.py && python mlx/train_v8.py "
            f"--epochs 500 --patience 80 --seeds 3` to produce them."
        )
    model = DesignHeadV8(dropout=0.0)
    model.load_weights(str(V8_WEIGHTS_PATH))
    total = sum(p.size for _, p in tree_flatten(model.parameters()))
    print(f"[server] loaded phase_9: {V8_WEIGHTS_PATH.name} ({total:,} params)")
    model.eval()
    return model, "phase_9"


# ═══════════════════════════════════════════════════
# SERVER
# ═══════════════════════════════════════════════════


class InferenceServer:
    def __init__(self, warmup: bool = False):
        self.start_time = time.time()
        self.request_count = 0
        self.total_inference_ms = 0

        self.extractor = Dinov2Extractor()
        print("[server] loading design model...")
        self.model, self.phase = load_design_model()

        if warmup:
            print("[server] warming up MLX JIT + DINOv2...")
            dummy = mx.random.uniform(shape=(1, VISUAL_DIM))
            dummy_code = mx.zeros((1, 64))
            _ = self.model(dummy, dummy_code, return_uncertainty=True)
            mx.eval(_)
            # Also warm DINOv2 on its actual device (MPS on M4 Max)
            import torch
            dummy_img = torch.zeros(1, 3, 224, 224).to(self.extractor.device)
            with torch.no_grad():
                _ = self.extractor.model(pixel_values=dummy_img)
            print("[server] warmup complete")

    def evaluate(self, request: dict) -> dict:
        """Run full evaluation: image → DINOv2 features → scores."""
        t0 = time.time()
        inp = request.get("input", {})

        if "precomputed_features" in inp:
            vis_features = np.array(inp["precomputed_features"], dtype=np.float32)
        elif "screenshot" in inp:
            vis_features = self.extractor.extract(inp["screenshot"])
        else:
            return {"error": "provide 'screenshot' path or 'precomputed_features'"}

        vis_mx = mx.array(vis_features[None, :])

        if "code_features" in inp and inp["code_features"]:
            code_features = np.array(inp["code_features"], dtype=np.float32)
        else:
            code_features = np.zeros(64, dtype=np.float32)
        code_mx = mx.array(code_features[None, :])

        scores_mx, log_var_mx = self.model(vis_mx, code_mx, return_uncertainty=True)
        mx.eval(scores_mx, log_var_mx)
        scores = scores_mx[0].tolist()
        log_var = mx.clip(log_var_mx, -7.0, 4.0)
        std_mx = mx.sqrt(mx.exp(log_var))
        mx.eval(std_mx)
        stds = std_mx[0].tolist()

        elapsed_ms = (time.time() - t0) * 1000
        self.request_count += 1
        self.total_inference_ms += elapsed_ms

        score_dict = {SCORE_NAMES[i]: round(scores[i], 4) for i in range(OUTPUT_DIM)}
        overall_idx = SCORE_NAMES.index("overall_aesthetic")
        uncertainty = {SCORE_NAMES[i]: round(stds[i], 4) for i in range(OUTPUT_DIM)}

        return {
            "scores": score_dict,
            "overall": round(scores[overall_idx], 4),
            "uncertainty": uncertainty,
            "norman": {
                "visceral": round(scores[SCORE_NAMES.index("visceral_score")], 4),
                "behavioral": round(scores[SCORE_NAMES.index("behavioral_score")], 4),
                "reflective": round(scores[SCORE_NAMES.index("reflective_score")], 4),
            },
            "inference_ms": round(elapsed_ms, 1),
            "model_version": self.phase,
            "param_count": sum(p.size for _, p in tree_flatten(self.model.parameters())),
        }

    def extract_features(self, request: dict) -> dict:
        """Extract MobileNet features without running the head."""
        inp = request.get("input", {})
        screenshot = inp.get("screenshot")
        if not screenshot:
            return {"error": "provide 'screenshot' path"}

        t0 = time.time()
        features = self.extractor.extract(screenshot)
        elapsed_ms = (time.time() - t0) * 1000

        return {
            "features": features.tolist(),
            "dim": len(features),
            "inference_ms": round(elapsed_ms, 1),
        }

    def status(self) -> dict:
        uptime = time.time() - self.start_time
        avg_ms = self.total_inference_ms / max(self.request_count, 1)
        weights_path = V8_WEIGHTS_PATH
        return {
            "status": "running",
            "phase": self.phase,
            "param_count": sum(p.size for _, p in tree_flatten(self.model.parameters())),
            "uptime_s": round(uptime, 1),
            "requests": self.request_count,
            "avg_inference_ms": round(avg_ms, 1),
            "weights": str(weights_path),
            "socket": SOCKET_PATH,
            "device": str(mx.default_device()),
        }

    def reload(self) -> dict:
        """Hot-reload model weights."""
        print("[server] reloading weights...")
        self.model, self.phase = load_design_model()
        return {"reloaded": True, "phase": self.phase}

    def handle(self, request: dict) -> dict:
        action = request.get("action", "evaluate")
        try:
            if action == "evaluate":
                return self.evaluate(request)
            elif action == "extract_features":
                return self.extract_features(request)
            elif action == "status":
                return self.status()
            elif action == "reload":
                return self.reload()
            else:
                return {"error": f"unknown action: {action}"}
        except Exception as e:
            return {"error": str(e)}


# ═══════════════════════════════════════════════════
# UNIX SOCKET TRANSPORT
# ═══════════════════════════════════════════════════


def run_socket_server(server: InferenceServer):
    """Run the inference server on a Unix domain socket."""
    # Clean up old socket
    if os.path.exists(SOCKET_PATH):
        os.remove(SOCKET_PATH)

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(SOCKET_PATH)
    sock.listen(5)
    sock.settimeout(1.0)  # Allow periodic signal checks

    # Write PID
    with open(PID_PATH, "w") as f:
        f.write(str(os.getpid()))

    print(f"[server] listening on {SOCKET_PATH}")
    print(f"[server] PID: {os.getpid()}")
    print("[server] ready.\n")

    running = True

    def shutdown(sig, frame):
        nonlocal running
        print(f"\n[server] shutting down (signal {sig})...")
        running = False

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while running:
        try:
            conn, _ = sock.accept()
        except socket.timeout:
            continue
        except OSError:
            break

        try:
            data = b""
            while True:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                data += chunk

            if data:
                request = json.loads(data.decode("utf-8"))
                response = server.handle(request)
                conn.sendall(json.dumps(response).encode("utf-8"))
        except Exception as e:
            try:
                conn.sendall(json.dumps({"error": str(e)}).encode("utf-8"))
            except:
                pass
        finally:
            conn.close()

    # Cleanup
    sock.close()
    if os.path.exists(SOCKET_PATH):
        os.remove(SOCKET_PATH)
    if os.path.exists(PID_PATH):
        os.remove(PID_PATH)
    print("[server] stopped.")


# ═══════════════════════════════════════════════════
# HTTP TRANSPORT (optional)
# ═══════════════════════════════════════════════════


def run_http_server(server: InferenceServer, port: int):
    """Run the inference server on HTTP."""
    from http.server import HTTPServer, BaseHTTPRequestHandler

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            request = json.loads(body.decode("utf-8"))
            response = server.handle(request)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode("utf-8"))

        def do_GET(self):
            response = server.status()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode("utf-8"))

        def log_message(self, format, *args):
            pass  # Suppress default logging

    httpd = HTTPServer(("127.0.0.1", port), Handler)
    print(f"[server] HTTP listening on http://127.0.0.1:{port}")

    # Also listen on socket for backward compat
    # (would need threading; skip for now — socket OR http)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()


# ═══════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Design Model Inference Server")
    parser.add_argument("--port", type=int, default=None, help="HTTP port (default: Unix socket only)")
    parser.add_argument("--warmup", action="store_true", help="Run warmup inference at startup")
    args = parser.parse_args()

    server = InferenceServer(warmup=args.warmup)

    if args.port:
        run_http_server(server, args.port)
    else:
        run_socket_server(server)
