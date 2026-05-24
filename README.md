# Personal Agent Suite

Three local-first AI agents packaged as a recruiter-friendly personal project.

- **Heimdall** routes a request to the best available specialist agent.
- **Cortana** answers questions from a local documentation set.
- **Jarvis** turns product or engineering requirements into Jira-ready tickets, with CSV/DOCX export and optional Jira creation.

This repository is intentionally clean: no internal company branding, no proprietary datasets, no generated outputs, no credentials, and no private deployment assumptions.

## Quick Start

```bash
git clone https://github.com/ayuush012/personal-agent-suite.git
cd personal-agent-suite
cp .env.example .env
pip install -r requirements.txt
python -m agents.jarvis --demo
```

Real LLM-backed runs require your own `ANTHROPIC_API_KEY` in `.env`. Optional integrations, such as Jira, Figma, Qdrant, Google Drive, or Confluence, are enabled only when you provide your own credentials locally.

## Agents

| Agent | Run | Required | Optional |
| --- | --- | --- | --- |
| Heimdall | `python -m agents.heimdall --demo` | `ANTHROPIC_API_KEY` for real routing | none |
| Cortana | `python -m agents.cortana --demo` | `ANTHROPIC_API_KEY` for real synthesis | `QDRANT_*`, Drive, Confluence |
| Jarvis | `python -m agents.jarvis --demo` | `ANTHROPIC_API_KEY` for real generation | Jira/Atlassian, Figma |

## Local Credential Model

Credentials stay on your machine in `.env`. The public demo does not ask for, transmit, or store API keys.

Jarvis has a credential-light path: when Jira credentials are missing, it still generates tickets and exports CSV/DOCX files locally.

## Example Commands

```bash
python -m agents.heimdall --request "Turn this feature brief into Jira tickets"
python -m agents.cortana --question "What does the onboarding guide recommend?"
python -m agents.jarvis --input samples/requirements/password_reset.md --export csv
```

## Repository Shape

```text
agents/
  heimdall/   request router
  cortana/    local document Q&A
  jarvis/     requirements-to-ticket workflow
samples/
  docs/       sanitized knowledge examples
  requirements/ sanitized feature briefs
scripts/
  scan_safety.py
```

## Safety

Before publishing or syncing an upstream enhancement, run:

```bash
python scripts/scan_safety.py
```

That scan checks for internal brand terms, private domains, and common secret patterns.

