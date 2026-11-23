"""
embedders.py - embedding model registry with on-disk vector caching.

Includes two Matryoshka arms so the Review-1 claim ("vectors can be truncated
after generation, retaining 90-95% of accuracy at a fraction of the storage")
is actually tested rather than asserted:

  * bge_base_256  - NAIVE truncation of a non-Matryoshka encoder (control)
  * arctic_mrl_256 - truncation of a genuinely Matryoshka-trained encoder

The difference between those two rows is the real finding.
"""
import hashlib
from pathlib import Path
from typing import List

import numpy as np

CACHE = Path(__file__).resolve().parents[1] / "data" / "vec_cache"
CACHE.mkdir(parents=True, exist_ok=True)

# name -> (hf_id, full_dim, truncate_to_dim or None, needs_trust_remote_code, query_prefix)
REGISTRY = {
    "minilm": ("sentence-transformers/all-MiniLM-L6-v2", 384, None, False, ""),
    "bge_small": ("BAAI/bge-small-en-v1.5", 384, None, False,
                  "Represent this sentence for searching relevant passages: "),
    "bge_base": ("BAAI/bge-base-en-v1.5", 768, None, False,
                 "Represent this sentence for searching relevant passages: "),
    "bge_base_256": ("BAAI/bge-base-en-v1.5", 768, 256, False,
                     "Represent this sentence for searching relevant passages: "),
    "arctic_mrl_256": ("Snowflake/snowflake-arctic-embed-m-v1.5", 768, 256, False,
                       "Represent this sentence for searching relevant passages: "),
}

DISPLAY = {
    "minilm": "MiniLM-L6 (384d)",
    "bge_small": "bge-small (384d)",
    "bge_base": "bge-base (768d)",
    "bge_base_256": "bge-base -> 256d (naive)",
    "arctic_mrl_256": "arctic -> 256d (true MRL)",
}

_MODELS = {}


def get_model(name: str):
    from sentence_transformers import SentenceTransformer
    hf_id, _, _, trust, _ = REGISTRY[name]
    key = (hf_id, trust)
    if key not in _MODELS:
        kw = {"trust_remote_code": True} if trust else {}
        _MODELS[key] = SentenceTransformer(hf_id, **kw)
    return _MODELS[key]


def _cache_key(name: str, texts: List[str], is_query: bool) -> Path:
    h = hashlib.sha256()
    h.update(name.encode())
    h.update(b"Q" if is_query else b"D")
    h.update(str(len(texts)).encode())
    for t in texts:
        h.update(t.encode("utf-8", "ignore"))
    return CACHE / f"{name}_{'q' if is_query else 'd'}_{h.hexdigest()[:16]}.npy"


def _postprocess(vecs: np.ndarray, truncate_to) -> np.ndarray:
    if truncate_to:
        vecs = vecs[:, :truncate_to]
    # always renormalise after truncation - this is required for MRL to work
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    return vecs / (norms + 1e-9)


def embed(name: str, texts: List[str], is_query: bool = False,
          batch_size: int = 64, use_cache: bool = True) -> np.ndarray:
    if not texts:
        return np.zeros((0, 1), dtype="float32")
    _, _, trunc, _, qprefix = REGISTRY[name]
    path = _cache_key(name, texts, is_query)
    if use_cache and path.exists():
        return np.load(path)

    model = get_model(name)
    payload = [qprefix + t for t in texts] if (is_query and qprefix) else texts
    vecs = model.encode(payload, batch_size=batch_size, show_progress_bar=False,
                        convert_to_numpy=True, normalize_embeddings=False)
    vecs = _postprocess(np.asarray(vecs, dtype="float32"), trunc)
    if use_cache:
        np.save(path, vecs)
    return vecs


def make_query_fn(name: str):
    def _fn(q: str) -> np.ndarray:
        return embed(name, [q], is_query=True, use_cache=False)[0]
    return _fn


def available() -> List[str]:
    """Models that can actually be loaded in this environment."""
    ok = []
    for name in REGISTRY:
        try:
            get_model(name)
            ok.append(name)
        except Exception as e:
            print(f"  [skip] {name}: {type(e).__name__}: {str(e)[:120]}")
    return ok
