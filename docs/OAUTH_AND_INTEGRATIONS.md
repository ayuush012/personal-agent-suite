# OAuth And Integrations

The hosted Asgard demo does not collect visitor credentials.

Local or self-hosted users can enable integrations by adding their own values to `.env`.

## Jira And Atlassian

```bash
JIRA_INSTANCE_URL=https://your-domain.atlassian.net
JIRA_SERVICE_ACCOUNT_EMAIL=you@example.com
JIRA_API_TOKEN=your_token
ATLASSIAN_CLIENT_ID=
ATLASSIAN_CLIENT_SECRET=
ATLASSIAN_REFRESH_TOKEN=
ATLASSIAN_CLOUD_ID=
```

Jarvis works without Jira credentials by generating previews and CSV/DOCX exports.

## Figma

```bash
FIGMA_CLIENT_ID=
FIGMA_CLIENT_SECRET=
FIGMA_SERVICE_ACCOUNT_TOKEN=
```

Figma input should remain optional. If credentials are absent, the app should explain what is missing and continue with text requirements.

## Knowledge Sources

```bash
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION=asgard_kb
GOOGLE_SERVICE_ACCOUNT_JSON=
CONFLUENCE_INSTANCE_URL=
```

Cortana uses sanitized local sample docs by default.
