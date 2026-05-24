from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable


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


def llm_provider() -> str:
    return env("LLM_PROVIDER", "groq").lower()


def has_groq_key() -> bool:
    return bool(env("GROQ_API_KEY"))


class LLMGateway:
    """Small provider gateway used by every public agent path.

    Network calls are intentionally optional. If no key is configured, agents
    return deterministic demo output instead of asking users for secrets.
    """

    def __init__(self, provider: str | None = None):
        self.provider = (provider or llm_provider()).lower()

    def configured(self) -> bool:
        if self.provider == "groq":
            return has_groq_key()
        if self.provider == "anthropic":
            return has_anthropic_key()
        return False

    async def complete(self, system: str, user: str, *, fallback: str) -> str:
        if not self.configured():
            return fallback
        if self.provider == "groq":
            return await self._groq(system, user, fallback=fallback)
        if self.provider == "anthropic":
            return await self._anthropic(system, user, fallback=fallback)
        return fallback

    async def _groq(self, system: str, user: str, *, fallback: str) -> str:
        try:
            import httpx

            model = env("GROQ_MODEL", "llama-3.3-70b-versatile")
            async with httpx.AsyncClient(timeout=25) as client:
                response = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {env('GROQ_API_KEY')}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "temperature": 0.2,
                    },
                )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
        except Exception as exc:
            return f"{fallback}\n\nLLM provider note: Groq was unavailable for this demo run ({exc})."

    async def _anthropic(self, system: str, user: str, *, fallback: str) -> str:
        try:
            import anthropic

            client = anthropic.AsyncAnthropic(api_key=env("ANTHROPIC_API_KEY"))
            message = await client.messages.create(
                model=env("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
                max_tokens=1200,
                temperature=0.2,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            parts: Iterable[str] = (
                block.text for block in message.content if getattr(block, "type", "") == "text"
            )
            return "\n".join(parts).strip() or fallback
        except Exception as exc:
            return f"{fallback}\n\nLLM provider note: Anthropic was unavailable for this demo run ({exc})."


def output_dir() -> Path:
    path = ROOT / "outputs"
    path.mkdir(parents=True, exist_ok=True)
    return path
