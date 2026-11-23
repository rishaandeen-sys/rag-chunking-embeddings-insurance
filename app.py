"""
app.py - Streamlit demo for the mini project.

Run:  streamlit run app.py
"""
import sys, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

import numpy as np
import pandas as pd
import streamlit as st

import chunkers, embedders, metrics
from retrievers import Retriever, MODES

st.set_page_config(page_title="RAG Chunking & Embeddings - Insurance",
                   page_icon="*", layout="wide",
                   initial_sidebar_state="expanded")   # controls must be visible for the demo

# Hide Streamlit developer chrome so the demo reads as a product, not a notebook.
st.markdown(
    """<style>
      #MainMenu, footer, header [data-testid="stToolbar"] {visibility: hidden;}
      [data-testid="stDecoration"] {display: none;}
      /* The default top padding leaves ~80px of dead space above the title. */
      [data-testid="stMainBlockContainer"] {padding-top: 1rem !important;}
      /* Compact title so the controls sit higher on the page. */
      h1 {font-size: 1.9rem !important; line-height: 1.25 !important;
          padding-bottom: 0.25rem !important;}
      /* A select list flips to open UPWARD when it is taller than the room
         left below the box. Cap its height so it opens downward and scrolls.
         (Streamlit 1.67: the list is div[role=listbox] inside this wrapper,
         and the inner element carries its own 300px cap.)
         425px = measured distance from the top of the page to the bottom of
         the sample box (about 401px) plus a margin; recompute if the layout above changes. */
      [data-testid="stSelectboxVirtualDropdown"],
      [data-testid="stSelectboxVirtualDropdown"] [role="listbox"] {
          max-height: clamp(150px, calc(100vh - 425px), 380px) !important;
      }
    </style>""",
    unsafe_allow_html=True,
)

TEXT_DIR = ROOT / "corpus" / "text"
RESULTS = ROOT / "results"


# ----------------------------------------------------------------- loading
@st.cache_data(show_spinner=False)
def load_docs():
    return {f.stem: f.read_text(encoding="utf-8") for f in sorted(TEXT_DIR.glob("*.txt"))}


@st.cache_data(show_spinner=False)
def load_gold():
    p = ROOT / "data" / "goldset.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


@st.cache_data(show_spinner=False)
def load_demo_questions():
    """Curated real-world questions for the demo (not part of the 50 benchmark)."""
    p = ROOT / "data" / "demo_questions.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


@st.cache_resource(show_spinner="Chunking corpus...")
def get_chunks(strategy):
    docs = load_docs()
    sem_fn = lambda s: embedders.embed("minilm", s, use_cache=True)
    out = []
    for doc_id, text in docs.items():
        if strategy == "fixed":
            out += chunkers.fixed_size(text, doc_id)
        elif strategy == "recursive":
            out += chunkers.recursive(text, doc_id)
        elif strategy == "semantic":
            out += chunkers.semantic(text, doc_id, sem_fn)
        else:
            out += chunkers.parent_child(text, doc_id)
    return out


@st.cache_resource(show_spinner="Building index...")
def get_retriever(strategy, model_name, use_reranker):
    chunks = get_chunks(strategy)
    vecs = embedders.embed(model_name, [c["retrieval_text"] for c in chunks], use_cache=True)
    ce = None
    if use_reranker:
        try:
            from sentence_transformers import CrossEncoder
            ce = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
        except Exception:
            ce = None
    qfn = embedders.make_query_fn(model_name)
    qfn("warm up the query encoder")   # otherwise the FIRST query reports ~8s
    if ce is not None:                 # of model-loading time as retrieval latency
        try:
            ce.predict([("warm up", "the cross encoder")])
        except Exception:
            pass
    return Retriever(chunks, vecs, qfn, ce), vecs


LEADING_NOISE = re.compile(r"^(?:\s*(?:[ivxlcIVXLC]+|\d+|[a-zA-Z])[.)]\s*)+")


def clean(text: str) -> str:
    """Tidy a chunk for display.

    Parent-child chunks begin at a clause heading, which in these PDFs is often
    a bare list marker such as "2." on its own line. Shown raw it reads as
    broken text, so leading markers and hard line breaks are collapsed.
    """
    t = " ".join(text.split())
    return LEADING_NOISE.sub("", t).strip()


def highlight(text, phrases):
    out = text
    for p in sorted(phrases, key=len, reverse=True):
        if not p.strip():
            continue
        out = re.sub("(" + re.escape(p) + ")", r"**:orange[\1]**", out, flags=re.I)
    return out


def extractive_answer(chunk_text, question, model_name, n=2):
    """No API key needed: return the sentences most similar to the question."""
    sents = [s for s in chunkers.split_sentences(chunk_text) if len(s) > 30]
    if not sents:
        return chunk_text[:400]
    sv = embedders.embed(model_name, sents, use_cache=False)
    qv = embedders.embed(model_name, [question], is_query=True, use_cache=False)[0]
    sims = sv @ qv
    top = np.argsort(sims)[::-1][:n]
    return " ".join(sents[i] for i in sorted(top))


COMPARE_DEFAULT = "What does exclusion code Excl02 cover?"


@st.cache_data(show_spinner="Comparing all four retrieval modes...")
def compare_modes(q, strategy, model_name, k):
    """Run one question through all four modes.

    Cached on (question, chunking, embedder, k). Streamlit executes every tab's
    code on every interaction, so without this an automatic comparison would be
    recomputed each time the user touched anything on another tab.
    """
    r, _ = get_retriever(strategy, model_name, True)
    g = KNOWN.get(q)
    rows = []
    for m in MODES:
        res, ms = r.retrieve(q, m, k=k)
        rows.append({
            "mode": m,
            "ms": ms,
            "metrics": metrics.evaluate_query(res, g, k=k) if g else None,
            "hits": [{"text": clean(c["text"])[:140],
                      "rel": bool(g and metrics.is_relevant(c["text"], g))}
                     for c in res[:3]],
        })
    return rows


# -------------------------------------------------------------------- UI
st.title("Clause-Level Retrieval over Health-Insurance Policy Wordings")
st.caption("Comparative analysis of chunking strategies and embedding models on RAG "
           "retrieval - Mini Project Review 3 - Ralph, Sanshray, Kushal, Rishaan")

docs = load_docs()
if not docs:
    st.error("No corpus found. Run `python src/ingest.py` first.")
    st.stop()

gold = load_gold()
demo_qs = load_demo_questions()
# Evidence lookup for ANY known question. Benchmark questions win on a clash;
# the demo questions add real-world phrasing with their own verified evidence.
KNOWN = {}
for _g in gold + demo_qs:
    KNOWN.setdefault(_g["question"], _g)

with st.sidebar:
    st.header("Pipeline configuration")
    strategy = st.selectbox("Chunking strategy", list(chunkers.STRATEGIES),
                            format_func=lambda s: chunkers.STRATEGIES[s], index=3)
    model_name = st.selectbox("Embedding model", list(embedders.REGISTRY),
                              format_func=lambda m: embedders.DISPLAY[m],
                              index=list(embedders.REGISTRY).index("bge_small"))
    mode = st.selectbox("Retrieval mode", list(MODES),
                        format_func=lambda m: MODES[m], index=2)
    top_k = st.slider("Top-k chunks", 1, 10, 5)
    st.caption("Switching any control rebuilds the index once, then caches it.")
    st.divider()
    st.caption("**Corpus:** " + str(len(docs)) + " policy documents")
    for d in docs:
        st.caption("- " + d + " - " + format(len(docs[d].split()), ",") + " words")

tab1, tab2, tab3 = st.tabs(["Ask a question", "Compare retrieval modes",
                            "Benchmark results"])

# ------------------------------------------------------------------ tab 1
with tab1:
    PLACEHOLDER = "Choose a sample question..."
    samples = [d["question"] for d in demo_qs]

    def _use_sample():
        """Selecting a sample fills the question box above it."""
        choice = st.session_state.get("sample_pick")
        if choice and choice != PLACEHOLDER:
            st.session_state["q_text"] = choice

    q = st.text_input("Question about the policy", key="q_text",
                      placeholder="Type your own question, or pick a sample below")
    st.selectbox("Sample questions", [PLACEHOLDER] + samples,
                 key="sample_pick", on_change=_use_sample)

    if q:
        use_rr = mode == "hybrid_rerank"
        r, vecs = get_retriever(strategy, model_name, use_rr)
        results, ms = r.retrieve(q, mode, k=top_k)

        g = KNOWN.get(q)
        ev = g["evidence"] if g else []

        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Latency", format(ms, ".0f") + " ms")
        m2.metric("Chunks indexed", format(len(r.chunks), ","))
        m3.metric("Index size", format(vecs.nbytes / 1024 ** 2, ".1f") + " MB")
        hit, ev_rank = False, None
        if g:
            for i, c in enumerate(results, 1):
                if metrics.is_relevant(c["text"], g):
                    hit, ev_rank = True, i
                    break
            m4.metric("Gold evidence found", "Yes" if hit else "No",
                      delta=("rank " + str(ev_rank)) if hit else "missed",
                      delta_color="normal" if hit else "inverse")

        if results:
            st.subheader("Best-matching excerpt")
            with st.spinner("Extracting..."):
                ans = clean(extractive_answer(results[0]["text"], q, model_name))
            shown = highlight(ans, ev) if ev else ans
            # Colour by whether the evidence was actually retrieved - a green box
            # on a miss is the one thing that would misrepresent the system.
            if g and not hit:
                st.warning(shown)
            else:
                st.info(shown)
            st.caption("Extract from the top-ranked clause (" + results[0]["doc_id"]
                       + "). This is a quoted excerpt, not a generated answer - "
                       "the retrieved clauses below are the real output.")
            if g:
                if hit:
                    st.success("Gold evidence found at rank " + str(ev_rank)
                               + " of " + str(len(results)))
                else:
                    st.error("Gold evidence NOT in the top " + str(len(results))
                             + " - this retrieval mode missed it")

        st.subheader("Retrieved context (" + str(len(results)) + " chunks)")
        SCORE_LABEL = {"dense": "cosine", "sparse": "BM25",
                       "hybrid_rrf": "RRF", "hybrid_rerank": "re-rank"}
        for i, c in enumerate(results, 1):
            rel = metrics.is_relevant(c["text"], g) if g else None
            mark = "" if rel is None else ("[EVIDENCE]  " if rel else "")
            header = (mark + str(i) + ".  " + c["doc_id"] + "   -   "
                      + SCORE_LABEL.get(mode, "score") + " "
                      + format(c["score"], ".4f") + "   -   "
                      + format(c["n_chars"], ",") + " chars")
            with st.expander(header, expanded=(i <= 2)):
                body = clean(c["text"])[:2500]
                st.markdown(highlight(body, ev) if ev else body)
                if c["retrieval_text"] != c["text"]:
                    st.caption("**Embedded child** - this short span is what was "
                               "matched; the full clause above is what is returned")
                    st.code(clean(c["retrieval_text"])[:400], language=None)

# ------------------------------------------------------------------ tab 2
with tab2:
    CMP_PLACEHOLDER = "Choose a sample question..."
    st.session_state.setdefault("cmp_text", COMPARE_DEFAULT)

    def _use_cmp_sample():
        choice = st.session_state.get("cmp_pick")
        if choice and choice != CMP_PLACEHOLDER:
            st.session_state["cmp_text"] = choice

    q2 = st.text_input("Question", key="cmp_text")
    st.selectbox("Sample questions", [CMP_PLACEHOLDER] + [d["question"] for d in demo_qs],
                 key="cmp_pick", on_change=_use_cmp_sample)
    st.caption("All four retrieval modes run automatically on the same question and the "
               "same chunks. Dense-only retrieval is where exact-match terms such as "
               "clause numbers and sub-limit amounts get missed.")

    if q2.strip():
        rows = compare_modes(q2.strip(), strategy, model_name, top_k)
        cols = st.columns(4)
        for col, row in zip(cols, rows):
            with col:
                st.markdown("**" + MODES[row["mode"]] + "**")
                mm = row["metrics"]
                if mm is not None:
                    st.metric("Evidence", "Found" if mm["recall@k"] >= 1 else "MISSED",
                              help="MRR " + format(mm["mrr"], ".2f")
                                   + " - nDCG " + format(mm["ndcg@k"], ".2f"))
                st.caption(format(row["ms"], ".0f") + " ms")
                for i, h in enumerate(row["hits"], 1):
                    ok = "**:green[OK]**" if h["rel"] else ":gray[--]"
                    st.caption(ok + " **" + str(i) + ".** " + h["text"] + "...")
    else:
        st.info("Type a question above, or pick a sample, to compare the four modes.")

# ------------------------------------------------------------------ tab 3
with tab3:
    f = RESULTS / "benchmark_results.csv"
    if not f.exists():
        st.info("Run `python src/benchmark.py` to populate this tab.")
    else:
        df = pd.read_csv(f)
        st.markdown("#### Decision matrix - nDCG@5 by chunking strategy x embedding model")
        piv = df[df["mode"] == "hybrid_rrf"].pivot_table(
            index="strategy", columns="embedder", values="ndcg@k")
        # Scale the gradient to the observed range; on a 0-1 scale every cell
        # lands mid-ramp and the matrix reads as uniform.
        st.dataframe(piv.style.background_gradient(
            cmap="YlGnBu", vmin=float(piv.min().min()), vmax=float(piv.max().max())
        ).format("{:.3f}"), use_container_width=True)
        best = piv.stack().idxmax()
        st.caption("Best cell: **" + str(best[0]) + "** + **" + str(best[1])
                   + "**  at nDCG@5 " + format(piv.stack().max(), ".3f"))

        st.markdown("#### Top configurations")
        st.dataframe(df.sort_values("ndcg@k", ascending=False).head(15)[
            ["strategy", "embedder", "mode", "recall@k", "mrr", "ndcg@k",
             "index_mb", "mean_latency_ms"]].round(4), use_container_width=True,
            hide_index=True)

        for name, cap in [("fig0_architecture.png", "System pipeline"),
                          ("fig5_decision_matrix.png", "Decision matrix"),
                          ("fig1_strategy_by_mode.png", "Chunking x retrieval mode"),
                          ("fig2_embedders.png", "Embedding models"),
                          ("fig7_chunk_sizes.png", "Chunk-size distributions"),
                          ("fig3_cost_quality.png", "Storage vs quality"),
                          ("fig6_question_type.png", "By question type"),
                          ("fig4_latency.png", "Latency")]:
            p = ROOT / "figures" / name
            if p.exists():
                st.image(str(p), caption=cap, use_container_width=True)
