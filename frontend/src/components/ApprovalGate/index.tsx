import React, { useState } from "react";
import axios from "axios";
import type { GateEvent, GateAction } from "@/types";

interface Props {
  gate: GateEvent;
  runId: string;
  token: string;
  onResolved: (action: GateAction) => void;
}

export function ApprovalGate({ gate, runId, token, onResolved }: Props) {
  const [editing, setEditing] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);

  const resolve = async (action: GateAction) => {
    setLoading(true);
    await axios.post(
      `/api/runs/${runId}/gates/${gate.gate_id}`,
      { action, edit_instructions: action === "edited" ? instructions : null },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    setLoading(false);
    onResolved(action);
  };

  return (
    <div style={styles.container}>
      <div style={styles.badge}>Gate {gate.gate_index + 1} — Approval Required</div>
      <p style={styles.prompt}>{gate.prompt}</p>

      <div style={styles.context}>
        {gate.context_keys.map((key) => (
          <div key={key} style={styles.contextBlock}>
            <span style={styles.contextKey}>{key}</span>
            <pre style={styles.contextValue}>{JSON.stringify(gate.context[key], null, 2)}</pre>
          </div>
        ))}
      </div>

      {editing ? (
        <div style={styles.editArea}>
          <textarea
            style={styles.textarea}
            placeholder="Describe your revisions (e.g. reclassify Acme Corp to Enterprise, adjust email tone to be more formal)..."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={4}
          />
          <div style={styles.actions}>
            <button style={styles.btnSecondary} onClick={() => setEditing(false)} disabled={loading}>
              Cancel
            </button>
            <button
              style={styles.btnPrimary}
              onClick={() => resolve("edited")}
              disabled={loading || !instructions.trim()}
            >
              Submit Revision
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.actions}>
          <button style={styles.btnDanger} onClick={() => resolve("rejected")} disabled={loading}>
            Reject
          </button>
          <button style={styles.btnSecondary} onClick={() => setEditing(true)} disabled={loading}>
            Edit & Revise
          </button>
          <button style={styles.btnPrimary} onClick={() => resolve("approved")} disabled={loading}>
            {loading ? "Processing..." : "Approve"}
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "#fff8e1",
    border: "1px solid #f59e0b",
    borderRadius: 8,
    padding: 20,
    margin: "12px 0",
  },
  badge: {
    display: "inline-block",
    background: "#f59e0b",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 4,
    padding: "2px 8px",
    marginBottom: 10,
  },
  prompt: { margin: "0 0 12px", fontSize: 14, lineHeight: 1.5 },
  context: { marginBottom: 16 },
  contextBlock: { marginBottom: 8 },
  contextKey: { fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" },
  contextValue: {
    background: "#f3f4f6",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 12,
    maxHeight: 160,
    overflow: "auto",
    margin: "4px 0 0",
  },
  actions: { display: "flex", gap: 8, justifyContent: "flex-end" },
  editArea: { display: "flex", flexDirection: "column", gap: 8 },
  textarea: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid #d1d5db",
    fontSize: 14,
    resize: "vertical",
  },
  btnPrimary: {
    padding: "8px 18px",
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  btnSecondary: {
    padding: "8px 18px",
    background: "#f3f4f6",
    color: "#374151",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 14,
    cursor: "pointer",
  },
  btnDanger: {
    padding: "8px 18px",
    background: "#fee2e2",
    color: "#dc2626",
    border: "1px solid #fca5a5",
    borderRadius: 6,
    fontSize: 14,
    cursor: "pointer",
  },
};
