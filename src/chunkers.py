"""
chunkers.py - the four segmentation strategies under comparison.

Every chunker returns a list of dicts:
    {"chunk_id", "doc_id", "text", "retrieval_text", "strategy", "n_chars"}

'text'            -> what is handed to the LLM / shown to the user (generation unit)
'retrieval_text'  -> what gets embedded and indexed (retrieval unit)

For every strategy except parent-child these are identical. Parent-child
deliberately decouples them, which is the whole point of that arm.
"""
import re
from typing import List, Dict

import numpy as np

SENT_END = re.compile(r"(?<=[.!?;:])\s+(?=[A-Z0-9\(])|\n{2,}")


def split_sentences(text: str) -> List[str]:
    parts = [p.strip() for p in SENT_END.split(text) if p and p.strip()]
    return [p for p in parts if len(p) > 1]


def _mk(doc_id, strategy, idx, text, retrieval_text=None):
    return {
        "chunk_id": f"{doc_id}::{strategy}::{idx}",
        "doc_id": doc_id,
        "text": text,
        "retrieval_text": retrieval_text if retrieval_text is not None else text,
        "strategy": strategy,
        "n_chars": len(text),
    }


# ---------------------------------------------------------------- 1. fixed
def fixed_size(text: str, doc_id: str, size: int = 512, overlap: int = 64) -> List[Dict]:
    """Character-window chunking. Context-blind baseline."""
    out, i, idx = [], 0, 0
    step = max(1, size - overlap)
    while i < len(text):
        piece = text[i:i + size].strip()
        if piece:
            out.append(_mk(doc_id, "fixed", idx, piece))
            idx += 1
        i += step
    return out


# ------------------------------------------------------------ 2. recursive
def recursive(text: str, doc_id: str, size: int = 512, overlap: int = 64) -> List[Dict]:
    """LangChain-style recursive character splitting on a separator hierarchy."""
    seps = ["\n\n", "\n", ". ", " "]

    def _split(t: str, depth: int = 0) -> List[str]:
        if len(t) <= size:
            return [t]
        if depth >= len(seps):
            return [t[i:i + size] for i in range(0, len(t), size)]
        sep = seps[depth]
        parts, buf, out = t.split(sep), "", []
        for p in parts:
            cand = (buf + sep + p) if buf else p
            if len(cand) <= size:
                buf = cand
            else:
                if buf:
                    out.append(buf)
                buf = p if len(p) <= size else ""
                if len(p) > size:
                    out.extend(_split(p, depth + 1))
        if buf:
            out.append(buf)
        return out

    raw = [c.strip() for c in _split(text) if c.strip()]
    # re-apply overlap between neighbours
    out, idx = [], 0
    for j, c in enumerate(raw):
        if overlap and j > 0:
            c = raw[j - 1][-overlap:] + " " + c
        out.append(_mk(doc_id, "recursive", idx, c.strip()))
        idx += 1
    return out


# ------------------------------------------------------------- 3. semantic
def semantic(text: str, doc_id: str, embed_fn, threshold_pct: int = 90,
             max_chars: int = 1200, min_chars: int = 200) -> List[Dict]:
    """
    Embed sentences, measure cosine distance between neighbours, and cut at
    distance percentile breakpoints (topical shifts). Greene/Kamradt method.
    """
    sents = split_sentences(text)
    if len(sents) < 3:
        return fixed_size(text, doc_id)

    vecs = embed_fn(sents)
    vecs = vecs / (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9)
    sims = np.sum(vecs[:-1] * vecs[1:], axis=1)
    dists = 1.0 - sims
    cut = np.percentile(dists, threshold_pct)

    out, buf, idx = [], [], 0
    for i, s in enumerate(sents):
        buf.append(s)
        cur = " ".join(buf)
        is_break = i < len(dists) and dists[i] >= cut
        if (is_break and len(cur) >= min_chars) or len(cur) >= max_chars:
            out.append(_mk(doc_id, "semantic", idx, cur))
            idx += 1
            buf = []
    if buf:
        out.append(_mk(doc_id, "semantic", idx, " ".join(buf)))
    return out


# --------------------------------------------------------- 4. parent-child
HEADING_RE = re.compile(
    r"^\s*((?:SECTION\s+)?\d+(?:\.\d+)*)\s*[\.\)\-–:]?\s+([A-Z][A-Za-z0-9 ,\-&/\(\)']{3,80})\s*$",
    re.M,
)


def parent_child(text: str, doc_id: str, child_size: int = 320, child_overlap: int = 48,
                 max_parent: int = 2400) -> List[Dict]:
    """
    Split on clause headings into parents; embed small children for precision
    but return the whole parent clause for generation.
    """
    bounds = [m.start() for m in HEADING_RE.finditer(text)]
    if len(bounds) < 3:
        # fall back to paragraph blocks
        blocks, cur = [], ""
        for para in text.split("\n\n"):
            if len(cur) + len(para) > max_parent and cur:
                blocks.append(cur)
                cur = para
            else:
                cur = (cur + "\n\n" + para) if cur else para
        if cur:
            blocks.append(cur)
        parents = blocks
    else:
        bounds = [0] + bounds + [len(text)]
        parents = []
        for a, b in zip(bounds[:-1], bounds[1:]):
            seg = text[a:b].strip()
            if not seg:
                continue
            # oversized clauses get hard-split so a parent stays promptable
            while len(seg) > max_parent:
                parents.append(seg[:max_parent])
                seg = seg[max_parent:]
            if seg:
                parents.append(seg)

    out, idx = [], 0
    step = max(1, child_size - child_overlap)
    for p_i, parent in enumerate(parents):
        parent = parent.strip()
        if not parent:
            continue
        heading = parent.split("\n", 1)[0][:90]
        i = 0
        made = False
        while i < len(parent):
            child = parent[i:i + child_size].strip()
            if child:
                # prepend the clause heading so the child keeps its address
                child_ctx = f"{heading}\n{child}" if not child.startswith(heading) else child
                out.append(_mk(doc_id, "parent_child", idx,
                               text=parent,            # generation unit
                               retrieval_text=child_ctx))  # retrieval unit
                out[-1]["parent_id"] = f"{doc_id}::P{p_i}"
                idx += 1
                made = True
            i += step
        if not made:
            continue
    return out


# Kept short: the sidebar select boxes truncate anything much longer.
STRATEGIES = {
    "fixed": "Fixed-size (512 / 64)",
    "recursive": "Recursive (512 / 64)",
    "semantic": "Semantic (percentile)",
    "parent_child": "Parent-child (320 -> clause)",
}
