import React from "react";
import type { WorkflowSummary } from "@/types";

interface Props {
  workflows: WorkflowSummary[];
  onStart: (workflowId: string) => void;
  loading: boolean;
}

// Map workflow IDs / owner_teams to an icon + function label
const FUNCTION_META: Record<string, { icon: string; label: string }> = {
  gtm:       { icon: "🚀", label: "GTM" },
  sales:     { icon: "💼", label: "Sales" },
  product:   { icon: "🧩", label: "Product" },
  marketing: { icon: "📣", label: "Marketing" },
  revops:    { icon: "📊", label: "RevOps" },
  finance:   { icon: "💰", label: "Finance" },
  hr:        { icon: "👥", label: "HR" },
};

function getCardMeta(w: WorkflowSummary) {
  const team = w.owner_teams[0]?.toLowerCase() ?? "";
  return FUNCTION_META[team] ?? { icon: "⚙️", label: w.owner_teams[0] ?? "General" };
}

export function WorkflowSelector({ workflows, onStart, loading }: Props) {
  if (!workflows.length) {
    return (
      <p style={{ color: "#6b7280", fontSize: 14, textAlign: "center", marginTop: 40 }}>
        No workflows available for this function.
      </p>
    );
  }

  return (
    <div style={styles.grid}>
      {workflows.map((w) => {
        const { icon, label } = getCardMeta(w);
        return (
          <div key={w.id} style={styles.card} onClick={() => !loading && onStart(w.id)}>
            {/* Icon */}
            <div style={styles.iconWrap}>
              <span style={styles.icon}>{icon}</span>
            </div>

            {/* Name */}
            <span style={styles.name}>{w.name}</span>

            {/* Description */}
            <p style={styles.description}>{w.description}</p>

            {/* Function tag */}
            <span style={styles.functionTag}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 16,
    width: "100%",
  },
  card: {
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.9)",
    borderRadius: 14,
    padding: "22px 20px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    cursor: "pointer",
    transition: "transform 0.15s, box-shadow 0.15s",
    boxShadow: "0 2px 12px rgba(99,102,241,0.07)",
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "linear-gradient(135deg, #ede9fe, #e0e7ff)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  icon: {
    fontSize: 22,
    lineHeight: 1,
  },
  name: {
    fontWeight: 700,
    fontSize: 15,
    color: "#1a1a2e",
    lineHeight: 1.3,
  },
  description: {
    fontSize: 13,
    color: "#4b5563",
    margin: 0,
    lineHeight: 1.55,
    flexGrow: 1,
  },
  functionTag: {
    display: "inline-block",
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: 600,
    color: "#6366f1",
    background: "rgba(99,102,241,0.1)",
    borderRadius: 20,
    padding: "3px 10px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginTop: 2,
  },
};
