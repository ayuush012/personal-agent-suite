from __future__ import annotations

from dataclasses import dataclass, asdict
import re


@dataclass(frozen=True)
class Ticket:
    issue_type: str
    summary: str
    description: str
    acceptance_criteria: list[str]
    priority: str
    labels: list[str]
    story_points: int | None

    def to_dict(self) -> dict:
        return asdict(self)


def generate_tickets(requirements: str) -> list[Ticket]:
    clean = " ".join(requirements.strip().split())
    feature = _feature_name(clean)
    labels = _labels(clean)
    return [
        Ticket(
            issue_type="Epic",
            summary=f"Deliver {feature}",
            description=f"Plan and deliver the {feature.lower()} capability from the provided requirements.",
            acceptance_criteria=[
                "Scope is reviewed and confirmed before implementation starts.",
                "Core user journey is implemented and validated with representative data.",
                "Error, empty, and success states are documented.",
            ],
            priority="High",
            labels=labels,
            story_points=8,
        ),
        Ticket(
            issue_type="Story",
            summary=f"Build user flow for {feature}",
            description="Implement the primary user-facing flow with clear state transitions and accessible copy.",
            acceptance_criteria=[
                "User can complete the happy path without manual intervention.",
                "Validation messages explain how to recover from invalid input.",
                "The flow is usable with keyboard navigation.",
            ],
            priority="High",
            labels=labels,
            story_points=5,
        ),
        Ticket(
            issue_type="Task",
            summary=f"Add export and fallback handling for {feature}",
            description="Provide local export or fallback behavior when optional integrations are not configured.",
            acceptance_criteria=[
                "Missing optional credentials do not block local usage.",
                "The user receives a clear setup message for unavailable integrations.",
                "Generated artifacts are written to a local outputs directory.",
            ],
            priority="Medium",
            labels=labels,
            story_points=3,
        ),
    ]


def _feature_name(text: str) -> str:
    lower = text.lower()
    if "password" in lower and "reset" in lower:
        return "password reset"
    if "onboarding" in lower:
        return "user onboarding"
    if "checkout" in lower:
        return "checkout"
    words = re.findall(r"[A-Za-z][A-Za-z0-9-]+", text)
    return " ".join(words[:3]).lower() if words else "requested feature"


def _labels(text: str) -> list[str]:
    labels = ["ai-generated", "product-workflow"]
    lower = text.lower()
    for term in ("security", "onboarding", "export", "jira", "figma", "mobile"):
        if term in lower:
            labels.append(term)
    return labels

