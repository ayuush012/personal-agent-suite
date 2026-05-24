# Upstream Sync Guide

This public repository is a clean product wrapper, not a direct fork of an internal system.

## Mapping

| Internal source | Public target |
| --- | --- |
| `reqi-agents/supervisor/agent_v2.py` | `agents/jarvis/orchestrator.py` |
| `reqi-agents/agents/ticket_content_generator` | `agents/jarvis/ticket_generator.py` |
| `backend/app/knowledge_base/*` | `agents/cortana/rag.py` |
| `veda-agent/agent.py` | `agents/heimdall/router.py` |

## Sync Checklist

For each future enhancement:

1. Confirm the change is generic and non-proprietary.
2. Remove internal URLs, auth assumptions, private data, and defaults.
3. Adapt configuration to `.env.example`.
4. Keep credentials local and optional where possible.
5. Rerun `python scripts/scan_safety.py`.
6. Run the demo commands for Heimdall, Cortana, and Jarvis.

