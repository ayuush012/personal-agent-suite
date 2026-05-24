import { useEffect, useMemo, useRef, useState } from "react";

type Workflow = {
  id: "heimdall" | "cortana" | "jarvis";
  name: string;
  persona_name: string;
  description: string;
  required: string[];
  optional: string[];
  integration_deps: string[];
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  preview?: Preview;
};

type Ticket = {
  issue_type: string;
  summary: string;
  description: string;
  acceptance_criteria: string[];
  priority: string;
  labels: string[];
  story_points: number | null;
};

type Preview =
  | { type: "route"; agent: string; confidence: string; reason: string }
  | { type: "answer"; content: string; sources: Array<{ file_name: string; score: number; excerpt: string }> }
  | { type: "tickets"; tickets: Ticket[]; jira?: { created: boolean; message: string; keys: string[] } };

type Run = {
  run_id: string;
  workflow_id: Workflow["id"];
  status: string;
};

type Integration = {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "not_configured" | "error";
  last_checked?: string;
};

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const WS_BASE = import.meta.env.VITE_WS_URL ?? API_BASE.replace(/^http/, "ws");
const GITHUB_URL = "https://github.com/ayuush012/personal-agent-suite";
const PORTFOLIO_URL = "https://www.buildwithayush.co.in";
const GROQ_KEYS_URL = "https://console.groq.com/keys";

const samplePrompts: Record<Workflow["id"], string[]> = {
  heimdall: [
    "Route this: turn a signup requirements brief into Jira tickets",
    "Route this: answer a question from the onboarding documentation"
  ],
  cortana: [
    "What does the local setup guide recommend before running agents?",
    "How should a recruiter try the demo safely?"
  ],
  jarvis: [
    "Create Jira-ready tickets for a password reset flow with email OTP, expiry, retry limits, and audit logging.",
    "Turn this brief into product tickets: users need to upload invoices, validate fields, export CSV, and handle errors."
  ]
};

function sessionId() {
  const key = "asgard_session_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}

function headers() {
  return { "Content-Type": "application/json", "X-Asgard-Session": sessionId() };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export default function App() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow["id"]>("heimdall");
  const [run, setRun] = useState<Run | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const active = useMemo(
    () => workflows.find((workflow) => workflow.id === activeWorkflow),
    [activeWorkflow, workflows]
  );

  useEffect(() => {
    api<Workflow[]>("/api/workflows/")
      .then(setWorkflows)
      .catch((err) => setError(err.message));
    api<{ integrations: Integration[] }>("/api/integrations/status")
      .then((data) => setIntegrations(data.integrations))
      .catch(() => setIntegrations([]));
  }, []);

  useEffect(() => {
    return () => wsRef.current?.close();
  }, []);

  async function start(workflowId = activeWorkflow): Promise<Run | null> {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const nextRun = await api<Run>("/api/runs/", {
        method: "POST",
        body: JSON.stringify({ workflow_id: workflowId })
      });
      setRun(nextRun);
      setMessages([]);
      connectSocket(nextRun);
      return nextRun;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start run");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function connectSocket(nextRun: Run) {
    wsRef.current?.close();
    const base = WS_BASE || window.location.origin.replace(/^http/, "ws");
    const socket = new WebSocket(`${base}/api/runs/${nextRun.run_id}/ws`);
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.event === "chat_message") {
        setMessages((current) => [
          ...current,
          {
            role: data.role,
            content: data.content,
            created_at: data.created_at,
            preview: data.preview
          }
        ]);
        if (data.preview) setPreview(data.preview);
      }
      if (data.event === "agent_log" && data.log_event === "tickets_preview") {
        setPreview({ type: "tickets", tickets: data.metadata.tickets, jira: data.metadata.jira });
      }
    };
    socket.onerror = () => setError("Live connection dropped. The REST API is still available.");
    wsRef.current = socket;
  }

  async function send(text = prompt) {
    const clean = text.trim();
    if (!clean) return;
    let currentRun = run;
    if (!currentRun || currentRun.workflow_id !== activeWorkflow) {
      currentRun = await start(activeWorkflow);
    }
    if (!currentRun) return;
    setPrompt("");
    setBusy(true);
    setError("");
    try {
      await api(`/api/runs/${currentRun.run_id}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: clean })
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportTickets(format: "csv" | "docx") {
    if (!run || !preview || preview.type !== "tickets") return;
    const response = await fetch(`${API_BASE}/api/runs/${run.run_id}/export-now`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ format, tickets: preview.tickets, project_key: "ASGARD" })
    });
    if (!response.ok) {
      setError("Export failed. Try again after regenerating tickets.");
      return;
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `asgard_tickets.${format}`;
    a.click();
    URL.revokeObjectURL(href);
  }

  function selectWorkflow(workflowId: Workflow["id"]) {
    setActiveWorkflow(workflowId);
    setRun(null);
    setMessages([]);
    setPreview(null);
    setError("");
  }

  return (
    <main className="shell">
      <section className="topbar" aria-label="Asgard overview">
        <div>
          <p className="eyebrow">Personal Agent Suite</p>
          <h1>Asgard</h1>
          <p className="lede">A local-first PM colleague for routing work, answering from docs, and generating Jira-ready tickets.</p>
        </div>
        <nav className="actions" aria-label="Primary links">
          <a className="button secondary" href={GITHUB_URL}>View GitHub</a>
          <a className="button secondary" href="#run-local">Run locally</a>
          <a className="button secondary" href={GROQ_KEYS_URL}>Groq key</a>
          <a className="button primary" href={PORTFOLIO_URL}>Back to portfolio</a>
        </nav>
      </section>

      <section className="trust-note">
        <span>Hosted demo mode</span>
        <p>No recruiter credentials are entered or stored here. Live integrations are enabled only when this repo is cloned and configured with a local `.env`.</p>
      </section>

      <section className="workspace">
        <aside className="agents-panel" aria-label="Agents">
          <div className="panel-heading">
            <span>Agents</span>
            <small>{run ? "Run active" : "Ready"}</small>
          </div>
          <div className="agent-list">
            {workflows.map((workflow) => (
              <button
                key={workflow.id}
                className={`agent-tile ${activeWorkflow === workflow.id ? "active" : ""}`}
                onClick={() => selectWorkflow(workflow.id)}
              >
                <span className="agent-mark">{workflow.persona_name.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{workflow.persona_name}</strong>
                  <em>{workflow.name}</em>
                </span>
              </button>
            ))}
          </div>
          <div className="integration-stack">
            <span className="section-label">Integrations</span>
            {integrations.map((integration) => (
              <div className="integration-row" key={integration.id}>
                <span>{integration.name}</span>
                <strong data-status={integration.status}>{integration.status.replace("_", " ")}</strong>
              </div>
            ))}
          </div>
        </aside>

        <section className="chat-panel" aria-label="Conversation">
          <header className="chat-header">
            <div>
              <span className="section-label">Current agent</span>
              <h2>{active?.persona_name ?? "Asgard"}</h2>
            </div>
            <button className="button compact" onClick={() => start()} disabled={busy}>
              {run?.workflow_id === activeWorkflow ? "Restart" : "Start"}
            </button>
          </header>

          <div className="sample-row">
            {(samplePrompts[activeWorkflow] ?? []).map((sample) => (
              <button key={sample} onClick={() => send(sample)} disabled={busy}>
                {sample}
              </button>
            ))}
          </div>

          <div className="messages" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-state">
                <h3>{active?.description}</h3>
                <p>Start the agent, choose a sample prompt, or write your own PM task.</p>
              </div>
            ) : (
              messages.map((message, index) => (
                <article key={`${message.created_at}-${index}`} className={`message ${message.role}`}>
                  <span>{message.role === "user" ? "You" : active?.persona_name ?? "Asgard"}</span>
                  <p>{message.content}</p>
                </article>
              ))
            )}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <label htmlFor="prompt">Prompt</label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask Asgard to route a request, answer from docs, or generate tickets..."
              rows={3}
            />
            <div className="composer-footer">
              {error ? <span className="error">{error}</span> : <span>Anonymous session: local browser only</span>}
              <button className="button primary" disabled={busy || !prompt.trim()} type="submit">
                {busy ? "Working..." : "Send"}
              </button>
            </div>
          </form>
        </section>

        <aside className="output-panel" aria-label="Output preview">
          <span className="section-label">Output</span>
          <PreviewPane preview={preview} onExport={exportTickets} />
        </aside>
      </section>

      <section className="setup-strip" id="run-local">
        <div>
          <span className="section-label">Run locally</span>
          <h2>Clone, add keys, use your own integrations.</h2>
        </div>
        <pre>{`git clone https://github.com/ayuush012/personal-agent-suite.git
cd personal-agent-suite
cp .env.example .env
docker compose up --build`}</pre>
      </section>
    </main>
  );
}

function PreviewPane({ preview, onExport }: { preview: Preview | null; onExport: (format: "csv" | "docx") => void }) {
  if (!preview) {
    return (
      <div className="preview-empty">
        <h3>Waiting for agent output</h3>
        <p>Routing decisions, cited answers, and ticket previews appear here.</p>
      </div>
    );
  }

  if (preview.type === "route") {
    return (
      <div className="preview-card">
        <h3>Route: {preview.agent}</h3>
        <p>{preview.reason}</p>
        <span className="confidence">{preview.confidence} confidence</span>
      </div>
    );
  }

  if (preview.type === "answer") {
    return (
      <div className="preview-card">
        <h3>Cited answer</h3>
        <p>{preview.content}</p>
        <div className="source-list">
          {preview.sources.map((source) => (
            <div key={source.file_name}>
              <strong>{source.file_name}</strong>
              <span>{source.excerpt}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="preview-card ticket-preview">
      <div className="preview-toolbar">
        <h3>Jira-ready tickets</h3>
        <div>
          <button onClick={() => onExport("csv")}>CSV</button>
          <button onClick={() => onExport("docx")}>DOCX</button>
        </div>
      </div>
      {preview.jira ? <p className="jira-note">{preview.jira.message}</p> : null}
      {preview.tickets.map((ticket) => (
        <article key={ticket.summary}>
          <span>{ticket.issue_type}</span>
          <h4>{ticket.summary}</h4>
          <p>{ticket.description}</p>
          <ul>
            {ticket.acceptance_criteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
