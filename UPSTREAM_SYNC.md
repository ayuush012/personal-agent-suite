# Upstream Sync Guide

This public repository is a clean product wrapper, not a direct fork of an internal system.

## Mapping

| Internal source | Public target |
| --- | --- |
| `reqi-agents/supervisor/agent_v2.py` | `agents/jarvis/orchestrator.py` |
| `reqi-agents/agents/ticket_content_generator` | `agents/jarvis/ticket_generator.py` |
| `backend/app/knowledge_base/*` | `agents/cortana/rag.py` |
| `veda-agent/agent.py` | `agents/heimdall/router.py` |
| internal React workflow dashboard | `frontend/src/App.tsx` and dashboard components |
| internal FastAPI workflow API | `backend/main.py` and `backend/app/*` |

## Sync Checklist

For each future enhancement:

1. Confirm the change is generic and non-proprietary.
2. Remove internal URLs, auth assumptions, private data, and defaults.
3. Adapt configuration to `.env.example`.
4. Route all model calls through `agents.common.LLMGateway`.
5. Keep credentials local and optional where possible.
6. Rerun `python scripts/scan_safety.py`.
7. Run the frontend build and backend smoke checks.
