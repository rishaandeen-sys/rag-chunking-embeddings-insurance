"""
benchmark.py - the full experimental grid.

Design note: BM25 does not depend on the embedding model, so the sparse arm is
run ONCE per chunking strategy rather than once per (strategy x model) cell.
Semantic chunk boundaries are always computed with MiniLM so that the chunk set
is identical across embedding arms - only the INDEXING encoder varies. Without
that control, the chunking and embedding factors would be confounded.
"""
import sys
import json
import time
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd

import chunkers
import embedders
import metrics
from retrievers import Retriever, MODES

ROOT = Path(__file__).resolve().parents[1]
TEXT_DIR = ROOT / "corpus" / "text"
RESULTS = ROOT / "results"
RESULTS.mkdir(exist_ok=True)

TOP_K = 5
CANDIDATE_POOL = 30


def load_corpus():
    docs = {}
    for f in sorted(TEXT_DIR.glob("*.txt")):
        docs[f.stem] = f.read_text(encoding="utf-8")
    return docs


def verify_goldset(gold, docs):
    """Abort unless every gold question's evidence is found verbatim in the corpus.

    Evidence is matched with the same normaliser the scorer uses (ligatures,
    dashes, case, whitespace), and against the document the question names, so a
    span that only exists in the OTHER policy does not pass. A question whose
    evidence cannot be located would otherwise be scored as a retrieval failure
    for every configuration, which would silently drag every result down.
    """
    normed = {k: metrics.norm(v) for k, v in docs.items()}
    problems = []
    for g in gold:
        pool = [normed[g["doc"]]] if g.get("doc") in normed else list(normed.values())
        if not any(metrics.norm(e) in t for e in g["evidence"] for t in pool):
            problems.append(g["qid"])
    if problems:
        raise SystemExit("Gold set verification FAILED - evidence not found in the corpus for: "
                         + ", ".join(problems))
    print(f"Gold set verified: all {len(gold)} questions have evidence located in the corpus\n")


def build_chunks(docs, strategy, sem_embed_fn):
    out = []
    t0 = time.perf_counter()
    for doc_id, text in docs.items():
        if strategy == "fixed":
            out += chunkers.fixed_size(text, doc_id)
        elif strategy == "recursive":
            out += chunkers.recursive(text, doc_id)
        elif strategy == "semantic":
            out += chunkers.semantic(text, doc_id, sem_embed_fn)
        elif strategy == "parent_child":
            out += chunkers.parent_child(text, doc_id)
        else:
            raise ValueError(strategy)
    return out, (time.perf_counter() - t0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=None)
    ap.add_argument("--no-rerank", action="store_true")
    ap.add_argument("--top-k", type=int, default=TOP_K)
    args = ap.parse_args()

    docs = load_corpus()
    gold = json.loads((ROOT / "data" / "goldset.json").read_text(encoding="utf-8"))
    print(f"Corpus: {len(docs)} documents | Gold set: {len(gold)} questions")
    verify_goldset(gold, docs)

    print("Loading embedding models...")
    models = args.models if args.models else embedders.available()
    print(f"Usable models: {models}\n")

    cross_encoder = None
    if not args.no_rerank:
        try:
            from sentence_transformers import CrossEncoder
            cross_encoder = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
            print("Cross-encoder loaded: ms-marco-MiniLM-L-6-v2\n")
        except Exception as e:
            print(f"Cross-encoder unavailable ({e}); skipping re-rank arm\n")

    sem_fn = lambda sents: embedders.embed("minilm", sents, use_cache=True)

    rows = []
    per_query_rows = []
    chunk_stats = []

    for strategy in chunkers.STRATEGIES:
        chunks, build_s = build_chunks(docs, strategy, sem_fn)
        sizes = [c["n_chars"] for c in chunks]
        ret_sizes = [len(c["retrieval_text"]) for c in chunks]
        _nrel = [metrics.count_relevant(chunks, g) for g in gold]
        chunk_stats.append({
            "mean_relevant_chunks_per_q": float(np.mean(_nrel)),
            "strategy": strategy,
            "n_chunks": len(chunks),
            "mean_chunk_chars": float(np.mean(sizes)),
            "median_chunk_chars": float(np.median(sizes)),
            "mean_retrieval_unit_chars": float(np.mean(ret_sizes)),
            "chunking_time_s": build_s,
        })
        print(f"[{strategy}] {len(chunks):>5} chunks | "
              f"mean {np.mean(sizes):>7.0f} chars | built in {build_s:.1f}s")

        # index-wide relevant-chunk counts, for a correct IDCG
        n_rel_total = {g["qid"]: metrics.count_relevant(chunks, g) for g in gold}
        missing = [q for q, c in n_rel_total.items() if c == 0]
        if missing:
            print(f"    WARNING: {len(missing)} questions have no relevant chunk "
                  f"under this strategy: {missing[:5]}")

        # ---- sparse arm: embedder-independent, run once -------------------
        sparse_only = Retriever(chunks, np.zeros((len(chunks), 2), dtype="float32"),
                                lambda q: np.zeros(2, dtype="float32"), None)
        pq, lats = [], []
        for g in gold:
            res, ms = sparse_only.retrieve(g["question"], "sparse", k=args.top_k)
            m = metrics.evaluate_query(res, g, k=args.top_k,
                                       n_rel_total=n_rel_total[g["qid"]])
            pq.append(m); lats.append(ms)
            per_query_rows.append({"qid": g["qid"], "qtype": g.get("type", "other"),
                                   "doc": g.get("doc", ""), "strategy": strategy,
                                   "embedder": "none (BM25)", "mode": "sparse",
                                   "latency_ms": ms, **m})
        agg = metrics.aggregate(pq)
        rows.append({"strategy": strategy, "embedder": "none (BM25)", "mode": "sparse",
                     "dim": 0, "n_chunks": len(chunks), "index_mb": 0.0,
                     "mean_latency_ms": float(np.mean(lats)), **agg})
        print(f"    sparse            recall@{args.top_k}={agg['recall@k']:.3f} "
              f"ndcg={agg['ndcg@k']:.3f} mrr={agg['mrr']:.3f}")

        # ---- dense / hybrid arms per embedder -----------------------------
        for mname in models:
            texts = [c["retrieval_text"] for c in chunks]
            t0 = time.perf_counter()
            try:
                vecs = embedders.embed(mname, texts, use_cache=True)
            except Exception as e:
                print(f"    [{mname}] FAILED, arm dropped: {type(e).__name__}: {str(e)[:90]}")
                continue
            embed_s = time.perf_counter() - t0
            qfn = embedders.make_query_fn(mname)
            r = Retriever(chunks, vecs, qfn, cross_encoder)

            modes = ["dense", "hybrid_rrf"]
            if cross_encoder is not None:
                modes.append("hybrid_rerank")

            for mode in modes:
                pq, lats = [], []
                for g in gold:
                    res, ms = r.retrieve(g["question"], mode, k=args.top_k,
                                         candidate_pool=CANDIDATE_POOL)
                    m = metrics.evaluate_query(res, g, k=args.top_k,
                                               n_rel_total=n_rel_total[g["qid"]])
                    pq.append(m); lats.append(ms)
                    per_query_rows.append({"qid": g["qid"], "qtype": g.get("type", "other"),
                                           "doc": g.get("doc", ""), "strategy": strategy,
                                           "embedder": mname, "mode": mode,
                                           "latency_ms": ms, **m})
                agg = metrics.aggregate(pq)
                rows.append({
                    "strategy": strategy,
                    "embedder": mname,
                    "mode": mode,
                    "dim": int(vecs.shape[1]),
                    "n_chunks": len(chunks),
                    "index_mb": vecs.nbytes / (1024 ** 2),
                    "embed_build_s": embed_s,
                    "mean_latency_ms": float(np.mean(lats)),
                    **agg,
                })
                print(f"    {mname:<14} {mode:<14} recall@{args.top_k}={agg['recall@k']:.3f} "
                      f"ndcg={agg['ndcg@k']:.3f} mrr={agg['mrr']:.3f} "
                      f"{np.mean(lats):.0f}ms")
        print()

    df = pd.DataFrame(rows)
    df.to_csv(RESULTS / "benchmark_results.csv", index=False)
    pd.DataFrame(chunk_stats).to_csv(RESULTS / "chunk_stats.csv", index=False)
    pd.DataFrame(per_query_rows).to_csv(RESULTS / "per_query.csv", index=False)
    print(f"\nWrote {len(df)} result rows -> results/benchmark_results.csv")

    best = df.sort_values("ndcg@k", ascending=False).head(10)
    print("\nTop 10 configurations by nDCG@k:")
    print(best[["strategy", "embedder", "mode", "recall@k", "ndcg@k",
                "mrr", "index_mb", "mean_latency_ms"]].to_string(index=False))


if __name__ == "__main__":
    main()
