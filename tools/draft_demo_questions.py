"""Draft real-world demo questions, verify their evidence, and test retrieval.

These questions are for the demo app only. They are NOT part of the 50-question
benchmark gold set, so the published results are unaffected.

Run:  python tools/draft_demo_questions.py
Writes data/demo_candidates.json with per-question test results.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import chunkers
import embedders
import metrics
from retrievers import Retriever

# (question, evidence phrases - ANY one counts).  Evidence is verbatim policy text.
C = [
    # ---- the three questions the presentation script uses, wording exact ----
    ("How long must I wait before a pre-existing disease is covered?",
     ["expiry of 36 months"]),
    ("What does exclusion code Excl02 cover?",
     ["Excl02"]),
    ("What daily amount is paid for shared accommodation?",
     ["Rs.1,000/- per day"]),

    # ---- real-world, the way a policyholder would actually ask --------------
    ("My wife is expecting. Is maternity covered, and is there a waiting period?",
     ["waiting period of 24 months from the date of first commencement",
      "traceable to childbirth"]),
    ("Will the policy pay for IVF or fertility treatment?",
     ["Excl17", "Assisted Reproduction Treatment"]),
    ("Is an ambulance covered if I am shifted from one hospital to another?",
     ["from one hospital to another hospital"]),
    ("Does the policy cover air ambulance, and up to how much?",
     ["air ambulance service up to 10% of sum insured", "Emergency Air Ambulance"]),
    ("What is the grace period if I forget to renew my policy on time?",
     ["Grace period of 30 days for renewing the policy"]),
    ("Will my claim be cut if I take a room more expensive than my limit?",
     ["Proportionate deduction on Room Rent"]),
    ("Is dental treatment covered?",
     ["Dental Treatment, necessitated due to disease or Injury",
      "cosmetic dental surgeries"]),
    ("Am I covered if I get injured doing adventure sports?",
     ["Hazardous sports, war, terrorism", "participation as a professional in Hazardous"]),
    ("Does the policy pay for cosmetic or plastic surgery?",
     ["unless for reconstruction following an Accident", "cosmetic surgery & plastic surgery"]),
    ("Am I covered if I need treatment abroad?",
     ["Treatment outside India", "medical treatment overseas"]),
    ("Are my tests and medicines before hospital admission covered?",
     ["incurred upto 60 days", "up to 60 days prior to hospitalization"]),
    ("How long after I leave hospital are my follow-up expenses covered?",
     ["incurred upto 180 days", "up to 180 days after discharge from the hospital"]),
    ("Can I get treated at home instead of going to a hospital?",
     ["Home care treatment - Payable up to 10% of the sum insured",
      "given treatment at Home"]),
    ("Do I get any bonus for not making a claim?",
     ["25% of the Sum Insured for each claim free year", "50% of the Base Sum"]),
    ("Do I have to pay a share of every claim myself?",
     ["10% of each and every claim amount"]),
    ("What happens if I use up my whole sum insured in one year?",
     ["restoration of sum insured for unlimited number of", "Automatic Restore Benefit"]),
    ("Does the policy cover Ayurvedic or homeopathic treatment?",
     ["AYUSH Hospital is payable up to the sum insured",
      "AYUSH Treatment refers to the medical"]),
    ("Can I get a second doctor's opinion on my diagnosis?",
     ["Second Medical Opinion from a Doctor", "E Opinion for Critical Illness"]),
    ("Will the policy pay for weight loss surgery?",
     ["Obesity/Weight control", "surgical treatment of obesity"]),
    ("Are injuries caused by alcohol or substance abuse covered?",
     ["Substance abuse, self-inflicted injuries"]),
    ("Can I keep renewing this policy for life?",
     ["Lifelong Renewal"]),
    ("Is my newborn baby covered from the day of birth?",
     ["payable from Day 1 of its birth"]),
    ("Will the policy pay for an organ transplant donor's expenses?",
     ["organ transplantation from the Donor to the Recipient"]),
    ("Is a health check-up covered even if I have not made a claim?",
     ["irrespective of claim"]),
    ("How soon after buying the policy can I make a claim for an illness?",
     ["within 30 days from the first Policy commencement"]),
    ("Does the policy cover treatment that does not need an overnight stay?",
     ["All Day Care Procedures are covered", "All Day Care Treatments"]),
    ("Does the policy pay for treatment of HIV?",
     ["HIV due to blood transfusion"]),
]

# ---------------------------------------------------------------- verification
docs = {f.stem: f.read_text(encoding="utf-8")
        for f in sorted((ROOT / "corpus" / "text").glob("*.txt"))}
normed = {k: metrics.norm(v) for k, v in docs.items()}

entries = []
for i, (q, ev) in enumerate(C, 1):
    present = [e for e in ev if any(metrics.norm(e) in t for t in normed.values())]
    entries.append({"id": f"D{i:02d}", "question": q, "evidence": present,
                    "dropped_evidence": [e for e in ev if e not in present],
                    "match": "any", "type": "real-world"})

# --------------------------------------------------------------- retrieval test
chunks = []
for d, t in docs.items():
    chunks += chunkers.parent_child(t, d)

CONFIGS = [("bge_small", "hybrid_rrf"), ("bge_small", "dense"),
           ("bge_small", "sparse"), ("bge_base", "hybrid_rrf"),
           ("bge_base", "dense")]
retr = {}
for emb in {"bge_small", "bge_base"}:
    vecs = embedders.embed(emb, [c["retrieval_text"] for c in chunks], use_cache=True)
    retr[emb] = Retriever(chunks, vecs, embedders.make_query_fn(emb), None)

for e in entries:
    e["found"] = {}
    if not e["evidence"]:
        continue
    for emb, mode in CONFIGS:
        res, _ = retr[emb].retrieve(e["question"], mode, k=5)
        rank = next((i for i, c in enumerate(res, 1) if metrics.is_relevant(c["text"], e)), None)
        e["found"][f"{emb}/{mode}"] = rank

(ROOT / "data" / "demo_candidates.json").write_text(
    json.dumps(entries, indent=1, ensure_ascii=False), encoding="utf-8")

print(f"{'id':4} {'sm-hyb':>6} {'sm-den':>6} {'sm-spa':>6} {'bs-hyb':>6} {'bs-den':>6}  question")
for e in entries:
    f = e["found"]
    cell = lambda k: ("-" if f.get(k) is None else str(f[k])).rjust(6)
    flag = "" if e["evidence"] else "  <-- NO EVIDENCE FOUND IN CORPUS"
    if e["dropped_evidence"]:
        flag += "  (dropped phrases: " + "; ".join(e["dropped_evidence"]) + ")"
    print(f"{e['id']:4} {cell('bge_small/hybrid_rrf')} {cell('bge_small/dense')} "
          f"{cell('bge_small/sparse')} {cell('bge_base/hybrid_rrf')} "
          f"{cell('bge_base/dense')}  {e['question'][:60]}{flag}")
print("\ncolumns = rank at which the evidence appeared in the top 5 ('-' = missed)")
