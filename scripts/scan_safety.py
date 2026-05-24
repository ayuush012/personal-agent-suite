from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BLOCKED_TERMS = [
    "pre" + "zent",
    "pre" + "zent.ai",
    "pre" + "zentium",
    "my" + "pre" + "zent",
    "sk" + "-ant-",
]
SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|token|secret|password)[ \t]*=[ \t]*['\"]?([A-Za-z0-9_\-]{12,})"),
]
SKIP_DIRS = {".git", ".venv", "__pycache__", "outputs", "node_modules", "dist"}
PLACEHOLDER_VALUES = {
    "your_groq_key",
    "your_token",
    "replace_me",
    "your-domain",
}


def iter_files():
    for path in ROOT.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file():
            yield path


def main() -> int:
    findings: list[str] = []
    for path in iter_files():
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        lower = text.lower()
        for term in BLOCKED_TERMS:
            if term in lower:
                findings.append(f"{path.relative_to(ROOT)} contains blocked term: {term}")
        for pattern in SECRET_PATTERNS:
            for match in pattern.finditer(text):
                value = match.group(2).strip().strip("'\"")
                if value.lower() in PLACEHOLDER_VALUES or value.lower().startswith("your_"):
                    continue
                findings.append(f"{path.relative_to(ROOT)} may contain a secret-like assignment")

    if findings:
        print("Safety scan failed:")
        for finding in findings:
            print(f"- {finding}")
        return 1

    print("Safety scan passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
