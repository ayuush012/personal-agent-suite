# Asgard Architecture

Asgard is a small full-stack workflow app:

- React/Vite frontend for the recruiter-facing dashboard.
- FastAPI backend for workflow discovery, run creation, chat, WebSocket events, integrations, and exports.
- Agent modules for Heimdall, Cortana, and Jarvis.
- `agents.common.LLMGateway` as the single model-provider path for hosted Groq and local Anthropic.

Hosted demo mode uses anonymous sessions. Local/self-hosted mode can enable credentials and OAuth integrations through `.env`.

## Runtime Flow

1. User opens Asgard from the portfolio.
2. Frontend creates an anonymous session ID in localStorage.
3. User selects Heimdall, Cortana, or Jarvis.
4. Backend creates a run and opens a WebSocket channel.
5. Chat messages trigger the selected agent.
6. Agent output is sent as chat events and output previews.
7. Jarvis tickets can be exported as CSV or DOCX without Jira credentials.

## Provider Flow

Every LLM-backed agent path should call `LLMGateway`. Hosted deployments use Groq. Local users can set `LLM_PROVIDER=anthropic` if they prefer.
