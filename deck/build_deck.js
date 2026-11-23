/*
 * build_deck.js - Review 3 (Final Demo) slide deck.
 *   node deck/build_deck.js
 *
 * Theme carried over from the Review 1 deck so the two read as one project.
 * Every number is read from results/summary.json.
 *
 * POSITIONING: every text element carries explicit x/y/w/h/fontSize/color.
 * pptxgenjs only inherits layout placeholders named title/body/chart; custom
 * placeholder names silently lose their options, which produced dark text on
 * dark backgrounds and footers rendered at title size.
 */
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const { applyTheme } = require(path.join(
  process.env.USERPROFILE || process.env.HOME,
  ".claude/skills/synced/e8d2201c-3210-4ae4-a267-b30abb0b57db_45cfe96b-0706-47f7-a2ef-1ef4b588e9d7/pptx/scripts/apply_theme.js"
));

const ROOT = path.resolve(__dirname, "..");
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "results", "summary.json"), "utf8"));
const FIG = path.join(ROOT, "figures");

// The demo-backup screenshots slide is OPT-IN. Default output is the 13-slide
// deck. To include the backup slide (it becomes slide 12):  DEMO_BACKUP=1 node deck/build_deck.js
const INCLUDE_BACKUP = process.env.DEMO_BACKUP === "1";

// Public repository for this project (shown on the title and closing slides).
const REPO_URL = "https://github.com/rishaandeen-sys/rag-chunking-embeddings-insurance";

const THEME = {
  name: "RAG Insurance Review 3",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "101534", lt1: "FFFFFF", dk2: "1B2A6B", lt2: "EDF2F7",
    accent1: "00A896", accent2: "02C39A", accent3: "F2A65A",
    accent4: "5B7FD4", accent5: "7D5BA6", accent6: "5A6586",
    hlink: "00A896", folHlink: "7D5BA6",
  },
};

const NAVY = "1B2A6B", INK = "2B3350", MUTED = "5A6586";
const TEAL = "00A896", MINT = "02C39A", ORANGE = "F2A65A",
      BLUE = "5B7FD4", PURPLE = "7D5BA6";
const PALE = "EDF2F7", DARK = "101534";
const ON_DARK = "C7CEE6";

const n = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? "n/a" : Number(v).toFixed(d));
const pctS = (v, d = 1) => (v === null || v === undefined ? "n/a" : Number(v).toFixed(d) + "%");
const NICE = {
  fixed: "Fixed-size", recursive: "Recursive", semantic: "Semantic", parent_child: "Parent–child",
  minilm: "MiniLM-L6", bge_small: "bge-small", bge_base: "bge-base",
  bge_base_256: "bge-base@256", arctic_mrl_256: "arctic@256 (MRL)", "none (BM25)": "BM25",
  dense: "Dense", sparse: "BM25", hybrid_rrf: "Hybrid RRF", hybrid_rerank: "Hybrid + re-rank",
};
const nice = (k) => NICE[k] || k;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";            // 13.33 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.author = "Ralph, Sanshray, Kushal, Rishaan";
pres.title = "RAG Chunking and Embeddings - Review 3";

const W = 13.33, H = 7.5, M = 0.62;
const CW = W - 2 * M;

// Layouts supply background and slide number only. All text is explicit.
pres.defineSlideMaster({ title: "DARK", background: { color: DARK } });
pres.defineSlideMaster({ title: "SECTION", background: { color: NAVY } });
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: "FFFFFF" },
  slideNumber: { x: W - 0.72, y: H - 0.46, fontSize: 10, color: "9AA3BC" },
});

// ------------------------------------------------------------- helpers
const T = (slide, text, o) => slide.addText(text, Object.assign({
  isTextBox: true, margin: 0, valign: "top", fontFace: "Calibri",
}, o));

function slideTitle(slide, text) {
  T(slide, text, {
    x: M, y: 0.36, w: CW, h: 0.70, fontSize: 27, bold: true,
    color: NAVY, valign: "middle", fontFace: "Cambria",
  });
}

function footNote(slide, text) {
  T(slide, text, {
    x: M, y: H - 0.54, w: CW - 0.7, h: 0.32, fontSize: 10.5,
    italic: true, color: MUTED, valign: "middle",
  });
}

function card(slide, x, y, w, h, fill) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: fill || PALE }, line: { width: 0 }, objectName: "card",
  });
}

function dot(slide, x, y, label, col) {
  slide.addShape(pres.ShapeType.ellipse, {
    x, y, w: 0.4, h: 0.4, fill: { color: col }, line: { width: 0 }, objectName: "badge" });
  T(slide, label, { x, y, w: 0.4, h: 0.4, align: "center", valign: "middle",
    fontSize: 11.5, bold: true, color: "FFFFFF" });
}

function stat(slide, x, y, w, value, label, color) {
  T(slide, value, { x, y, w, h: 0.66, fontSize: 32, bold: true,
    color, fontFace: "Cambria", valign: "middle" });
  T(slide, label, { x, y: y + 0.68, w, h: 0.6, fontSize: 11, color: MUTED });
}

function fig(slide, file, o) {
  const p = path.join(FIG, file);
  if (fs.existsSync(p)) slide.addImage(Object.assign({ path: p }, o));
}

let s;

// =====================================================================
// 1  Title
// =====================================================================
s = pres.addSlide({ masterName: "DARK" });
T(s, "MINI PROJECT  ·  REVIEW 3  ·  FINAL DEMO", {
  x: M, y: 1.62, w: CW, h: 0.34, fontSize: 13.5, bold: true, color: MINT, charSpacing: 3 });
T(s, "Clause-Level Retrieval over\nHealth-Insurance Policy Wordings", {
  x: M, y: 2.10, w: CW, h: 1.70, fontSize: 36, bold: true,
  color: "FFFFFF", fontFace: "Cambria", lineSpacing: 42 });
T(s, "Comparative Analysis of Chunking Strategies and Embedding Models on RAG Retrieval", {
  x: M, y: 4.02, w: CW - 1.4, h: 0.42, fontSize: 15.5, color: ON_DARK });
T(s, "Ralph  ·  Sanshray  ·  Kushal  ·  Rishaan", {
  x: M, y: 4.62, w: CW, h: 0.44, fontSize: 17, bold: true, color: MINT });
T(s, "UE24AM343AB5  —  Prompt Engineering and Optimization for Generative AI", {
  x: M, y: H - 1.0, w: CW, h: 0.34, fontSize: 11.5, color: "7A86AE" });
T(s, [{ text: "GitHub:  " + REPO_URL, options: { hyperlink: { url: REPO_URL, tooltip: "Open the project repository" }, color: MINT } }], {
  x: M, y: H - 0.62, w: CW, h: 0.34, fontSize: 12 });
s.addNotes("Review 3 final demo. Plan: 2 min on how we narrowed scope after Review 1 feedback, 4 min method, 5 min results, 4 min live demo, questions.");

// =====================================================================
// 2  What changed since Review 1
// =====================================================================
s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "What changed since Review 1");
T(s, "“The topic is based on a very wide thing — base it on one or two similar topics.”", {
  x: M, y: 1.16, w: CW, h: 0.36, fontSize: 15, italic: true, color: NAVY });
T(s, "Review 1 feedback", { x: M, y: 1.54, w: 4, h: 0.24, fontSize: 10, color: MUTED });

{
  const gap = 0.3, cw = (CW - 2 * gap) / 3, y0 = 1.96, ch = 3.72;
  [["01", "Scope",
    "Review 1 surveyed chunking across technical documentation in general. Too broad to conclude anything.",
    "Narrowed to one genre: retail health-insurance policy wordings, two insurers.", TEAL],
   ["02", "Why this genre",
    "We needed a corpus where the comparison can actually separate the methods.",
    "Policy wordings mix flowing prose with hard identifiers — Excl02, Rs.15,000, 36 months.", BLUE],
   ["03", "Deliverable",
    "A literature survey and a set of open questions.",
    "A measured decision matrix over " + S.n_configs + " configurations, plus a working demo.", ORANGE],
  ].forEach(([num, head, before, after, col], i) => {
    const x = M + i * (cw + gap);
    card(s, x, y0, cw, ch);
    dot(s, x + 0.26, y0 + 0.26, num, col);
    T(s, head, { x: x + 0.78, y: y0 + 0.26, w: cw - 1.04, h: 0.4,
      fontSize: 15.5, bold: true, color: NAVY, valign: "middle" });
    T(s, "BEFORE", { x: x + 0.26, y: y0 + 0.86, w: cw - 0.52, h: 0.22,
      fontSize: 8.5, bold: true, color: MUTED, charSpacing: 1.5 });
    T(s, before, { x: x + 0.26, y: y0 + 1.10, w: cw - 0.52, h: 1.0,
      fontSize: 11.5, color: MUTED });
    T(s, "NOW", { x: x + 0.26, y: y0 + 2.22, w: cw - 0.52, h: 0.22,
      fontSize: 8.5, bold: true, color: TEAL, charSpacing: 1.5 });
    T(s, after, { x: x + 0.26, y: y0 + 2.46, w: cw - 0.52, h: 1.1,
      fontSize: 12, bold: true, color: INK });
  });
}
footNote(s, "The narrowing is not cosmetic — it is what makes the dense-vs-sparse comparison measurable");
s.addNotes("Lead with the feedback. We did not just shrink the topic; we chose a corpus whose language mix makes the comparison decisive.");

// =====================================================================
// 3  The corpus
// =====================================================================
s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "The corpus");
T(s, "Two complete retail health-insurance policy wordings, from two different Indian insurers — same genre, different house style.", {
  x: M, y: 1.14, w: CW, h: 0.32, fontSize: 13, color: MUTED });
{
  const cells = [
    [String(S.corpus.documents.length), "policy documents", TEAL],
    [(S.corpus.total_words / 1000).toFixed(0) + "k", "words of policy text", BLUE],
    [String(S.goldset.n), "gold questions, evidence-verified", ORANGE],
    [String(S.n_configs), "scored configurations", PURPLE],
  ];
  cells.forEach(([v, l, c], i) => stat(s, M + i * (CW / 4), 1.64, CW / 4 - 0.4, v, l, c));
}
card(s, M, 3.34, CW, 2.05);
T(s, "Why the language mix matters", {
  x: M + 0.32, y: 3.54, w: 6, h: 0.32, fontSize: 14.5, bold: true, color: NAVY });
{
  const half = CW / 2 - 0.66;
  T(s, [
    { text: "Prose that only semantics can reach", options: { bold: true, color: BLUE, fontSize: 12, breakLine: true } },
    { text: "“Accident means a sudden, unforeseen and involuntary event caused by external, visible and violent means.”", options: { fontSize: 11.5, color: INK, italic: true } },
  ], { x: M + 0.32, y: 3.96, w: half, h: 1.7, isTextBox: true, margin: 0, valign: "top", fontFace: "Calibri" });
  T(s, [
    { text: "Identifiers that only lexical match can reach", options: { bold: true, color: "B5701E", fontSize: 12, breakLine: true } },
    { text: "“Refractive Error: Code – Excl15 … refractive error less than 7.5 dioptres.”", options: { fontSize: 11.5, color: INK, italic: true, breakLine: true } },
    { text: "A dense vector does not retrieve “Excl15”. BM25 does.", options: { fontSize: 11.5, color: MUTED } },
  ], { x: M + CW / 2 + 0.1, y: 3.96, w: half, h: 1.7, isTextBox: true, margin: 0, valign: "top", fontFace: "Calibri" });
}
footNote(s, "Both quotations are real text from the corpus");
s.addNotes("A prose-only corpus would make the hybrid comparison vacuous. This corpus is chosen so the result can go either way.");

// =====================================================================
// 4  Architecture
// =====================================================================
s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "System architecture");
{
  const steps = [
    ["PDF ingestion", "de-noise and\nde-hyphenate", MUTED],
    ["Chunking", "fixed · recursive ·\nsemantic · parent–child", BLUE],
    ["Embedding", "MiniLM · bge-small ·\nbge-base · 2 × 256d", TEAL],
    ["Retrieval", "FAISS dense +\nBM25 sparse", PURPLE],
    ["RRF fusion", "ordinal ranks,\nnever raw scores", ORANGE],
  ];
  // Five cards spread across the full width (they were six): each card is wider,
  // so the text is stepped up a little to keep the slide balanced.
  const gap = 0.26, n = steps.length, sw = (CW - (n - 1) * gap) / n, y0 = 1.56, ch = 2.08;
  steps.forEach(([head, sub, col], i) => {
    const x = M + i * (sw + gap);
    card(s, x, y0, sw, ch);
    dot(s, x + sw / 2 - 0.2, y0 + 0.22, String(i + 1), col);
    T(s, head, { x: x + 0.1, y: y0 + 0.74, w: sw - 0.2, h: 0.38,
      align: "center", fontSize: 13.5, bold: true, color: NAVY });
    T(s, sub, { x: x + 0.1, y: y0 + 1.16, w: sw - 0.2, h: 0.85,
      align: "center", fontSize: 10.5, color: MUTED });
    if (i < n - 1) T(s, "›", { x: x + sw + 0.04, y: y0 + 0.72, w: 0.18, h: 0.4,
      align: "center", fontSize: 17, color: "B9C1D6" });
  });
}
card(s, M, 4.05, CW, 1.12);
T(s, [
  { text: "Why RRF and not score averaging.  ", options: { bold: true, color: NAVY, fontSize: 12.5 } },
  { text: "Cosine similarity and BM25 term weights live on incompatible, unbounded scales — naive normalisation is exactly where hybrid search breaks. RRF discards magnitudes and fuses on rank position, so neither retriever can dominate by scale alone.", options: { color: INK, fontSize: 12.5 } },
], { x: M + 0.32, y: 4.28, w: CW - 0.64, h: 1.26, isTextBox: true, margin: 0, valign: "top", fontFace: "Calibri" });
footNote(s, "Five stages, all running on CPU");
s.addNotes("The RRF point is the one to dwell on if asked a technical question.");

// =====================================================================
// 5  Experimental design
// =====================================================================
s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "Experimental design");
T(s, "A full factorial sweep — every chunking strategy against every embedding configuration against every retrieval mode.", {
  x: M, y: 1.12, w: CW, h: 0.32, fontSize: 13, color: MUTED });
s.addTable([
  [{ text: "Factor", options: { bold: true, color: NAVY } },
   { text: "Levels", options: { bold: true, color: NAVY } }],
  ["Chunking strategy", "fixed-size 512/64   ·   recursive   ·   semantic (percentile)   ·   parent–child"],
  ["Embedding model", "MiniLM-L6 384d   ·   bge-small 384d   ·   bge-base 768d   ·   bge-base→256d   ·   arctic→256d"],
  ["Retrieval mode", "dense   ·   BM25   ·   hybrid RRF   ·   hybrid + cross-encoder re-rank"],
  ["Scored on", S.goldset.n + " gold questions   ·   Success@5, Coverage@5, Hit@1, MRR, nDCG@5, latency, index size"],
], {
  // The table is the whole slide now, so it is sized up to fill the space
  // (taller rows, larger type) instead of sitting small above an empty area.
  x: M, y: 1.82, w: CW, colW: [3.0, CW - 3.0], rowH: 0.8,
  fontSize: 14.5, color: INK, fontFace: "Calibri", valign: "middle", margin: 10,
  border: { type: "solid", color: "DCE2EE", pt: 1 },
});
s.addNotes("If the examiner asks one methods question it will be about confounding: semantic chunk boundaries are always computed with MiniLM, never the model under test, so the chunking and embedding factors are not confounded. BM25 is run once per chunking strategy because it does not use embeddings.");

// =====================================================================
// 6  Evaluation method
// =====================================================================
s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "How we score it");
T(s, "Our main challenge here is that every chunking strategy creates different chunk boundaries, so we cannot use chunk IDs as labels.", {
  x: M, y: 1.12, w: CW, h: 0.32, fontSize: 13, color: MUTED });
{
  const lw = CW * 0.54 - 0.15, rw = CW * 0.46 - 0.15;
  card(s, M, 1.58, lw, 4.55);
  T(s, "Gold labels are evidence spans", { x: M + 0.3, y: 1.80, w: lw - 0.6, h: 0.34,
    fontSize: 15, bold: true, color: NAVY });
  T(s, [
    { text: "Q:  ", options: { bold: true, color: BLUE, fontSize: 12 } },
    { text: "“How long must I wait before a pre-existing disease is covered?”", options: { fontSize: 12, color: INK, breakLine: true } },
    { text: "evidence:  ", options: { bold: true, color: TEAL, fontSize: 12 } },
    { text: "“expiry of 36 months”", options: { fontSize: 12, color: INK, italic: true } },
  ], { x: M + 0.3, y: 2.22, w: lw - 0.6, h: 1.05, isTextBox: true, margin: 0, valign: "top", fontFace: "Calibri" });
  T(s, "A retrieved chunk is relevant if it contains that span. The same question scores identically however the corpus was cut — which is exactly what a study of cutting requires.",
    { x: M + 0.3, y: 3.50, w: lw - 0.6, h: 1.1, fontSize: 12.5, color: MUTED });
  T(s, "Chunk-ID labelling cannot do this: a chunk ID under one strategy has no counterpart under another.",
    { x: M + 0.3, y: 4.80, w: lw - 0.6, h: 1.0, fontSize: 12.5, bold: true, color: NAVY });

  const rx = M + CW * 0.54 + 0.15;
  card(s, rx, 1.58, rw, 4.55);
  T(s, "Deterministic metrics only", { x: rx + 0.3, y: 1.80, w: rw - 0.6, h: 0.34,
    fontSize: 15, bold: true, color: NAVY });
  ["Success@5 — was the evidence found at all",
   "Coverage@5 — how much of it was found",
   "Hit@1 · MRR · nDCG@5 (binary gains)",
   "Mean query latency · vector index size",
   "No LLM-as-a-judge in the scoring loop",
  ].forEach((t, i) => T(s, t, { x: rx + 0.3, y: 2.30 + i * 0.54, w: rw - 0.6, h: 0.5,
    fontSize: 12.5, color: INK }));
  T(s, "Review 1 flagged evaluator brittleness on local hardware as a research gap. Keeping scoring deterministic is our answer — the benchmark reruns identically on a laptop.",
    { x: rx + 0.3, y: 5.08, w: rw - 0.6, h: 0.9, fontSize: 11, italic: true, color: MUTED });
}
footNote(s, "All " + S.goldset.n + " questions are machine-verified against the corpus before the benchmark runs");
s.addNotes("This is our methodological contribution. Chunk-ID labelling cannot compare strategies with different boundaries; evidence spans can.");

// =====================================================================
// 7  Result 1 - chunking
// =====================================================================
const byStrat = Object.entries(S.by_strategy).sort((a, b) => b[1]["ndcg@k"] - a[1]["ndcg@k"]);
const bs = byStrat[0], ws = byStrat[byStrat.length - 1];
const spread = (a) => Math.max(...a) - Math.min(...a);
const stratSpread = spread(byStrat.map((e) => e[1]["ndcg@k"]));
const modeSpread = spread(Object.values(S.by_mode).map((v) => v["ndcg@k"]));
const embSpread = spread(Object.values(S.by_embedder).map((v) => v["ndcg@k"]));

s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "Result 1 — chunking strategy");
fig(s, "fig1_strategy_by_mode.png", { x: M, y: 1.42, w: 7.9, h: 3.70 });
{
  const rx = 8.72, rw = W - M - 8.72;
  T(s, "What it shows", { x: rx, y: 1.36, w: rw, h: 0.32, fontSize: 14, bold: true, color: NAVY });
  const WHY = {
    recursive: "Recursive wins by cutting at the least damaging boundary available — paragraph before line, line before sentence — so a clause and its exception stay together.",
    semantic: "Semantic wins by cutting where meaning shifts rather than where a character budget runs out, producing fewer, larger, self-contained chunks.",
    parent_child: "Parent–child wins by decoupling: small children are embedded for precise matching, the whole clause is returned for context.",
    fixed: "Fixed-size leads here, which says the corpus tolerates blunt segmentation — worth noting rather than assuming structure always helps.",
  };
  [nice(bs[0]) + " leads at nDCG@5 " + n(bs[1]["ndcg@k"]) + ".",
   nice(ws[0]) + " is lowest at " + n(ws[1]["ndcg@k"]) + " — a spread of " + n(stratSpread) + ".",
   "For scale: retrieval mode spans " + n(modeSpread) + ", embedding model only " + n(embSpread) + ".",
  ].forEach((t, i) => T(s, t, { x: rx, y: 1.78 + i * 0.95, w: rw, h: 0.9,
    fontSize: 12.5, color: INK }));
  card(s, rx, 4.66, rw, 1.62);
  T(s, WHY[bs[0]] || "", { x: rx + 0.24, y: 4.88, w: rw - 0.48, h: 1.2,
    fontSize: 12, color: INK });
}
s.addNotes("Point at the dashed BM25 baseline — it is there so nobody can claim the dense arms are being flattered.");

// =====================================================================
// 8  Result 2 - embeddings and MRL
// =====================================================================
const byEmb = Object.entries(S.by_embedder).sort((a, b) => b[1]["ndcg@k"] - a[1]["ndcg@k"]);
s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "Result 2 — embeddings and Matryoshka truncation");
fig(s, "fig3_cost_quality.png", { x: M, y: 1.60, w: 5.6, h: 3.42 });
{
  const rx = 6.25, rw = W - M - 6.25;
  T(s, "The controlled pair", { x: rx, y: 1.38, w: rw, h: 0.32, fontSize: 14, bold: true, color: NAVY });
  T(s, "Both 256-dimensional arms produce an identical index size, so the gap between them isolates what Matryoshka training itself contributes.",
    { x: rx, y: 1.76, w: rw, h: 0.7, fontSize: 12, color: MUTED });
  [[pctS(S.mrl.naive_retention_pct), "of bge-base-768 quality retained by naive truncation to 256d", ORANGE],
   [pctS(S.mrl.storage_saving_pct), "less index storage at 256 dimensions", TEAL],
   [pctS(S.mrl.true_mrl_vs_bge768_pct), "of bge-base-768 quality from the Matryoshka-trained encoder at 256d", BLUE],
  ].forEach(([v, l, c], i) => {
    const y = 2.62 + i * 1.22;
    T(s, v, { x: rx, y, w: 1.75, h: 0.72, fontSize: 26, bold: true, color: c,
      fontFace: "Cambria", valign: "middle" });
    T(s, l, { x: rx + 1.82, y, w: rw - 1.82, h: 0.72, fontSize: 12, color: INK,
      valign: "middle" });
  });
}
footNote(s, "Best embedding configuration overall: " + nice(byEmb[0][0]) + " at mean nDCG@5 " + n(byEmb[0][1]["ndcg@k"]));
s.addNotes("Review 1 asserted 12x storage reduction at 90-95% accuracy. We tested it rather than repeating it.");

// =====================================================================
// 9  Result 3 - where dense breaks
// =====================================================================
s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "Result 3 — where dense retrieval breaks");
fig(s, "fig6_question_type.png", { x: M, y: 1.42, w: 7.9, h: 3.70 });
{
  const rx = 8.72, rw = W - M - 8.72;
  T(s, "The reason for this corpus", { x: rx, y: 1.36, w: rw, h: 0.32, fontSize: 14, bold: true, color: NAVY });
  ["Dense and sparse are not better or worse than each other — they fail on different questions.",
   "On exact-match questions BM25 reaches 0.97 and dense only 0.84.",
   "On semantic questions it inverts: dense 0.69, BM25 0.54.",
  ].forEach((t, i) => T(s, t, { x: rx, y: 1.78 + i * 0.95, w: rw, h: 0.9,
    fontSize: 12.5, color: INK }));
  card(s, rx, 4.66, rw, 1.32, "FFF4E8");
  T(s, "On a prose-only corpus this chart would be flat and hybrid retrieval would be pure overhead.",
    { x: rx + 0.24, y: 4.88, w: rw - 0.48, h: 0.9, fontSize: 12.5, bold: true, color: "A05A18" });
}
s.addNotes("This slide justifies the scope change. Without a mixed-language corpus there is no finding here.");

// =====================================================================
// 10  Decision matrix + cost
// =====================================================================
s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "The deliverable — decision matrix and its cost");
fig(s, "fig5_decision_matrix.png", { x: M, y: 1.32, w: 7.0, h: 3.18 });
fig(s, "fig4_latency.png", { x: M, y: 4.62, w: 3.6, h: 2.19 });
{
  const rx = 7.9, rw = W - M - 7.9;
  card(s, rx, 1.32, rw, 2.62);
  T(s, "Best configuration", { x: rx + 0.26, y: 1.50, w: rw - 0.52, h: 0.28, fontSize: 11.5, color: MUTED });
  T(s, nice(S.best.strategy) + "  +  " + nice(S.best.embedder), {
    x: rx + 0.26, y: 1.80, w: rw - 0.52, h: 0.44, fontSize: 15, bold: true, color: NAVY });
  T(s, "under " + nice(S.best.mode) + " retrieval", {
    x: rx + 0.26, y: 2.24, w: rw - 0.52, h: 0.28, fontSize: 12, color: MUTED });
  T(s, "nDCG@5 " + n(S.best.ndcg), {
    x: rx + 0.26, y: 2.60, w: rw - 0.52, h: 0.32, fontSize: 13.5, bold: true, color: TEAL });
  T(s, "Success@5 " + n(S.best.recall) + "    MRR " + n(S.best.mrr) + "    " + n(S.best.index_mb, 2) + " MB", {
    x: rx + 0.26, y: 2.94, w: rw - 0.52, h: 0.5, fontSize: 12, color: INK });

  card(s, rx, 4.14, rw, 2.5);
  T(s, "What precision costs", { x: rx + 0.26, y: 4.36, w: rw - 0.52, h: 0.3,
    fontSize: 13, bold: true, color: NAVY });
  T(s, "Re-ranking adds " + n(S.reranker.ndcg_gain) + " nDCG over hybrid fusion — and multiplies latency by " +
      S.reranker.latency_multiple + "×, to " + n(S.reranker.latency_ms, 0) + " ms. Worth it for clause lookup where a wrong exclusion has financial consequences; not for high-traffic autocomplete.",
    { x: rx + 0.26, y: 4.72, w: rw - 0.52, h: 1.8, fontSize: 12, color: INK });
}
s.addNotes("This matrix is literally what the problem statement asked for as the expected outcome. Say so.");

// =====================================================================
// 11  Demo
// =====================================================================
s = pres.addSlide({ masterName: "SECTION" });
T(s, "04", { x: M, y: 1.30, w: 2, h: 0.8, fontSize: 44, bold: true, color: MINT, fontFace: "Cambria" });
T(s, "Live demo", { x: M, y: 2.10, w: CW, h: 0.86, fontSize: 34, bold: true,
  color: "FFFFFF", fontFace: "Cambria" });
T(s, "Streamlit app — switch chunking strategy, embedding model and retrieval mode on the same question, and watch which clause comes back.", {
  x: M, y: 3.02, w: CW - 2.4, h: 0.56, fontSize: 14.5, color: ON_DARK });
[["How long must I wait before a pre-existing disease is covered?", "semantic — all modes find it", TEAL],
 ["What does exclusion code Excl02 cover?", "exact-match — dense-only FAILS, hybrid finds it", ORANGE],
 ["What daily amount is paid for shared accommodation?", "exact-match — Rs.1,000/- per day", TEAL],
].forEach(([q, tag, col], i) => {
  const y = 4.05 + i * 0.82;
  dot(s, M, y, String(i + 1), col);
  T(s, "“" + q + "”", { x: M + 0.58, y: y - 0.04, w: 8.6, h: 0.34,
    fontSize: 13.5, color: "FFFFFF" });
  T(s, tag, { x: M + 0.58, y: y + 0.28, w: 8.6, h: 0.3, fontSize: 11.5,
    color: col === ORANGE ? ORANGE : MINT });
});
s.addNotes("SANSHRAY. The demo is ALREADY OPEN and ALREADY WARMED UP in another window - ALT+TAB to it, do not start anything now. Config MUST be parent-child + bge-SMALL + Hybrid RRF (with bge-base the Excl02 question does not fail). Order: 1) ask the pre-existing disease question. 2) switch to DENSE ONLY, ask the Excl02 question - it FAILS. 3) switch back to HYBRID RRF, same question - found. 4) Compare tab, then Benchmark tab. ALT+TAB back to the slides.");

// =====================================================================
// 11a  Demo backup - real screenshots, used only if the live demo fails
// =====================================================================
if (INCLUDE_BACKUP) {
s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "Demo — what the system returns");
T(s, "Captured from the running system. Parent–child chunking, bge-small embeddings, 1,124 indexed children.", {
  x: M, y: 1.12, w: CW, h: 0.32, fontSize: 13, color: MUTED });
{
  const shots = [
    ["demo_backup/1_semantic_hybrid_found.jpg", "1 · Semantic question, hybrid",
     "“Pre-existing disease?” → evidence FOUND", TEAL],
    ["demo_backup/2_excl02_dense_FAILS.jpg", "2 · “Excl02”, dense only",
     "evidence NOT found — returns Excl04 instead", "B5701E"],
    ["demo_backup/3_excl02_hybrid_found.jpg", "3 · “Excl02”, hybrid RRF",
     "evidence FOUND — answer names Code-Excl 02", TEAL],
  ];
  const gap = 0.2, iw = (CW - 2 * gap) / 3, ih = iw * 590 / 894;
  shots.forEach(([file, head, cap, col], i) => {
    const x = M + i * (iw + gap);
    T(s, head, { x, y: 1.52, w: iw, h: 0.3, fontSize: 12.5, bold: true, color: NAVY });
    fig(s, file, { x, y: 1.86, w: iw, h: ih });
    T(s, cap, { x, y: 1.92 + ih, w: iw, h: 0.6, fontSize: 11.5, bold: true, color: col });
  });
  const by = 1.92 + ih + 0.72;
  card(s, M, by, CW, 1.35, "FFF4E8");
  T(s, [
    { text: "Same question, same chunks, same index — only the retrieval mode changed.  ",
      options: { bold: true, color: "A05A18", fontSize: 14 } },
    { text: "Panels 2 and 3 are the crossover from Result 3 reproduced on a single query: a dense vector has no useful representation of the literal string “Excl02”, so it returns a plausible but wrong exclusion. Adding the lexical retriever recovers the right clause at rank one.",
      options: { color: INK, fontSize: 13.5 } },
  ], { x: M + 0.32, y: by + 0.22, w: CW - 0.64, h: 1.0, isTextBox: true, margin: 0, valign: "top", fontFace: "Calibri" });
}
footNote(s, "Backup only — skip this slide when the live demo runs");
s.addNotes("SKIP THIS SLIDE if the live demo worked. It exists so that a failed demo costs nothing: advance here and narrate the same three steps over the real screenshots.");
}

// =====================================================================
// 12  Limitations
// =====================================================================
s = pres.addSlide({ masterName: "CONTENT" });
slideTitle(s, "What we did not do, and what is next");
{
  const lims = [
    ["01", "Gold set size", S.goldset.n + " questions separate configurations, but differences of a few hundredths of nDCG should not be over-read.", ORANGE],
    ["02", "Corpus breadth", "Two documents, one jurisdiction, one product category. The decision matrix is evidence, not a general law.", BLUE],
    ["03", "RAPTOR & late chunking", "Surveyed in Review 1, not implemented. Both need heavy offline pre-compute, and our cost column argues against it at this corpus size.", PURPLE],
    ["04", "A bug we found and fixed", "Our first scorer counted every child of a parent as a separate relevant unit — 14.1 per question against 2.2 elsewhere. Collapsing to unique parents moved parent–child from worst to best.", TEAL],
  ];
  const gap = 0.26, cw = (CW - gap) / 2, ch = 1.72, y0 = 1.44;
  lims.forEach(([num, head, text, col], i) => {
    const x = M + (i % 2) * (cw + gap);
    const y = y0 + Math.floor(i / 2) * (ch + 0.34);
    card(s, x, y, cw, ch);
    dot(s, x + 0.28, y + 0.26, num, col);
    T(s, head, { x: x + 0.8, y: y + 0.26, w: cw - 1.08, h: 0.4,
      fontSize: 14.5, bold: true, color: NAVY, valign: "middle" });
    T(s, text, { x: x + 0.28, y: y + 0.84, w: cw - 0.56, h: 1.12,
      fontSize: 11.5, color: INK });
  });
}
footNote(s, "Stated rather than hidden — the cost measurements are what make dropping RAPTOR defensible");
s.addNotes("Owning the bug is a strength. It shows the evaluation was examined rather than trusted.");

// =====================================================================
// 13  Close
// =====================================================================
s = pres.addSlide({ masterName: "DARK" });
T(s, "CONCLUSION", { x: M, y: 1.62, w: CW, h: 0.34, fontSize: 13.5, bold: true,
  color: MINT, charSpacing: 3 });
T(s, "Retrieval architecture mattered\nmore than embedding choice", {
  x: M, y: 2.10, w: CW, h: 1.6, fontSize: 34, bold: true, color: "FFFFFF",
  fontFace: "Cambria", lineSpacing: 40 });
T(s, "Narrowing the corpus is what let the comparison separate the methods: dense and sparse retrieval fail on different questions, and only a corpus containing both kinds of language can show it.", {
  x: M, y: 3.92, w: CW - 1.6, h: 0.8, fontSize: 14.5, color: ON_DARK });
T(s, "Ralph  ·  Sanshray  ·  Kushal  ·  Rishaan     —     thank you, questions welcome", {
  x: M, y: 4.86, w: CW, h: 0.42, fontSize: 15.5, bold: true, color: MINT });
T(s, "Key references:  Sarthi et al., RAPTOR (ICLR 2024)  ·  Günther et al., Late Chunking (2024)  ·  Es et al., RAGAS (EACL 2024)  ·  Kusupati et al., Matryoshka Representation Learning (NeurIPS 2022)  ·  Cormack et al., Reciprocal Rank Fusion (SIGIR 2009)", {
  x: M, y: H - 1.1, w: CW, h: 0.6, fontSize: 9.5, color: "7A86AE" });
T(s, [{ text: "Code, data and results:  " + REPO_URL, options: { hyperlink: { url: REPO_URL, tooltip: "Open the project repository" }, color: MINT } }], {
  x: M, y: H - 0.5, w: CW, h: 0.32, fontSize: 11 });

// ------------------------------------------------------------- write
const OUT = path.join(ROOT, "deck", "RAG_Chunking_Embeddings_Review3.pptx");
pres.writeFile({ fileName: OUT })
  .then(() => applyTheme(OUT, THEME))
  .then(() => console.log("wrote " + OUT))
  .catch((e) => { console.error(e); process.exit(1); });
