from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re


@dataclass(frozen=True)
class Source:
    file_name: str
    score: float
    excerpt: str


def _tokenize(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2}


def load_documents(directory: Path) -> list[tuple[str, str]]:
    docs: list[tuple[str, str]] = []
    for path in sorted(directory.glob("*")):
        if path.suffix.lower() not in {".txt", ".md"}:
            continue
        docs.append((path.name, path.read_text(encoding="utf-8")))
    return docs


def retrieve(question: str, directory: Path, limit: int = 3) -> list[Source]:
    query_terms = _tokenize(question)
    scored: list[Source] = []
    for file_name, content in load_documents(directory):
        content_terms = _tokenize(content)
        overlap = query_terms & content_terms
        if not overlap:
            continue
        score = len(overlap) / max(len(query_terms), 1)
        excerpt = _best_excerpt(content, overlap)
        scored.append(Source(file_name=file_name, score=score, excerpt=excerpt))
    return sorted(scored, key=lambda s: s.score, reverse=True)[:limit]


def answer(question: str, directory: Path) -> dict:
    sources = retrieve(question, directory)
    if not sources:
        return {
            "answer": "I could not find a relevant answer in the local sample documents.",
            "sources": [],
        }

    source_lines = " ".join(source.excerpt for source in sources)
    return {
        "answer": f"Based on the local documents: {source_lines}",
        "sources": [source.__dict__ for source in sources],
    }


def _best_excerpt(content: str, overlap: set[str]) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", content.strip())
    if not sentences:
        return content[:220]
    ranked = sorted(
        sentences,
        key=lambda sentence: len(_tokenize(sentence) & overlap),
        reverse=True,
    )
    return ranked[0][:260]

