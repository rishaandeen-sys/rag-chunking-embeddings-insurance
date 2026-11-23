"""Curate data/demo_questions.json from the tested candidates.

Keeps only questions whose evidence was found in the corpus AND retrieved in the
top 5 under the demo configuration (parent-child, bge-small, hybrid RRF) as well
as under bge-base hybrid. Order is deliberate: the three questions the
presentation script uses come first, then real-world questions grouped by theme.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
cands = {c["id"]: c for c in json.loads(
    (ROOT / "data" / "demo_candidates.json").read_text(encoding="utf-8"))}

ORDER = [
    # presentation script
    "D01", "D02", "D03",
    # pregnancy and family
    "D04", "D05", "D25",
    # what is excluded
    "D12", "D22", "D11", "D23", "D10",
    # getting to hospital
    "D06", "D07",
    # money
    "D09", "D18", "D17",
    # other benefits
    "D21", "D26",
]

out, problems = [], []
for cid in ORDER:
    c = cands[cid]
    f = c["found"]
    ok = (c["evidence"]
          and f.get("bge_small/hybrid_rrf") is not None
          and f.get("bge_base/hybrid_rrf") is not None)
    if not ok:
        problems.append(cid)
        continue
    out.append({"question": c["question"], "evidence": c["evidence"],
                "match": "any", "type": "real-world"})

if problems:
    raise SystemExit("candidates failed the quality bar: " + ", ".join(problems))

(ROOT / "data" / "demo_questions.json").write_text(
    json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"wrote data/demo_questions.json with {len(out)} questions")
for i, q in enumerate(out, 1):
    print(f"  {i:2}. {q['question']}")
