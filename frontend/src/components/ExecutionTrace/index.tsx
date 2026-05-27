import React, { useState, useEffect, useRef } from "react";

interface LogEntry {
  timestamp: string;
  agent: string;
  level: string;
  event: string;
  metadata: Record<string, unknown>;
}

interface Props {
  runId: string;
  token: string;
  open: boolean;
  onClose: () => void;
  runStatus?: string;
  liveEntries?: LogEntry[];
}

const LEVEL_COLOR: Record<string, string> = {
  debug:   "#9ca3af",
  info:    "#374151",
  warning: "#d97706",
  error:   "#dc2626",
};

const LEVEL_DOT: Record<string, string> = {
  debug:   "#d1d5db",
  info:    "#6366f1",
  warning: "#f59e0b",
  error:   "#ef4444",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
  } catch {
    return iso;
  }
}

function formatMetadata(meta: Record<string, unknown>): string {
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  return parts.length ? `  · ${parts.join(" · ")}` : "";
}

export function ExecutionTrace({ runId, token, open, onClose, runStatus, liveEntries = [] }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [fetched, setFetched] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Merge live WebSocket entries
  useEffect(() => {
    if (liveEntries.length === 0) return;
    setEntries(prev => {
      const existing = new Set(prev.map(e => e.timestamp + e.event));
      const fresh = liveEntries.filter(e => !existing.has(e.timestamp + e.event));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, [liveEntries]);

  // Fetch full log history when panel is first opened
  useEffect(() => {
    if (!open || fetched) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/logs`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data: LogEntry[] = await res.json();
        if (!cancelled) {
          setEntries(data);
          setFetched(true);
        }
      } catch {
        // silently ignore — live entries are still shown
      }
    })();
    return () => { cancelled = true; };
  }, [open, fetched, runId, token]);

  // Re-fetch when run completes to capture final state
  useEffect(() => {
    if (runStatus === "completed" || runStatus === "failed") {
      setFetched(false);
    }
  }, [runStatus]);

  // Scroll to bottom when new entries arrive
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, open]);

  const count = entries.length || liveEntries.length;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div style={styles.backdrop} onClick={onClose} />

      {/* Side panel */}
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.title}>Execution trace</span>
          {count > 0 && <span style={styles.badge}>{count}</span>}
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={styles.logList}>
          {entries.length === 0 ? (
            <div style={styles.empty}>No trace events yet.</div>
          ) : (
            entries.map((entry, i) => (
              <div key={i} style={styles.row}>
                <span style={styles.time}>{formatTime(entry.timestamp)}</span>
                <span style={{ ...styles.dot, background: LEVEL_DOT[entry.level] ?? "#6366f1" }} />
                <span style={styles.agent}>[{entry.agent}]</span>
                <span style={{ ...styles.eventText, color: LEVEL_COLOR[entry.level] ?? "#374151" }}>
                  {entry.event}
                </span>
                {Object.keys(entry.metadata).length > 0 && (
                  <span style={styles.meta}>{formatMetadata(entry.metadata)}</span>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.18)",
    zIndex: 100,
  },
  panel: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: 400,
    background: "#fff",
    boxShadow: "-4px 0 24px rgba(0,0,0,0.10)",
    zIndex: 101,
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "16px 20px",
    borderBottom: "1px solid #e8e8f0",
    flexShrink: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: "#1a1a2e",
  },
  badge: {
    background: "#e0e7ff",
    color: "#4f46e5",
    borderRadius: 10,
    padding: "1px 7px",
    fontSize: 11,
    fontWeight: 600,
  },
  closeBtn: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    background: "none",
    border: "none",
    borderRadius: 6,
    color: "#6b7280",
    cursor: "pointer",
    flexShrink: 0,
  },
  logList: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 20px 20px",
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 11,
    lineHeight: 1.8,
  },
  empty: {
    color: "#9ca3af",
    fontStyle: "italic",
  },
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    flexWrap: "wrap",
  },
  time: {
    color: "#9ca3af",
    flexShrink: 0,
    minWidth: 72,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
    marginTop: 4,
  },
  agent: {
    color: "#7c3aed",
    flexShrink: 0,
  },
  eventText: {
    fontWeight: 500,
  },
  meta: {
    color: "#9ca3af",
    fontSize: 10,
  },
};
