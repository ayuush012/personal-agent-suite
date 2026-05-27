import React from "react";
import type { WorkflowRun, WsEvent, GateEvent, GateAction } from "@/types";
import { ApprovalGate } from "@/components/ApprovalGate";

interface Props {
  run: WorkflowRun;
  events: WsEvent[];
  pendingGate: GateEvent | null;
  token: string;
  onGateResolved: (action: GateAction) => void;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "#9ca3af",
  running: "#6366f1",
  awaiting_gate: "#f59e0b",
  completed: "#10b981",
  failed: "#ef4444",
  cancelled: "#6b7280",
};

export function RunDashboard({ run, events, pendingGate, token, onGateResolved }: Props) {
  const stepEvents = events.filter(
    (e) => e.event === "step_started" || e.event === "step_completed"
  ) as Extract<WsEvent, { event: "step_started" | "step_completed" }>[];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <span style={styles.workflowId}>{run.workflow_id}</span>
          <span style={{ ...styles.statusBadge, background: STATUS_COLOR[run.status] }}>
            {run.status.replace("_", " ")}
          </span>
        </div>
        <span style={styles.runId}>Run {run.run_id.slice(0, 8)}</span>
      </div>

      {pendingGate && (
        <ApprovalGate gate={pendingGate} runId={run.run_id} token={token} onResolved={onGateResolved} />
      )}

      <div style={styles.timeline}>
        <h3 style={styles.sectionTitle}>Pipeline Progress</h3>
        {stepEvents.length === 0 && (
          <p style={{ fontSize: 13, color: "#9ca3af" }}>Waiting for first step...</p>
        )}
        {stepEvents.map((e, i) => (
          <div key={i} style={styles.stepRow}>
            <span
              style={{
                ...styles.stepDot,
                background: e.event === "step_completed" ? "#10b981" : "#6366f1",
              }}
            />
            <span style={styles.stepLabel}>
              Step {e.step + 1} — <strong>{e.agent}</strong>
            </span>
            <span style={styles.stepStatus}>
              {e.event === "step_completed" ? "Done" : "Running..."}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", gap: 16 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "14px 20px",
  },
  workflowId: { fontWeight: 600, fontSize: 15, marginRight: 10 },
  statusBadge: {
    fontSize: 11,
    color: "#fff",
    borderRadius: 4,
    padding: "2px 8px",
    fontWeight: 500,
    textTransform: "capitalize",
  },
  runId: { fontSize: 12, color: "#9ca3af", fontFamily: "monospace" },
  timeline: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 20,
  },
  sectionTitle: { margin: "0 0 14px", fontSize: 14, fontWeight: 600 },
  stepRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  stepDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  stepLabel: { fontSize: 13, flex: 1 },
  stepStatus: { fontSize: 12, color: "#9ca3af" },
};
