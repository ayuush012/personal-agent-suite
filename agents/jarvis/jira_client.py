from __future__ import annotations

from agents.common import env


def jira_configured() -> bool:
    return all([
        env("JIRA_INSTANCE_URL"),
        env("JIRA_SERVICE_ACCOUNT_EMAIL"),
        env("JIRA_API_TOKEN"),
        env("JIRA_PROJECT_KEY"),
    ])


def create_tickets_if_configured(tickets: list[dict]) -> dict:
    if not jira_configured():
        return {
            "created": False,
            "message": "Jira credentials are not configured. Tickets were generated locally and can be exported instead.",
            "keys": [],
        }

    # The public v1 keeps Jira writes explicit. A production adapter can be added
    # here using the user's local credentials from .env.
    return {
        "created": False,
        "message": "Jira credentials were found, but live issue creation is disabled in the demo adapter. Review tickets before enabling writes.",
        "keys": [],
    }

