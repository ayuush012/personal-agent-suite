# Groq Setup

1. Go to `https://console.groq.com/keys`.
2. Sign up or log in.
3. Create an API key.
4. Add it to `.env`:

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_key
GROQ_MODEL=llama-3.3-70b-versatile
```

Hosted deployments should keep this key server-side only. Do not expose it in frontend environment variables.
