# Clause-Level Retrieval over Health-Insurance Policy Wordings

**Comparative Analysis of Chunking Strategies and Embedding Models on RAG Retrieval**

Mini Project · Prompt Engineering and Optimization for Generative AI (UE24AM343AB5)
B.Tech CSE (AI & ML), Semester 5 · **Team 10**

| Name | SRN |
|---|---|
| Ralph | _to be added_ |
| Sanshray | _to be added_ |
| Kushal | _to be added_ |
| Rishaan | _to be added_ |

---

## What this is

An empirical study, not a chatbot. We hold one narrow corpus fixed — two Indian
retail health-insurance policy wordings — and sweep the two factors that decide
whether a RAG system retrieves the right clause: **how documents are chunked** and
**how the chunks are embedded**, plus how retrieval is performed.

| Factor | Levels |
|---|---|
| Chunking strategy | fixed-size, recursive, semantic, parent–child |
| Embedding model | MiniLM-L6, bge-small, bge-base, bge-base→256d (naive truncation), arctic-embed-m-v1.5→256d (Matryoshka-trained) |
| Retrieval mode | dense (FAISS), BM25, hybrid RRF, hybrid + cross-encoder re-rank |

That is 64 scored configurations (BM25 does not use embeddings, so it runs once per
chunking strategy), each evaluated on the same 50-question gold set.

### Headline results

| | |
|---|---|
| Best configuration | parent–child + bge-small, hybrid + re-rank: **nDCG@5 0.747**, Success@5 0.88 |
| Chunking (mean nDCG@5) | parent–child 0.673 › recursive 0.596 › semantic 0.589 › fixed 0.542 |
| Retrieval mode (mean nDCG@5) | re-rank 0.673 › hybrid 0.578 › dense 0.549 › BM25 0.523 |
| Dense vs BM25 | exact-match questions: BM25 0.97, dense 0.84 · semantic questions: dense 0.69, BM25 0.54 |
| Matryoshka | truncating bge-base 768→256d keeps 98.8% of its quality for 66.5% less index storage |
| Cost of re-ranking | +0.095 nDCG for 26.9× the latency |

Retrieval mode spans 0.150 nDCG, embedding model only 0.054: retrieval architecture
mattered more than the embedding model on this corpus.

### Why this corpus

Policy wordings mix flowing prose (definitions, conditions) with hard identifiers
(clause codes like `Excl02`, sub-limits like `Rs.15,000`, durations like `36 months`).
Dense retrieval and lexical retrieval fail on *different* questions here, which is what
makes the comparison measurable.

---

## Repository layout

```
corpus/raw/          the two source policy PDFs, unmodified
corpus/text/         extracted, cleaned plain text
data/goldset.json    the 50 benchmark questions with verbatim evidence spans
data/demo_questions.json   extra real-world questions used only by the demo app
src/ingest.py        PDF -> cleaned text
src/chunkers.py      the four chunking strategies
src/embedders.py     embedding registry, truncation, vector cache
src/retrievers.py    FAISS dense, BM25, RRF fusion, cross-encoder re-rank
src/metrics.py       evidence-span matching; Success, Coverage, Hit@1, MRR, nDCG
src/benchmark.py     the full experimental grid
src/summarise.py     condenses results into results/summary.json
src/figures.py       report figures
app.py               Streamlit demo
results/             benchmark_results.csv (64 rows), per_query.csv, chunk_stats.csv, summary.json
figures/             generated charts
report/              the IEEE-format report (PDF and DOCX) and its generator
deck/                the final-review slides (PPTX and PDF) and their generator
run_all.py           rebuild the pipeline end to end (use --skip-deck; see the last section)
```

---

## Running it

Requires Python 3.12 (CPU only; no GPU or API keys needed).

```bash
python -m venv .venv
.venv\Scripts\activate                       # Windows;  source .venv/bin/activate on Linux/macOS
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt

python src/ingest.py        # PDFs -> corpus/text/
python src/benchmark.py     # the full grid -> results/   (slow: see below)
python src/summarise.py     # -> results/summary.json
python src/figures.py       # -> figures/
streamlit run app.py        # the interactive demo
```

**Timing.** The first run downloads the embedding models (about 1 GB) and builds the
vector cache in `data/vec_cache/` (not committed). The cross-encoder re-ranking arm
dominates the benchmark runtime on CPU; add `--no-rerank` for a much faster run that
skips that arm. Finished results are already committed under `results/`.

**Demo.** `streamlit run app.py` opens three views: ask a question under any chunking /
embedding / retrieval setting; compare all four retrieval modes on one question; and
browse the benchmark results. Use the bge-small embedding model to see dense-only
retrieval miss the clause code `Excl02` while hybrid retrieval finds it.

---

## Method notes that matter

**Gold labels are evidence spans, not chunk IDs.** Each chunking strategy produces
different boundaries, so a chunk ID cannot be a portable label. Each question instead
carries phrases taken verbatim from the policy; a retrieved chunk is relevant if it
contains one. `benchmark.py` checks every span against the corpus before it runs and
aborts if any cannot be found.

**Provenance of the questions.** The 50 questions were drafted with the assistance of a
language model from the policy text, phrased the way a policyholder would ask, then
checked verbatim against the source. Drafted questions can share phrasing habits with
the encoders under test, so an independent set written by human annotators would be a
stronger test. This is listed as a limitation in the report.

**Semantic chunk boundaries are always computed with MiniLM**, never with the model
being benchmarked; otherwise the chunking and embedding factors would be confounded.

**BM25 runs once per chunking strategy**, because it does not depend on the
embedding model.

**Parent–child results are collapsed to unique parents.** Several children share one
parent clause; counting each child separately inflated that strategy's number of
"relevant" units (14.1 per question against about 2.2 for the others) and made it
look worst. Retrieval and scoring now both work on unique parents. The report
documents this correction.

**Scoring is deterministic.** No language model sits in the scoring loop, so reruns
reproduce the same scores exactly (measured latencies naturally vary).

**The two Matryoshka arms are a controlled pair.** `bge_base_256` truncates a model
never trained for truncation; `arctic_mrl_256` truncates one that was. Both land at 256
dimensions and the same index size.

## Scope and limitations

- 50 questions separates configurations but not differences of a few hundredths of nDCG.
- Two documents, one jurisdiction, one product category.
- RAPTOR and late chunking were surveyed but not implemented; both need heavy offline
  pre-compute, which the measured cost column argues against at this corpus size.
- Evaluation stops at retrieval; generation quality is not measured.

## Data

The two policy documents are public documents published by the insurers (Star Health
Assure; HDFC ERGO my:Optima Secure) and are included unmodified only so the extraction
step can be reproduced. Copyright remains with the insurers.

## Rebuilding the report and slides

`report/build_report.js` regenerates the report from `results/summary.json` (needs
`npm install docx`). `deck/build_deck.js` regenerates the slides (needs
`npm install pptxgenjs` plus a local theme helper that is not part of this repository), so
the finished `.pptx` and `.pdf` are committed.
