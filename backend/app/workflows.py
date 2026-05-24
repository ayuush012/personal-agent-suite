from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Workflow:
    id: str
    name: str
    persona_name: str
    description: str
    required: list[str]
    optional: list[str]


WORKFLOWS: dict[str, Workflow] = {
    "heimdall": Workflow(
        id="heimdall",
        name="Router Agent",
        persona_name="Heimdall",
        description="Routes requests to the right specialist and explains the decision.",
        required=["Groq or Anthropic key"],
        optional=[],
    ),
    "cortana": Workflow(
        id="cortana",
        name="Knowledge Retrieval Agent",
        persona_name="Cortana",
        description="Answers questions from sanitized documents with cited sources.",
        required=["Groq or Anthropic key"],
        optional=["Qdrant", "Drive", "Confluence"],
    ),
    "jarvis": Workflow(
        id="jarvis",
        name="PM Ticket Agent",
        persona_name="Jarvis",
        description="Turns requirements into Jira-ready tickets with export fallback.",
        required=["Groq or Anthropic key"],
        optional=["Jira", "Atlassian OAuth", "Figma"],
    ),
}


def workflow_summaries() -> list[dict]:
    return [
        {
            "id": wf.id,
            "name": wf.name,
            "persona_name": wf.persona_name,
            "description": wf.description,
            "owner_teams": ["demo"],
            "execution_pattern": "conversational",
            "step_count": 1,
            "gate_count": 0,
            "integration_deps": wf.optional,
            "required": wf.required,
            "optional": wf.optional,
        }
        for wf in WORKFLOWS.values()
    ]
