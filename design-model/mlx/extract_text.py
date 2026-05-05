#!/usr/bin/env python3
"""
Extract text-intent embeddings for all manifest samples using a small
sentence-transformer (all-MiniLM-L6-v2, 22M params, 384-d).

Phase 10 — design intent
  v8 added DINOv2 vision features but the model still doesn't know WHAT
  is being designed.  A "music player" and a "settings panel" should be
  judged differently — visceral matters more for the first, behavioral
  for the second.  Adding intent text via a frozen sentence-transformer
  gives the trunk this prior at marginal compute cost (~10ms per sample
  on MPS, 384-d cached vectors).

Text composition
  For each sample we compose text from the most informative metadata field:
    1. metadata.brief  — full design brief (170 self_train samples)
    2. category + source_name — composite description (most other samples)
    3. category alone — fallback (handful)

Output
  data/text_embeddings.npz with arrays:
    indices     (int64, shape=[N])           — manifest sample indices
    embeddings  (float32, shape=[N, 384])    — MiniLM embeddings
    briefs      (object,  shape=[N])         — the source text per sample,
                                               for inspection / debugging

Idempotent — re-running skips samples already in the cache (keyed by
manifest index AND brief text, so changing a sample's brief invalidates
its cached embedding automatically).

Usage
  python extract_text.py
  python extract_text.py --model intfloat/e5-small-v2
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

DATA_DIR = Path(__file__).parent.parent / "data"
MANIFEST_PATH = DATA_DIR / "manifest.json"
EMBEDDINGS_PATH = DATA_DIR / "text_embeddings.npz"

DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
TEXT_DIM = 384


def compose_brief(sample: dict) -> str:
    """Return the best available intent text for a sample.

    Order of preference:
      1. metadata.brief      — present for opus_self_train
      2. category + source_name composite — gives flywheel/scraped
         samples richer context than category alone
      3. category alone
      4. source_name alone
      5. "unknown design"   — last resort, only if literally nothing
    """
    meta = sample.get("metadata", {}) or {}
    brief = (meta.get("brief") or "").strip()
    if brief:
        return brief
    cat = (meta.get("category") or "").strip()
    sn = (meta.get("source_name") or "").strip()
    if cat and sn:
        # Strip path-like prefixes that aren't useful context
        sn_clean = sn.replace("flywheel-", "").replace("self-train-", "")
        return f"a {cat} design: {sn_clean}"
    return cat or sn or "unknown design"


def mean_pooling(token_embeddings, attention_mask):
    """Mean-pool over token positions, masking padding."""
    mask = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
    summed = torch.sum(token_embeddings * mask, dim=1)
    denom = torch.clamp(mask.sum(dim=1), min=1e-9)
    return summed / denom


def encode_batch(model, tokenizer, texts, device):
    """Encode a list of texts to (N, 384) normalized embeddings."""
    encoded = tokenizer(texts, padding=True, truncation=True,
                        max_length=128, return_tensors="pt")
    encoded = {k: v.to(device) for k, v in encoded.items()}
    with torch.no_grad():
        out = model(**encoded)
    pooled = mean_pooling(out.last_hidden_state, encoded["attention_mask"])
    # L2-normalize so cosine sim works without division
    pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
    return pooled.cpu().numpy().astype(np.float32)


def load_existing_archive():
    if not EMBEDDINGS_PATH.exists():
        return {"indices": np.zeros(0, dtype=np.int64),
                "embeddings": np.zeros((0, TEXT_DIM), dtype=np.float32),
                "briefs": np.zeros(0, dtype=object)}
    with np.load(EMBEDDINGS_PATH, allow_pickle=True) as npz:
        return {
            "indices": npz["indices"].copy(),
            "embeddings": npz["embeddings"].copy(),
            "briefs": npz["briefs"].copy(),
        }


def save_archive(archive):
    np.savez(EMBEDDINGS_PATH,
             indices=archive["indices"],
             embeddings=archive["embeddings"],
             briefs=archive["briefs"])


def extract(model_id: str = DEFAULT_MODEL, batch_size: int = 32):
    if torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")

    print(f"[text] loading {model_id} on {device}...")
    t0 = time.time()
    model = AutoModel.from_pretrained(model_id).to(device)
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model.eval()
    print(f"[text] loaded in {time.time()-t0:.1f}s · "
          f"{sum(p.numel() for p in model.parameters())/1e6:.1f}M params · "
          f"{TEXT_DIM}-d output")

    manifest = json.loads(MANIFEST_PATH.read_text())
    archive = load_existing_archive()

    # Map manifest_index → (cached_brief, embedding_index_in_archive)
    cached_idx = {int(idx): k for k, idx in enumerate(archive["indices"].tolist())}

    # Build the work list, skipping samples whose cached brief still matches
    work = []  # list of (manifest_index, brief_text)
    for mi, sample in enumerate(manifest["samples"]):
        brief = compose_brief(sample)
        if mi in cached_idx:
            cached_brief = str(archive["briefs"][cached_idx[mi]])
            if cached_brief == brief:
                continue  # already cached AND brief unchanged
        work.append((mi, brief))

    print(f"[text] {len(work)} samples to embed "
          f"(of {len(manifest['samples'])} total; "
          f"{len(cached_idx)} cached)")

    if not work:
        print("[text] nothing to do — text embedding cache is up to date.")
        return

    # Batch encode
    new_indices = []
    new_embeddings = []
    new_briefs = []

    t0 = time.time()
    for batch_start in range(0, len(work), batch_size):
        batch = work[batch_start: batch_start + batch_size]
        texts = [b for _, b in batch]
        emb = encode_batch(model, tokenizer, texts, device)
        for (mi, brief), e in zip(batch, emb):
            new_indices.append(mi)
            new_embeddings.append(e)
            new_briefs.append(brief)

        done = min(batch_start + batch_size, len(work))
        print(f"  [{done}/{len(work)}] encoded")

    new_indices = np.asarray(new_indices, dtype=np.int64)
    new_embeddings = np.stack(new_embeddings).astype(np.float32)
    new_briefs = np.asarray(new_briefs, dtype=object)

    # Merge with archive: replace any existing entries for these indices
    new_set = set(new_indices.tolist())
    keep_mask = ~np.isin(archive["indices"], list(new_set))
    archive["indices"] = np.concatenate([archive["indices"][keep_mask], new_indices])
    archive["embeddings"] = np.concatenate(
        [archive["embeddings"][keep_mask], new_embeddings], axis=0
    ) if archive["embeddings"].shape[0] else new_embeddings
    archive["briefs"] = np.concatenate([archive["briefs"][keep_mask], new_briefs])

    save_archive(archive)
    elapsed = time.time() - t0
    print(f"\n[text] embedded {len(new_indices)} new texts in {elapsed:.1f}s")
    print(f"[text] archive: {EMBEDDINGS_PATH.name}, "
          f"shape={archive['embeddings'].shape}, "
          f"size={EMBEDDINGS_PATH.stat().st_size / 1024:.0f} KB")
    print(f"[text] sample briefs (first 3):")
    for k in range(min(3, len(new_briefs))):
        print(f"  idx {new_indices[k]}: {new_briefs[k][:80]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract text-intent embeddings")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    extract(model_id=args.model, batch_size=args.batch_size)
