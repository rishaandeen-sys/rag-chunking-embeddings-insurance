"""
metrics.py - evidence-grounded retrieval metrics.

Chunk boundaries differ between strategies, so a gold label cannot be a chunk id.
Instead each gold question carries EVIDENCE PHRASES lifted verbatim from the
policy document. A retrieved chunk counts as relevant if it contains that
evidence. This makes the four chunking arms directly comparable on one scale.
"""
import re
from typing import List, Dict

import numpy as np

WS = re.compile(r"\s+")

# PDF text layers emit typographic ligatures and fancy dashes; both corpora do.
# Normalising them is required or evidence matching silently fails on words
# like "specified" (which arrives as "speci<fi-ligature>ed").
LIGATURES = {
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl",
    "–": "-", "—": "-", "‘": "'", "’": "'",
    "“": '"', "”": '"', " ": " ",
}


def norm(text: str) -> str:
    for a, b in LIGATURES.items():
        text = text.replace(a, b)
    return WS.sub(" ", text.lower()).strip()


def is_relevant(chunk_text: str, gold: Dict) -> bool:
    hay = norm(chunk_text)
    ev = [norm(e) for e in gold["evidence"]]
    if gold.get("match", "any") == "all":
        return all(e in hay for e in ev)
    return any(e in hay for e in ev)


def count_relevant(chunks: List[Dict], gold: Dict) -> int:
    """How many DISTINCT retrievable units in the index carry this evidence.

    Needed for a correct IDCG: the ideal ranking is bounded by how many
    relevant units actually exist, not by how many happened to be retrieved.

    Units are counted after collapsing parent-child duplicates. Counting every
    child of a relevant parent separately would inflate the ideal ranking for
    that strategy alone and make its nDCG incomparable with the others.
    """
    seen = set()
    for c in chunks:
        if is_relevant(c["text"], gold):
            seen.add(c.get("parent_id", c["chunk_id"]))
    return len(seen)


def evaluate_query(results: List[Dict], gold: Dict, k: int = 10,
                   n_rel_total: int = None) -> Dict:
    """results: ranked list of chunk dicts. Returns per-query metrics.

    success@k  - was the evidence found at all within the top k (binary)
    coverage@k - what fraction of all relevant chunks were retrieved
    ndcg@k     - binary-gain nDCG, normalised against the ideal ranking of
                 min(n_rel_total, k) relevant chunks
    """
    topk = results[:k]
    rel_flags = [1 if is_relevant(c["text"], gold) else 0 for c in topk]

    hit_at_1 = rel_flags[0] if rel_flags else 0
    hit_at_3 = 1 if any(rel_flags[:3]) else 0
    hit_at_5 = 1 if any(rel_flags[:5]) else 0
    recall_at_k = 1 if any(rel_flags) else 0          # success@k: evidence found at all
    precision_at_k = sum(rel_flags) / max(1, len(rel_flags))

    # MRR
    mrr = 0.0
    for i, f in enumerate(rel_flags, start=1):
        if f:
            mrr = 1.0 / i
            break

    # nDCG@k with binary gains. The ideal ranking puts min(n_rel_total, k)
    # relevant chunks at the top; falling back to the retrieved count only when
    # the caller cannot supply the index-wide total.
    dcg = sum(f / np.log2(i + 1) for i, f in enumerate(rel_flags, start=1))
    n_rel = sum(rel_flags)
    ideal_n = min(n_rel_total, k) if n_rel_total is not None else n_rel
    idcg = sum(1.0 / np.log2(i + 1) for i in range(1, ideal_n + 1)) if ideal_n else 0.0
    ndcg = (dcg / idcg) if idcg > 0 else 0.0
    coverage = (n_rel / n_rel_total) if n_rel_total else 0.0

    return {
        "hit@1": hit_at_1,
        "hit@3": hit_at_3,
        "hit@5": hit_at_5,
        "recall@k": recall_at_k,
        "precision@k": precision_at_k,
        "mrr": mrr,
        "ndcg@k": ndcg,
        "coverage@k": coverage,
        "n_relevant_retrieved": n_rel,
    }


def aggregate(per_query: List[Dict]) -> Dict:
    if not per_query:
        return {}
    keys = [k for k in per_query[0] if k != "n_relevant_retrieved"]
    return {k: float(np.mean([q[k] for q in per_query])) for k in keys}
