"""
ingest.py - PDF -> cleaned, section-tagged plain text.

Corpus: Indian retail health-insurance policy wordings.
We keep section headings inline (as markers) because the downstream
parent-child chunker uses them as natural parent boundaries.
"""
import re
import json
from pathlib import Path

import fitz  # PyMuPDF

RAW_DIR = Path(__file__).resolve().parents[1] / "corpus" / "raw"
OUT_DIR = Path(__file__).resolve().parents[1] / "corpus" / "text"

# Lines that are pure page furniture in these policy PDFs.
NOISE_PATTERNS = [
    r"^\s*page\s+\d+\s*(of\s+\d+)?\s*$",
    r"^\s*\d+\s*$",
    r"^\s*UIN\s*[:\-]",
    r"^\s*IRDAI?\s+Reg(n|istration)?\.?\s*No",
    r"^\s*Toll\s*Free",
    r"^\s*www\.\S+\s*$",
    r"^\s*CIN\s*[:\-]",
]
NOISE_RE = [re.compile(p, re.I) for p in NOISE_PATTERNS]

# Numbered clause headings, e.g. "4.2 Specific Waiting Period" / "SECTION 3 - BENEFITS"
HEADING_RE = re.compile(
    r"^\s*((?:SECTION\s+)?\d+(?:\.\d+)*)\s*[\.\)\-–:]?\s+([A-Z][A-Za-z0-9 ,\-&/\(\)']{3,80})\s*$"
)
CAPS_HEADING_RE = re.compile(r"^\s*([A-Z][A-Z \-&/,\.']{6,80})\s*$")


def is_noise(line: str) -> bool:
    return any(rx.search(line) for rx in NOISE_RE)


def dehyphenate(text: str) -> str:
    # join words broken across line ends: "hospi-\ntalisation" -> "hospitalisation"
    return re.sub(r"(\w)-\n(\w)", r"\1\2", text)


def extract(pdf_path: Path) -> str:
    doc = fitz.open(pdf_path)
    pages = []
    for page in doc:
        pages.append(page.get_text("text"))
    doc.close()
    raw = "\n".join(pages)
    raw = dehyphenate(raw)

    out_lines = []
    for line in raw.split("\n"):
        line = line.replace("\xa0", " ").rstrip()
        if not line.strip():
            out_lines.append("")
            continue
        if is_noise(line):
            continue
        out_lines.append(line)

    # collapse >2 blank lines
    text = "\n".join(out_lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def tag_sections(text: str):
    """Return (tagged_text, sections) where sections = [{'heading','start','end'}]."""
    lines = text.split("\n")
    sections = []
    for i, line in enumerate(lines):
        m = HEADING_RE.match(line)
        if m:
            sections.append({"line": i, "number": m.group(1), "heading": m.group(2).strip()})
            continue
        m2 = CAPS_HEADING_RE.match(line)
        if m2 and len(line.split()) <= 10:
            sections.append({"line": i, "number": "", "heading": m2.group(1).strip()})
    return sections


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    for pdf in sorted(RAW_DIR.glob("*.pdf")):
        text = extract(pdf)
        secs = tag_sections(text)
        out = OUT_DIR / (pdf.stem + ".txt")
        out.write_text(text, encoding="utf-8")
        manifest.append({
            "doc_id": pdf.stem,
            "source_pdf": pdf.name,
            "chars": len(text),
            "words": len(text.split()),
            "sections_detected": len(secs),
            "text_file": str(out.relative_to(OUT_DIR.parents[1])),
        })
        print(f"{pdf.stem:28} {len(text):>8,} chars  {len(text.split()):>7,} words  "
              f"{len(secs):>4} headings")
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
