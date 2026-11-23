"""
run_all.py - rebuild everything end to end.

    python run_all.py            # full pipeline
    python run_all.py --skip-bench   # reuse results, regenerate figures/report/deck

Each stage is idempotent; embeddings are cached under data/vec_cache/.
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = str(ROOT / ".venv" / "Scripts" / "python.exe")
if not Path(PY).exists():
    PY = sys.executable


def run(desc, cmd, cwd=ROOT):
    print(f"\n{'=' * 70}\n  {desc}\n{'=' * 70}")
    r = subprocess.run(cmd, cwd=str(cwd), shell=False)
    if r.returncode != 0:
        print(f"\n!! stage failed: {desc}  (exit {r.returncode})")
        sys.exit(r.returncode)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-bench", action="store_true",
                    help="reuse results/benchmark_results.csv")
    ap.add_argument("--skip-deck", action="store_true",
                    help="do not rebuild the slides (they need a local theme helper that "
                         "is not part of the repository; the finished deck is committed)")
    args = ap.parse_args()

    run("1/6  Extract policy PDFs to text", [PY, "src/ingest.py"])
    if not args.skip_bench:
        run("2/6  Benchmark grid (this is the slow one)", [PY, "src/benchmark.py"])
    run("3/6  Summarise results", [PY, "src/summarise.py"])
    run("4/6  Render figures", [PY, "src/figures.py"])
    run("5/6  Chunk-size figure", [PY, "tools/chunk_size_fig.py"])
    run("6/6  Build IEEE report", ["node", "report/build_report.js"])
    if not args.skip_deck:
        run("6/6  Build Review 3 deck", ["node", "deck/build_deck.js"])

    print("\n" + "=" * 70)
    print("  Done. Artefacts:")
    for p in ["results/benchmark_results.csv", "results/summary.json",
              "report/MiniProject_Report_IEEE.docx",
              "deck/RAG_Chunking_Embeddings_Review3.pptx"]:
        f = ROOT / p
        print(f"   {'OK ' if f.exists() else 'MISSING '} {p}")
    print("\n  Demo:  streamlit run app.py")
    print("=" * 70)


if __name__ == "__main__":
    main()
