import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — react-markdown types resolve after npm install
import ReactMarkdown from "react-markdown";
import type { ChatMessage, GateEvent, GateAction, AgentLogEntry, PreviewData } from "@/types";
import { ApprovalGate } from "@/components/ApprovalGate";
import { ExecutionTrace } from "@/components/ExecutionTrace";

interface WorkflowDisplay {
  personaName: string;
  initials: string;
  subLabel?: string;
}

interface Props {
  runId: string;
  token: string;
  messages: ChatMessage[];
  pendingGate: GateEvent | null;
  onGateResolved: (action: GateAction) => void;
  runStatus?: string;
  onNewRun?: () => void;
  onRestartWithMessage?: (message: string) => void;
  liveLogEntries?: AgentLogEntry[];
  workflowDisplayMap?: Record<string, WorkflowDisplay>;
  agentTyping?: boolean;
  runError?: string;
  onUserSend?: (message: string, images?: Array<{preview: string; name: string}>) => void;
  // In-panel header props
  workflowId?: string;
  onPreview?: (data: PreviewData) => void;
  optimisticImages?: Array<{preview: string; name: string}>;
  agentChips?: string[];
  onChipSelect?: (agentName: string) => void;
}

const OPERATOR_STEPS = [
  "Understanding user intent...",
  "Identifying the right agent...",
  "Preparing the workspace...",
];

/**
 * Normalise agent/LLM message text so it renders cleanly in ReactMarkdown.
 *
 * Problems addressed:
 *  1. Bullet lines using "• " (U+2022) — ReactMarkdown doesn't recognise these
 *     as list items, so single-\n-separated bullets collapse into one line.
 *     Fix: convert each "• …" line into a proper Markdown "- …" list item.
 *  2. Single \n inside a non-list paragraph — standard Markdown ignores it.
 *     Fix: replace standalone single newlines (not already \n\n) with "  \n"
 *     (two trailing spaces = Markdown hard line-break) so they are preserved.
 */
function normaliseMarkdown(text: string): string {
  // Split into lines and detect bullet lines
  const lines = text.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Convert unicode bullet "• text" → "- text"
    if (/^\s*[•·]\s+/.test(line)) {
      out.push(line.replace(/^\s*[•·]\s+/, "- "));
    } else {
      out.push(line);
    }
  }

  // Re-join, then fix bare single newlines that aren't already double-newlines:
  // a single \n between two non-empty, non-list lines → "  \n" (hard break)
  let result = out.join("\n");
  result = result.replace(/([^\n])\n([^\n-])/g, "$1  \n$2");

  return result;
}

function MarkdownContent({ content }: { content: string }) {
  const normalised = normaliseMarkdown(content);
  return (
    <ReactMarkdown
      components={{
        p: ({ children }: { children?: React.ReactNode }) => <p style={{ margin: "0 0 6px 0", lineHeight: 1.6 }}>{children}</p>,
        ul: ({ children }: { children?: React.ReactNode }) => <ul style={{ margin: "4px 0 6px 0", paddingLeft: 18 }}>{children}</ul>,
        ol: ({ children }: { children?: React.ReactNode }) => <ol style={{ margin: "4px 0 6px 0", paddingLeft: 18 }}>{children}</ol>,
        li: ({ children }: { children?: React.ReactNode }) => <li style={{ marginBottom: 3, lineHeight: 1.6 }}>{children}</li>,
        strong: ({ children }: { children?: React.ReactNode }) => <strong style={{ fontWeight: 600, color: "#111827" }}>{children}</strong>,
        code: ({ children }: { children?: React.ReactNode }) => <code style={{ background: "rgba(99,102,241,0.08)", borderRadius: 4, padding: "2px 5px", fontSize: 13, color: "#4338ca", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{children}</code>,
      }}
    >
      {normalised}
    </ReactMarkdown>
  );
}


function OperatorCard({ content }: { content: string }) {
  return (
    <div style={styles.agentCard}>
      {/* Header */}
      <div style={styles.cardHeaderRow}>
        <div style={{ ...styles.avatarCircle, background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}>
          <span style={styles.avatarText}>VE</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={styles.agentLabel}>HEIMDALL</span>
          <span style={styles.agentSubLabel}>Intent Routing Agent</span>
        </div>
      </div>
      <div style={styles.cardDivider} />
      {/* Steps */}
      <div style={styles.stepsBlock}>
        {OPERATOR_STEPS.map((step, i) => (
          <div key={i} style={styles.stepRow}>
            <div style={styles.checkCircle}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span style={styles.stepText}>{step}</span>
          </div>
        ))}
      </div>
      <div style={styles.cardDivider} />
      {/* Message */}
      <div style={styles.cardBody}>
        <MarkdownContent content={content} />
      </div>
    </div>
  );
}

function AgentCard({ content, display }: { content: string; display: WorkflowDisplay }) {
  return (
    <div style={styles.agentCard}>
      {/* Header */}
      <div style={styles.cardHeaderRow}>
        <div style={{ ...styles.avatarCircle, background: "linear-gradient(135deg, #7c3aed, #6366f1)" }}>
          <span style={styles.avatarText}>{display.initials}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={styles.agentLabel}>{display.personaName.toUpperCase()}</span>
          <span style={styles.agentSubLabel}>{display.subLabel ?? "Specialist agent"}</span>
        </div>
      </div>
      <div style={styles.cardDivider} />
      {/* Message */}
      <div style={styles.cardBody}>
        <MarkdownContent content={content} />
      </div>
    </div>
  );
}

// Per-workflow gradient map for the in-panel header icon
const WORKFLOW_GRADIENTS: Record<string, string> = {
  heimdall: "linear-gradient(135deg, #7c3aed, #6366f1)",
  "jarvis": "linear-gradient(135deg, #6366f1, #4f46e5)",
  "cortana": "linear-gradient(135deg, #0ea5e9, #6366f1)",
};

export function ChatPanel({ runId, token, messages, pendingGate, onGateResolved, runStatus, onNewRun, onRestartWithMessage, liveLogEntries, workflowDisplayMap, agentTyping, runError, onUserSend, workflowId, onPreview, optimisticImages, agentChips, onChipSelect }: Props) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);

  // Agent name transition state
  const [displayedWorkflowId, setDisplayedWorkflowId] = useState(workflowId);
  const [nameKey, setNameKey] = useState(0);
  const prevWorkflowIdRef = useRef(workflowId);

  useEffect(() => {
    if (workflowId !== prevWorkflowIdRef.current) {
      prevWorkflowIdRef.current = workflowId;
      setDisplayedWorkflowId(workflowId);
      setNameKey((k) => k + 1);
    }
  }, [workflowId]);

  // Resolve display info for the in-panel header
  const headerDisplay = (() => {
    const wfId = displayedWorkflowId;
    const display = wfId ? workflowDisplayMap?.[wfId] : undefined;
    return {
      name: display?.personaName ?? "Heimdall",
      initials: display?.initials ?? "VE",
      gradient: (wfId ? WORKFLOW_GRADIENTS[wfId] : undefined) ?? "linear-gradient(135deg, #7c3aed, #6366f1)",
    };
  })();

  const [pendingImages, setPendingImages] = useState<Array<{path: string; name: string; preview: string}>>([]);
  const [pendingFile, setPendingFile] = useState<{ path: string; name: string; tag: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingGate]);

  const send = async () => {
    if (!input.trim() && pendingImages.length === 0 && !pendingFile) return;
    if (sending) return;
    if (runStatus === "completed" && onRestartWithMessage) {
      const msg = input.trim();
      setInput("");
      setPendingImages([]);
      setPendingFile(null);
      onRestartWithMessage(msg);
      return;
    }
    setSending(true);
    // Build message: file tag first (if any), then images, then text
    let message = "";
    if (pendingFile) {
      message += pendingFile.tag;
    }
    if (pendingImages.length > 0) {
      if (message) message += "\n";
      message += `[UPLOADED_IMAGES: ${pendingImages.map(img => img.path).join(",")}]`;
    }
    if (input.trim()) {
      if (message) message += "\n";
      message += input.trim();
    }
    const capturedPreviews = pendingImages.map(img => ({ preview: img.preview, name: img.name }));
    onUserSend?.(message, capturedPreviews.length > 0 ? capturedPreviews : undefined);
    await axios.post(
      `/api/runs/${runId}/chat`,
      { message },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    setInput("");
    setPendingImages([]);
    setPendingFile(null);
    setSending(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    setSending(true);
    try {
      const { data } = await axios.post<{ file_path: string }>(
        `/api/runs/${runId}/upload`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" } }
      );
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const tag = ext === "csv" || ext === "xlsx"
        ? `[UPLOADED_CSV: ${data.file_path}]`
        : `[UPLOADED_PDF: ${data.file_path}]`;
      // Stage as pending — don't send yet; user sends with the message
      setPendingFile({ path: data.file_path, name: file.name, tag });
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSending(true);
    try {
      const uploaded: Array<{path: string; name: string; preview: string}> = [];
      for (const file of files.slice(0, 10)) {
        const formData = new FormData();
        formData.append("file", file);
        const { data } = await axios.post<{ file_path: string; filename: string }>(
          `/api/runs/${runId}/upload`,
          formData,
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" } }
        );
        const preview = URL.createObjectURL(file);
        uploaded.push({ path: data.file_path, name: file.name, preview });
      }
      setPendingImages(prev => [...prev, ...uploaded].slice(0, 10));
    } finally {
      setSending(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const renderUserContent = (content: string, images?: Array<{preview: string; name: string}>) => {
    const displayText = content
      .replace(/\[UPLOADED_IMAGES:[^\]]+\]/g, "")
      .replace(/\[UPLOADED_PDF:[^\]]+\]/g, "")
      .replace(/\[UPLOADED_CSV:[^\]]+\]/g, "")
      .trim();
    const hasImages = images && images.length > 0;
    const imgTagMatch = !hasImages ? content.match(/\[UPLOADED_IMAGES:\s*([^\]]+)\]/) : null;
    const imgFileNames = imgTagMatch ? imgTagMatch[1].split(",").map(f => f.trim()) : [];

    // Extract PDF/CSV file name from tag for the file bubble
    const pdfMatch = content.match(/\[UPLOADED_PDF:\s*([^\]]+)\]/);
    const csvMatch = content.match(/\[UPLOADED_CSV:\s*([^\]]+)\]/);
    const uploadedFilePath = pdfMatch?.[1] ?? csvMatch?.[1] ?? null;
    const uploadedFileExt = csvMatch ? (uploadedFilePath?.endsWith(".xlsx") ? "xlsx" : "csv") : (uploadedFilePath ? "pdf" : null);
    const uploadedFileName = uploadedFilePath
      ? uploadedFilePath.split("/").pop()?.replace(/^[a-f0-9-]+_/, "") ?? uploadedFilePath.split("/").pop() ?? ""
      : "";

    const fileIconColor = "#6b7280";
    const fileBgColor = "rgba(107,114,128,0.08)";

    return (
      <>
        {hasImages && images.map((img, idx) => (
          <img key={idx} src={img.preview} alt={img.name}
               style={{ maxWidth: "100%", maxHeight: 180, borderRadius: 8, marginBottom: displayText ? 6 : 0, display: "block" }} />
        ))}
        {!hasImages && imgFileNames.map((name, idx) => {
          const displayName = name.split("/").pop()?.replace(/^[a-f0-9-]+_/, "") ?? name;
          return (
            <div key={idx} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 10, padding: "8px 12px", marginBottom: displayText ? 8 : 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{displayName}</span>
                <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>image</span>
              </div>
            </div>
          );
        })}
        {uploadedFilePath && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: fileBgColor, border: `1px solid ${fileIconColor}22`, borderRadius: 10, padding: "8px 12px", marginBottom: displayText ? 8 : 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, background: fileIconColor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                {uploadedFileName}
              </span>
              <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>{uploadedFileExt}</span>
            </div>
          </div>
        )}
        {displayText && <span>{displayText}</span>}
      </>
    );
  };

  return (
    <div style={styles.container}>
      {/* Keyframe for agent name slide-in animation */}
      <style>{`
        @keyframes agent-name-slide {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>

      {/* In-panel header: agent icon, name (animated), status pill, back button */}
      {workflowId && (
        <div style={styles.panelHeader}>
          <div style={styles.panelHeaderLeft}>
            <div style={{ ...styles.panelAgentIcon, background: headerDisplay.gradient }}>
              <span style={styles.avatarText}>{headerDisplay.initials}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span key={nameKey} style={styles.panelAgentName}>
                {headerDisplay.name}
              </span>
              {(runStatus === "running" || runStatus === "pending") && (
                <div style={styles.panelStatusPill}>
                  <div style={styles.panelStatusDot} />
                  <span>Running</span>
                </div>
              )}
              {runStatus === "completed" && (
                <div style={{ ...styles.panelStatusPill, background: "rgba(22,163,74,0.1)", color: "#16a34a" }}>
                  <div style={{ ...styles.panelStatusDot, background: "#16a34a", animation: "none" }} />
                  <span>Completed</span>
                </div>
              )}
            </div>
          </div>
          {onNewRun && (
            <button style={styles.panelBackBtn} onClick={onNewRun}>← New request</button>
          )}
        </div>
      )}

      {/* Outer scroll container */}
      <div style={styles.messagesOuter}>
        {/* Inner wrapper: flex column, min-height 100% so messages anchor to bottom */}
        <div style={styles.messagesInner}>
          {messages.map((m, i) => {
            if (m.role === "user") {
              const isLastUserMsg = i === messages.length - 1 || !messages.slice(i + 1).some(x => x.role === "user");
              const hasImageTag = m.content.includes("[UPLOADED_IMAGES:");
              const imgs = isLastUserMsg && hasImageTag ? (optimisticImages ?? m.images) : m.images;
              return (
                <div key={i} style={styles.userBubbleWrapper}>
                  <div style={styles.userBubble}>{renderUserContent(m.content, imgs)}</div>
                </div>
              );
            }
            if (m.workflowId === "heimdall") {
              return (
                <React.Fragment key={i}>
                  <OperatorCard content={m.content} />
                </React.Fragment>
              );
            }
            const display: WorkflowDisplay = (m.workflowId
              ? workflowDisplayMap?.[m.workflowId]
              : undefined) ?? { personaName: "Agent", initials: "AG" };
            const previewLabel =
              m.preview?.type === "tickets" ? "Preview tickets" :
              m.preview?.type === "answer" ? "Preview answer" : null;
            return (
              <React.Fragment key={i}>
                <AgentCard content={m.content} display={display} />
                {m.preview && previewLabel && (
                  <div style={styles.previewBtnWrapper}>
                    <button
                      style={styles.previewBtn}
                      onClick={() => onPreview?.(m.preview!)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                      {previewLabel}
                    </button>
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {/* Agent chips — shown when Heimdall has low-confidence routing */}
          {agentChips && agentChips.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, padding: "4px 0 8px 0" }}>
              {agentChips.map((name) => (
                <button
                  key={name}
                  onClick={() => onChipSelect?.(name)}
                  style={{
                    padding: "5px 14px",
                    borderRadius: 20,
                    border: "1.5px solid #6366f1",
                    background: "white",
                    color: "#6366f1",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          {/* Typing indicator — shown while agent is processing but hasn't responded yet */}
          {agentTyping && (
            <div style={styles.typingCard}>
              <div style={styles.typingDots}>
                <div style={{ ...styles.typingDot, animationDelay: "0ms" }} />
                <div style={{ ...styles.typingDot, animationDelay: "160ms" }} />
                <div style={{ ...styles.typingDot, animationDelay: "320ms" }} />
              </div>
              <span style={styles.typingLabel}>Agent is thinking…</span>
            </div>
          )}

          {pendingGate && (
            <div style={styles.gateInChat}>
              <ApprovalGate gate={pendingGate} runId={runId} token={token} onResolved={onGateResolved} />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <ExecutionTrace
        runId={runId}
        token={token}
        open={traceOpen}
        onClose={() => setTraceOpen(false)}
        runStatus={runStatus}
        liveEntries={liveLogEntries ?? []}
      />

      {runStatus === "failed" && (
        <div style={styles.errorBanner}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
            <span>⚠ The agent encountered an error and could not complete.</span>
            {runError && (
              <span style={{ ...styles.errorBanner, fontFamily: "monospace", fontSize: 11, padding: 0, background: "transparent", color: "#b91c1c", wordBreak: "break-all" as const }}>{runError}</span>
            )}
          </div>
          {onNewRun && (
            <button style={styles.newRunBtn} onClick={onNewRun}>
              Start a new run
            </button>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.csv,.xlsx"
        style={{ display: "none" }}
        onChange={handleFileUpload}
        disabled={sending || runStatus === "failed"}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        style={{ display: "none" }}
        onChange={handleImageUpload}
        disabled={sending || runStatus === "failed"}
      />

      <div style={styles.inputOuter}>
        <div style={styles.inputBox}>
          {(pendingImages.length > 0 || pendingFile) && (
            <div style={styles.imagePreviewStrip}>
              {/* Pending file chip (PDF / CSV / XLSX) */}
              {pendingFile && (() => {
                const ext = pendingFile.name.split(".").pop()?.toLowerCase() ?? "";
                const chipColor = "#6b7280";
                const displayName = pendingFile.name.replace(/^[a-f0-9-]+_/, "");
                return (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(107,114,128,0.08)", border: "1px solid rgba(107,114,128,0.2)", borderRadius: 8, padding: "5px 8px", position: "relative" }}>
                    <div style={{ width: 24, height: 24, borderRadius: 4, background: chipColor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
                      </svg>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#1f2937", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
                      <span style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase" }}>{ext}</span>
                    </div>
                    <button
                      style={{ ...styles.imageRemoveBtn, position: "static", marginLeft: 2 }}
                      onClick={() => setPendingFile(null)}
                      title="Remove"
                      type="button"
                    >×</button>
                  </div>
                );
              })()}
              {/* Pending images */}
              {pendingImages.map((img, i) => (
                <div key={i} style={styles.imagePreviewItem}>
                  <img src={img.preview} alt={img.name} style={styles.imagePreviewThumb} />
                  <button
                    style={styles.imageRemoveBtn}
                    onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                    title="Remove"
                    type="button"
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <textarea
            style={styles.textarea}
            placeholder={
              runStatus === "completed"
                ? "Describe a new request to start over, or ask a follow-up..."
                : "Tell me what you need to conquer today."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            disabled={sending || runStatus === "failed"}
          />
          <div style={styles.inputFooter}>
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button
                style={styles.attachBtn}
                title="Attach PDF, CSV or XLSX"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || runStatus === "failed" || runStatus === "completed"}
                type="button"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>
              <button
                style={{ ...styles.attachBtn, color: pendingImages.length > 0 ? "#6366f1" : "#9ca3af" }}
                title="Attach image(s)"
                onClick={() => imageInputRef.current?.click()}
                disabled={sending || runStatus === "failed" || runStatus === "completed"}
                type="button"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                {pendingImages.length > 0 && (
                  <span style={styles.traceBadge}>{pendingImages.length}</span>
                )}
              </button>
              <button
                style={{ ...styles.attachBtn, color: traceOpen ? "#6366f1" : "#9ca3af" }}
                title="Execution trace"
                onClick={() => setTraceOpen(o => !o)}
                type="button"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </button>
            </div>
            <button style={{ ...styles.sendBtn, opacity: (input.trim() || pendingImages.length > 0 || pendingFile) ? 1 : 0.5 }} onClick={send} disabled={sending || (!input.trim() && pendingImages.length === 0 && !pendingFile) || runStatus === "failed"}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    background: "transparent",
  },
  // Outer scroll container — takes all available vertical space
  messagesOuter: {
    flex: 1,
    overflowY: "auto",
    minHeight: 0,
  },
  // Inner wrapper: min-height 100% + justify-content flex-end
  // → with few messages they anchor to the bottom; with many they scroll normally
  messagesInner: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    minHeight: "100%",
    padding: "20px 16px",
    gap: 12,
    boxSizing: "border-box" as const,
  },

  // ── User bubble ───────────────────────────────────────────────────────────────
  userBubbleWrapper: {
    display: "flex",
    justifyContent: "flex-end",
  },
  userBubble: {
    maxWidth: "82%",
    padding: "10px 16px",
    borderRadius: "18px 18px 4px 18px",
    fontSize: 14,
    lineHeight: 1.6,
    background: "linear-gradient(135deg, #7c3aed, #6366f1)",
    color: "#fff",
    wordBreak: "break-word" as const,
    boxShadow: "0 2px 8px rgba(99,102,241,0.25)",
  },

  // ── Agent cards ───────────────────────────────────────────────────────────────
  agentCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "14px 16px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05)",
    fontSize: 14,
    color: "#111827",
  },
  cardHeaderRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.03em",
  },
  agentLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#6366f1",
    letterSpacing: "0.07em",
    lineHeight: 1.3,
  },
  agentSubLabel: {
    fontSize: 10,
    fontWeight: 400,
    color: "#9ca3af",
    letterSpacing: "0.02em",
  },
  cardDivider: {
    height: 1,
    background: "#f3f4f6",
    margin: "10px 0",
  },
  stepsBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    padding: "2px 0",
  },
  stepRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  checkCircle: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "#22c55e",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stepText: {
    fontSize: 13,
    color: "#4b5563",
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 1.65,
    color: "#1f2937",
    wordBreak: "break-word" as const,
    overflowWrap: "anywhere" as const,
  },

  // ── Shared ────────────────────────────────────────────────────────────────────
  gateInChat: { width: "100%" },

  // ── Typing indicator ─────────────────────────────────────────────────────────
  typingCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
    alignSelf: "flex-start",
  },
  typingDots: {
    display: "flex",
    gap: 4,
    alignItems: "center",
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#6366f1",
    animation: "pulse-dot 1.2s ease-in-out infinite",
  },
  typingLabel: {
    fontSize: 12,
    color: "#9ca3af",
    fontStyle: "italic" as const,
  },
  errorBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    background: "rgba(254,242,242,0.9)",
    color: "#dc2626",
    fontSize: 13,
  },
  newRunBtn: {
    padding: "4px 12px",
    background: "#dc2626",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
    flexShrink: 0 as const,
  },
  inputOuter: {
    display: "flex",
    justifyContent: "center",
    padding: "8px 12px 14px",
    background: "transparent",
  },
  inputBox: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    background: "#fff",
    borderRadius: 14,
    padding: "10px 12px 8px",
    boxShadow: "0 2px 12px rgba(99,102,241,0.10), 0 1px 3px rgba(0,0,0,0.04)",
    border: "1px solid rgba(99,102,241,0.15)",
    boxSizing: "border-box" as const,
  },
  inputFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  attachBtn: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
    background: "transparent",
    border: "none",
    borderRadius: 6,
    color: "#9ca3af",
    cursor: "pointer",
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    padding: "4px 8px",
    borderRadius: 0,
    border: "none",
    fontSize: 14,
    resize: "none",
    fontFamily: "inherit",
    background: "transparent",
    outline: "none",
    color: "#111827",
    lineHeight: 1.5,
  },
  traceBadge: {
    position: "absolute" as const,
    top: 2,
    right: 2,
    background: "#6366f1",
    color: "#fff",
    borderRadius: "50%",
    fontSize: 9,
    fontWeight: 700,
    width: 14,
    height: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none" as const,
  },
  sendBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    padding: 0,
    background: "linear-gradient(135deg, #7c3aed, #6366f1)",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    cursor: "pointer",
    flexShrink: 0,
  },
  imagePreviewStrip: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
    padding: "6px 0 2px",
    marginBottom: 4,
  },
  imagePreviewItem: {
    position: "relative" as const,
    display: "inline-flex",
  },
  imagePreviewThumb: {
    width: 44,
    height: 44,
    objectFit: "cover" as const,
    borderRadius: 6,
  },
  imageRemoveBtn: {
    position: "absolute" as const,
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    fontSize: 11,
    lineHeight: 1,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },

  // ── In-panel header ───────────────────────────────────────────────────────────
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px 10px",
    background: "transparent",
    flexShrink: 0,
  },
  panelHeaderLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  panelAgentIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxShadow: "0 2px 6px rgba(99,102,241,0.28)",
  },
  panelAgentName: {
    fontSize: 14,
    fontWeight: 700,
    color: "#1a1a3e",
    letterSpacing: "-0.01em",
    animation: "agent-name-slide 0.35s ease-out",
  },
  panelStatusPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 7px",
    background: "rgba(99,102,241,0.1)",
    color: "#4338ca",
    borderRadius: 20,
    fontSize: 10,
    fontWeight: 600,
    alignSelf: "flex-start",
  },
  panelStatusDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "#6366f1",
    animation: "pulse-dot 1.4s ease-in-out infinite",
    flexShrink: 0,
  },
  panelBackBtn: {
    padding: "5px 12px",
    background: "rgba(255,255,255,0.55)",
    border: "none",
    borderRadius: 7,
    fontSize: 12,
    cursor: "pointer",
    color: "#4b5563",
    fontWeight: 500,
    boxShadow: "0 1px 3px rgba(0,0,0,0.09)",
    flexShrink: 0,
  },

  // ── Preview button ────────────────────────────────────────────────────────────
  previewBtnWrapper: {
    padding: "2px 0 4px",
  },
  previewBtn: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "10px 16px",
    background: "rgba(99,102,241,0.09)",
    border: "1.5px solid rgba(99,102,241,0.22)",
    borderRadius: 10,
    color: "#4338ca",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.01em",
    boxSizing: "border-box" as const,
  },
};
