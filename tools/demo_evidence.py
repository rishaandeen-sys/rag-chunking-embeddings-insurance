"""Capture what the live demo shows, straight from the pipeline.

Used to build the backup slide: if the demo will not run on the day, these are
the real retrieved results, not a reconstruction.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import chunkers, embedders, metrics
from retrievers import Retriever

docs = {f.stem: f.read_text(encoding="utf-8")
        for f in sorted((ROOT / "corpus" / "text").glob("*.txt"))}
gold = {g["question"]: g for g in json.loads(
    (ROOT / "data" / "goldset.json").read_text(encoding="utf-8"))}

chunks = []
for d, t in docs.items():
    chunks += chunkers.parent_child(t, d)
vecs = embedders.embed("bge_base", [c["retrieval_text"] for c in chunks], use_cache=True)
r = Retriever(chunks, vecs, embedders.make_query_fn("bge_base"), None)

QUERIES = [
    ("How long must I wait before a pre-existing disease is covered?", ["hybrid_rrf"]),
    ("What does exclusion code Excl02 cover?", ["dense", "hybrid_rrf"]),
]

out = []
for q, modes in QUERIES:
    g = gold.get(q)
    for m in modes:
        res, ms = r.retrieve(q, m, k=5)
        hits = []
        for i, c in enumerate(res[:3], 1):
            rel = metrics.is_relevant(c["text"], g) if g else None
            snippet = " ".join(c["text"].split())[:260]
            hits.append({"rank": i, "score": round(c["score"], 4),
                         "relevant": bool(rel), "doc": c["doc_id"], "text": snippet})
        found = any(h["relevant"] for h in hits) or (
            any(metrics.is_relevant(c["text"], g) for c in res) if g else False)
        out.append({"question": q, "mode": m, "latency_ms": round(ms, 1),
                    "evidence_found": bool(found), "hits": hits,
                    "evidence": g["evidence"] if g else []})
        print(f"[{m:11}] found={found}  {q[:52]}")

(ROOT / "results" / "demo_evidence.json").write_text(
    json.dumps(out, indent=2), encoding="utf-8")
print("-> results/demo_evidence.json")
