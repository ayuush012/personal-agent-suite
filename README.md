# Asgard Agent Suite

Asgard is a recruiter-facing, local-first agentic workflow platform for product management work. It preserves the useful shape of a full workflow app: a React dashboard, FastAPI backend, run orchestration, WebSocket updates, agent previews, exports, and optional integrations.

- **Heimdall** routes a request to the best available specialist agent.
- **Cortana** answers questions from a local documentation set.
- **Jarvis** turns product or engineering requirements into Jira-ready tickets, with CSV/DOCX export and optional Jira creation.

This repository is intentionally clean: no internal company branding, no proprietary datasets, no generated outputs, no credentials, and no private deployment assumptions. The hosted demo does not ask recruiters for credentials.

## Quick Start

```bash
git clone https://github.com/ayuush012/personal-agent-suite.git
cd personal-agent-suite
cp .env.example .env
docker compose up --build
```

Open `http://localhost:5173`.

Groq is the default LLM provider:

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_key
GROQ_MODEL=llama-3.3-70b-versatile
```

You can get a free Groq key from `https://console.groq.com/keys`. Local users may switch to Anthropic by setting `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`.

## Agents

| Agent | Hosted demo | Local optional integrations |
| --- | --- | --- |
| Heimdall | Routes sample or user prompts | none |
| Cortana | Answers from sanitized sample docs | Qdrant, Drive, Confluence |
| Jarvis | Generates tickets and exports CSV/DOCX | Jira, Atlassian OAuth, Figma |

## Local Credential Model

Credentials stay on your machine in `.env`. The public hosted demo does not ask for, transmit, or store visitor API keys.

Jarvis has a credential-light path: when Jira credentials are missing, it still generates tickets and exports CSV/DOCX files locally.

## Manual Dev Mode

```bash
cd backend
pip install -r ../requirements.txt
uvicorn main:app --reload

cd frontend
npm install
npm run dev
```

## Repository Shape

```text
backend/     FastAPI app, anonymous demo auth, workflow APIs, WebSocket events
frontend/    React/Vite Asgard dashboard
agents/
  heimdall/  request router
  cortana/   local document Q&A
  jarvis/    requirements-to-ticket workflow
docs/        setup, deployment, OAuth, Groq, architecture notes
samples/     sanitized docs and requirements
scripts/
  scan_safety.py
```

## Safety

Before publishing or syncing an upstream enhancement, run:

```bash
python scripts/scan_safety.py
```

That scan checks for internal brand terms, private domains, and common secret patterns.
