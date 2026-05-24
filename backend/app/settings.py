from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings


ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "Asgard"
    hosted_demo: bool = True
    frontend_url: str = "http://localhost:5173"
    secret_key: str = "replace_me"

    llm_provider: str = "groq"
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"

    database_url: str = "sqlite+aiosqlite:///./asgard.db"
    redis_url: str = "redis://localhost:6379/0"

    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_api_key: str = ""
    qdrant_collection: str = "asgard_kb"

    jira_instance_url: str = "https://your-domain.atlassian.net"
    jira_api_token: str = ""
    jira_service_account_email: str = ""
    atlassian_client_id: str = ""
    atlassian_client_secret: str = ""
    atlassian_refresh_token: str = ""
    atlassian_cloud_id: str = ""

    figma_client_id: str = ""
    figma_client_secret: str = ""
    figma_service_account_token: str = ""

    google_service_account_json: str = ""
    confluence_instance_url: str = ""

    class Config:
        env_file = (str(ROOT / ".env"), ".env")
        env_file_encoding = "utf-8"


settings = Settings()
