from __future__ import annotations

from fastapi import Header


def get_current_demo_user(x_asgard_session: str | None = Header(default=None)) -> dict:
    session_id = x_asgard_session or "demo-session"
    return {
        "email": f"{session_id}@local.asgard",
        "team": "demo",
        "session_id": session_id,
        "auth_mode": "anonymous",
    }
