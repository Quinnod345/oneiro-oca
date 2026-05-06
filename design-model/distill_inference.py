#!/usr/bin/env python3
"""
distill_inference.py — run the LoRA-distilled VLM on a screenshot + brief.

This is the inference path for the model produced by distill_train.py.
Uses standard HuggingFace + PEFT loading (`AutoModel.from_pretrained` +
`PeftModel.from_pretrained`) — the reliable mature path.  No mlx-vlm.

Architecture
  base:    Qwen/Qwen2.5-VL-3B-Instruct (or whatever was used during training)
  adapter: weights/distill-{model_name}-lora/ (PEFT adapter directory)
  device:  MPS on M4 Max, ~600ms per evaluation after warmup

Output
  Returns a dict with the parsed score table + the raw rationale text.
  Failures in JSON parsing fall back to returning the raw text under
  `raw_output` so callers can decide how to handle it.

Programmatic usage
  from distill_inference import DistillModel
  model = DistillModel()  # loads base + adapter once
  result = model.evaluate(
      screenshot_path="/abs/path/to/img.png",
      brief="A minimal task list inspired by Things 3"
  )
  # result: {scores: {...}, rationale: {...}, latency_ms: float}

CLI usage
  python3 distill_inference.py \
    --screenshot /path/to/img.png \
    --brief "A minimal task list inspired by Things 3"

  python3 distill_inference.py --warmup    # download base, load adapter, exit
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
WEIGHTS_DIR = ROOT / "weights"

DEFAULT_BASE_MODEL = "Qwen/Qwen2.5-VL-3B-Instruct"
DEFAULT_ADAPTER_DIR = WEIGHTS_DIR / "distill-Qwen-Qwen2.5-VL-3B-Instruct-lora"

SCORE_NAMES = [
    "typography_quality", "color_harmony", "spatial_composition",
    "motion_elegance", "emotional_resonance", "craft_visibility",
    "minimalism_coherence", "native_integration",
    "visceral_score", "behavioral_score", "reflective_score",
    "overall_aesthetic",
    "innovation_score", "system_creativity", "design_distinctiveness",
    "problem_level",
]


def format_prompt(brief: str) -> str:
    """Same prompt template the model was trained on (matches
    distill_train.format_prompt)."""
    return (
        f"You are a world-class product designer evaluating a UI/app design.\n"
        f"BRIEF: {brief or 'unknown'}\n\n"
        f"Examine the design above and produce a structured analysis with "
        f"strengths, weaknesses, intent fit, Norman balance, fix priorities, "
        f"and 16-dimensional scores."
    )


def parse_output(text: str) -> dict:
    """Parse the structured output the model was trained to produce.

    Training target shape (see distill_train.format_target):
        DESIGN ANALYSIS
        Strengths: ...
        Weaknesses: ...
        Intent fit: ...
        Norman balance: ...
        Fix priorities: ...

        SCORES
          typography_quality: 0.72
          color_harmony: 0.78
          ...

    Best-effort regex; falls back to {raw_output: text} if structure
    isn't found.
    """
    result: dict = {"raw_output": text}

    # Sections via simple regex
    sections = {
        "strengths": re.search(r"Strengths:\s*(.+?)(?=\n[A-Z]|\Z)", text, re.S),
        "weaknesses": re.search(r"Weaknesses:\s*(.+?)(?=\n[A-Z]|\Z)", text, re.S),
        "intent_fit": re.search(r"Intent fit:\s*(.+?)(?=\n[A-Z]|\Z)", text, re.S),
        "norman_balance": re.search(r"Norman balance:\s*(.+?)(?=\n[A-Z]|\Z)", text, re.S),
        "fix_priorities": re.search(r"Fix priorities:\s*(.+?)(?=\n[A-Z]|\Z)", text, re.S),
    }
    rationale = {}
    for k, m in sections.items():
        if m:
            val = m.group(1).strip()
            if k in ("strengths", "weaknesses"):
                rationale[k] = [s.strip() for s in val.split(" | ") if s.strip()]
            elif k == "fix_priorities":
                rationale[k] = [s.strip() for s in val.split(" > ") if s.strip()]
            else:
                rationale[k] = val
    if rationale:
        result["rationale"] = rationale

    # Scores: lines like "  typography_quality: 0.72"
    score_pattern = re.compile(r"\s+([a-z_]+):\s*([0-9]+(?:\.[0-9]+)?)")
    scores = {}
    in_scores_section = False
    for line in text.split("\n"):
        if "SCORES" in line:
            in_scores_section = True
            continue
        if in_scores_section:
            m = score_pattern.match(line)
            if m and m.group(1) in SCORE_NAMES:
                try:
                    scores[m.group(1)] = float(m.group(2))
                except ValueError:
                    pass
    if len(scores) >= 8:  # at least half the dims
        result["scores"] = scores
        # Convenience: overall + Norman block, mirrors v9 server response
        if "overall_aesthetic" in scores:
            result["overall"] = scores["overall_aesthetic"]
        if all(d in scores for d in ("visceral_score", "behavioral_score", "reflective_score")):
            result["norman"] = {
                "visceral": scores["visceral_score"],
                "behavioral": scores["behavioral_score"],
                "reflective": scores["reflective_score"],
            }

    return result


class DistillModel:
    """Persistent wrapper around the base VLM + PEFT adapter.

    Loads once; subsequent .evaluate() calls are warm and fast (~600ms
    on M4 Max for Qwen2.5-VL-3B).
    """

    def __init__(self, base_model_id: str = DEFAULT_BASE_MODEL,
                 adapter_dir: Path = DEFAULT_ADAPTER_DIR,
                 device: str | None = None):
        import torch
        from transformers import AutoProcessor

        # transformers 5.x rename
        try:
            from transformers import AutoModelForImageTextToText as _AutoVLM
        except ImportError:
            from transformers import AutoModelForVision2Seq as _AutoVLM

        from peft import PeftModel

        if device is None:
            device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.device = device
        self.torch = torch

        print(f"[distill-inf] loading base {base_model_id} on {device}...")
        t0 = time.time()
        dtype = torch.bfloat16 if device == "mps" else torch.float32
        try:
            base = _AutoVLM.from_pretrained(
                base_model_id, dtype=dtype, low_cpu_mem_usage=True,
            ).to(device)
        except TypeError:
            base = _AutoVLM.from_pretrained(
                base_model_id, torch_dtype=dtype, low_cpu_mem_usage=True,
            ).to(device)

        if adapter_dir is not None and Path(adapter_dir).exists():
            print(f"[distill-inf] loading adapter {adapter_dir.name}...")
            self.model = PeftModel.from_pretrained(base, str(adapter_dir))
            # Merge LoRA into base for faster inference (one-time cost).
            # If you want to swap adapters at runtime, comment out the merge.
            self.model = self.model.merge_and_unload()
            self.has_adapter = True
        else:
            print(f"[distill-inf] no adapter found at {adapter_dir}; using base model")
            self.model = base
            self.has_adapter = False

        self.model.eval()

        # Match training-time image cap so dimensions agree
        MAX_PIXELS = 768 * 768
        MIN_PIXELS = 256 * 256
        try:
            self.processor = AutoProcessor.from_pretrained(
                base_model_id, min_pixels=MIN_PIXELS, max_pixels=MAX_PIXELS,
            )
        except TypeError:
            self.processor = AutoProcessor.from_pretrained(base_model_id)

        print(f"[distill-inf] ready in {time.time()-t0:.1f}s "
              f"(adapter={'on' if self.has_adapter else 'off'})")

    def evaluate(self, screenshot_path: str, brief: str = "",
                 max_new_tokens: int = 700,
                 temperature: float = 0.0) -> dict:
        from PIL import Image

        t0 = time.time()
        img = Image.open(screenshot_path).convert("RGB")
        prompt = format_prompt(brief)

        messages = [{
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": prompt},
            ],
        }]
        text = self.processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = self.processor(text=[text], images=[img], return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        with self.torch.no_grad():
            generated = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=temperature > 0,
                temperature=temperature if temperature > 0 else 1.0,
                pad_token_id=getattr(self.processor.tokenizer, "pad_token_id", None)
                or self.processor.tokenizer.eos_token_id,
            )

        # Trim the prompt prefix from the generation
        prompt_len = inputs["input_ids"].shape[1]
        new_tokens = generated[0, prompt_len:]
        output_text = self.processor.tokenizer.decode(
            new_tokens, skip_special_tokens=True
        )

        result = parse_output(output_text)
        result["latency_ms"] = round((time.time() - t0) * 1000, 1)
        result["model"] = "qwen2.5-vl-3b" + ("-distilled" if self.has_adapter else "-base")
        result["brief_used"] = brief or None
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--screenshot", default=None)
    parser.add_argument("--brief", default="")
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--adapter-dir", type=Path, default=DEFAULT_ADAPTER_DIR)
    parser.add_argument("--max-tokens", type=int, default=700)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--warmup", action="store_true",
                        help="Just load model and adapter, then exit "
                             "(useful for first-run setup)")
    args = parser.parse_args()

    model = DistillModel(args.base_model, args.adapter_dir)
    if args.warmup:
        print("[distill-inf] warmup complete")
        return 0

    if not args.screenshot:
        print("ERROR: --screenshot is required (unless --warmup)", file=sys.stderr)
        return 1

    result = model.evaluate(
        screenshot_path=args.screenshot,
        brief=args.brief,
        max_new_tokens=args.max_tokens,
        temperature=args.temperature,
    )
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
