#!/usr/bin/env python3
"""
Design Model Inference Server — Phase 5/6/7.

Provides real-time design evaluation via Unix socket or HTTP.
Any process (Node.js, Python, CLI) can query design scores.

Architecture (auto-selected based on which weights file is present):
  v7  PyTorch features[0..17] → MLX features[18] (fine-tuned) →
      adapter → trunk → 4 heads (scores, uncertainty, pref, aux)
  v6  PyTorch features[0..18] (frozen) → MLX trunk → 4 heads
      (uncertainty meaningful, no backbone adaptation)
  v5  same as v6 but no uncertainty/adapter/pref (loaded with
      strict=False, those new params stay at random init)

Actions:
  evaluate       — screenshot → features → 16 design scores
                   (with per-dim uncertainty when running v6/v7)
  extract_features — screenshot → 1280-dim MobileNet features
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
# v7 weights take precedence (Phase 7 backbone fine-tuned), then v6, then v5.
# DesignHeadV7 is a strict superset of v6 (which is a superset of v5), so
# the same class can load any of the three with strict=False.  Older
# phases were purged 2026-04-28.
from train_v7 import DesignHeadV7, MOBILENET_WEIGHTS_PATH, SCORE_NAMES, OUTPUT_DIM

WEIGHTS_DIR = Path(__file__).parent.parent / "weights"
V7_WEIGHTS_PATH = WEIGHTS_DIR / "design-head-v7.safetensors"
V6_WEIGHTS_PATH = WEIGHTS_DIR / "design-head-v6.safetensors"
V5_WEIGHTS_PATH = WEIGHTS_DIR / "design-head-v5.safetensors"
SOCKET_PATH = "/tmp/design-model-v2.sock"
PID_PATH = "/tmp/design-model-v2.pid"

# ═══════════════════════════════════════════════════
# MOBILENET V2 FEATURE EXTRACTOR (PyTorch)
# ═══════════════════════════════════════════════════


class MobileNetExtractor:
    """Persistent MobileNet V2 feature extractor using PyTorch.

    Returns BOTH the 1280-dim pooled vector (legacy callers / v5/v6) and
    the (7, 7, 320) pre-pool tensor (v7's trainable features[18] consumes
    this).  Both are cheap once the image has gone through features[0..17].
    """

    def __init__(self):
        import torch
        import torchvision.models as models
        import torchvision.transforms as T

        self.torch = torch
        model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
        model.eval()

        # Split: pre[0..17] produces (1, 320, 7, 7); pooled[0..18]+pool produces (1, 1280)
        self.pre_extractor = torch.nn.Sequential(*list(model.features)[:18])
        self.pooled_extractor = torch.nn.Sequential(
            model.features,
            torch.nn.AdaptiveAvgPool2d((1, 1)),
            torch.nn.Flatten(),
        )

        self.transform = T.Compose([
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def extract(self, image_path: str) -> np.ndarray:
        """Extract 1280-dim pooled features (legacy API)."""
        from PIL import Image
        img = Image.open(image_path).convert("RGB")
        tensor = self.transform(img).unsqueeze(0)
        with self.torch.no_grad():
            features = self.pooled_extractor(tensor)
        return features[0].numpy()

    def extract_pre(self, image_path: str) -> np.ndarray:
        """Extract pre-pool (7, 7, 320) features for v7's trainable backbone."""
        from PIL import Image
        img = Image.open(image_path).convert("RGB")
        tensor = self.transform(img).unsqueeze(0)
        with self.torch.no_grad():
            pre = self.pre_extractor(tensor)  # (1, 320, 7, 7)
        # → NHWC for MLX
        return pre[0].permute(1, 2, 0).numpy().astype(np.float32)


# ═══════════════════════════════════════════════════
# DESIGN HEAD (MLX)
# ═══════════════════════════════════════════════════


def load_design_model():
    """Load the latest design head — prefer v7, fall back to v6, then v5.

    The v7 architecture is a strict superset of v6 (it adds a trainable
    backbone), which is a superset of v5.  DesignHeadV7 with strict=False
    can load any of the three checkpoints — missing params stay at random
    init, including the backbone for v6/v5 (which will then need to be
    re-initialized from MobileNet's ImageNet weights).
    """
    model = DesignHeadV7(dropout=0.0)

    if V7_WEIGHTS_PATH.exists():
        model.load_weights(str(V7_WEIGHTS_PATH))
        weights_path = V7_WEIGHTS_PATH
        phase = "phase_7"
    elif V6_WEIGHTS_PATH.exists():
        # v6 has no trainable backbone — load it as a v6-compat run.  We
        # need to ALSO seed the backbone from ImageNet weights, otherwise
        # the freshly-init v7 backbone is random and will give garbage
        # predictions for any pre-pool feature path.
        model.load_weights(str(V6_WEIGHTS_PATH), strict=False)
        if MOBILENET_WEIGHTS_PATH.exists():
            model.backbone.load_imagenet_weights(MOBILENET_WEIGHTS_PATH)
        weights_path = V6_WEIGHTS_PATH
        phase = "phase_6_compat"
    elif V5_WEIGHTS_PATH.exists():
        model.load_weights(str(V5_WEIGHTS_PATH), strict=False)
        if MOBILENET_WEIGHTS_PATH.exists():
            model.backbone.load_imagenet_weights(MOBILENET_WEIGHTS_PATH)
        weights_path = V5_WEIGHTS_PATH
        phase = "phase_5_compat"
    else:
        raise FileNotFoundError(
            f"No weights at {V7_WEIGHTS_PATH}, {V6_WEIGHTS_PATH}, or "
            f"{V5_WEIGHTS_PATH}.  Train via `python mlx/train_v7.py` first."
        )

    total = sum(p.size for _, p in tree_flatten(model.parameters()))
    print(f"[server] loaded {phase}: {weights_path.name} ({total:,} params)")
    model.eval()
    return model, phase


# ═══════════════════════════════════════════════════
# SERVER
# ═══════════════════════════════════════════════════


class InferenceServer:
    def __init__(self, warmup: bool = False):
        self.start_time = time.time()
        self.request_count = 0
        self.total_inference_ms = 0

        print("[server] loading MobileNet V2 feature extractor...")
        self.extractor = MobileNetExtractor()
        print("[server] loading design model...")
        self.model, self.phase = load_design_model()

        if warmup:
            print("[server] warming up MLX JIT...")
            # Warm both code paths: pre-pool (v7 backbone) and pooled (legacy)
            dummy_pre = mx.random.uniform(shape=(1, 7, 7, 320))
            dummy_pooled = mx.random.uniform(shape=(1, 1280))
            dummy_code = mx.zeros((1, 64))
            _ = self.model(dummy_pre, dummy_code, return_uncertainty=True)
            mx.eval(_)
            _ = self.model(dummy_pooled, dummy_code, return_uncertainty=True)
            mx.eval(_)
            print("[server] warmup complete")

    def evaluate(self, request: dict) -> dict:
        """Run full evaluation: image → features → scores.

        Phase routing:
          - phase_7 / phase_6_compat / phase_5_compat: feed the trainable
            MLX backbone with PRE-POOL (7, 7, 320) features so the
            fine-tuned features[18] runs.  The PyTorch extractor's
            extract_pre() does the cheap features[0..17] forward pass.
          - precomputed_features (1280-d) bypass the trainable backbone
            and use the legacy pooled-input path on the head's trunk.
            This preserves backward compat for callers with cached features.
        """
        t0 = time.time()
        inp = request.get("input", {})

        if "precomputed_features" in inp:
            vis_features = np.array(inp["precomputed_features"], dtype=np.float32)
            vis_mx = mx.array(vis_features[None, :])  # (1, 1280) — legacy path
        elif "screenshot" in inp:
            pre = self.extractor.extract_pre(inp["screenshot"])  # (7, 7, 320)
            vis_mx = mx.array(pre[None, :, :, :])  # (1, 7, 7, 320)
        else:
            return {"error": "provide 'screenshot' path or 'precomputed_features'"}

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

        # Uncertainty is meaningful for v6+ and v7.  Phase_5_compat has
        # random log_var weights so we suppress it.
        uncertainty = None
        if self.phase in ("phase_6_compat", "phase_7"):
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
        weights_path = (
            V7_WEIGHTS_PATH if V7_WEIGHTS_PATH.exists()
            else V6_WEIGHTS_PATH if V6_WEIGHTS_PATH.exists()
            else V5_WEIGHTS_PATH
        )
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
