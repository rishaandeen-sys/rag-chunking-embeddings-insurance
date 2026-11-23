"""
retrievers.py - dense, sparse, hybrid-RRF and cross-encoder re-ranked retrieval.

The RRF implementation deliberately fuses on ORDINAL RANK, never on raw score,
because dense cosine similarity and BM25 term weights live on incompatible
scales (this was the argument on Slide 7 of Review 1).
"""
import re
import time
from typing import List, Dict, Tuple

import numpy as np
import faiss
from rank_bm25 import BM25Okapi

TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> List[str]:
    return TOKEN_RE.findall(text.lower())


class DenseIndex:
    """FAISS inner-product index over L2-normalised vectors (= cosine)."""

    def __init__(self, vectors: np.ndarray, chunks: List[Dict]):
        self.chunks = chunks
        v = np.ascontiguousarray(vectors.astype("float32"))
        faiss.normalize_L2(v)
        self.index = faiss.IndexFlatIP(v.shape[1])
        self.index.add(v)
        self.dim = v.shape[1]
        self.nbytes = v.nbytes

    def search(self, qvec: np.ndarray, k: int) -> List[Tuple[int, float]]:
        q = np.ascontiguousarray(qvec.astype("float32").reshape(1, -1))
        faiss.normalize_L2(q)
        scores, ids = self.index.search(q, min(k, len(self.chunks)))
        return [(int(i), float(s)) for i, s in zip(ids[0], scores[0]) if i >= 0]


class SparseIndex:
    """BM25 over the same retrieval units."""

    def __init__(self, chunks: List[Dict]):
        self.chunks = chunks
        self.corpus = [tokenize(c["retrieval_text"]) for c in chunks]
        self.bm25 = BM25Okapi(self.corpus)

    def search(self, query: str, k: int) -> List[Tuple[int, float]]:
        scores = self.bm25.get_scores(tokenize(query))
        top = np.argsort(scores)[::-1][:k]
        return [(int(i), float(scores[i])) for i in top]


def rrf_fuse(rankings: List[List[Tuple[int, float]]], k_const: int = 60,
             top_k: int = 10) -> List[Tuple[int, float]]:
    """
    Reciprocal Rank Fusion: score(d) = sum over lists of 1 / (k + rank(d)).
    Raw magnitudes are discarded entirely - only ordinal position survives.
    """
    fused = {}
    for ranking in rankings:
        for rank, (idx, _score) in enumerate(ranking, start=1):
            fused[idx] = fused.get(idx, 0.0) + 1.0 / (k_const + rank)
    ordered = sorted(fused.items(), key=lambda x: x[1], reverse=True)
    return ordered[:top_k]


class Retriever:
    """
    Wraps one (chunking strategy x embedding model) configuration and exposes
    the four retrieval modes the study compares.
    """

    def __init__(self, chunks: List[Dict], vectors: np.ndarray, embed_query_fn,
                 cross_encoder=None):
        self.chunks = chunks
        self.dense = DenseIndex(vectors, chunks)
        self.sparse = SparseIndex(chunks)
        self.embed_query = embed_query_fn
        self.cross_encoder = cross_encoder
        # Parent-child indexes many children per parent. Returning several
        # children of the same parent would hand the generator the same text
        # repeatedly, so results are collapsed to unique parents - which is how
        # the strategy is defined, and what keeps it comparable with the others.
        self.dedup = any("parent_id" in c for c in chunks)

    def _key(self, idx: int):
        c = self.chunks[idx]
        return c.get("parent_id", c["chunk_id"])

    def _collapse(self, hits, k):
        """Keep the best-ranked hit per parent, preserving order."""
        if not self.dedup:
            return hits[:k]
        seen, out = set(), []
        for idx, score in hits:
            key = self._key(idx)
            if key in seen:
                continue
            seen.add(key)
            out.append((idx, score))
            if len(out) >= k:
                break
        return out

    # ---------------------------------------------------------------- modes
    def retrieve(self, query: str, mode: str = "hybrid_rrf", k: int = 10,
                 candidate_pool: int = 30) -> Tuple[List[Dict], float]:
        t0 = time.perf_counter()

        # over-fetch so that collapsing to unique parents still yields k results
        fan = 8 if self.dedup else 1
        pool = min(len(self.chunks), candidate_pool * fan)

        if mode == "dense":
            raw = self.dense.search(self.embed_query(query), k * fan)
            hits = self._collapse(raw, k)

        elif mode == "sparse":
            raw = self.sparse.search(query, k * fan)
            hits = self._collapse(raw, k)

        elif mode == "hybrid_rrf":
            d = self.dense.search(self.embed_query(query), pool)
            s = self.sparse.search(query, pool)
            hits = self._collapse(rrf_fuse([d, s], top_k=pool), k)

        elif mode == "hybrid_rerank":
            d = self.dense.search(self.embed_query(query), pool)
            s = self.sparse.search(query, pool)
            fused = rrf_fuse([d, s], top_k=pool)
            # collapse BEFORE cross-encoding: scoring eight children of one
            # parent wastes the budget that should cover eight distinct clauses
            fused = self._collapse(fused, candidate_pool)
            if self.cross_encoder is None:
                hits = fused[:k]
            else:
                pairs = [(query, self.chunks[i]["retrieval_text"]) for i, _ in fused]
                ce_scores = self.cross_encoder.predict(pairs)
                order = np.argsort(ce_scores)[::-1][:k]
                hits = [(fused[o][0], float(ce_scores[o])) for o in order]
        else:
            raise ValueError(f"unknown retrieval mode: {mode}")

        latency_ms = (time.perf_counter() - t0) * 1000.0
        results = []
        for idx, score in hits:
            c = dict(self.chunks[idx])
            c["score"] = score
            results.append(c)
        return results, latency_ms


MODES = {
    "dense": "Dense only",
    "sparse": "Sparse only (BM25)",
    "hybrid_rrf": "Hybrid (RRF fusion)",
    "hybrid_rerank": "Hybrid + cross-encoder re-rank",
}
