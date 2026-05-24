from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RouteDecision:
    agent: str
    confidence: str
    reason: str


AGENTS = {
    "jarvis": "Turns requirements, specs, mockups, or feature briefs into Jira-ready tickets.",
    "cortana": "Answers questions from documents and knowledge bases with cited context.",
}


def route_request(request: str) -> RouteDecision:
    text = request.lower()
    ticket_terms = {
        "jira", "ticket", "tickets", "story", "stories", "epic", "task",
        "acceptance criteria", "requirements", "feature brief", "figma", "mockup",
    }
    knowledge_terms = {
        "document", "docs", "knowledge", "policy", "sop", "source", "answer",
        "question", "what does", "where is", "explain", "summarize",
    }

    ticket_score = sum(term in text for term in ticket_terms)
    knowledge_score = sum(term in text for term in knowledge_terms)

    if ticket_score > knowledge_score:
        confidence = "high" if ticket_score >= 2 else "medium"
        return RouteDecision(
            agent="jarvis",
            confidence=confidence,
            reason="The request asks for structured delivery work such as tickets, requirements, or implementation tasks.",
        )

    if knowledge_score > 0:
        confidence = "high" if knowledge_score >= 2 else "medium"
        return RouteDecision(
            agent="cortana",
            confidence=confidence,
            reason="The request asks for an answer grounded in documents or existing knowledge.",
        )

    return RouteDecision(
        agent="jarvis",
        confidence="low",
        reason="No strong signal was found, so the request defaults to the workflow automation agent.",
    )

