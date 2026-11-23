"""
summarise.py - condense the benchmark grid into the handful of numbers the
report and the slide deck quote, so no figure is ever typed by hand.

Writes results/summary.json
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"


def r(x, n=3):
    return None if pd.isna(x) else round(float(x), n)


def main():
    df = pd.read_csv(RES / "benchmark_results.csv")
    cs = pd.read_csv(RES / "chunk_stats.csv")
    pq = pd.read_csv(RES / "per_query.csv")
    gold = json.loads((ROOT / "data" / "goldset.json").read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / "corpus" / "text" / "manifest.json").read_text(encoding="utf-8"))

    dense_like = df[df["mode"] != "sparse"]

    best = df.sort_values("ndcg@k", ascending=False).iloc[0]
    best_dense_only = df[df["mode"] == "dense"].sort_values("ndcg@k", ascending=False).iloc[0]
    sparse_rows = df[df["mode"] == "sparse"]

    out = {
        "corpus": {
            "documents": manifest,
            "total_words": int(sum(m["words"] for m in manifest)),
            "total_chars": int(sum(m["chars"] for m in manifest)),
        },
        "goldset": {
            "n": len(gold),
            "by_type": pd.Series([g["type"] for g in gold]).value_counts().to_dict(),
            "by_doc": pd.Series([g["doc"] for g in gold]).value_counts().to_dict(),
        },
        "chunk_stats": cs.round(2).to_dict(orient="records"),
        "n_configs": int(len(df)),

        # ---- headline configuration -------------------------------------
        "best": {
            "strategy": best["strategy"], "embedder": best["embedder"],
            "mode": best["mode"], "ndcg": r(best["ndcg@k"]),
            "recall": r(best["recall@k"]), "mrr": r(best["mrr"]),
            "hit1": r(best["hit@1"]), "index_mb": r(best["index_mb"], 2),
            "latency_ms": r(best["mean_latency_ms"], 1),
        },
        "best_dense_only": {
            "strategy": best_dense_only["strategy"],
            "embedder": best_dense_only["embedder"],
            "ndcg": r(best_dense_only["ndcg@k"]), "recall": r(best_dense_only["recall@k"]),
        },

        # ---- factor main effects ----------------------------------------
        "by_strategy": dense_like.groupby("strategy")[
            ["recall@k", "mrr", "ndcg@k", "hit@1", "coverage@k", "mean_latency_ms"]
        ].mean().round(3).to_dict(orient="index"),
        "by_embedder": dense_like.groupby("embedder")[
            ["recall@k", "mrr", "ndcg@k", "index_mb", "mean_latency_ms"]
        ].mean().round(3).to_dict(orient="index"),
        "by_mode": df.groupby("mode")[
            ["recall@k", "mrr", "ndcg@k", "coverage@k", "mean_latency_ms"]
        ].mean().round(3).to_dict(orient="index"),

        "sparse_baseline": {
            "ndcg": r(sparse_rows["ndcg@k"].mean()),
            "recall": r(sparse_rows["recall@k"].mean()),
            "mrr": r(sparse_rows["mrr"].mean()),
            "latency_ms": r(sparse_rows["mean_latency_ms"].mean(), 1),
            "by_strategy": sparse_rows.set_index("strategy")["ndcg@k"].round(3).to_dict(),
        },

        # ---- question-type breakdown (the dense-vs-sparse story) --------
        "by_qtype_mode": pq.groupby(["qtype", "mode"])[["recall@k", "mrr", "ndcg@k"]]
                           .mean().round(3).reset_index().to_dict(orient="records"),

        # ---- Matryoshka controlled pair ---------------------------------
        "mrl": {},
        "decision_matrix": df[df["mode"] == "hybrid_rrf"].pivot_table(
            index="strategy", columns="embedder", values="ndcg@k").round(3)
            .to_dict(orient="index"),
    }

    # Matryoshka: compare each 256d arm against its own 768d parent
    def arm(name, mode="hybrid_rrf"):
        s = df[(df["embedder"] == name) & (df["mode"] == mode)]
        return None if s.empty else {
            "ndcg": r(s["ndcg@k"].mean()), "recall": r(s["recall@k"].mean()),
            "index_mb": r(s["index_mb"].mean(), 2), "dim": int(s["dim"].iloc[0]),
        }

    full = arm("bge_base")
    naive = arm("bge_base_256")
    mrl = arm("arctic_mrl_256")
    out["mrl"] = {"bge_base_768": full, "bge_base_256_naive": naive,
                  "arctic_256_true_mrl": mrl}
    if full and naive:
        out["mrl"]["naive_retention_pct"] = r(100 * naive["ndcg"] / full["ndcg"], 1)
        out["mrl"]["storage_saving_pct"] = r(
            100 * (1 - naive["index_mb"] / full["index_mb"]), 1)
    if full and mrl:
        out["mrl"]["true_mrl_vs_bge768_pct"] = r(100 * mrl["ndcg"] / full["ndcg"], 1)

    # cost of the re-ranker
    rr = df[df["mode"] == "hybrid_rerank"]
    hy = df[df["mode"] == "hybrid_rrf"]
    if not rr.empty and not hy.empty:
        out["reranker"] = {
            "ndcg_gain": r(rr["ndcg@k"].mean() - hy["ndcg@k"].mean()),
            "hit1_gain": r(rr["hit@1"].mean() - hy["hit@1"].mean()),
            "latency_multiple": r(rr["mean_latency_ms"].mean() / hy["mean_latency_ms"].mean(), 1),
            "latency_ms": r(rr["mean_latency_ms"].mean(), 1),
        }

    # ---- error analysis: which questions defeat every configuration -----
    gold_by_id = {g["qid"]: g for g in gold}
    per_q = pq.groupby("qid")["recall@k"].mean().sort_values()
    out["hardest"] = [
        {"qid": q, "success": r(v, 2), "type": gold_by_id[q]["type"],
         "doc": gold_by_id[q]["doc"], "question": gold_by_id[q]["question"]}
        for q, v in per_q.head(6).items()
    ]
    out["never_found"] = [q for q, v in per_q.items() if v == 0]
    qtype = pd.DataFrame([{"qid": k, "t": v["type"]} for k, v in gold_by_id.items()])
    out["success_by_qtype"] = (pq.merge(qtype, on="qid")
                                 .groupby("t")["recall@k"].mean().round(3).to_dict())
    out["coverage_by_strategy"] = df.groupby("strategy")["coverage@k"].mean().round(3).to_dict()
    out["hit1_by_mode"] = df.groupby("mode")["hit@1"].mean().round(3).to_dict()
    out["chunking_time_s"] = {c["strategy"]: c["chunking_time_s"] for c in out["chunk_stats"]}

    (RES / "summary.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2)[:4000])
    print("\n-> results/summary.json")


if __name__ == "__main__":
    main()
