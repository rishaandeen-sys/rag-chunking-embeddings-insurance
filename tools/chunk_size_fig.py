"""Compute chunk-size distributions per strategy and render them.

Chunking is cheap and the sentence embeddings semantic chunking needs are
already cached, so this runs in seconds without touching the benchmark.
"""
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import chunkers
import embedders
import figures as F   # reuse the validated palette and rcParams

docs = {f.stem: f.read_text(encoding="utf-8")
        for f in sorted((ROOT / "corpus" / "text").glob("*.txt"))}
sem_fn = lambda s: embedders.embed("minilm", s, use_cache=True)

sizes = {}
for strat in ["fixed", "recursive", "semantic", "parent_child"]:
    out = []
    for d, t in docs.items():
        if strat == "fixed":
            out += chunkers.fixed_size(t, d)
        elif strat == "recursive":
            out += chunkers.recursive(t, d)
        elif strat == "semantic":
            out += chunkers.semantic(t, d, sem_fn)
        else:
            out += chunkers.parent_child(t, d)
    # for parent-child the meaningful distribution is the INDEXED unit
    key = "retrieval_text" if strat == "parent_child" else "text"
    sizes[strat] = [len(c[key]) for c in out]

(ROOT / "results" / "chunk_sizes.json").write_text(
    json.dumps({k: v for k, v in sizes.items()}), encoding="utf-8")

LBL = {"fixed": "Fixed", "recursive": "Recursive",
       "semantic": "Semantic", "parent_child": "Parent–child (indexed child)"}

fig, ax = plt.subplots(figsize=(6.4, 2.9))
bins = np.linspace(0, 1600, 45)
for i, (k, v) in enumerate(sizes.items()):
    ax.hist(v, bins=bins, histtype="step", linewidth=1.6,
            color=F.C[i % len(F.C)], label=LBL[k] + f"  (n={len(v)})")
ax.set_xlabel("Characters per indexed unit")
ax.set_ylabel("Count")
ax.set_title("Chunk-size distribution by segmentation strategy")
ax.legend(fontsize=7.5, frameon=False)
fig.savefig(ROOT / "figures" / "fig7_chunk_sizes.png")
plt.close(fig)

print("chunk sizes:")
for k, v in sizes.items():
    a = np.array(v)
    print(f"  {k:14} n={len(a):>5}  mean={a.mean():7.0f}  median={np.median(a):7.0f}"
          f"  p10={np.percentile(a,10):6.0f}  p90={np.percentile(a,90):7.0f}")
print("-> figures/fig7_chunk_sizes.png")
