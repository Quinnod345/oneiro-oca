#!/usr/bin/env python3
"""
distill_train.py — LoRA fine-tune a small VLM to mimic Opus's
teacher data from distill_collect.py.

Why
  The v9 head is a scalar regressor — it produces 16 numbers but cannot
  explain WHY a design fails.  A small VLM (SmolVLM 2B / PaliGemma 2 3B
  / Qwen2.5-VL 3B) fine-tuned via LoRA can reproduce both the scores
  AND the rationale, giving us:
    1. Better scores (likely — the VLM has stronger priors)
    2. Free-text critique generation (capability we don't have)
    3. Same-or-faster inference on M4 Max with MPS

Default student
  Qwen/Qwen2.5-VL-7B-Instruct (~7B params)
    - Strongest open VLM under 10B as of late 2025
    - Excellent at reading dense text in UI screenshots — important
      for design-quality judgments where typography + microcopy matter
    - Apache 2.0 licensed
    - ~14 GB bf16 weights, ~25-30 GB peak training memory at batch=1
    - Inference: ~1.5s per evaluation on M4 Max + MPS

Alternatives (swap with --model):
    Qwen/Qwen2.5-VL-3B-Instruct      # ~6 GB, ~600ms inference, slightly weaker
    HuggingFaceTB/SmolVLM-Instruct   # ~5 GB, fastest, but materially weaker
    google/paligemma2-3b-pt-224      # MLX-VLM friendly
    OpenGVLab/InternVL2_5-8B         # roughly tied with Qwen2.5-VL 7B

Output
  weights/distill-{model_name}-lora/      ← LoRA adapter weights
    adapter_config.json
    adapter_model.safetensors

Cost / time (Qwen2.5-VL 7B, ~500 teacher samples)
  Teacher data:    ~$40 in Opus 4.7 calls (one-time, see distill_collect.py)
  LoRA fine-tune:  4 epochs ≈ 12-20 hours on M4 Max + MPS
  No API spend during training; pure local compute.

Usage
  # Smoke test with a handful of teacher samples
  python3 distill_train.py --epochs 1 --max-samples 5 --output-suffix smoke

  # Full fine-tune (assumes you've run distill_collect.py for ~500 samples)
  python3 distill_train.py --epochs 4 --batch-size 2 --grad-accum 4

This script intentionally has a smoke-test path so you can verify the
pipeline works without committing to the full 6-12 hour training run.
"""

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
DISTILL_DIR = DATA_DIR / "distill"
WEIGHTS_DIR = ROOT / "weights"

DEFAULT_MODEL = "Qwen/Qwen2.5-VL-7B-Instruct"
DEFAULT_LORA_R = 16
DEFAULT_LORA_ALPHA = 32
DEFAULT_LORA_DROPOUT = 0.05

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]


def load_distill_records(max_samples: int | None = None) -> list[dict]:
    if not DISTILL_DIR.exists():
        return []
    records = []
    for path in sorted(DISTILL_DIR.glob("cycle-*.json")):
        try:
            rec = json.loads(path.read_text())
            if "scores" in rec and "rationale" in rec:
                records.append(rec)
        except Exception as e:
            print(f"  [warn] skip {path.name}: {e}", file=sys.stderr)
    if max_samples is not None:
        records = records[:max_samples]
    return records


def format_target(record: dict) -> str:
    """Convert a teacher record into the chain-of-thought text the student
    learns to produce.  Order matters: rationale first (chain-of-thought),
    scores last (final answer)."""
    rat = record["rationale"]
    scores = record["scores"]
    parts = ["DESIGN ANALYSIS"]
    if rat.get("dominant_strengths"):
        parts.append("Strengths: " + " | ".join(rat["dominant_strengths"]))
    if rat.get("dominant_weaknesses"):
        parts.append("Weaknesses: " + " | ".join(rat["dominant_weaknesses"]))
    if rat.get("intent_fit"):
        parts.append(f"Intent fit: {rat['intent_fit']}")
    if rat.get("norman_balance"):
        parts.append(f"Norman balance: {rat['norman_balance']}")
    if rat.get("fix_priorities"):
        parts.append("Fix priorities: " + " > ".join(rat["fix_priorities"]))
    parts.append("")
    parts.append("SCORES")
    for name in SCORE_NAMES:
        parts.append(f"  {name}: {scores.get(name, 0.5):.2f}")
    return "\n".join(parts)


def format_prompt(record: dict) -> str:
    """The user-side prompt the student VLM sees at inference time."""
    return (
        f"You are a world-class product designer evaluating a UI/app design.\n"
        f"BRIEF: {record.get('brief', 'unknown')}\n\n"
        f"Examine the design above and produce a structured analysis with "
        f"strengths, weaknesses, intent fit, Norman balance, fix priorities, "
        f"and 16-dimensional scores."
    )


def smoke_check_imports() -> tuple[bool, list[str]]:
    """Try to import the heavy deps; report what's missing.  We do this
    early so the user sees a helpful error before downloading 2 GB of
    model weights."""
    missing = []
    try:
        import torch  # noqa
    except ImportError:
        missing.append("torch")
    try:
        import transformers  # noqa
    except ImportError:
        missing.append("transformers")
    try:
        import peft  # noqa
    except ImportError:
        missing.append("peft")
    try:
        from PIL import Image  # noqa
    except ImportError:
        missing.append("Pillow")
    return (len(missing) == 0, missing)


def build_lora_model(model_id: str, lora_r: int, lora_alpha: int,
                     lora_dropout: float):
    """Load the VLM in PyTorch (MPS), wrap with PEFT LoRA on attention
    projections.  Returns (model, processor)."""
    import torch
    import transformers
    from transformers import AutoProcessor
    from peft import LoraConfig, get_peft_model

    # transformers 4.x → AutoModelForVision2Seq
    # transformers 5.x → AutoModelForImageTextToText (renamed)
    # Try the modern name first, fall back for older installs.
    try:
        from transformers import AutoModelForImageTextToText as _AutoVLM
    except ImportError:
        from transformers import AutoModelForVision2Seq as _AutoVLM

    device = "mps" if torch.backends.mps.is_available() else "cpu"

    print(f"[distill] loading {model_id} on {device} "
          f"(transformers {transformers.__version__}, using {_AutoVLM.__name__})...")
    t0 = time.time()
    # bfloat16 is well-supported on MPS and halves memory
    dtype = torch.bfloat16 if device == "mps" else torch.float32
    # transformers 5.x renamed `torch_dtype` to `dtype`; pass `dtype` first
    # then fall back for older releases.
    try:
        model = _AutoVLM.from_pretrained(
            model_id, dtype=dtype, low_cpu_mem_usage=True,
        ).to(device)
    except TypeError:
        model = _AutoVLM.from_pretrained(
            model_id, torch_dtype=dtype, low_cpu_mem_usage=True,
        ).to(device)

    # Gradient checkpointing — trades ~30% extra compute for ~70% less
    # activation memory.  Critical at our model size on M4 Max + MPS.
    if hasattr(model, "gradient_checkpointing_enable"):
        model.gradient_checkpointing_enable()
        # MPS bf16 + checkpointing needs use_cache=False
        if hasattr(model, "config"):
            model.config.use_cache = False
        print(f"[distill] gradient checkpointing enabled")

    # Cap image resolution at the processor.  Qwen2.5-VL's vision tower
    # tokenizes at 28×28 patches; without a cap a 1440×900 UI screenshot
    # produces thousands of vision tokens whose activations blow past the
    # 64 GB unified memory.  768×768 = ~750 tokens, fits easily.
    MAX_PIXELS = 768 * 768
    MIN_PIXELS = 256 * 256
    try:
        processor = AutoProcessor.from_pretrained(
            model_id, min_pixels=MIN_PIXELS, max_pixels=MAX_PIXELS,
        )
        print(f"[distill] processor capped: min_pixels={MIN_PIXELS}, max_pixels={MAX_PIXELS}")
    except TypeError:
        # Older processors don't accept these args — load default
        processor = AutoProcessor.from_pretrained(model_id)
        print(f"[distill] WARNING: processor does not accept pixel caps; "
              f"forward-pass memory may blow up on large screenshots")
    print(f"[distill] loaded in {time.time()-t0:.1f}s · "
          f"{sum(p.numel() for p in model.parameters())/1e6:.0f}M params")

    # LoRA on the attention projections of every transformer block.  Qwen2.5-VL,
    # PaliGemma 2, SmolVLM, and InternVL all use the same q_proj/k_proj/v_proj/o_proj
    # naming, so this target list works across all four.  Including k_proj
    # (vs the original 3-projection set) gives a small capability boost at
    # negligible cost on M4 Max.
    lora_config = LoraConfig(
        r=lora_r,
        lora_alpha=lora_alpha,
        lora_dropout=lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )
    model = get_peft_model(model, lora_config)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"[distill] LoRA wrapped: {trainable/1e6:.1f}M trainable / "
          f"{total/1e6:.0f}M total ({trainable/total*100:.2f}%)")

    return model, processor, device


def collate_records(records: list[dict], processor, device):
    """Build a list of (inputs, target_token_ids) pairs.

    SmolVLM expects messages with image+text content.  Each record becomes
    one chat-formatted training example.
    """
    from PIL import Image

    examples = []
    for rec in records:
        screenshot = rec["screenshot_path"]
        if not Path(screenshot).exists():
            continue

        prompt = format_prompt(rec)
        target = format_target(rec)

        try:
            img = Image.open(screenshot).convert("RGB")
        except Exception:
            continue

        messages = [
            {"role": "user", "content": [
                {"type": "image"},
                {"type": "text", "text": prompt},
            ]},
            {"role": "assistant", "content": [
                {"type": "text", "text": target},
            ]},
        ]

        try:
            text_chunks = processor.apply_chat_template(messages, add_generation_prompt=False)
            inputs = processor(text=text_chunks, images=[img], return_tensors="pt")
        except Exception as e:
            print(f"  [skip] processor failed for idx {rec.get('manifest_index')}: {e}",
                  file=sys.stderr)
            continue

        examples.append({"inputs": inputs, "target_text": target,
                         "manifest_index": rec.get("manifest_index")})
    return examples


def train(model_id: str, epochs: int, batch_size: int, grad_accum: int,
          lr: float, max_samples: int | None,
          lora_r: int, lora_alpha: int, lora_dropout: float,
          output_suffix: str = ""):
    ok, missing = smoke_check_imports()
    if not ok:
        print(f"[distill] missing dependencies: {missing}", file=sys.stderr)
        print(f"  install with: pip3 install --break-system-packages "
              f"{' '.join(missing)}", file=sys.stderr)
        return 1

    records = load_distill_records(max_samples=max_samples)
    if not records:
        print("[distill] no teacher records found at "
              f"{DISTILL_DIR}.  Run distill_collect.py first.", file=sys.stderr)
        return 1
    print(f"[distill] loaded {len(records)} teacher records")

    import torch
    from torch.optim import AdamW

    model, processor, device = build_lora_model(
        model_id, lora_r, lora_alpha, lora_dropout
    )

    print(f"[distill] preparing examples...")
    examples = collate_records(records, processor, device)
    print(f"[distill] {len(examples)} examples ready (after image-load filter)")

    if not examples:
        print("[distill] no valid examples after collation — aborting",
              file=sys.stderr)
        return 1

    optimizer = AdamW([p for p in model.parameters() if p.requires_grad],
                      lr=lr, weight_decay=0.01)
    model.train()

    total_steps = epochs * (len(examples) // batch_size + 1)
    print(f"[distill] training: {epochs} epochs, batch {batch_size}, "
          f"grad_accum {grad_accum}, lr {lr:.2e}, total ~{total_steps} steps")

    step = 0
    t0_run = time.time()
    for epoch in range(epochs):
        # Shuffle for this epoch
        import random
        rng = random.Random(epoch)
        rng.shuffle(examples)

        epoch_loss = 0.0
        accum_steps = 0
        optimizer.zero_grad()

        for k, ex in enumerate(examples):
            inputs = {key: val.to(device) for key, val in ex["inputs"].items()}

            # Targets: shift the input_ids so each token predicts the next
            labels = inputs["input_ids"].clone()
            # Mask padding tokens so they don't contribute to loss
            if "attention_mask" in inputs:
                labels = labels.masked_fill(inputs["attention_mask"] == 0, -100)
            inputs["labels"] = labels

            out = model(**inputs)
            loss = out.loss / grad_accum
            loss.backward()
            epoch_loss += float(loss) * grad_accum
            accum_steps += 1

            if accum_steps >= grad_accum:
                torch.nn.utils.clip_grad_norm_(
                    [p for p in model.parameters() if p.requires_grad], 1.0
                )
                optimizer.step()
                optimizer.zero_grad()
                accum_steps = 0
                step += 1

                if step % 5 == 0:
                    elapsed = time.time() - t0_run
                    print(f"  epoch {epoch+1}/{epochs} step {step:3d} "
                          f"sample {k+1:3d}/{len(examples)}  loss={float(loss)*grad_accum:.3f}  "
                          f"elapsed {elapsed/60:.1f}min")

        avg = epoch_loss / max(len(examples), 1)
        print(f"[distill] epoch {epoch+1} complete  avg_loss={avg:.4f}")

    # Save adapter
    out_dir = WEIGHTS_DIR / f"distill-{model_id.replace('/', '-')}-lora{output_suffix}"
    out_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(out_dir))
    print(f"[distill] saved LoRA adapter to {out_dir}")
    print(f"[distill] total time: {(time.time()-t0_run)/60:.1f} min")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LoRA fine-tune a small VLM via Opus distillation")
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help=f"HuggingFace VLM id (default {DEFAULT_MODEL})")
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=1,
                        help="Micro-batch size (default 1; M4 Max + 3B VLM is memory-bound)")
    parser.add_argument("--grad-accum", type=int, default=4,
                        help="Gradient accumulation steps (effective batch = batch * grad_accum)")
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--max-samples", type=int, default=None,
                        help="Cap teacher samples used (default: all)")
    parser.add_argument("--lora-r", type=int, default=DEFAULT_LORA_R)
    parser.add_argument("--lora-alpha", type=int, default=DEFAULT_LORA_ALPHA)
    parser.add_argument("--lora-dropout", type=float, default=DEFAULT_LORA_DROPOUT)
    parser.add_argument("--output-suffix", default="")
    args = parser.parse_args()

    sys.exit(train(
        args.model, args.epochs, args.batch_size, args.grad_accum,
        args.lr, args.max_samples,
        args.lora_r, args.lora_alpha, args.lora_dropout,
        args.output_suffix,
    ))
