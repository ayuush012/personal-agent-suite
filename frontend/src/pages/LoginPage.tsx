import React from "react";

interface Props {
  onLogin?: () => void;
}

export function LoginPage({ onLogin }: Props) {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.logoText}>Asgard</span>
          <span style={styles.logoSub}>Agentic Workflows</span>
        </div>
        <p style={styles.tagline}>
          This hosted demo runs without a login wall. Continue to access the agent workspace.
        </p>
        <button style={styles.button} onClick={onLogin}>
          Continue
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: "48px 40px",
    width: 380,
    textAlign: "center",
    boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
  },
  logo: { display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 16 },
  logoText: { fontSize: 28, fontWeight: 700, color: "#6366f1" },
  logoSub: { fontSize: 13, color: "#9ca3af", marginTop: 2 },
  tagline: { fontSize: 14, color: "#6b7280", lineHeight: 1.6, margin: "0 0 28px" },
  button: {
    border: "none",
    borderRadius: 10,
    background: "#6366f1",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    padding: "10px 18px",
    cursor: "pointer",
  },
};
