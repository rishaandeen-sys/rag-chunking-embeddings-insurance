"""figures.py - publication figures for the IEEE report."""
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "results"
FIG = ROOT / "figures"
FIG.mkdir(exist_ok=True)

SURFACE = "#FFFFFF"   # matches the slide background exactly; an off-white
                      # figure canvas renders as a visible grey box on the deck
INK = "#23262F"
MUTED = "#6B7280"

plt.rcParams.update({
    "font.size": 9, "axes.titlesize": 10, "axes.labelsize": 9,
    "figure.dpi": 200, "savefig.bbox": "tight", "axes.grid": True,
    "grid.alpha": 0.22, "grid.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.edgecolor": "#C9CCD4", "axes.labelcolor": INK,
    "text.color": INK, "xtick.color": MUTED, "ytick.color": MUTED,
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE, "legend.labelcolor": INK,
})

# Categorical palette - validated with the dataviz six-checks script
# (lightness band, chroma floor, CVD separation, normal-vision floor, contrast).
# Hues track the Review-1 deck theme; values were snapped until all checks passed.
C = ["#4461C4", "#049A8B", "#CC7A2E", "#8A62B5"]

# Sequential ramp: ONE hue, light -> dark (never a rainbow).
SEQ = mcolors.LinearSegmentedColormap.from_list(
    "teal_seq", ["#F2FAF8", "#BDE6DF", "#7FCBC0", "#36A897", "#0B7A6D", "#064B44"])


def _bars(ax, x, heights, width, label, color):
    """2px surface gap between adjacent fills; flat, thin marks."""
    return ax.bar(x, heights, width * 0.9, label=label, color=color,
                  edgecolor=SURFACE, linewidth=1.0, zorder=3)

STRAT_LBL = {"fixed": "Fixed", "recursive": "Recursive",
             "semantic": "Semantic", "parent_child": "Parent–child"}
MODE_LBL = {"sparse": "BM25", "dense": "Dense", "hybrid_rrf": "Hybrid RRF",
            "hybrid_rerank": "Hybrid + rerank"}


def fig_strategy_by_mode(df):
    """Grouped bars: nDCG@k for each chunking strategy across retrieval modes."""
    d = df[df["mode"] != "sparse"]
    modes = [m for m in ["dense", "hybrid_rrf", "hybrid_rerank"] if m in set(d["mode"])]
    strats = [s for s in STRAT_LBL if s in set(d["strategy"])]
    fig, ax = plt.subplots(figsize=(6.4, 3.0))
    w = 0.8 / len(modes)
    x = np.arange(len(strats))
    for i, m in enumerate(modes):
        vals = [d[(d.strategy == s) & (d["mode"] == m)]["ndcg@k"].mean() for s in strats]
        _bars(ax, x + i * w - 0.4 + w / 2, vals, w, MODE_LBL[m], C[i])
    sparse_mean = df[df["mode"] == "sparse"]["ndcg@k"].mean()
    ax.axhline(sparse_mean, ls="--", lw=1.2, color="#666",
               label=f"BM25 only ({sparse_mean:.2f})")
    ax.set_xticks(x); ax.set_xticklabels([STRAT_LBL[s] for s in strats])
    ax.set_ylabel("nDCG@5"); ax.set_ylim(0, 1.0)
    ax.set_title("Retrieval quality by chunking strategy and retrieval mode")
    ax.legend(fontsize=7.5, ncol=2, frameon=False)
    fig.savefig(FIG / "fig1_strategy_by_mode.png"); plt.close(fig)


def fig_embedder(df):
    """Embedding model comparison, averaged over chunking strategies."""
    d = df[df["mode"].isin(["dense", "hybrid_rrf"])]
    if d.empty:
        return
    g = d.groupby(["embedder", "mode"])["ndcg@k"].mean().unstack()
    order = g.mean(axis=1).sort_values(ascending=False).index
    g = g.loc[order]
    fig, ax = plt.subplots(figsize=(6.4, 3.0))
    x = np.arange(len(g)); w = 0.38
    for i, m in enumerate(g.columns):
        _bars(ax, x + i * w - w / 2, g[m].values, w, MODE_LBL.get(m, m), C[i])
    ax.set_xticks(x)
    ax.set_xticklabels([t.replace("_", "\n") for t in g.index], fontsize=7.5)
    ax.set_ylabel("nDCG@5"); ax.set_ylim(0, 1.0)
    ax.set_title("Embedding model comparison (mean over chunking strategies)")
    ax.legend(fontsize=8, frameon=False)
    fig.savefig(FIG / "fig2_embedders.png"); plt.close(fig)


def fig_cost_quality(df):
    """Index size vs retrieval quality - the storage/accuracy trade-off."""
    d = df[(df["mode"] == "hybrid_rrf") & (df["index_mb"] > 0)]
    if d.empty:
        return
    g = d.groupby("embedder").agg(
        index_mb=("index_mb", "mean"), ndcg=("ndcg@k", "mean"),
        dim=("dim", "first")).reset_index().sort_values("ndcg", ascending=False)

    fig, ax = plt.subplots(figsize=(5.4, 3.3))
    # One series, directly labelled: colour would have to cycle across five
    # points to carry identity, and identity is already in the labels.
    ax.scatter(g.index_mb, g.ndcg, s=95, color=C[1],
               edgecolor=SURFACE, linewidth=1.6, zorder=3)

    # Several arms land at the same index size (the two 256d ones are
    # identical by construction), so labels are placed to the right and spread
    # vertically within each cluster rather than printed on top of each other.
    span = max(g.ndcg.max() - g.ndcg.min(), 1e-6)
    rows = list(g.itertuples())
    clusters = {}
    for r in rows:
        clusters.setdefault(round(r.index_mb, 1), []).append(r)
    for group in clusters.values():
        group.sort(key=lambda r: -r.ndcg)
        k = len(group)
        for j, r in enumerate(group):
            if k == 1:
                dy = 0
            else:
                dy = 13 - j * 26 / max(1, k - 1) * (k - 1) / (k - 1) if k > 1 else 0
                dy = (k - 1 - 2 * j) * 9          # +9 / -9 for a pair
            ax.annotate(f"{r.embedder.replace('_', '-')} ({int(r.dim)}d)",
                        (r.index_mb, r.ndcg), textcoords="offset points",
                        xytext=(12, dy), fontsize=7.5, va="center", ha="left",
                        color=INK)

    ax.set_xlabel("Vector index size (MB)")
    ax.set_ylabel("nDCG@5")
    ax.set_title("Storage cost vs retrieval quality")
    ax.margins(x=0.30, y=0.30)
    fig.savefig(FIG / "fig3_cost_quality.png")
    plt.close(fig)


def fig_latency(df):
    d = df.groupby("mode")["mean_latency_ms"].mean().reindex(
        [m for m in ["sparse", "dense", "hybrid_rrf", "hybrid_rerank"]
         if m in set(df["mode"])])
    fig, ax = plt.subplots(figsize=(4.6, 2.8))
    ax.bar([MODE_LBL[i] for i in d.index], d.values, 0.62,
           color=C[:len(d)], edgecolor=SURFACE, linewidth=1.0, zorder=3)
    ax.set_ylabel("Mean query latency (ms)")
    ax.set_title("Latency cost of each retrieval stage")
    for i, v in enumerate(d.values):
        ax.text(i, v, f"{v:.0f}", ha="center", va="bottom", fontsize=8)
    plt.xticks(fontsize=7.5)
    fig.savefig(FIG / "fig4_latency.png"); plt.close(fig)


def fig_heatmap(df):
    d = df[df["mode"] == "hybrid_rrf"]
    if d.empty:
        return
    p = d.pivot_table(index="strategy", columns="embedder", values="ndcg@k")
    p = p.reindex([s for s in STRAT_LBL if s in p.index])
    # Scale the ramp to the observed range. On a 0-1 scale every cell here
    # lands mid-ramp and the matrix reads as uniform, which defeats its purpose;
    # the printed values and the colourbar both state the true range.
    lo = np.floor(np.nanmin(p.values) * 50) / 50
    hi = np.ceil(np.nanmax(p.values) * 50) / 50
    fig, ax = plt.subplots(figsize=(6.4, 2.9))
    im = ax.imshow(p.values, cmap=SEQ, vmin=lo, vmax=hi, aspect="auto")
    ax.set_xticks(range(len(p.columns)))
    ax.set_xticklabels(p.columns, rotation=30, ha="right", fontsize=7.5)
    ax.set_yticks(range(len(p.index)))
    ax.set_yticklabels([STRAT_LBL[i] for i in p.index], fontsize=8)
    for i in range(p.shape[0]):
        for j in range(p.shape[1]):
            v = p.values[i, j]
            if not np.isnan(v):
                frac = (v - lo) / (hi - lo) if hi > lo else 0.5
                ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=8.5,
                        fontweight="bold" if v == np.nanmax(p.values) else "normal",
                        color="white" if frac > 0.55 else INK)
    ax.grid(False)
    ax.set_title("Decision matrix: nDCG@5 (hybrid RRF retrieval)")
    ax.set_xticklabels([c.replace("_", "-") for c in p.columns],
                       rotation=22, ha="right", fontsize=8)
    fig.colorbar(im, ax=ax, shrink=0.85, label="nDCG@5")
    ax.set_xlabel("")
    fig.savefig(FIG / "fig5_decision_matrix.png"); plt.close(fig)


def fig_question_type(df_pq):
    """Per-question-type breakdown: where sparse beats dense."""
    if df_pq is None or df_pq.empty:
        return
    g = df_pq.groupby(["qtype", "mode"])["recall@k"].mean().unstack()
    cols = [c for c in ["dense", "sparse", "hybrid_rrf", "hybrid_rerank"] if c in g.columns]
    g = g[cols]
    fig, ax = plt.subplots(figsize=(6.4, 3.0))
    x = np.arange(len(g)); w = 0.8 / len(cols)
    for i, m in enumerate(cols):
        _bars(ax, x + i * w - 0.4 + w / 2, g[m].values, w, MODE_LBL[m], C[i])
    ax.set_xticks(x); ax.set_xticklabels(g.index, fontsize=8)
    ax.set_ylabel("Success@5  (evidence found)"); ax.set_ylim(0, 1.05)
    ax.set_title("Where dense retrieval fails: success by question type")
    ax.legend(fontsize=7.5, ncol=2, frameon=False)
    fig.savefig(FIG / "fig6_question_type.png"); plt.close(fig)


def fig_architecture():
    """Pipeline diagram. Hand-drawn rather than data-driven: it shows the
    dense/sparse branch converging through RRF, which is the structural claim
    the Results section rests on."""
    from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

    fig, ax = plt.subplots(figsize=(7.0, 2.5))
    ax.set_xlim(0, 104); ax.set_ylim(0, 34)
    ax.axis("off"); ax.grid(False)
    fig.patch.set_facecolor(SURFACE)

    def box(x, y, w, h, title, sub, edge, fill="#FFFFFF"):
        ax.add_patch(FancyBboxPatch((x, y), w, h,
                     boxstyle="round,pad=0.5,rounding_size=1.2",
                     linewidth=1.1, edgecolor=edge, facecolor=fill, zorder=2))
        ax.text(x + w / 2, y + h * 0.63, title, ha="center", va="center",
                fontsize=7.6, fontweight="bold", color=INK, zorder=3)
        if sub:
            ax.text(x + w / 2, y + h * 0.26, sub, ha="center", va="center",
                    fontsize=6.0, color=MUTED, zorder=3)

    def arrow(x1, y1, x2, y2, col="#9AA3BC"):
        ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>",
                     mutation_scale=8, linewidth=0.9, color=col, zorder=1,
                     shrinkA=0, shrinkB=0))

    # main spine
    box(1, 13, 15, 8, "Policy PDFs", "extract, de-noise,\nde-hyphenate", MUTED)
    box(19, 13, 18.5, 8, "Chunking", "fixed · recursive\nsemantic · parent–child", C[0])
    box(41, 13, 15, 8, "Embedding", "5 configs,\n384–768d", C[1])
    arrow(16, 17, 19, 17); arrow(37.5, 17, 41, 17)

    # branch
    box(59, 23, 15, 7.5, "Dense", "FAISS, cosine", C[1])
    box(59, 3.5, 15, 7.5, "Sparse", "BM25", C[2])
    arrow(56, 18.5, 59, 25); arrow(56, 15.5, 59, 9)

    box(77, 13, 11, 8, "RRF", "ordinal\nranks", C[2])
    arrow(74, 25, 79, 21.5); arrow(74, 9, 79, 12.5)

    box(91, 13, 11, 8, "Re-rank", "cross-\nencoder", C[3])
    arrow(88, 17, 91, 17)

    ax.text(52, 0.4, "evaluated on 50 evidence-anchored questions  ·  Success@5 · Coverage@5 · MRR · nDCG@5",
            ha="center", va="bottom", fontsize=6.2, color=MUTED, style="italic")
    fig.savefig(FIG / "fig0_architecture.png")
    plt.close(fig)


def main():
    df = pd.read_csv(RES / "benchmark_results.csv")
    pq_path = RES / "per_query.csv"
    df_pq = pd.read_csv(pq_path) if pq_path.exists() else None
    fig_architecture()
    fig_strategy_by_mode(df)
    fig_embedder(df)
    fig_cost_quality(df)
    fig_latency(df)
    fig_heatmap(df)
    fig_question_type(df_pq)
    print("Figures written to figures/:")
    for f in sorted(FIG.glob("*.png")):
        print("  ", f.name)


if __name__ == "__main__":
    main()
