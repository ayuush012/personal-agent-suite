import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";

interface Integration {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "not_configured" | "error";
  last_checked?: string;
  error?: string;
  // Google Chat extras
  spaces?: string[];
  space_count?: number;
  last_message_at?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  token: string;
}

const APP_ICONS: Record<string, React.ReactNode> = {
  atlassian: (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
      <path d="M11.5 16.8c-3.1-4-5.4-7.6-5.4-7.6a.5.5 0 0 0-.85 0L1.1 15.9a.5.5 0 0 0 .01.52l9.29 14.28c.17.26.54.26.71 0l2.65-4.07-2.26-9.83z" fill="#2684FF"/>
      <path d="M30.89 15.9l-4.11-6.7a.5.5 0 0 0-.85 0s-2.3 3.6-5.41 7.6l-2.26 9.83 2.65 4.07c.17.26.54.26.71 0l9.29-14.28a.5.5 0 0 0-.02-.52z" fill="#2684FF"/>
      <path d="M16.5 8.5C14.6 5.8 14.1 4 16.03 1.3a.5.5 0 0 0-.84-.54C12.72 3.9 13.2 6.6 15.5 9.6l1 1.4 1.22-1.1-1.22-1.4z" fill="#2684FF"/>
    </svg>
  ),
  figma: (
    <svg width="22" height="22" viewBox="0 0 38 57" fill="none">
      <path d="M19 28.5A9.5 9.5 0 1 1 28.5 19 9.5 9.5 0 0 1 19 28.5z" fill="#1ABCFE"/>
      <path d="M9.5 47.5A9.5 9.5 0 0 1 19 38v9.5a9.5 9.5 0 0 1-9.5 0z" fill="#0ACF83"/>
      <path d="M0 28.5A9.5 9.5 0 0 1 9.5 19H19v9.5a9.5 9.5 0 0 1-9.5 9.5A9.5 9.5 0 0 1 0 28.5z" fill="#A259FF"/>
      <path d="M0 9.5A9.5 9.5 0 0 1 9.5 0H19v19H9.5A9.5 9.5 0 0 1 0 9.5z" fill="#F24E1E"/>
      <path d="M19 0h9.5a9.5 9.5 0 0 1 0 19H19V0z" fill="#FF7262"/>
    </svg>
  ),
  google_drive: (
    <svg width="22" height="22" viewBox="0 0 87.3 78" fill="none">
      <path d="M6.6 66.85L23.7 49.8l-8.45-14.64L0 53.65z" fill="#0066DA"/>
      <path d="M43.65 78l17.1-17.1H9.55L26.65 78z" fill="#00AC47"/>
      <path d="M43.65 0L26.55 29.6l17.1 29.2L60.75 29.6z" fill="#EA4335"/>
      <path d="M43.65 0L60.75 29.6h26.55L43.65 0z" fill="#00832D"/>
      <path d="M87.3 53.65L70.2 35.16l-8.45 14.64 17.1 17.05z" fill="#2684FC"/>
      <path d="M60.75 29.6l8.45 14.64L87.3 53.65l-26.55-24.05z" fill="#FFBA00"/>
      <path d="M26.55 29.6L0 53.65l26.55-24.05z" fill="#00AC47"/>
    </svg>
  ),
  gong: (
    <svg width="22" height="22" viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="8" fill="#FF4F00"/>
      <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle"
            fill="white" fontSize="16" fontWeight="700" fontFamily="sans-serif">
        G
      </text>
    </svg>
  ),
  google_chat: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="#00BCD4"/>
      <circle cx="7" cy="11" r="1.5" fill="white"/>
      <circle cx="12" cy="11" r="1.5" fill="white"/>
      <circle cx="17" cy="11" r="1.5" fill="white"/>
    </svg>
  ),
};

const STATUS_CONFIG = {
  connected:      { label: "Connected",      color: "#057a55", bg: "rgba(0,200,120,0.1)",  dot: "#10b981" },
  disconnected:   { label: "Disconnected",   color: "#b91c1c", bg: "rgba(239,68,68,0.1)", dot: "#ef4444" },
  not_configured: { label: "Not configured", color: "#6b7280", bg: "rgba(107,114,128,0.1)", dot: "#9ca3af" },
  error:          { label: "Error",           color: "#b45309", bg: "rgba(245,158,11,0.1)", dot: "#f59e0b" },
};

const OAUTH_INTEGRATIONS = new Set(["atlassian", "figma", "gong"]);

export function AppsPanel({ isOpen, onClose, token }: Props) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const headers = { Authorization: `Bearer ${token}` };

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get("/api/integrations/status", { headers });
      setIntegrations(data.integrations ?? []);
    } catch {
      // keep previous state
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isOpen) fetchStatus();
  }, [isOpen, fetchStatus]);

  const handleReconnect = async (id: string, forceReauth = false) => {
    setReconnecting(id);
    setRowError((p) => ({ ...p, [id]: "" }));
    try {
      const { data } = await axios.post(
        `/api/integrations/${id}/reconnect`,
        { force_reauth: forceReauth },
        { headers },
      );

      if (data.requires_oauth && data.auth_url) {
        // Full-page redirect — avoids popup blockers.
        // After OAuth the user lands back at /?atlassian_connected=true (or similar)
        // which triggers an auto-refresh of the Apps panel.
        window.location.href = data.auth_url;
        return;
      }

      if (data.success) {
        // Refresh just this row
        await fetchStatus();
      } else if (data.reconnect_unsupported) {
        setRowError((p) => ({ ...p, [id]: "Reconnect not available for this integration." }));
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Reconnect failed.";
      setRowError((p) => ({ ...p, [id]: msg }));
    } finally {
      setReconnecting(null);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.18)",
          zIndex: 1000,
        }}
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: 380,
        background: "#ffffff",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)",
        borderRadius: "12px 0 0 12px",
        zIndex: 1001,
        display: "flex",
        flexDirection: "column",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 20px 14px",
          borderBottom: "none",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#111827" }}>Connected Apps</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
              Status is checked live each time you open this panel.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#6b7280", fontSize: 20, lineHeight: 1, padding: 4,
              borderRadius: 6,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} style={{
                  height: 72, borderRadius: 10,
                  background: "rgba(107,114,128,0.08)",
                  animation: "pulse 1.4s ease-in-out infinite",
                }} />
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {integrations.map((intg) => {
                const sc = STATUS_CONFIG[intg.status] ?? STATUS_CONFIG.error;
                const isReconnecting = reconnecting === intg.id;
                const canReconnect = OAUTH_INTEGRATIONS.has(intg.id) && intg.status !== "connected";
                const canReauthorize = OAUTH_INTEGRATIONS.has(intg.id);
                const err = rowError[intg.id];

                return (
                  <div key={intg.id} style={{
                    background: "#fafafa",
                    borderRadius: 10,
                    padding: "14px 14px 12px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.04)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {/* Icon */}
                      <div style={{
                        width: 40, height: 40, borderRadius: 10,
                        background: "#f3f4f6",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        {APP_ICONS[intg.id] ?? (
                          <span style={{ fontSize: 18 }}>🔌</span>
                        )}
                      </div>

                      {/* Name + status */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>
                          {intg.name}
                          {intg.id === "atlassian" && (
                            <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af", marginLeft: 5 }}>
                              Jira + Confluence
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                          <span style={{
                            display: "inline-block",
                            width: 7, height: 7, borderRadius: "50%",
                            background: sc.dot, flexShrink: 0,
                          }} />
                          <span style={{
                            fontSize: 12, fontWeight: 500,
                            color: sc.color,
                            background: sc.bg,
                            borderRadius: 5,
                            padding: "1px 7px",
                          }}>
                            {sc.label}
                            {intg.id === "google_chat" && intg.space_count != null && intg.status === "connected" && (
                              <span style={{ fontWeight: 400, marginLeft: 4 }}>
                                — {intg.space_count} {intg.space_count === 1 ? "space" : "spaces"}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Reconnect (disconnected only) + Reauthorize (always for OAuth) */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
                        {canReconnect && (
                          <button
                            onClick={() => handleReconnect(intg.id, false)}
                            disabled={isReconnecting}
                            style={{
                              padding: "5px 12px",
                              background: isReconnecting ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.9)",
                              border: "1px solid rgba(99,102,241,0.3)",
                              borderRadius: 7,
                              fontSize: 12,
                              fontWeight: 500,
                              color: "#4338ca",
                              cursor: isReconnecting ? "default" : "pointer",
                              whiteSpace: "nowrap",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                            }}
                          >
                            {isReconnecting ? "Connecting…" : "Reconnect"}
                          </button>
                        )}
                        {canReauthorize && (
                          <button
                            onClick={() => handleReconnect(intg.id, true)}
                            disabled={isReconnecting}
                            style={{
                              padding: "5px 12px",
                              background: isReconnecting ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.9)",
                              border: "1px solid rgba(99,102,241,0.15)",
                              borderRadius: 7,
                              fontSize: 12,
                              fontWeight: 500,
                              color: "#6b7280",
                              cursor: isReconnecting ? "default" : "pointer",
                              whiteSpace: "nowrap",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                            }}
                          >
                            Reauthorize
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Google Chat: space names + last message */}
                    {intg.id === "google_chat" && intg.status === "connected" && intg.spaces && intg.spaces.length > 0 && (
                      <div style={{ marginTop: 8, paddingLeft: 52 }}>
                        {intg.spaces.map((space) => (
                          <div key={space} style={{
                            fontSize: 11, color: "#374151",
                            display: "flex", alignItems: "center", gap: 5,
                            marginBottom: 2,
                          }}>
                            <span style={{ color: "#9ca3af", fontSize: 10 }}>▸</span>
                            {space}
                          </div>
                        ))}
                        {intg.last_message_at && (
                          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
                            Last message: {new Date(intg.last_message_at + "Z").toLocaleString(undefined, {
                              day: "2-digit", month: "short", year: "numeric",
                              hour: "2-digit", minute: "2-digit",
                              timeZoneName: "short",
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Error from status check */}
                    {intg.error && intg.status !== "connected" && (
                      <div style={{
                        marginTop: 6, fontSize: 11, color: "#92400e",
                        background: "rgba(245,158,11,0.08)",
                        borderRadius: 6, padding: "3px 8px",
                      }}>
                        {intg.error}
                      </div>
                    )}

                    {/* Inline error from reconnect attempt */}
                    {err && (
                      <div style={{
                        marginTop: 6, fontSize: 11, color: "#b91c1c",
                        background: "rgba(239,68,68,0.06)",
                        borderRadius: 6, padding: "3px 8px",
                      }}>
                        {err}
                      </div>
                    )}

                    {/* Last checked */}
                    {intg.last_checked && (
                      <div style={{ marginTop: 6, fontSize: 10, color: "#9ca3af" }}>
                        Checked {new Date(intg.last_checked).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 16px 14px",
          display: "flex", justifyContent: "flex-end",
        }}>
          <button
            onClick={fetchStatus}
            disabled={loading}
            style={{
              padding: "5px 14px",
              background: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(99,102,241,0.25)",
              borderRadius: 7, fontSize: 12, fontWeight: 500,
              color: "#4338ca", cursor: loading ? "default" : "pointer",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
    </>
  );
}
