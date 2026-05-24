from __future__ import annotations

import argparse
from pathlib import Path

from agents.common import ROOT
from .rag import answer


def main() -> None:
    parser = argparse.ArgumentParser(description="Cortana local document Q&A")
    parser.add_argument("--question", default="", help="Question to answer")
    parser.add_argument("--docs", default=str(ROOT / "samples" / "docs"), help="Directory of .md/.txt docs")
    parser.add_argument("--demo", action="store_true", help="Run a sanitized demo question")
    args = parser.parse_args()

    question = args.question
    if args.demo or not question:
        question = "What should the agent do when optional Jira credentials are missing?"

    result = answer(question, Path(args.docs))
    print("Cortana answer")
    print(f"Question: {question}")
    print(result["answer"])
    if result["sources"]:
        print("\nSources:")
        for source in result["sources"]:
            print(f"- {source['file_name']} ({source['score']:.0%})")


if __name__ == "__main__":
    main()

