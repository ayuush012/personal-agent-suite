from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_env() -> None:
    """Load .env if python-dotenv is installed; otherwise continue gracefully."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(ROOT / ".env")


def env(name: str, default: str = "") -> str:
    load_env()
    return os.getenv(name, default).strip()


def has_anthropic_key() -> bool:
    return bool(env("ANTHROPIC_API_KEY"))


def output_dir() -> Path:
    path = ROOT / "outputs"
    path.mkdir(parents=True, exist_ok=True)
    return path

