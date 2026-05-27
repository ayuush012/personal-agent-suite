import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ReactMarkdown from "react-markdown";
import type { KBStatus, KBChatResponse, KBSource, KBWhatsNew, KBPerson, KBTicket } from "@/types";

interface Props {
  token: string;
  userEmail: string;
}

interface KBMessage {
  role: "user" | "assistant";
  content: string;
  sources?: KBSource[];
  intent?: string;
  entities?: string[];
  hyde_used?: boolean;
  follow_up?: string;
  chunks_used?: number;
  top_score?: number;
  suggested_questions?: string[];
  whats_new?: KBWhatsNew[];
  people?: KBPerson[];
  open_tickets?: KBTicket[];
}

const WELCOME_MESSAGE: KBMessage = {
  role: "assistant",
  content: `Hi there! 👋 I'm **Cortana**, Asgard's internal knowledge assistant.\n\nI have access to your organisation's documents — release notes, product updates, policies, FAQs, training guides, and more.\n\nHere are a few things you can ask me:\n- 🚀 *What's new in the latest release?*\n- 📋 *What does the data retention policy say?*\n- 🛠 *How do I troubleshoot [feature]?*\n- 📣 *What were the key updates in version 5.0?*\n\nJust type your question below and I'll find the answer for you!`,
};

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }: { children?: React.ReactNode }) => (
          <p style={{ margin: "0 0 6px 0", lineHeight: 1.6, fontSize: 13, color: "#374151" }}>{children}</p>
        ),
        ul: ({ children }: { children?: React.ReactNode }) => (
          <ul style={{ margin: "4px 0 6px 0", paddingLeft: 18 }}>{children}</ul>
        ),
        ol: ({ children }: { children?: React.ReactNode }) => (
          <ol style={{ margin: "4px 0 6px 0", paddingLeft: 18 }}>{children}</ol>
        ),
        li: ({ children }: { children?: React.ReactNode }) => (
          <li style={{ marginBottom: 3, lineHeight: 1.6, fontSize: 13, color: "#374151" }}>{children}</li>
        ),
        strong: ({ children }: { children?: React.ReactNode }) => (
          <strong style={{ fontWeight: 600, color: "#111827" }}>{children}</strong>
        ),
        code: ({ children }: { children?: React.ReactNode }) => (
          <code style={{ background: "rgba(99,102,241,0.08)", borderRadius: 4, padding: "2px 5px", fontSize: 12, color: "#4338ca", fontFamily: "ui-monospace, monospace" }}>{children}</code>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function KnowledgeBase({ token, userEmail }: Props) {
  const [status, setStatus] = useState<KBStatus | null>(null);
  const [messages, setMessages] = useState<KBMessage[]>([WELCOME_MESSAGE]);
  const [activeAnswer, setActiveAnswer] = useState<KBMessage | null>(null);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [forceReindexing, setForceReindexing] = useState(false);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [vectorCount, setVectorCount] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const syncLogRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios
      .get<KBStatus>("/api/kb/status")
      .then((r) => {
        setStatus(r.data);
        setVectorCount(r.data.vectors_count);
      })
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    if (syncLogRef.current) {
      syncLogRef.current.scrollTop = syncLogRef.current.scrollHeight;
    }
  }, [syncLog]);

  const handleSync = async () => {
    setSyncing(true);
    syncingRef.current = true;
    setSyncLog([]);

    // Poll /api/kb/status every 3 s while sync is running so the vector
    // count increments live instead of jumping at the end.
    const pollInterval = setInterval(async () => {
      if (!syncingRef.current) { clearInterval(pollInterval); return; }
      try {
        const r = await axios.get<KBStatus>("/api/kb/status");
        setVectorCount(r.data.vectors_count);
      } catch { /* ignore */ }
    }, 3000);
    try {
      const resp = await fetch("/api/kb/sync", {
        method: "POST",
        headers: { ...headers, Accept: "text/event-stream" },
      });
      if (!resp.ok || !resp.body) {
        const text = await resp.text();
        setSyncLog((prev) => [...prev, `Error: ${resp.status} ${text}`]);
        setSyncing(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            const evt = JSON.parse(raw);
            setSyncLog((prev) => [...prev, evt.message ?? ""]);
            if (evt.type === "done" && evt.stats?.vectors_count != null) {
              setVectorCount(evt.stats.vectors_count);
            }
          } catch {
            // ignore parse error
          }
        }
      }
    } catch (err: unknown) {
      setSyncLog((prev) => [...prev, `Network error: ${err}`]);
    }
    syncingRef.current = false;
    clearInterval(pollInterval);
    setSyncing(false);
    // Final authoritative count after sync completes
    try {
      const r = await axios.get<KBStatus>("/api/kb/status");
      setStatus(r.data);
      setVectorCount(r.data.vectors_count);
    } catch { /* ignore */ }
    // Auto-clear sync log after 3 s so it doesn't clutter the chat
    setTimeout(() => setSyncLog([]), 3000);
  };

  const handleForceReindex = async () => {
    setShowForceConfirm(false);
    setForceReindexing(true);
    syncingRef.current = true;
    setSyncLog(["🔄 Force reindex started — wiping sync records and recreating collection…"]);

    const pollInterval = setInterval(async () => {
      if (!syncingRef.current) { clearInterval(pollInterval); return; }
      try {
        const r = await axios.get<KBStatus>("/api/kb/status");
        setVectorCount(r.data.vectors_count);
      } catch { /* ignore */ }
    }, 3000);

    try {
      const resp = await axios.post<{ job_id: string; status: string }>(
        "/api/kb/sync/force",
        {},
        { headers }
      );
      const jobId = resp.data.job_id;

      // Poll job status until done
      const pollJob = setInterval(async () => {
        try {
          const jobResp = await axios.get<{
            status: string;
            messages: string[];
            result?: { vectors_count?: number };
            error?: string;
          }>(`/api/kb/sync/status?job_id=${jobId}`, { headers });
          const job = jobResp.data;
          setSyncLog(job.messages ?? []);
          if (job.status === "done" || job.status === "error") {
            clearInterval(pollJob);
            if (job.result?.vectors_count != null) setVectorCount(job.result.vectors_count);
            syncingRef.current = false;
            clearInterval(pollInterval);
            setForceReindexing(false);
            // Final authoritative count
            try {
              const r = await axios.get<KBStatus>("/api/kb/status");
              setStatus(r.data);
              setVectorCount(r.data.vectors_count);
            } catch { /* ignore */ }
            setTimeout(() => setSyncLog([]), 5000);
          }
        } catch { /* ignore */ }
      }, 2000);
    } catch (err: unknown) {
      setSyncLog((prev) => [...prev, `Network error: ${err}`]);
      syncingRef.current = false;
      clearInterval(pollInterval);
      setForceReindexing(false);
    }
  };

  const _buildMessage = (data: KBChatResponse): KBMessage => {
    const topScore = data.sources?.length
      ? Math.max(...data.sources.map((s) => s.final_score ?? s.similarity ?? 0))
      : undefined;
    return {
      role: "assistant",
      content: data.answer ?? "No response received.",
      sources: data.sources,
      intent: data.intent,
      entities: data.entities,
      hyde_used: data.hyde_used,
      follow_up: data.follow_up,
      chunks_used: data.chunks_used,
      top_score: topScore,
      suggested_questions: data.suggested_questions,
      whats_new: data.whats_new,
      people: data.people,
      open_tickets: data.open_tickets,
    };
  };

  const sendPrompt = (q: string) => {
    if (thinking) return;
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setThinking(true);
    setActiveAnswer(null);
    axios
      .post<KBChatResponse>("/api/kb/chat", { question: q, user_name: userEmail }, { headers })
      .then(({ data }) => {
        const msg = _buildMessage(data);
        setMessages((prev) => [...prev, msg]);
        setActiveAnswer(msg);
      })
      .catch(() => {
        const errMsg: KBMessage = { role: "assistant", content: "Something went wrong. Please try again." };
        setMessages((prev) => [...prev, errMsg]);
        setActiveAnswer(errMsg);
      })
      .finally(() => setThinking(false));
  };

  const handleSend = async () => {
    const q = input.trim();
    if (!q || thinking) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setThinking(true);
    setActiveAnswer(null);
    try {
      const { data } = await axios.post<KBChatResponse>(
        "/api/kb/chat",
        { question: q, user_name: userEmail },
        { headers }
      );
      const assistantMsg = _buildMessage(data);
      setMessages((prev) => [...prev, assistantMsg]);
      setActiveAnswer(assistantMsg);
    } catch (err: unknown) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.detail
          ? err.response.data.detail
          : "Something went wrong. Please try again.";
      const errMsg: KBMessage = { role: "assistant", content: msg };
      setMessages((prev) => [...prev, errMsg]);
      setActiveAnswer(errMsg);
    }
    setThinking(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isOnline = status?.status && status.status !== "unavailable";

  return (
    <div style={s.container}>
      {/* ── Header ── */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.headerTitle}>Ask Cortana</span>
          <span style={s.headerDot}>•</span>
          <span style={{ ...s.statusDot, background: isOnline ? "#22c55e" : "#ef4444" }} />
          <span style={s.vectorCount}>
            {vectorCount != null ? `${vectorCount.toLocaleString()} vectors` : "Connecting…"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...s.syncBtn, opacity: syncing ? 0.6 : 1 }}
            onClick={handleSync}
            disabled={syncing || forceReindexing}
          >
            {syncing ? "Syncing…" : "↻ Sync"}
          </button>
          <button
            style={{ ...s.forceReindexBtn, opacity: forceReindexing ? 0.6 : 1 }}
            onClick={() => setShowForceConfirm(true)}
            disabled={syncing || forceReindexing}
          >
            {forceReindexing ? "Reindexing…" : "⟳ Force Reindex"}
          </button>
        </div>
      </div>

      {/* ── Force reindex confirmation dialog ── */}
      {showForceConfirm && (
        <div style={s.dialogOverlay}>
          <div style={s.dialogBox}>
            <div style={s.dialogTitle}>Force Full Reindex</div>
            <div style={s.dialogBody}>
              This will reindex data from all sources. Are you sure you want to proceed?
            </div>
            <div style={s.dialogActions}>
              <button
                style={s.dialogCancelBtn}
                onClick={() => setShowForceConfirm(false)}
              >
                Cancel
              </button>
              <button
                style={s.dialogConfirmBtn}
                onClick={handleForceReindex}
              >
                Yes, Reindex
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sync log ── */}
      {syncLog.length > 0 && (
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div ref={syncLogRef} style={s.syncLog}>
            {syncLog.map((line, i) => (
              <div key={i} style={s.syncLine}>{line}</div>
            ))}
          </div>
          <button
            onClick={() => setSyncLog([])}
            style={{ position: "absolute", top: 6, right: 10, background: "none", border: "none", color: "#6366f1", fontSize: 14, cursor: "pointer", lineHeight: 1 }}
            title="Dismiss"
          >✕</button>
        </div>
      )}

      {/* ── Split body ── */}
      <div style={s.body}>

        {/* LEFT — chat thread */}
        <div style={s.leftPane}>
          <div style={s.thread}>
            {messages.map((msg, i) => {
              const isWelcome = i === 0 && msg.role === "assistant";

              if (msg.role === "user") {
                return (
                  <div key={i} style={s.userBubbleWrapper}>
                    <div style={s.userBubble}>{msg.content}</div>
                  </div>
                );
              }

              if (isWelcome) {
                /* Welcome — agent card with full markdown */
                return (
                  <div key={i} style={s.agentCard}>
                    <div style={s.cardHeaderRow}>
                      <div style={s.avatarCircle}>
                        <span style={s.avatarText}>AS</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={s.agentLabel}>ASTRID</span>
                        <span style={s.agentSubLabel}>Knowledge agent</span>
                      </div>
                    </div>
                    <div style={s.cardDivider} />
                    <div style={{ ...s.cardBody, maxHeight: 220, overflowY: "auto" as const }}>
                      <MarkdownContent content={msg.content} />
                    </div>
                  </div>
                );
              }

              /* Regular assistant reply — compact chip, click to view on right */
              return (
                <div key={i} style={{ ...s.agentCard, cursor: "pointer" }} onClick={() => setActiveAnswer(msg)}>
                  <div style={s.cardHeaderRow}>
                    <div style={s.avatarCircle}>
                      <span style={s.avatarText}>AS</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={s.agentLabel}>ASTRID</span>
                      <span style={s.agentSubLabel}>Knowledge agent</span>
                    </div>
                  </div>
                  <div style={s.cardDivider} />
                  <div style={s.cardBody}>
                    <div
                      style={{ ...s.answerChip, ...(activeAnswer === msg ? s.answerChipActive : {}) }}
                      onClick={() => setActiveAnswer(msg)}
                    >
                      <span>✦ Answer ready — view on right →</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Thinking indicator */}
            {thinking && (
              <div style={s.agentCard}>
                <div style={s.cardHeaderRow}>
                  <div style={s.avatarCircle}>
                    <span style={s.avatarText}>AS</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={s.agentLabel}>ASTRID</span>
                    <span style={s.agentSubLabel}>Knowledge agent</span>
                  </div>
                </div>
                <div style={s.cardDivider} />
                <div style={s.cardBody}>
                  <div style={s.typingRow}>
                    <div style={s.typingDots}>
                      <div style={{ ...s.typingDot, animationDelay: "0ms" }} />
                      <div style={{ ...s.typingDot, animationDelay: "160ms" }} />
                      <div style={{ ...s.typingDot, animationDelay: "320ms" }} />
                    </div>
                    <span style={s.typingLabel}>Agent is thinking…</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={s.inputOuter}>
            <div style={s.inputBox}>
              <textarea
                style={s.inputField}
                placeholder="Ask a question, request a revision, or chat with the agent..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                disabled={thinking}
              />
              <div style={s.inputActions}>
                {/* Attachment icon */}
                <button style={s.iconBtn} title="Attach file" tabIndex={-1}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                </button>
                {/* Image icon */}
                <button style={s.iconBtn} title="Attach image" tabIndex={-1}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                  </svg>
                </button>
                {/* Activity/pulse icon */}
                <button style={s.iconBtn} title="Activity" tabIndex={-1}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                </button>
                {/* Send */}
                <button
                  style={{ ...s.sendBtn, opacity: input.trim() && !thinking ? 1 : 0.4 }}
                  onClick={handleSend}
                  disabled={!input.trim() || thinking}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={s.divider} />

        {/* RIGHT — answer pane */}
        <div style={s.rightPane}>
          {activeAnswer ? (
            <div style={s.answerWrap}>

              {/* SECTION 1 — Meta stat blocks */}
              <div style={s.metaGrid}>
                {activeAnswer.intent && (
                  <div style={s.metaBlockPurple}>
                    <span style={s.metaLabel}>Query intent</span>
                    <span style={s.metaValuePurple}>{activeAnswer.intent.replace(/_/g, " ")}</span>
                  </div>
                )}
                {activeAnswer.chunks_used != null && (
                  <div style={s.metaBlockGray}>
                    <span style={s.metaLabel}>Chunks · match</span>
                    <span style={s.metaValueGray}>
                      {activeAnswer.chunks_used} chunks{activeAnswer.top_score != null ? ` · ${(activeAnswer.top_score * 100).toFixed(0)}%` : ""}
                    </span>
                  </div>
                )}
                {activeAnswer.hyde_used && (
                  <div style={s.metaBlockGreen}>
                    <span style={s.metaLabel}>HyDE</span>
                    <span style={s.metaValueGreen}>enabled</span>
                  </div>
                )}
                {activeAnswer.people && activeAnswer.people.length > 0 && (
                  <div style={s.metaBlockAmber}>
                    <span style={s.metaLabel}>Reach out</span>
                    {activeAnswer.people[0].email ? (
                      <a href={`mailto:${activeAnswer.people[0].email}`} style={s.metaValueAmberLink}>
                        {activeAnswer.people[0].name}
                      </a>
                    ) : (
                      <span style={s.metaValueAmber}>{activeAnswer.people[0].name}</span>
                    )}
                  </div>
                )}
              </div>

              <div style={s.sectionDivider} />

              {/* SECTION 2 — Main answer */}
              <div>
                <div style={s.answerLabel}>Answer</div>
                <div className="kb-markdown" style={{ marginTop: 8 }}>
                  <ReactMarkdown>{activeAnswer.content}</ReactMarkdown>
                </div>
              </div>

              {/* SECTION 3 — What's New (only when present) */}
              {activeAnswer.whats_new && activeAnswer.whats_new.length > 0 && (
                <>
                  <div style={s.sectionDivider} />
                  <div style={s.whatsNewCard}>
                    <div style={s.whatsNewAccent} />
                    <div style={s.whatsNewBody}>
                      {activeAnswer.whats_new.map((item, i) => (
                        <div key={i} style={{ marginBottom: i < activeAnswer.whats_new!.length - 1 ? 12 : 0 }}>
                          <div style={s.whatsNewHeader}>
                            <span style={s.versionBadge}>{item.version}</span>
                            {item.date && <span style={s.dateBadge}>{item.date}</span>}
                          </div>
                          <ul style={s.whatsNewList}>
                            {item.items.map((bullet, j) => (
                              <li key={j} style={s.whatsNewItem}>{bullet}</li>
                            ))}
                          </ul>
                          {item.url && (
                            <a href={item.url} target="_blank" rel="noreferrer" style={s.whatsNewLink}>
                              Full release notes ↗
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* SECTION 4 — PM Owner cards (only when present) */}
              {activeAnswer.people && activeAnswer.people.length > 0 && (
                <>
                  <div style={s.sectionDivider} />
                  <div style={s.sectionLabel}>PM Owners</div>
                  <div style={s.peopleRow}>
                    {activeAnswer.people.map((p, i) => (
                      <div key={i} style={s.personCard}>
                        <div style={s.personAvatar}>
                          <span style={s.personInitials}>
                            {p.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                          </span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={s.personName}>{p.name}</div>
                          {p.features && p.features.length > 0 && (
                            <div style={s.personFeatures}>{p.features.join(", ")}</div>
                          )}
                        </div>
                        {p.email && (
                          <a href={`mailto:${p.email}`} style={s.mailtoBtn} title={`Email ${p.name}`}>✉</a>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* SECTION 5 — Open Jira tickets (only when present, max 3) */}
              {activeAnswer.open_tickets && activeAnswer.open_tickets.length > 0 && (
                <>
                  <div style={s.sectionDivider} />
                  <div style={s.sectionLabel}>Open Tickets</div>
                  <div style={s.ticketsList}>
                    {activeAnswer.open_tickets.slice(0, 3).map((t, i) => (
                      <a key={i} href={t.url || "#"} target="_blank" rel="noreferrer" style={s.ticketRow}>
                        <span style={{
                          ...s.ticketStatus,
                          background: t.status === "In Progress" ? "#fef3c7" : t.status === "Done" ? "#d1fae5" : "#e0e7ff",
                          color: t.status === "In Progress" ? "#92400e" : t.status === "Done" ? "#065f46" : "#3730a3",
                        }}>
                          {t.status}
                        </span>
                        <span style={s.ticketTitle}>{t.id}: {t.title}</span>
                        {t.assignee && <span style={s.ticketAssignee}>{t.assignee}</span>}
                      </a>
                    ))}
                  </div>
                </>
              )}

              {/* SECTION 6 — Sources */}
              <div style={s.sectionDivider} />
              <div>
                <div style={s.sectionLabel}>Sources</div>
                <div style={s.sourcesGrid}>
                  {(() => {
                    const seen = new Map<string, KBSource>();
                    for (const src of (activeAnswer.sources ?? [])) {
                      const key = src.file_name ?? "";
                      if (!seen.has(key) || (src.similarity ?? 0) > (seen.get(key)!.similarity ?? 0)) seen.set(key, src);
                    }
                    return Array.from(seen.values())
                      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
                      .slice(0, 6)
                      .map((src, j) => {
                        const ext = (src.file_name ?? "").split(".").pop()?.toLowerCase() ?? "";
                        const isSheet = ["csv", "xlsx", "xls"].includes(ext);
                        const isDoc = ["docx", "doc"].includes(ext);
                        const iconColor = isSheet ? "#059669" : isDoc ? "#2563eb" : "#7c3aed";
                        const iconLabel = isSheet ? "⊞" : isDoc ? "⊟" : "📄";
                        const matchPct = src.similarity != null ? `${(src.similarity * 100).toFixed(0)}%` : null;
                        return (
                          <a key={j} href={src.source_url || "#"} target="_blank" rel="noreferrer" style={s.sourceCard}>
                            <span style={{ ...s.sourceIcon, color: iconColor }}>{iconLabel}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={s.sourceFileName}>{src.file_name ?? "Source"}</div>
                              {src.source_updated_at && (
                                <div style={s.sourceDate}>{src.source_updated_at.slice(0, 10)}</div>
                              )}
                            </div>
                            {matchPct && <span style={s.matchBadge}>{matchPct}</span>}
                            <span style={s.sourceLink}>↗</span>
                          </a>
                        );
                      });
                  })()}
                </div>
              </div>

              {/* SECTION 7 — Quick actions 2×2 grid */}
              <div style={s.sectionDivider} />
              <div>
                <div style={s.sectionLabel}>Quick actions</div>
                <div style={s.quickGrid}>
                  {((): { label: string; icon: string; prompt: string }[] => {
                    const intent = activeAnswer.intent ?? "";
                    if (intent === "release_notes") return [
                      { label: "Latest release", icon: "🚀", prompt: "What's new in the latest release?" },
                      { label: "Version history", icon: "📋", prompt: "Show me the version history" },
                      { label: "What was fixed?", icon: "🔧", prompt: "What bugs were fixed in recent releases?" },
                      { label: "Upcoming changes", icon: "🔮", prompt: "What upcoming changes are planned?" },
                    ];
                    if (intent === "feature_ownership") return [
                      { label: "All PM owners", icon: "👥", prompt: "Show all PM owners and their features" },
                      { label: "Contact list", icon: "📧", prompt: "Who do I contact for product questions?" },
                      { label: "Team structure", icon: "🏗️", prompt: "What is the team structure?" },
                      { label: "Responsibilities", icon: "📌", prompt: "What are the PM responsibilities?" },
                    ];
                    return [
                      { label: "Prompt tips", icon: "💡", prompt: "What kinds of questions can I ask Cortana?" },
                      { label: "Version history", icon: "📋", prompt: "Show me the version history of the product" },
                      { label: "Log a ticket", icon: "🎫", prompt: "How do I log a Jira ticket for this?" },
                      { label: "Compare features", icon: "⚖️", prompt: "Compare features across product areas" },
                    ];
                  })().map((action, i) => (
                    <button key={i} style={s.quickBtn} onClick={() => sendPrompt(action.prompt)}>
                      <span style={s.quickIcon}>{action.icon}</span>
                      <span style={s.quickLabel}>{action.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* SECTION 8 — Follow-up suggestion pills */}
              {(activeAnswer.suggested_questions?.length || activeAnswer.follow_up) && (
                <>
                  <div style={s.sectionDivider} />
                  <div>
                    <div style={s.sectionLabel}>Suggested follow-ups</div>
                    <div style={s.pillsRow}>
                      {(activeAnswer.suggested_questions?.length
                        ? activeAnswer.suggested_questions
                        : activeAnswer.follow_up ? [activeAnswer.follow_up] : []
                      ).slice(0, 3).map((q, i) => (
                        <button key={i} style={s.followPill} onClick={() => sendPrompt(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

            </div>
          ) : (
            <div style={s.rightEmpty}>
              <div style={s.rightEmptyIcon}>💡</div>
              <div style={s.rightEmptyText}>
                Ask a question — the full answer will appear here
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 80%, 100% { opacity: 0.2; }
          40% { opacity: 1; }
        }
        @keyframes typingPulse {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        .kb-markdown p { margin: 8px 0; font-size: 14px; line-height: 1.7; color: #1a1a2e; }
        .kb-markdown p:first-child { margin-top: 0; }
        .kb-markdown p:last-child { margin-bottom: 0; }
        .kb-markdown h2 { font-size: 16px; font-weight: 700; color: #1a1a2e; margin: 16px 0 8px; }
        .kb-markdown h3 { font-size: 14px; font-weight: 600; color: #1a1a2e; margin: 12px 0 6px; }
        .kb-markdown strong { font-weight: 600; color: #1a1a2e; }
        .kb-markdown ul, .kb-markdown ol { padding-left: 20px; margin: 8px 0; }
        .kb-markdown li { margin: 5px 0; font-size: 14px; line-height: 1.6; color: #1a1a2e; }
        .kb-markdown code { background: rgba(99,102,241,0.08); border-radius: 3px; padding: 1px 5px; font-size: 12px; font-family: monospace; }
      `}</style>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 2px 16px rgba(99,102,241,0.08)",
    border: "1px solid #e8eaf6",
  },

  // ── Header ───────────────────────────────────────────────
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 20px",
    background: "#fff",
    borderBottom: "1px solid #e8eaf6",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "#1a1a2e",
  },
  headerDot: {
    fontSize: 14,
    color: "#d1d5db",
    fontWeight: 400,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  vectorCount: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: 500,
  },
  syncBtn: {
    padding: "7px 16px",
    background: "linear-gradient(135deg, #7c3aed, #6366f1)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "opacity 0.2s",
  },

  forceReindexBtn: {
    padding: "7px 16px",
    background: "#fff",
    color: "#6b7280",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "opacity 0.2s",
    boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
  },

  // ── Confirmation dialog ───────────────────────────────────
  dialogOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  dialogBox: {
    background: "#fff",
    borderRadius: 14,
    padding: "28px 32px",
    maxWidth: 420,
    width: "90%",
    boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
  },
  dialogTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "#111827",
    marginBottom: 10,
  },
  dialogBody: {
    fontSize: 14,
    color: "#4b5563",
    lineHeight: 1.6,
    marginBottom: 24,
  },
  dialogActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  },
  dialogCancelBtn: {
    padding: "8px 18px",
    background: "#f3f4f6",
    color: "#374151",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  dialogConfirmBtn: {
    padding: "8px 18px",
    background: "linear-gradient(135deg, #dc2626, #ef4444)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },

  // ── Sync log ─────────────────────────────────────────────
  syncLog: {
    background: "#0f0f23",
    padding: "8px 32px 8px 16px",
    maxHeight: 80,
    overflowY: "auto" as const,
    borderBottom: "1px solid #1e1e3f",
  },
  syncLine: {
    fontSize: 12,
    color: "#a5b4fc",
    fontFamily: "monospace",
    lineHeight: 1.6,
  },

  // ── Body ─────────────────────────────────────────────────
  body: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  leftPane: {
    display: "flex",
    flexDirection: "column",
    width: "38%",
    flexShrink: 0,
    overflow: "hidden",
    minHeight: 0,
  },
  thread: {
    flex: 1,
    minHeight: 0,
    overflowY: "scroll" as const,
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    background: "#f9fafb",
  },

  // ── Agent card (matches Jira Chat component style) ────────
  agentCard: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  },
  cardHeaderRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #7c3aed, #6366f1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 11,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: "0.04em",
  },
  agentLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#7c3aed",
    letterSpacing: "0.06em",
  },
  agentSubLabel: {
    fontSize: 11,
    color: "#9ca3af",
    fontWeight: 400,
  },
  cardDivider: {
    height: 1,
    background: "#f3f4f6",
    margin: "0",
  },
  cardBody: {
    padding: "10px 14px",
  },

  // ── User bubble ───────────────────────────────────────────
  userBubbleWrapper: {
    display: "flex",
    justifyContent: "flex-end",
  },
  userBubble: {
    background: "linear-gradient(135deg, #7c3aed, #6366f1)",
    color: "#fff",
    padding: "9px 14px",
    borderRadius: "18px 18px 4px 18px",
    fontSize: 13,
    lineHeight: 1.5,
    maxWidth: "80%",
    wordBreak: "break-word" as const,
    fontWeight: 500,
  },

  // ── Answer chip (RETAINED) ────────────────────────────────
  answerChip: {
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 14px",
    background: "#f5f3ff",
    border: "1px solid #c4b5fd",
    borderRadius: 20,
    fontSize: 12,
    color: "#7c3aed",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    userSelect: "none" as const,
  },
  answerChipActive: {
    background: "linear-gradient(135deg, #7c3aed, #6366f1)",
    color: "#fff",
    border: "1px solid transparent",
  },

  // ── Thinking indicator ────────────────────────────────────
  typingRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  typingDots: {
    display: "flex",
    alignItems: "center",
    gap: 3,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#7c3aed",
    animation: "typingPulse 1.2s ease-in-out infinite",
  },
  typingLabel: {
    fontSize: 12,
    color: "#9ca3af",
    fontStyle: "italic",
  },

  // ── Input ─────────────────────────────────────────────────
  inputOuter: {
    padding: "12px 14px",
    borderTop: "1px solid #e5e7eb",
    background: "#fff",
    flexShrink: 0,
  },
  inputBox: {
    border: "1px solid #e0e0e0",
    borderRadius: 12,
    background: "#fff",
    overflow: "hidden",
  },
  inputField: {
    width: "100%",
    padding: "10px 14px 6px",
    border: "none",
    outline: "none",
    fontSize: 13,
    lineHeight: 1.5,
    resize: "none" as const,
    fontFamily: "Inter, sans-serif",
    color: "#1a1a2e",
    background: "transparent",
    boxSizing: "border-box" as const,
  },
  inputActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 10px 8px",
  },
  iconBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    background: "none",
    border: "none",
    borderRadius: 6,
    color: "#9ca3af",
    cursor: "pointer",
    padding: 0,
    transition: "color 0.15s",
  },
  sendBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    background: "linear-gradient(135deg, #7c3aed, #6366f1)",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    cursor: "pointer",
    flexShrink: 0,
    transition: "opacity 0.2s",
    marginLeft: "auto",
  },

  // ── Divider ───────────────────────────────────────────────
  divider: {
    width: 1,
    background: "#e8eaf6",
    flexShrink: 0,
  },

  // ── Right pane ────────────────────────────────────────────
  rightPane: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "24px",
    background: "#fff",
  },
  answerWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 0,
  },
  answerLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#7c3aed",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  rightEmpty: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    gap: 12,
    color: "#9ca3af",
    textAlign: "center" as const,
  },
  rightEmptyIcon: {
    fontSize: 36,
    opacity: 0.5,
  },
  rightEmptyText: {
    fontSize: 13,
    maxWidth: 260,
    lineHeight: 1.6,
  },

  // ── Meta stat blocks (Section 1) ─────────────────────────
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 8,
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "#9ca3af",
    marginBottom: 4,
  },
  metaBlockPurple: {
    display: "flex",
    flexDirection: "column" as const,
    padding: "10px 12px",
    background: "#faf5ff",
    border: "1px solid #e9d5ff",
    borderRadius: 8,
  },
  metaValuePurple: {
    fontSize: 13,
    fontWeight: 600,
    color: "#7c3aed",
    textTransform: "capitalize" as const,
  },
  metaBlockGray: {
    display: "flex",
    flexDirection: "column" as const,
    padding: "10px 12px",
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
  },
  metaValueGray: {
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
  },
  metaBlockGreen: {
    display: "flex",
    flexDirection: "column" as const,
    padding: "10px 12px",
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
  },
  metaValueGreen: {
    fontSize: 13,
    fontWeight: 600,
    color: "#065f46",
  },
  metaBlockAmber: {
    display: "flex",
    flexDirection: "column" as const,
    padding: "10px 12px",
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 8,
  },
  metaValueAmber: {
    fontSize: 13,
    fontWeight: 600,
    color: "#92400e",
  },
  metaValueAmberLink: {
    fontSize: 13,
    fontWeight: 600,
    color: "#92400e",
    textDecoration: "none",
    borderBottom: "1px dashed #f59e0b",
  },

  // ── Section helpers ───────────────────────────────────────
  sectionDivider: {
    height: 1,
    background: "#f3f4f6",
    margin: "16px 0",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#6b7280",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: 8,
  },

  // ── What's New ────────────────────────────────────────────
  whatsNewCard: {
    display: "flex",
    border: "1px solid #e9d5ff",
    borderRadius: 10,
    overflow: "hidden",
  },
  whatsNewAccent: {
    width: 4,
    background: "linear-gradient(180deg, #7c3aed, #6366f1)",
    flexShrink: 0,
  },
  whatsNewBody: {
    padding: "12px 14px",
    flex: 1,
  },
  whatsNewHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  versionBadge: {
    padding: "2px 8px",
    background: "#7c3aed",
    color: "#fff",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
  },
  dateBadge: {
    fontSize: 11,
    color: "#9ca3af",
  },
  whatsNewList: {
    margin: "0 0 8px 0",
    paddingLeft: 16,
  },
  whatsNewItem: {
    fontSize: 13,
    color: "#374151",
    lineHeight: 1.6,
    marginBottom: 3,
  },
  whatsNewLink: {
    fontSize: 12,
    color: "#7c3aed",
    fontWeight: 600,
    textDecoration: "none",
  },

  // ── PM Owners ─────────────────────────────────────────────
  peopleRow: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  personCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    background: "#fafafa",
    border: "1px solid #f0f0f0",
    borderRadius: 8,
  },
  personAvatar: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #7c3aed, #6366f1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  personInitials: {
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
  },
  personName: {
    fontSize: 13,
    fontWeight: 600,
    color: "#111827",
  },
  personFeatures: {
    fontSize: 11,
    color: "#9ca3af",
    marginTop: 1,
    overflow: "hidden",
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  mailtoBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    background: "#ede9fe",
    borderRadius: "50%",
    fontSize: 13,
    color: "#7c3aed",
    textDecoration: "none",
    flexShrink: 0,
  },

  // ── Tickets ───────────────────────────────────────────────
  ticketsList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  ticketRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    background: "#fafafa",
    border: "1px solid #f0f0f0",
    borderRadius: 8,
    textDecoration: "none",
  },
  ticketStatus: {
    padding: "2px 7px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    flexShrink: 0,
  },
  ticketTitle: {
    flex: 1,
    fontSize: 12,
    color: "#374151",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  ticketAssignee: {
    fontSize: 11,
    color: "#9ca3af",
    flexShrink: 0,
  },

  // ── Sources (card style) ──────────────────────────────────
  sourcesGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  sourceCard: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    background: "#fafafa",
    border: "1px solid #f0f0f0",
    borderRadius: 8,
    textDecoration: "none",
  },
  sourceIcon: {
    fontSize: 16,
    flexShrink: 0,
    width: 20,
    textAlign: "center" as const,
  },
  sourceFileName: {
    fontSize: 12,
    color: "#374151",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  sourceDate: {
    fontSize: 11,
    color: "#9ca3af",
    marginTop: 1,
  },
  matchBadge: {
    padding: "2px 7px",
    background: "rgba(99,102,241,0.1)",
    color: "#4f46e5",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    flexShrink: 0,
  },
  sourceLink: {
    fontSize: 12,
    color: "#9ca3af",
    flexShrink: 0,
  },

  // ── Quick actions ─────────────────────────────────────────
  quickGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  quickBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left" as const,
  },
  quickIcon: {
    fontSize: 15,
    flexShrink: 0,
  },
  quickLabel: {
    fontSize: 12,
    color: "#374151",
    fontWeight: 500,
  },

  // ── Follow-up pills ───────────────────────────────────────
  pillsRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
  },
  followPill: {
    padding: "6px 14px",
    background: "#f5f3ff",
    border: "1px solid #c4b5fd",
    borderRadius: 20,
    fontSize: 12,
    color: "#7c3aed",
    fontWeight: 500,
    cursor: "pointer",
    textAlign: "left" as const,
    lineHeight: 1.4,
  },
};
