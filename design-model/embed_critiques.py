#!/usr/bin/env python3
"""
embed_critiques.py — Phase 5 critique embedding pipeline.

Phase 5 of the design model (per VISION.md:211) adds an auxiliary training
head that learns to predict Opus's critique text from the code's feature
vector. Scores teach WHAT, critiques teach WHY — "great typography but
clashes with the palette" carries structural information that per-dimension
scores can't capture, and an embedded critique is a dense representation
of that structural signal.

This script is the batch embedding layer. It:
  • Scans data/critiques/cycle-*.json for per-cycle critique records
    (produced by self_train.save_critique_for_training())
  • Filters to records with non-empty critique text
  • Skips cycles already embedded (tracked in data/critique_embeddings_state.json)
  • Batches the unembedded critique texts through OpenAI's
    text-embedding-3-large endpoint (3072 dims)
  • Appends to a NumPy zip at data/critique_embeddings.npz with:
      cycle_ids  (int64, shape=[N])
      embeddings (float32, shape=[N, 3072])
      overalls   (float32, shape=[N])
      innovations (float32, shape=[N])
  • Updates the state file with the latest cycle number + timestamp

Run manually:
    python3 embed_critiques.py
    python3 embed_critiques.py --batch-size 64
    python3 embed_critiques.py --model text-embedding-3-small

Run as a recurring cron / or at the end of a self_train batch. Safe to
re-run — embeddings are idempotent via the cycle-id state file.

Requires: requests, numpy, OPENAI_API_KEY in env (already in .env).
No openai package needed — calls the HTTP endpoint directly.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import List, Tuple

import numpy as np
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env", override=True)

# ═══════════════════════════════════════════════════
# Paths & constants
# ═══════════════════════════════════════════════════

DATA_DIR = Path(__file__).parent / "data"
CRITIQUES_DIR = DATA_DIR / "critiques"
EMBEDDINGS_PATH = DATA_DIR / "critique_embeddings.npz"
STATE_PATH = DATA_DIR / "critique_embeddings_state.json"

OPENAI_API_URL = "https://api.openai.com/v1/embeddings"
DEFAULT_MODEL = "text-embedding-3-large"
DEFAULT_DIMS = 3072  # text-embedding-3-large native
DEFAULT_BATCH_SIZE = 64  # OpenAI accepts up to 2048 but 64 keeps latency low
MAX_CRITIQUE_CHARS = 6000  # truncate very long critiques so rate cost stays bounded

# ═══════════════════════════════════════════════════
# State tracking
# ═══════════════════════════════════════════════════


def load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            pass
    return {
        "embedded_cycles": [],
        "last_embed_at": None,
        "model": DEFAULT_MODEL,
        "dim": DEFAULT_DIMS,
        "total_api_calls": 0,
        "total_tokens": 0,
    }


def save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2))


# ═══════════════════════════════════════════════════
# Critique discovery
# ═══════════════════════════════════════════════════


def discover_critiques() -> List[dict]:
    """Scan CRITIQUES_DIR and return all critique records, sorted by cycle."""
    if not CRITIQUES_DIR.exists():
        return []
    records = []
    for path in sorted(CRITIQUES_DIR.glob("cycle-*.json")):
        try:
            rec = json.loads(path.read_text())
            if rec.get("critique"):  # skip empty-critique stubs
                records.append(rec)
        except Exception as e:
            print(f"  [warn] skip {path.name}: {e}", file=sys.stderr)
    return records


def filter_unembedded(records: List[dict], embedded_ids: set) -> List[dict]:
    return [r for r in records if r["cycle"] not in embedded_ids]


# ═══════════════════════════════════════════════════
# OpenAI API call
# ═══════════════════════════════════════════════════


def embed_batch(texts: List[str], model: str, api_key: str) -> Tuple[np.ndarray, int]:
    """Call OpenAI embeddings API for one batch. Returns (embeddings, tokens_used)."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"model": model, "input": texts}
    r = requests.post(OPENAI_API_URL, headers=headers, json=payload, timeout=60)
    r.raise_for_status()
    data = r.json()
    # Data is ordered by .index; build an array in order
    sorted_data = sorted(data["data"], key=lambda x: x["index"])
    embeddings = np.asarray([d["embedding"] for d in sorted_data], dtype=np.float32)
    tokens = data.get("usage", {}).get("total_tokens", 0)
    return embeddings, tokens


# ═══════════════════════════════════════════════════
# Archive append
# ═══════════════════════════════════════════════════


def load_existing_archive() -> dict:
    """Load cycle_ids/embeddings/overalls/innovations from the .npz file."""
    if not EMBEDDINGS_PATH.exists():
        return {
            "cycle_ids": np.zeros(0, dtype=np.int64),
            "embeddings": np.zeros((0, DEFAULT_DIMS), dtype=np.float32),
            "overalls": np.zeros(0, dtype=np.float32),
            "innovations": np.zeros(0, dtype=np.float32),
        }
    with np.load(EMBEDDINGS_PATH) as npz:
        return {
            "cycle_ids": npz["cycle_ids"].copy(),
            "embeddings": npz["embeddings"].copy(),
            "overalls": npz["overalls"].copy(),
            "innovations": npz["innovations"].copy(),
        }


def save_archive(archive: dict) -> None:
    np.savez(
        EMBEDDINGS_PATH,
        cycle_ids=archive["cycle_ids"],
        embeddings=archive["embeddings"],
        overalls=archive["overalls"],
        innovations=archive["innovations"],
    )


# ═══════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 5 critique embedding pipeline")
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help=f"OpenAI embedding model (default: {DEFAULT_MODEL})")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE,
                        help=f"Texts per API call (default: {DEFAULT_BATCH_SIZE})")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report counts without calling the API")
    parser.add_argument("--max-new", type=int, default=None,
                        help="Embed at most this many new critiques this run")
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not args.dry_run and not api_key:
        print("ERROR: OPENAI_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    state = load_state()
    archive = load_existing_archive()
    embedded_ids = set(int(x) for x in archive["cycle_ids"].tolist())

    records = discover_critiques()
    unembedded = filter_unembedded(records, embedded_ids)

    print(f"═══ Phase 5 Critique Embedder ═══")
    print(f"Critiques on disk:   {len(records)}")
    print(f"Already embedded:    {len(embedded_ids)}")
    print(f"Unembedded:          {len(unembedded)}")
    print(f"Archive:             {EMBEDDINGS_PATH.name} ({archive['embeddings'].shape})")
    print(f"Model:               {args.model}")

    if args.max_new is not None:
        unembedded = unembedded[: args.max_new]
        print(f"Cap this run:        {len(unembedded)}")

    if args.dry_run:
        print("Dry run — no API calls made.")
        return

    if not unembedded:
        print("Nothing to embed. Done.")
        return

    # ── Batch through API ──
    t0 = time.time()
    total_tokens = 0
    api_calls = 0

    new_ids = []
    new_embeddings = []
    new_overalls = []
    new_innovations = []

    for batch_start in range(0, len(unembedded), args.batch_size):
        batch = unembedded[batch_start : batch_start + args.batch_size]
        texts = [
            (r["critique"] or "")[:MAX_CRITIQUE_CHARS]
            for r in batch
        ]

        try:
            embeddings, tokens = embed_batch(texts, args.model, api_key)
        except requests.HTTPError as e:
            print(f"  [api error] batch {batch_start // args.batch_size}: {e}", file=sys.stderr)
            if e.response is not None:
                print(f"  body: {e.response.text[:300]}", file=sys.stderr)
            break
        except Exception as e:
            print(f"  [api error] batch {batch_start // args.batch_size}: {e}", file=sys.stderr)
            break

        api_calls += 1
        total_tokens += tokens

        for i, rec in enumerate(batch):
            new_ids.append(rec["cycle"])
            new_embeddings.append(embeddings[i])
            new_overalls.append(float(rec.get("overall", 0.0)))
            new_innovations.append(float(rec.get("innovation", 0.0)))

        done = min(batch_start + args.batch_size, len(unembedded))
        print(
            f"  batch {api_calls}: cycles {batch[0]['cycle']}-{batch[-1]['cycle']} "
            f"({done}/{len(unembedded)}) · {tokens} tok"
        )

    if not new_ids:
        print("No successful embeddings. Exiting without state update.")
        return

    # ── Append + save ──
    new_ids_arr = np.asarray(new_ids, dtype=np.int64)
    new_emb_arr = np.stack(new_embeddings).astype(np.float32)
    new_overalls_arr = np.asarray(new_overalls, dtype=np.float32)
    new_innov_arr = np.asarray(new_innovations, dtype=np.float32)

    archive["cycle_ids"] = np.concatenate([archive["cycle_ids"], new_ids_arr])
    archive["embeddings"] = (
        np.concatenate([archive["embeddings"], new_emb_arr], axis=0)
        if archive["embeddings"].shape[0] > 0
        else new_emb_arr
    )
    archive["overalls"] = np.concatenate([archive["overalls"], new_overalls_arr])
    archive["innovations"] = np.concatenate([archive["innovations"], new_innov_arr])

    save_archive(archive)

    # ── Update state ──
    state["embedded_cycles"] = sorted(set(
        list(state.get("embedded_cycles", [])) + list(int(x) for x in new_ids_arr.tolist())
    ))
    state["last_embed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state["model"] = args.model
    state["dim"] = int(new_emb_arr.shape[1])
    state["total_api_calls"] = int(state.get("total_api_calls", 0)) + api_calls
    state["total_tokens"] = int(state.get("total_tokens", 0)) + total_tokens
    save_state(state)

    elapsed = time.time() - t0
    print(f"\n═══ Done ═══")
    print(f"Embedded:       {len(new_ids)} new critiques")
    print(f"API calls:      {api_calls}")
    print(f"Tokens:         {total_tokens}")
    print(f"Elapsed:        {elapsed:.1f}s")
    print(f"Archive shape:  {archive['embeddings'].shape}")
    print(f"Saved to:       {EMBEDDINGS_PATH}")


if __name__ == "__main__":
    main()
