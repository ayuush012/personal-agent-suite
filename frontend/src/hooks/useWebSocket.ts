import { useEffect, useRef, useState } from "react";
import type { WsEvent } from "@/types";

// Derive WS base from the page origin so it works in dev, behind an ALB, and behind any custom domain
// without rebuilding. Fall back to VITE_WS_URL or localhost only when window is unavailable (SSR / tests).
const WS_BASE =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`
    : (import.meta.env.VITE_WS_URL ?? "ws://localhost:8000");

export function useRunWebSocket(
  runId: string | null,
  onEvent: (e: WsEvent) => void,
  onOpen?: () => void,
  token?: string,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const onEventRef = useRef(onEvent);
  const onOpenRef = useRef(onOpen);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);

  useEffect(() => {
    if (!runId) return;

    let retryCount = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      const url = `${WS_BASE}/api/runs/${runId}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCount = 0;
        setConnected(true);
        // Send JWT as first frame — keeps token out of URL and server logs
        if (token) ws.send(token);
        onOpenRef.current?.();
      };

      ws.onclose = (e) => {
        setConnected(false);
        if (closed) return;
        // Do not retry on auth failure, access denied, or intentional close
        if (e.code === 4001 || e.code === 4003 || e.code === 1000) return;
        const delayMs = Math.min(1000 * Math.pow(2, retryCount), 30_000);
        retryCount++;
        retryTimeout = setTimeout(connect, delayMs);
      };

      ws.onerror = () => setConnected(false);

      ws.onmessage = (msg) => {
        try {
          onEventRef.current(JSON.parse(msg.data) as WsEvent);
        } catch {
          // ignore malformed frames
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      wsRef.current?.close();
    };
  }, [runId, token]);

  return { connected };
}
