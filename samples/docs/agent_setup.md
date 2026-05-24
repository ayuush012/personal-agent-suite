# Agent Setup Guide

The Personal Agent Suite is local-first. Users clone the repository, copy `.env.example` to `.env`, and add their own credentials locally.

Jarvis can generate and export tickets with only a language model key. If optional Jira credentials are missing, Jarvis should not fail the workflow. It should explain that Jira creation is unavailable and export CSV or JSON locally instead.

Heimdall routes incoming requests to the most relevant specialist agent.

Cortana answers questions from local documents first. External knowledge stores can be connected later through optional configuration.

