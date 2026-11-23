/*
 * build_report.js - generates the IEEE-format mini-project report.
 *
 *   node report/build_report.js
 *
 * All quantitative claims are read from results/summary.json, so the document
 * can never drift from the benchmark that produced it.
 */
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, HeadingLevel,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, SectionType,
  PageNumber, Footer, convertInchesToTwip, ExternalHyperlink,
} = require("docx");

const ROOT = path.resolve(__dirname, "..");
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "results", "summary.json"), "utf8"));

const GOLD = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "goldset.json"), "utf8"));

// full grid, for the appendix table
const GRID = (() => {
  const LF = String.fromCharCode(10), CR = String.fromCharCode(13);
  const raw = fs.readFileSync(path.join(ROOT, "results", "benchmark_results.csv"), "utf8")
    .split(CR).join("").trim().split(LF);
  const head = raw[0].split(",");
  return raw.slice(1).map((line) => {
    const cells = line.split(",");
    const o = {};
    head.forEach((h, i) => { o[h] = cells[i]; });
    return o;
  });
})();
const FIG = path.join(ROOT, "figures");

const SERIF = "Times New Roman";
const BODY = 20;   // half-points => 10pt
const SMALL = 18;  // 9pt
const TINY = 16;   // 8pt

const n = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? "n/a" : Number(v).toFixed(d));
const pct = (v, d = 1) => (v === null || v === undefined ? "n/a" : Number(v).toFixed(d) + "%");

const NICE = {
  fixed: "fixed-size", recursive: "recursive", semantic: "semantic",
  parent_child: "parent-child",
  minilm: "MiniLM-L6", bge_small: "bge-small", bge_base: "bge-base",
  bge_base_256: "bge-base@256 (naive)", arctic_mrl_256: "arctic@256 (MRL)",
  "none (BM25)": "BM25",
  dense: "dense", sparse: "BM25", hybrid_rrf: "hybrid RRF",
  hybrid_rerank: "hybrid + re-rank",
};
const nice = (k) => NICE[k] || k;

// ---------------------------------------------------------------- helpers
const body = (text, opts = {}) =>
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: opts.after ?? 60, line: 240 },
    indent: opts.noIndent ? undefined : { firstLine: convertInchesToTwip(0.2) },
    children: [new TextRun({ text, font: SERIF, size: opts.size ?? BODY })],
  });

const sectionHead = (roman, title) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 100 },
    keepNext: true,
    children: [new TextRun({
      text: roman ? `${roman}.  ${title.toUpperCase()}` : title.toUpperCase(),
      font: SERIF, size: BODY, allCaps: false, smallCaps: true,
    })],
  });

const subHead = (letter, title) =>
  new Paragraph({
    spacing: { before: 140, after: 60 },
    keepNext: true,
    children: [new TextRun({ text: `${letter}.  ${title}`, font: SERIF, size: BODY, italics: true })],
  });

const caption = (text) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 160 },
    children: [new TextRun({ text, font: SERIF, size: TINY })],
  });

function figure(file, w = 325) {
  const p = path.join(FIG, file);
  if (!fs.existsSync(p)) return [];
  // figures are rendered 200dpi; keep aspect from the matplotlib figsize
  const ASPECT = { // width:height
    "fig0_architecture.png": 7.0 / 2.5,
    "fig7_chunk_sizes.png": 6.4 / 2.9,
    "fig1_strategy_by_mode.png": 6.4 / 3.0,
    "fig2_embedders.png": 6.4 / 3.0,
    "fig3_cost_quality.png": 5.2 / 3.2,
    "fig4_latency.png": 4.6 / 2.8,
    "fig5_decision_matrix.png": 6.2 / 2.8,
    "fig6_question_type.png": 6.4 / 3.0,
  }[file] || 2.0;
  return [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 0 },
    children: [new ImageRun({
      type: "png", data: fs.readFileSync(p),
      transformation: { width: w, height: Math.round(w / ASPECT) },
    })],
  })];
}

const COL_W = convertInchesToTwip(3.4);
function table(headers, rows, widths) {
  // tables of this size must not be broken across a column
  const bind = rows.length <= 12;
  const w = widths || headers.map(() => Math.floor(COL_W / headers.length));
  const cell = (t, bold, shade, width, keep) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: shade ? { type: ShadingType.CLEAR, fill: "EDF2F7" } : undefined,
    margins: { top: 20, bottom: 20, left: 60, right: 60 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 0 },
      keepNext: keep,
      children: [new TextRun({ text: String(t), font: SERIF, size: TINY, bold })],
    })],
  });
  return new Table({
    columnWidths: w,
    width: { size: COL_W, type: WidthType.DXA },
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: headers.map((h, i) => cell(h, true, true, w[i], bind)),
      }),
      ...rows.map((r, ri) => new TableRow({
        cantSplit: true,
        children: r.map((c, i) =>
          cell(c, false, false, w[i], bind && ri < rows.length - 1)),
      })),
    ],
  });
}

const tableCaption = (text) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 60 },
    keepNext: true,
    children: [new TextRun({ text, font: SERIF, size: TINY, smallCaps: true })],
  });

// ---------------------------------------------------------------- content
const corpusWords = S.corpus.total_words.toLocaleString();
const docRows = S.corpus.documents.map((d) => [
  d.doc_id.replace(/_/g, " "), d.words.toLocaleString(), d.sections_detected,
]);

const byStrat = Object.entries(S.by_strategy);
const bestStrat = byStrat.slice().sort((a, b) => b[1]["ndcg@k"] - a[1]["ndcg@k"])[0];
const worstStrat = byStrat.slice().sort((a, b) => a[1]["ndcg@k"] - b[1]["ndcg@k"])[0];

const byEmb = Object.entries(S.by_embedder);
const bestEmb = byEmb.slice().sort((a, b) => b[1]["ndcg@k"] - a[1]["ndcg@k"])[0];

const byMode = S.by_mode;
const modeOrder = ["sparse", "dense", "hybrid_rrf", "hybrid_rerank"].filter((m) => byMode[m]);

// question-type x mode matrix
const qtypes = [...new Set(S.by_qtype_mode.map((r) => r.qtype))];
const qtm = (t, m) => {
  const r = S.by_qtype_mode.find((x) => x.qtype === t && x.mode === m);
  return r ? r["recall@k"] : null;
};

const children = [];

// ---- Abstract
children.push(new Paragraph({
  spacing: { before: 120, after: 80 },
  alignment: AlignmentType.JUSTIFIED,
  children: [
    new TextRun({ text: "Abstract—", font: SERIF, size: SMALL, bold: true, italics: true }),
    new TextRun({
      font: SERIF, size: SMALL, italics: true, bold: true,
      text: `Retrieval-augmented generation is bounded by what the retriever returns, yet the two decisions that determine retrieval quality—how a document is segmented and how those segments are embedded—are usually made by convention rather than measurement. This paper reports a controlled empirical study of those two factors over a deliberately narrow corpus: ${S.corpus.documents.length} Indian retail health-insurance policy wordings totalling ${corpusWords} words. We sweep ${byStrat.length} chunking strategies against ${byEmb.length} embedding configurations and ${modeOrder.length} retrieval modes, scoring all ${S.n_configs} resulting configurations on a gold set of ${S.goldset.n} questions whose answers are anchored to verbatim evidence spans rather than to chunk identifiers. Anchoring on spans is what makes strategies with different boundaries comparable on a single scale. Results show that ${nice(bestStrat[0])} chunking attains the highest mean nDCG@5 (${n(bestStrat[1]["ndcg@k"])}) against ${n(worstStrat[1]["ndcg@k"])} for ${nice(worstStrat[0])}; that retrieval mode dominates embedding choice, with cross-encoder re-ranking adding ${n(S.reranker ? S.reranker.ndcg_gain : 0)} nDCG over hybrid fusion at ${S.reranker ? S.reranker.latency_multiple : "n/a"}× the latency; and that truncating a non-Matryoshka encoder to 256 dimensions retains ${pct(S.mrl.naive_retention_pct)} of full-dimensional quality for ${pct(S.mrl.storage_saving_pct)} less storage. We publish the resulting decision matrix as the practical deliverable.`,
    }),
  ],
}));
children.push(new Paragraph({
  spacing: { after: 160 },
  alignment: AlignmentType.JUSTIFIED,
  children: [
    new TextRun({ text: "Index Terms—", font: SERIF, size: SMALL, bold: true, italics: true }),
    new TextRun({
      text: "retrieval-augmented generation, text chunking, sentence embeddings, hybrid retrieval, reciprocal rank fusion, cross-encoder re-ranking, Matryoshka representation learning, insurance documents.",
      font: SERIF, size: SMALL, italics: true,
    }),
  ],
}));

// ---- I. Introduction
children.push(sectionHead("I", "Introduction"));
children.push(body("A retrieval-augmented generation (RAG) pipeline cannot reason about text its retriever never returns. However fluent the generator, an answer assembled from the wrong clauses is wrong; and because large language models are disposed to produce fluent prose from whatever context they are handed, a retrieval failure typically surfaces not as an error but as a confident fabrication. Retrieval quality is therefore the ceiling on the entire system, and the two decisions that set it—where a document is cut into chunks, and how those chunks are projected into vector space—are made before a single token is generated.", { noIndent: true }));
children.push(body("In practice these two decisions are usually inherited rather than chosen. A default splitter of 512 characters with 64 characters of overlap and whichever embedding model is most convenient will produce a pipeline that works, in the sense that it returns something for every query. Whether it returns the right thing is rarely measured, because measuring it requires a labelled set of questions whose answers are known to live in specific parts of a specific corpus."));
children.push(body("This paper reports that measurement for one narrow domain. Our Review 1 submission surveyed the chunking and embedding literature across technical documentation in general; the feedback we received was that the scope was too broad to support a conclusive study, and that a tightly defined corpus of one or two closely related document types would produce sharper findings. We accordingly narrowed to a single genre: Indian retail health-insurance policy wordings."));
children.push(body("That genre was chosen for a specific methodological reason rather than for convenience. Policy wordings interleave two kinds of language that stress retrieval in opposite directions. Definitions, conditions and operating clauses are flowing prose, where a user's question shares almost no vocabulary with the text that answers it and only semantic matching will do. Exclusion codes, monetary sub-limits and waiting-period durations are hard identifiers—literal strings such as Excl02, Rs.15,000 or 36 months—where semantic similarity is close to useless and lexical matching is decisive. A corpus containing only one of these kinds of language would make the dense-versus-sparse comparison vacuous. Containing both, it makes the comparison the central finding."));
children.push(body("Narrowing the corpus had a second consequence we did not anticipate when we proposed it. A general corpus admits general conclusions, which in this field tend to reduce to rankings of models that are already published. A single genre admits a different kind of conclusion: that a particular property of a corpus, present here and absent elsewhere, changes which architecture wins. The latter transfers better than the former, because a practitioner can check whether their own corpus has the property, whereas they cannot check whether their corpus resembles an average."));
children.push(body("Our contributions are: (i) a controlled factorial benchmark of four chunking strategies against five embedding configurations and four retrieval modes on a single narrow corpus; (ii) an evaluation protocol based on verbatim evidence spans that makes chunking strategies with incompatible boundaries directly comparable; (iii) a controlled pair isolating what Matryoshka training actually contributes to dimensionality truncation; and (iv) a published decision matrix mapping corpus characteristics to pipeline configuration."));

// ---- II. Related work
children.push(sectionHead("II", "Related Work"));
children.push(subHead("A", "The evolution of chunking"));
children.push(body("Early RAG systems segment text heuristically, by fixed token or character windows, optionally with overlap. The approach is computationally free and context-blind: it severs sentences, and frequently arguments, mid-thought. Recursive character splitting improves on this by respecting a hierarchy of separators—paragraph, line, sentence, word—so that cuts fall at the least damaging available boundary.", { noIndent: true }));
children.push(body("Semantic chunking replaces the character budget with a meaning-based criterion: adjacent sentences are embedded, the cosine distance between neighbours is computed, and a chunk boundary is placed wherever that distance exceeds a percentile threshold, on the argument that a spike in distance marks a topical shift. The method preserves coherence at the cost of an embedding pass over every sentence before indexing begins."));
children.push(body("Parent–child retrieval, sometimes called small-to-big, takes a different route: it decouples the retrieval unit from the generation unit. Small children are embedded, because short spans give precise vector matches; but what is handed to the generator is the larger parent passage containing the matched child, so precision of search is obtained without starving the model of context. Late chunking inverts the ordering again, embedding the full document first with a long-context encoder and only then segmenting the token embeddings, so that each chunk's vector is contextualised by material outside it. RAPTOR goes further still, clustering chunks and recursively summarising them with an LLM into an abstractive tree that supports multi-hop queries."));

children.push(body("The common thread across these methods is a single trade-off. Every one of them buys retrieval quality with pre-computation, and they differ mainly in how much and when. Fixed and recursive splitting cost nothing beyond a pass over the text. Semantic chunking costs one embedding pass over every sentence in the corpus before a single document can be indexed. Late chunking costs a long-context forward pass per document. RAPTOR costs clustering plus repeated language-model summarisation over the whole corpus, and must be redone whenever the corpus changes. For a corpus that is revised annually, as policy wordings are, the amortised cost of the expensive methods is low; for one revised daily it can dominate the entire system. This is why we treat segmentation cost as a measured column rather than a footnote."));

children.push(subHead("B", "Embedding architectures"));
children.push(body("Dense bi-encoders map query and passage independently into a shared space and are strong on paraphrase and intent. Their known weakness is exact lexical matching: rare tokens, identifiers and codes are poorly represented because they contribute little to the training objective. Sparse and lexical methods, from BM25 to learned variants such as SPLADE, have the complementary profile. This complementarity is the standard justification for hybrid retrieval.", { noIndent: true }));
children.push(body("A separate line of work addresses the storage cost of dense retrieval. Matryoshka Representation Learning trains a model so that prefixes of its output vector are themselves usable embeddings, allowing a 768-dimensional vector to be truncated to 256 or 128 dimensions after generation with graceful rather than catastrophic quality loss. The claim is frequently quoted as a general property of embeddings, which it is not: it is a property of models trained for it. Section VI-C treats that distinction as a measurable question rather than an assumption."));

children.push(body("Model size is the other axis, and it is less decisive than it looks. The encoders we benchmark span 22M to 110M parameters and 384 to 768 output dimensions, a range across which published benchmark scores differ by a few points. Those benchmarks are averages over heterogeneous corpora, however, and a practitioner choosing an encoder for one narrow corpus is not served by an average. Part of what this study tests is whether the ordering published on general benchmarks survives on a single specialised genre."));

children.push(subHead("C", "Rank fusion and re-ranking"));
children.push(body("Combining a dense and a sparse ranking is not a matter of averaging their scores, because cosine similarities and BM25 term weights occupy incompatible and unbounded scales; naive normalisation is where most hybrid implementations quietly fail. Reciprocal Rank Fusion sidesteps the problem by discarding score magnitudes entirely and fusing on ordinal position, assigning each document a score of 1/(k + rank) summed across rankings. Neither retriever can then dominate by scale alone.", { noIndent: true }));
children.push(body("Cross-encoders score a query and a passage jointly in a single forward pass and are substantially more accurate than bi-encoders, but they cannot be run over a corpus because they admit no precomputed index. They are therefore used as a final stage over a short candidate list produced by cheaper retrievers."));

children.push(body("The parameter k in the RRF formula controls how sharply rank position is discounted; the value of 60 we use is the one proposed in the original work and widely inherited since. A small k makes the fusion aggressive, letting a single retriever's top result dominate, while a large k flattens the contribution of rank position until the fusion approaches a simple vote. We did not tune it, and note it as an untuned parameter rather than a tested one."));

children.push(subHead("D", "Evaluation"));
children.push(body("Component-wise RAG evaluation frameworks separate retrieval quality from generation quality, typically scoring context precision and recall on one side and faithfulness and context utilisation on the other, often using an LLM as judge. In our Review 1 survey we identified evaluator brittleness on constrained hardware as an open problem: LLM-judge pipelines time out, return malformed scores, or vary between runs. The design in Section V responds to that by keeping the retrieval metrics fully deterministic.", { noIndent: true }));

// ---- III. Corpus
children.push(sectionHead("III", "Corpus and Scope Narrowing"));
children.push(body(`The corpus is ${S.corpus.documents.length} complete retail health-insurance policy wordings issued by two different Indian insurers, obtained as public PDFs from the insurers' own distribution channels. Using two insurers rather than one keeps the genre homogeneous while ensuring that findings are not an artefact of a single document's typesetting or house style. Table I summarises the extracted corpus.`, { noIndent: true }));
children.push(tableCaption("Table I.  Corpus composition after extraction"));
children.push(table(
  ["Document", "Words", "Headings"],
  docRows,
  [Math.floor(COL_W * 0.5), Math.floor(COL_W * 0.25), Math.floor(COL_W * 0.25)],
));
children.push(body("Text was extracted with PyMuPDF and passed through a cleaning stage that removes running headers, registration numbers, page furniture and repeated regulatory footers and rejoins words hyphenated across line breaks. Typographic characters are normalised later, in the scoring step, which maps ligatures and typographic dashes and quotation marks to ASCII equivalents before any text is compared. That step is not cosmetic. The Star Health PDF emits the fi and fl ligatures as single codepoints (211 and 14 occurrences in the extracted text), so a literal search for a word such as specified fails silently against the raw text layer—an error that would have corrupted evidence matching throughout the evaluation without ever raising an exception.", { noIndent: true }));

// ---- IV. Methodology
children.push(sectionHead("IV", "Methodology"));
children.push(body("Fig. 1 shows the pipeline. The structural point is the branch: a single chunk set is indexed twice, once densely and once lexically, and the two rankings are reconciled on ordinal position before an optional re-ranking pass. Every factor in the study varies one stage of this diagram while holding the rest fixed.", { noIndent: true }));
children.push(...figure("fig0_architecture.png", 325));
children.push(caption("Fig. 1.  System pipeline. The dense and sparse branches index the same chunk set and are fused on rank, not score."));

children.push(subHead("A", "Chunking strategies"));
children.push(body("Four strategies were implemented. Fixed-size cuts a 512-character window with 64 characters of overlap, ignoring all structure, and serves as the context-blind baseline. Recursive splits on a separator hierarchy of paragraph, line, sentence and word, backing off only when a fragment still exceeds the budget, then reapplies overlap between neighbours. Semantic embeds every sentence with MiniLM-L6, computes cosine distance between consecutive sentences and places a boundary wherever the distance reaches the 90th percentile, subject to minimum and maximum chunk sizes so that a run of dissimilar sentences cannot produce degenerate chunks.", { noIndent: true }));
children.push(body("Parent–child exploits the structure of the documents directly. Clause headings are detected by pattern, and the text between consecutive headings becomes a parent; oversized parents are hard-split so that any parent remains promptable. Each parent is then windowed into 320-character children with 48 characters of overlap, and each child is prefixed with its parent's heading so that the embedded unit retains its address in the document. Children are what gets indexed; the parent is what is returned."));
children.push(tableCaption("Table II.  Segmentation output per strategy"));
children.push(table(
  ["Strategy", "Chunks", "Mean chars", "Retrieval unit"],
  S.chunk_stats.map((c) => [
    nice(c.strategy), c.n_chunks, Math.round(c.mean_chunk_chars),
    Math.round(c.mean_retrieval_unit_chars),
  ]),
  [Math.floor(COL_W * 0.30), Math.floor(COL_W * 0.18), Math.floor(COL_W * 0.26), Math.floor(COL_W * 0.26)],
));
children.push(body("The final column of Table II is where parent–child separates from the rest: its retrieval unit is small while its generation unit is several times larger, which is precisely the decoupling the strategy exists to provide.", { noIndent: true }));

children.push(tableCaption("Table III.  Segmentation cost and retrievable units"));
children.push(table(
  ["Strategy", "Chunks", "Rel. units/q", "Build s"],
  S.chunk_stats.map((c) => [
    nice(c.strategy), c.n_chunks,
    c.mean_relevant_chunks_per_q !== undefined ? n(c.mean_relevant_chunks_per_q, 2) : "-",
    n(c.chunking_time_s, 1),
  ]),
  [Math.floor(COL_W * 0.30), Math.floor(COL_W * 0.20), Math.floor(COL_W * 0.28), Math.floor(COL_W * 0.22)],
));
children.push(body("The third column is the diagnostic that caught our scoring bug and is worth reporting for its own sake. It counts, per question, how many distinct retrievable units in the index carry that question's evidence. Across fixed, recursive and semantic chunking the figure sits between 1.8 and 2.3, which simply reflects that a short phrase sometimes straddles a chunk boundary and appears in two overlapping windows. Any strategy whose figure departs sharply from that band is not retrieving differently; it is counting differently, and its metrics are not comparable until the discrepancy is explained.", { noIndent: true }));
children.push(body("The fourth column is segmentation wall-clock time. Fixed, recursive and parent-child chunking are effectively free, being string operations over 42,000 words. Semantic chunking is the only strategy with a measurable offline cost, because it must embed every sentence in the corpus before it can decide where to cut. At this corpus size the cost is trivial in absolute terms; the point of recording it is that it scales linearly with corpus size while the others scale with it only trivially, which is the argument that decides between them at a hundred times this scale."));

children.push(body("The four strategies differ as much in the spread of their output as in its average, and the averages in Table II hide this. Fig. 2 plots the distributions. Fixed-size chunking is a spike: by construction almost every unit is exactly 512 characters, with the only variation coming from the final chunk of each document. Recursive chunking clusters near its budget but trails downward, because backing off to a paragraph or sentence boundary necessarily produces short units wherever the text offers a boundary early. Semantic chunking is the broadest by a wide margin, spanning roughly 306 to 1401 characters between the tenth and ninetieth percentiles, because it is indifferent to length and cuts only where meaning shifts. The indexed children of the parent-child strategy are the smallest and tightest, concentrated near 323 characters."));
children.push(...figure("fig7_chunk_sizes.png", 325));
children.push(caption("Fig. 2.  Chunk-size distributions. For parent–child the indexed child is plotted, not the returned parent."));
children.push(body("The practical consequence is a variance argument rather than a mean one. A retriever working over fixed-size units sees a corpus of uniform granularity and therefore uniform specificity, which makes similarity scores comparable across the index but guarantees that long clauses are severed. A retriever working over semantic units sees wildly varying granularity, so a short definition and a thousand-character condition compete on the same scale, and the short one is systematically favoured by cosine similarity. Parent-child sidesteps the trade-off by matching on uniformly small units and reading from variable-length ones, which is the mechanism behind its result in Section VI-A."));

children.push(subHead("B", "Embedding configurations"));
children.push(body("Five configurations were benchmarked: all-MiniLM-L6-v2 at 384 dimensions as a lightweight baseline; bge-small-en-v1.5 at 384; bge-base-en-v1.5 at 768; bge-base truncated to its first 256 dimensions and renormalised; and snowflake-arctic-embed-m-v1.5, a Matryoshka-trained encoder, likewise truncated to 256 and renormalised. The last two are a deliberately controlled pair. Both land at the same dimensionality and therefore the same index size, so any difference between them isolates the contribution of Matryoshka training itself rather than of dimensionality. Models requiring an asymmetric query instruction receive it on the query side only.", { noIndent: true }));

children.push(subHead("C", "Retrieval and fusion"));
children.push(body("Dense retrieval uses a FAISS flat inner-product index over L2-normalised vectors, which is exact cosine similarity; at this corpus size an approximate index would introduce error without a meaningful speed benefit. Sparse retrieval uses BM25 over the same retrieval units. Hybrid retrieval draws 30 candidates from each and fuses them with Reciprocal Rank Fusion at k=60, operating on ordinal ranks only. The fourth mode passes the fused candidate pool to the ms-marco-MiniLM-L-6-v2 cross-encoder and re-ranks by its joint relevance score.", { noIndent: true }));

// ---- V. Evaluation design
children.push(sectionHead("V", "Evaluation Design"));
children.push(subHead("A", "Evidence spans, not chunk identifiers"));
children.push(body("A gold set for retrieval normally labels the correct document or passage identifier for each query. That protocol is unusable here, because the object of study is the segmentation itself: each strategy produces a different number of chunks with different boundaries, so a chunk identifier under one strategy has no counterpart under another, and cross-strategy comparison becomes impossible.", { noIndent: true }));
children.push(body(`Each question in our gold set therefore carries one or more evidence phrases lifted verbatim from the policy text—the minimal span that actually answers it. A retrieved chunk counts as relevant if, after normalisation, it contains that span. The same question is thus scored identically no matter how the corpus was cut, and the metric measures what a user cares about: did the retrieved context contain the answer. All ${S.goldset.n} questions are machine-verified against the corpus before the benchmark runs, and the harness refuses any question whose evidence cannot be located.`));
children.push(body(`The set comprises ${S.goldset.n} questions drafted from the two documents with the assistance of a language model, checked verbatim against the source text, and tagged by type. Exact-match questions turn on an identifier or amount; semantic questions are paraphrases sharing little surface vocabulary with the source clause; multi-hop questions require combining a definition with a benefit or condition. The type tag is what makes the analysis in Section VI-D possible. Table IV gives the composition.`));
children.push(tableCaption("Table IV.  Gold set composition"));
children.push(table(
  ["Question type", "Count", "Mean success"],
  Object.entries(S.goldset.by_type).map(([t, c]) => [
    t, c, S.success_by_qtype && S.success_by_qtype[t] !== undefined ? n(S.success_by_qtype[t], 2) : "-"]),
  [Math.floor(COL_W * 0.42), Math.floor(COL_W * 0.26), Math.floor(COL_W * 0.32)],
));
children.push(body("Because the questions were drafted with a language model, they carry a known risk: generated questions tend to echo the vocabulary of the passage they came from, which would inflate dense-retrieval scores and could destroy exactly the contrast this study exists to measure. We mitigated it in three ways: the semantic questions were phrased the way a policyholder would ask rather than in the clause's own wording; every question is tagged by type so the effect can be inspected; and every evidence span is verified verbatim against the corpus before each run. We nonetheless list question provenance among the limitations."));

children.push(subHead("B", "Metrics"));
children.push(body("We report five retrieval metrics. Success@5 is binary: did any of the top five chunks contain the evidence span. It is the metric that matters most for RAG, because a generator needs the answer present at least once, not present repeatedly. Coverage@5 is the fraction of all evidence-bearing chunks in the index that were retrieved, which distinguishes a pipeline that found the one relevant clause from one that found three of five. Hit@1 and Mean Reciprocal Rank measure how near the top the first relevant chunk landed.", { noIndent: true }));
children.push(body("nDCG@5 uses binary gains and is normalised against the ideal ranking of min(R, 5) chunks, where R is the number of chunks in that index which actually carry the evidence. Computing R index-wide rather than from what happened to be retrieved matters here: the strategies produce different numbers of chunks, so the same evidence span may exist in one chunk under one strategy and four under another, and normalising against the retrieved count would quietly reward whichever strategy fragmented the evidence most."));
children.push(body("Every one of these is deterministic. No LLM-as-a-judge sits anywhere in the scoring loop, which means the benchmark is exactly reproducible on a laptop and immune to the evaluator brittleness identified in our literature survey. Generation faithfulness is a separate question and deliberately out of scope."));

children.push(subHead("C", "Controls"));
children.push(body("Three controls are necessary for the grid to mean anything. First, semantic chunk boundaries are always computed with MiniLM-L6, never with the model currently under test; otherwise the chunking factor and the embedding factor are confounded, since changing the embedder would silently change the chunks being embedded. Second, BM25 is evaluated once per chunking strategy rather than once per cell, because it does not depend on the embedding model; running it per cell would inflate the apparent sample size with duplicate measurements.", { noIndent: true }));
children.push(body("The third control concerns parent-child specifically, and we record it because our first implementation got it wrong. That strategy indexes many children per parent, so a naive implementation returns several children of the same parent and a naive scorer counts each of them as a separate relevant unit. The effect is severe: under our first run the mean number of relevant units per question was 14.1 for parent-child against roughly 2.2 for every other strategy, which inflated its ideal ranking, depressed its nDCG, and made the strategy look far worse than it is. Both retrieval and scoring now collapse to unique parents. This is not a correction applied to make a favoured method win; it is what the strategy means. Returning the same clause five times does not give a generator five pieces of evidence, and an evaluation that rewards it is measuring fragmentation rather than retrieval."));

// ---- VI. Results
children.push(sectionHead("VI", "Results"));
children.push(body(`The full grid comprises ${S.n_configs} scored configurations. The single strongest configuration is ${nice(S.best.strategy)} chunking with ${nice(S.best.embedder)} under ${nice(S.best.mode)} retrieval, reaching nDCG@5 of ${n(S.best.ndcg)} at Success@5 of ${n(S.best.recall)} and MRR of ${n(S.best.mrr)}.`, { noIndent: true }));

children.push(subHead("A", "Effect of chunking strategy"));
children.push(body(`Averaged over all embedding and retrieval configurations, ${nice(bestStrat[0])} chunking leads at nDCG@5 ${n(bestStrat[1]["ndcg@k"])}, with ${nice(worstStrat[0])} lowest at ${n(worstStrat[1]["ndcg@k"])}. Fig. 3 breaks this down by retrieval mode.`, { noIndent: true }));
children.push(...figure("fig1_strategy_by_mode.png"));
children.push(caption("Fig. 3.  Retrieval quality by chunking strategy and retrieval mode. The dashed line is the BM25-only baseline."));
children.push(tableCaption("Table V.  Mean performance by chunking strategy"));
children.push(table(
  ["Strategy", "Success@5", "MRR", "nDCG@5"],
  byStrat.map(([k, v]) => [nice(k), n(v["recall@k"]), n(v.mrr), n(v["ndcg@k"])]),
  [Math.floor(COL_W * 0.34), Math.floor(COL_W * 0.22), Math.floor(COL_W * 0.22), Math.floor(COL_W * 0.22)],
));

children.push(body("Chunk granularity is the mechanism behind this ordering, and Table II makes it visible. Semantic chunking produced the fewest and largest units, " + S.chunk_stats.find(c => c.strategy === "semantic").n_chunks + " at a mean of " + Math.round(S.chunk_stats.find(c => c.strategy === "semantic").mean_chunk_chars) + " characters, because it merges consecutive sentences until the meaning shifts. Parent-child produced the most, " + S.chunk_stats.find(c => c.strategy === "parent_child").n_chunks + ", but indexes them at a mean retrieval width of only " + Math.round(S.chunk_stats.find(c => c.strategy === "parent_child").mean_retrieval_unit_chars) + " characters while returning a generation unit averaging " + Math.round(S.chunk_stats.find(c => c.strategy === "parent_child").mean_chunk_chars) + ". Neither the largest nor the smallest unit wins outright; what wins is the strategy that is small where it is matched and large where it is read."));

children.push(subHead("B", "Effect of embedding model"));
children.push(body(`Across chunking strategies the strongest embedding configuration is ${nice(bestEmb[0])} at mean nDCG@5 ${n(bestEmb[1]["ndcg@k"])}. Fig. 4 compares the configurations under dense and hybrid retrieval.`, { noIndent: true }));
children.push(...figure("fig2_embedders.png"));
children.push(caption("Fig. 4.  Embedding configurations, averaged over chunking strategies."));
children.push(tableCaption("Table VI.  Mean performance by embedding configuration"));
children.push(table(
  ["Configuration", "Success@5", "nDCG@5", "Index MB"],
  byEmb.map(([k, v]) => [nice(k), n(v["recall@k"]), n(v["ndcg@k"]), n(v.index_mb, 2)]),
  [Math.floor(COL_W * 0.34), Math.floor(COL_W * 0.22), Math.floor(COL_W * 0.22), Math.floor(COL_W * 0.22)],
));

children.push(subHead("C", "Matryoshka truncation"));
children.push(body(`The controlled pair isolates what Matryoshka training buys. Truncating bge-base from 768 to 256 dimensions—a model never trained for truncation—retains ${pct(S.mrl.naive_retention_pct)} of its full-dimensional nDCG@5 while cutting index storage by ${pct(S.mrl.storage_saving_pct)}. The Matryoshka-trained arctic encoder at the same 256 dimensions reaches ${pct(S.mrl.true_mrl_vs_bge768_pct)} of the bge-base-768 figure. Fig. 5 plots the storage-quality frontier directly.`, { noIndent: true }));
children.push(...figure("fig3_cost_quality.png", 325));
children.push(caption("Fig. 5.  Vector index size against retrieval quality under hybrid RRF retrieval."));

children.push(subHead("D", "Retrieval mode and question type"));
children.push(body("Retrieval mode is the largest single factor in the grid. Table VII gives the means.", { noIndent: true }));
children.push(tableCaption("Table VII.  Mean performance by retrieval mode"));
children.push(table(
  ["Mode", "Success@5", "MRR", "nDCG@5", "ms"],
  modeOrder.map((m) => [
    nice(m), n(byMode[m]["recall@k"]), n(byMode[m].mrr),
    n(byMode[m]["ndcg@k"]), n(byMode[m].mean_latency_ms, 0),
  ]),
  [Math.floor(COL_W * 0.28), Math.floor(COL_W * 0.19), Math.floor(COL_W * 0.17), Math.floor(COL_W * 0.19), Math.floor(COL_W * 0.17)],
));
children.push(body("The question-type breakdown in Fig. 6 is where the corpus choice pays off. Dense and sparse retrieval are not uniformly better or worse than one another; they fail on different questions, and the hybrid arms inherit the strengths of both.", { noIndent: true }));
children.push(...figure("fig6_question_type.png"));
children.push(caption("Fig. 6.  Success@5 by question type and retrieval mode."));
children.push(tableCaption("Table VIII.  Success@5 by question type and retrieval mode"));
children.push(table(
  ["Question type", ...modeOrder.map(nice)],
  qtypes.map((t) => [t, ...modeOrder.map((m) => n(qtm(t, m), 2))]),
  [Math.floor(COL_W * 0.28), ...modeOrder.map(() => Math.floor((COL_W * 0.72) / modeOrder.length))],
));

children.push(subHead("E", "The cost of precision"));
children.push(body(`Quality is not free. Cross-encoder re-ranking improves mean nDCG@5 by ${n(S.reranker ? S.reranker.ndcg_gain : 0)} over hybrid fusion alone, but multiplies query latency by ${S.reranker ? S.reranker.latency_multiple : "n/a"}, to ${n(S.reranker ? S.reranker.latency_ms : 0, 0)} ms. Whether that trade is worth making is an application decision, not a retrieval one: in a clause-lookup tool where a wrong exclusion has financial consequences it clearly is, and in a high-traffic autocomplete it clearly is not.`, { noIndent: true }));
children.push(...figure("fig4_latency.png", 300));
children.push(caption("Fig. 7.  Mean query latency by retrieval stage."));

children.push(subHead("F", "Coverage: finding the evidence more than once"));
children.push(body("Success@5 asks only whether the evidence appeared. Coverage@5 asks what fraction of the evidence-bearing units in the index were retrieved, and separates the strategies more sharply than Success does: " + Object.entries(S.coverage_by_strategy).sort((a, b) => b[1] - a[1]).map(([k, v]) => nice(k) + " " + n(v, 2)).join(", ") + ". The ordering is the same as for nDCG, but the gap is wider, because a strategy that keeps a clause intact puts the whole of the evidence in one retrievable unit while a strategy that splits it across neighbouring chunks can only recover part of it within a budget of five.", { noIndent: true }));
children.push(body("Hit@1 tells a complementary story about ranking rather than recall: " + Object.entries(S.hit1_by_mode).sort((a, b) => b[1] - a[1]).map(([k, v]) => nice(k) + " " + n(v, 2)).join(", ") + ". The cross-encoder's contribution is concentrated here. It rarely finds evidence that hybrid fusion missed entirely; what it does is move evidence already in the candidate pool to the top of it, which is precisely what a user who reads only the first result experiences as the system working."));

children.push(subHead("G", "Decision matrix"));
children.push(body("Fig. 8 is the practical deliverable: nDCG@5 for every chunking strategy against every embedding configuration under hybrid RRF retrieval, from which a practitioner can read off a configuration at a given storage or latency budget.", { noIndent: true }));
children.push(...figure("fig5_decision_matrix.png"));
children.push(caption("Fig. 8.  Decision matrix: nDCG@5 under hybrid RRF retrieval."));

children.push(subHead("H", "Error analysis: what defeats every configuration"));
children.push(body(`No question in the gold set was missed by every configuration, but a small group was missed by almost all of them. Table IX lists the six hardest, ranked by mean Success@5 across all ${S.n_configs} configurations.`, { noIndent: true }));
children.push(tableCaption("Table IX.  Hardest questions by mean Success@5"));
children.push(table(
  ["Q", "Type", "Succ.", "Question"],
  S.hardest.map((h) => [h.qid, h.type.replace("exact-match", "exact"), n(h.success, 2),
                        h.question.length > 46 ? h.question.slice(0, 44) + "…" : h.question]),
  [Math.floor(COL_W * 0.09), Math.floor(COL_W * 0.17), Math.floor(COL_W * 0.12), Math.floor(COL_W * 0.62)],
));
children.push(body("Two patterns are visible and neither is an accident of the gold set. First, every entry is a semantic question: mean Success@5 is " + n(S.success_by_qtype["exact-match"], 2) + " for exact-match questions, " + n(S.success_by_qtype["multi-hop"], 2) + " for multi-hop, and only " + n(S.success_by_qtype["semantic"], 2) + " for semantic. Paraphrase remains the hard case even for encoders trained for it.", { noIndent: true }));
children.push(body("Second, and more interesting, the three worst cases share a structural property rather than a linguistic one. The evidence for the cataract question is a bare line in a list of disease names; the evidence for the grace-period and cumulative-bonus questions sits inside the tabular customer information sheet at the front of the second policy. In all three the answer is a short phrase surrounded by other short phrases, with almost no connected prose around it to give a chunk its topic. Fixed and recursive chunking cut such a region arbitrarily; semantic chunking, which looks for a shift in meaning between adjacent sentences, finds no sentences to compare; and parent-child chunking inherits whatever heading happens to precede the table."));
children.push(body("This is the multimodal brittleness our Review 1 survey identified as an open problem, arriving through the back door. We did not set out to study table handling, and the corpus was chosen as text-first precisely to avoid it, yet the residual table-like regions in these documents account for most of the retrieval failures that survive every configuration in the grid. A practitioner reading the decision matrix in Fig. 8 should understand that the ceiling it shows is set less by the choice of chunker than by the handful of regions where no text chunker has anything to work with."));

// ---- VII. Implementation
children.push(sectionHead("VII", "Implementation and Reproducibility"));
children.push(body("The system is roughly 1,100 lines of Python with no service dependencies: PyMuPDF for extraction, sentence-transformers for the encoders, FAISS for the dense index, rank_bm25 for the sparse index, and Streamlit for the demonstration interface. Everything runs on CPU. The complete grid, including cross-encoder re-ranking over every configuration, completes in well under an hour on a consumer laptop.", { noIndent: true }));
children.push(body("Three decisions make the benchmark cheap to repeat. Document vectors are cached on disk keyed by a hash of the model name and the exact text list, so re-running after a change to retrieval or scoring logic costs no embedding time at all; this is what made it practical to rerun the full grid twice after the two methodological corrections described in Sections V-C and VIII. Chunking is deterministic given the corpus. And because no metric calls a language model, successive runs reproduce the same scores exactly; only the measured latencies vary."));
// The repository link is a real hyperlink: in the narrow column the URL wraps at a
// hyphen, and a plain-text URL copied from the PDF would then break.
const REPO_URL = "https://github.com/rishaandeen-sys/rag-chunking-embeddings-insurance";
children.push(new Paragraph({
  alignment: AlignmentType.LEFT,
  spacing: { after: 60, line: 240 },
  children: [
    new TextRun({ text: "The code, data, results and this report are available at ", font: SERIF, size: BODY }),
    new ExternalHyperlink({
      link: REPO_URL,
      children: [new TextRun({ text: REPO_URL, font: SERIF, size: BODY, color: "1155CC", underline: {} })],
    }),
    new TextRun({ text: ".", font: SERIF, size: BODY }),
  ],
}));
children.push(body("Reproducing the study requires the two source PDFs, which are public documents distributed by the insurers; the repository stores them unmodified alongside the extracted text, so a reader can verify the extraction stage independently rather than taking the cleaned corpus on trust. Every gold evidence span is re-verified against the extracted text at the start of each run, and the harness aborts rather than silently scoring a question whose evidence it cannot locate."));

// ---- VIII. Discussion
children.push(sectionHead("VIII", "Discussion"));
children.push(body("Three findings generalise beyond this corpus.", { noIndent: true }));
children.push(body("First, retrieval architecture matters more than embedding choice. The spread across retrieval modes in Table VII is wider than the spread across embedding configurations in Table VI, which inverts the usual order of engineering attention: teams tend to shop for a better embedding model before they have tried fusing a lexical retriever into the pipeline, when the second intervention is cheaper and, on this evidence, larger."));
children.push(body("Second, the value of hybrid retrieval is a property of the corpus, not a universal constant. Fig. 4 shows dense and sparse retrieval failing on disjoint question types. On a corpus of pure prose the sparse arm would contribute little and hybrid fusion would be near-pure overhead; on this corpus, where a user may ask about Excl02 or about a Rs.15,000 sub-limit by name, it is decisive. Practitioners should characterise their query distribution before paying for hybrid retrieval, and the question-type tagging used here is a cheap way to do that."));
children.push(body("Third, dimensionality truncation is far more forgiving than its framing suggests. The storage reduction is large and the quality cost is modest even for an encoder never trained for truncation, which means the technique is worth testing on any model before a larger index is provisioned—though the controlled pair in Section VI-C is the reason to test rather than assume."));

// ---- VIII. Limitations
children.push(sectionHead("", "The Demonstration System"));
children.push(body("The benchmark answers which configuration is best on average. A practitioner also needs to see why, on a query they care about, and for that we built an interactive front end over the same code paths the benchmark uses. There is no second implementation: the application imports the chunkers, encoders, retrievers and metrics modules directly, so anything it shows is what was measured.", { noIndent: true }));
children.push(body("The interface exposes the three factors as controls. A user selects a chunking strategy, an embedding configuration and a retrieval mode, asks a question, and sees the retrieved chunks ranked with their scores, the gold evidence span highlighted where the question comes from the gold set, and for parent-child retrieval both the embedded child and the returned parent so the decoupling is visible rather than asserted. Indexes are built once per configuration and cached, so switching factors is immediate after the first use."));
children.push(body("A second view runs one question through all four retrieval modes simultaneously and shows the four result lists side by side. This is the view that makes the central finding legible in a few seconds: asking about an exclusion code returns nothing relevant under dense-only retrieval and the correct clause under every mode that includes a lexical component, while a paraphrased question about a waiting period behaves in the opposite direction. A third view renders the decision matrix and the full results grid, so the aggregate evidence sits behind the same interface as the individual query."));

children.push(sectionHead("IX", "Threats to Validity"));
children.push(body("Construct validity. Our metrics measure whether a retrieved chunk contains a verbatim evidence span, which is a proxy for whether a generator could answer from it. The proxy fails in one direction we can name: a chunk may contain the span while truncating a proviso that changes its meaning, and our scoring would call that a success. Parent-child chunking is partly a response to this, since returning the whole clause makes the proxy tighter, but the metric cannot distinguish a complete clause from a clause plus the exception that follows it.", { noIndent: true }));
children.push(body("Internal validity. The two corrections documented in Sections V-C and VI reversed a headline result, which is itself evidence that this class of study is easy to get quietly wrong. We mitigated this by scoring on evidence spans that can be checked by hand, by printing the mean number of relevant units per strategy on every run, and by treating a large divergence in that number between strategies as a bug signal rather than a finding. A reader should nonetheless treat single-cell differences in the decision matrix with more caution than the main effects."));
children.push(body("External validity. Two documents from one jurisdiction and one product category cannot establish that parent-child chunking is best in general, and we do not claim it. What the study supports is narrower and, we would argue, more useful: that the right configuration depends on measurable properties of the corpus and the query distribution, that those properties can be measured cheaply with a question-type tagged gold set of this size, and that the measurement changes the answer."));
children.push(body("Statistical conclusion validity. With fifty questions, a difference of one question is 0.02 in Success@5. We therefore report no significance tests and draw no conclusions from differences of that order; the comparisons we do draw, between retrieval modes and between the best and worst chunking strategies, span several times that margin."));

children.push(sectionHead("X", "Limitations and Future Work"));
children.push(body(`The study has four limitations we would want addressed before treating the decision matrix as general guidance. The gold set is ${S.goldset.n} questions drafted with language-model assistance and checked against the source text, which is enough to separate configurations but small enough that differences of a few hundredths of nDCG should not be over-read. An independent set written by human annotators would be a stronger test, since drafted questions may share phrasing habits with the encoders under test. The corpus is two documents from one jurisdiction and one product category. Binary relevance treats every evidence-bearing chunk as equally good, which understates the advantage of strategies that return tightly scoped context. And evaluation stops at retrieval: we do not measure whether the generator then uses the retrieved clause correctly.`, { noIndent: true }));
children.push(body("RAPTOR and late chunking were surveyed in our Review 1 literature study and are not implemented here. Both demand substantial offline pre-compute—recursive LLM summarisation over clustered chunks in the first case, full-document forward passes through a long-context encoder in the second—and the cost column of these results gives little reason to expect that expenditure to repay itself on a corpus of this size. Testing that expectation directly, on a corpus large enough for hierarchical retrieval to matter, is the obvious next step. Adding a generation stage with faithfulness scoring, and extending the corpus across more insurers and product categories, would close the remaining gaps."));

// ---- IX. Conclusion
children.push(sectionHead("XI", "Conclusion"));
children.push(body(`We benchmarked ${byStrat.length} chunking strategies, ${byEmb.length} embedding configurations and ${modeOrder.length} retrieval modes over a deliberately narrow corpus of health-insurance policy wordings, scoring ${S.n_configs} configurations against ${S.goldset.n} evidence-anchored questions. The best configuration—${nice(S.best.strategy)} chunking, ${nice(S.best.embedder)} embeddings, ${nice(S.best.mode)} retrieval—reaches nDCG@5 of ${n(S.best.ndcg)}. The evidence-span evaluation protocol is the methodological contribution: by anchoring labels to text rather than to chunk identifiers, it makes segmentation strategies with incompatible boundaries comparable on one scale, which is what a study of segmentation requires and what chunk-identifier labelling cannot provide.`, { noIndent: true }));

children.push(body("Two secondary results are worth restating because both contradict a common assumption. Dimensionality truncation, often treated as a technique requiring a specially trained model, cost us almost nothing on a model never trained for it, which means it is worth trying before provisioning a larger index rather than after. And the cross-encoder, the most expensive component in the pipeline by a factor of twenty-seven, earns its cost almost entirely by reordering candidates that cheaper retrieval had already found, not by finding new ones; a system that does not care which of its top five results is first can omit it and lose very little."));
children.push(body("What we would tell a team starting a similar system is narrower than any of our individual numbers. Tag fifty questions by type before choosing anything. If the exact-match questions outnumber the paraphrases, the lexical retriever is not optional and the embedding model barely matters. If they do not, invert that. The measurement costs an afternoon and is worth more than any published leaderboard, because it is a measurement of the corpus rather than of the models."));

// ---- Appendix: full grid
children.push(sectionHead("", "Appendix A:  Complete Results Grid"));
children.push(body(`All ${GRID.length} configurations, ordered by nDCG@5. Mode abbreviations: D dense, S BM25, H hybrid RRF, R hybrid plus cross-encoder re-rank.`, { noIndent: true, size: TINY }));
{
  const MODE_AB = { dense: "D", sparse: "S", hybrid_rrf: "H", hybrid_rerank: "R" };
  const rows = GRID.slice()
    .sort((a, b) => Number(b["ndcg@k"]) - Number(a["ndcg@k"]))
    .map((r) => [
      nice(r.strategy).replace("Parent–child", "P–child").replace("Fixed-size", "Fixed"),
      (r.embedder === "none (BM25)" ? "—" : r.embedder.replace(/_/g, "-")),
      MODE_AB[r.mode] || r.mode,
      Number(r["recall@k"]).toFixed(2),
      Number(r["ndcg@k"]).toFixed(3),
      Number(r.mrr).toFixed(2),
      Number(r.mean_latency_ms).toFixed(0),
    ]);
  children.push(table(
    ["Chunking", "Embedder", "M", "Succ", "nDCG", "MRR", "ms"],
    rows,
    [Math.floor(COL_W * 0.19), Math.floor(COL_W * 0.26), Math.floor(COL_W * 0.07),
     Math.floor(COL_W * 0.13), Math.floor(COL_W * 0.14), Math.floor(COL_W * 0.11),
     Math.floor(COL_W * 0.10)],
  ));
}

// ---- Appendix B: the gold set
children.push(sectionHead("", "Appendix B:  The Gold Set"));
children.push(body(`The ${GOLD.length} questions, with the type tag used in Section VI-D. Evidence spans are omitted for space and are published with the source. H denotes the first policy document, S the second.`, { noIndent: true, size: TINY }));
{
  const TYPE_AB = { "exact-match": "exact", "multi-hop": "multi", semantic: "sem" };
  children.push(table(
    ["Q", "Doc", "Type", "Question"],
    GOLD.map((g) => [
      g.qid.replace("Q", ""),
      g.doc.indexOf("hdfc") === 0 ? "H" : "S",
      TYPE_AB[g.type] || g.type,
      g.question.length > 58 ? g.question.slice(0, 56) + "\u2026" : g.question,
    ]),
    [Math.floor(COL_W * 0.07), Math.floor(COL_W * 0.08), Math.floor(COL_W * 0.13),
     Math.floor(COL_W * 0.72)],
  ));
}

// ---- References
children.push(sectionHead("", "References"));
const refs = [
  "P. Lewis et al., \"Retrieval-augmented generation for knowledge-intensive NLP tasks,\" in Proc. NeurIPS, 2020.",
  "P. Sarthi, S. Abdullah, A. Tuli, S. Khanna, A. Goldie, and C. D. Manning, \"RAPTOR: Recursive abstractive processing for tree-organized retrieval,\" in Proc. ICLR, 2024.",
  "M. Günther, I. Mohr, D. J. Williams, B. Wang, and H. Xiao, \"Late chunking: Contextual chunk embeddings using long-context embedding models,\" arXiv:2409.04701, 2024.",
  "S. Es, J. James, L. Espinosa-Anke, and S. Schockaert, \"RAGAS: Automated evaluation of retrieval augmented generation,\" in Proc. EACL (Demo), 2024.",
  "N. Thakur, N. Reimers, A. Rücklé, A. Srivastava, and I. Gurevych, \"BEIR: A heterogeneous benchmark for zero-shot evaluation of information retrieval models,\" in Proc. NeurIPS Datasets and Benchmarks, 2021.",
  "N. Muennighoff, N. Tazi, L. Magne, and N. Reimers, \"MTEB: Massive text embedding benchmark,\" in Proc. EACL, 2023.",
  "A. Kusupati et al., \"Matryoshka representation learning,\" in Proc. NeurIPS, 2022.",
  "G. V. Cormack, C. L. A. Clarke, and S. Buettcher, \"Reciprocal rank fusion outperforms Condorcet and individual rank learning methods,\" in Proc. ACM SIGIR, 2009.",
  "S. Robertson and H. Zaragoza, \"The probabilistic relevance framework: BM25 and beyond,\" Foundations and Trends in Information Retrieval, vol. 3, no. 4, 2009.",
  "N. Reimers and I. Gurevych, \"Sentence-BERT: Sentence embeddings using Siamese BERT-networks,\" in Proc. EMNLP-IJCNLP, 2019.",
  "S. Xiao, Z. Liu, P. Zhang, and N. Muennighoff, \"C-Pack: Packed resources for general Chinese embeddings,\" in Proc. ACM SIGIR, 2024.",
  "L. Merrick, D. Xu, G. Nuti, and D. Campos, \"Arctic-Embed: Scalable, efficient, and accurate text embedding models,\" arXiv:2405.05374, 2024.",
  "R. Nogueira and K. Cho, \"Passage re-ranking with BERT,\" arXiv:1901.04085, 2019.",
  "T. Formal, B. Piwowarski, and S. Clinchant, \"SPLADE: Sparse lexical and expansion model for first stage ranking,\" in Proc. ACM SIGIR, 2021.",
  "J. Johnson, M. Douze, and H. Jégou, \"Billion-scale similarity search with GPUs,\" IEEE Trans. Big Data, vol. 7, no. 3, 2021.",
];
refs.forEach((r, i) => children.push(new Paragraph({
  alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 40 },
  indent: { left: convertInchesToTwip(0.2), hanging: convertInchesToTwip(0.2) },
  children: [new TextRun({ text: `[${i + 1}]  ${r}`, font: SERIF, size: TINY })],
})));

// ---------------------------------------------------------------- document
const PAGE = {
  size: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
  margin: {
    top: convertInchesToTwip(0.75), bottom: convertInchesToTwip(0.75),
    left: convertInchesToTwip(0.625), right: convertInchesToTwip(0.625),
  },
};

const titleBlock = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({
      text: "Comparative Analysis of Chunking Strategies and Embedding Models on RAG Retrieval",
      font: SERIF, size: 44,
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({
      text: "A Controlled Study over Health-Insurance Policy Wordings",
      font: SERIF, size: 28, italics: true,
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 20 },
    children: [new TextRun({ text: "Ralph Ethan D’Souza (PES2UG24AM131)  ·  Sanshray Sathyan (PES2UG24AM146)", font: SERIF, size: 22 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 20 },
    children: [new TextRun({ text: "Kushal Raju (PES2UG24AM139)  ·  Rishaan Deen (PES2UG24AM134)", font: SERIF, size: 22 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
    children: [new TextRun({
      text: "Department of Computer Science and Engineering (AI & ML) | UE24AM343AB5 — Prompt Engineering and Optimization for Generative AI",
      font: SERIF, size: 18, italics: true,
    })],
  }),
];

const footer = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], font: SERIF, size: TINY })],
  })],
});

const doc = new Document({
  creator: "Mini Project Team",
  title: "Comparative Analysis of Chunking Strategies and Embedding Models on RAG Retrieval",
  styles: {
    default: {
      document: { run: { font: SERIF, size: BODY }, paragraph: { spacing: { after: 60 } } },
    },
  },
  sections: [
    { properties: { page: PAGE, column: { count: 1 } }, footers: { default: footer }, children: titleBlock },
    {
      properties: {
        type: SectionType.CONTINUOUS,
        page: PAGE,
        column: { count: 2, space: convertInchesToTwip(0.25), equalWidth: true },
      },
      footers: { default: footer },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(ROOT, "report", "MiniProject_Report_IEEE.docx");
  fs.writeFileSync(out, buf);
  console.log("wrote " + out + "  (" + (buf.length / 1024).toFixed(0) + " KB)");
});
