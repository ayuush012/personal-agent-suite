import React, { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import type { WorkflowSummary, WorkflowRun, WsEvent, GateEvent, GateAction, ChatMessage, AgentLogEntry, User, TicketData, SubtaskData, PreviewData, CortanaSource } from "@/types";
import { WorkflowSelector } from "@/components/WorkflowSelector";
import { ChatPanel } from "@/components/Chat";
import { OutputPanel } from "@/components/OutputPanel";
import { AppsPanel } from "@/components/AppsPanel";
import { useRunWebSocket } from "@/hooks/useWebSocket";

interface Props {
  user: User;
  onLogout: () => void;
}

const SUGGESTIONS = [
  "Learn about AI Builder",
  "Create a Jira ticket",
  "Generate marketing collateral",
  "Draft product release notes",
];

function extractAdfText(doc: unknown): string {
  if (typeof doc === "string") return doc;
  if (!doc || typeof doc !== "object") return "";
  const node = doc as Record<string, unknown>;
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return (node.content as unknown[]).map(extractAdfText).join(
      node.type === "paragraph" || node.type === "heading" ? "\n" : ""
    );
  }
  return "";
}

function getFirstName(email: string) {
  const name = email.split("@")[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}


export function DashboardPage({ user, onLogout }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowsError, setWorkflowsError] = useState<string>("");
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null);
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [pendingGate, setPendingGate] = useState<GateEvent | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [starting, setStarting] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [runState, setRunState] = useState<Record<string, unknown>>({});
  const [pendingInitialPrompt, setPendingInitialPrompt] = useState<string | null>(null);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  // True while the agent is processing (run started, but no assistant message received yet)
  const [agentTyping, setAgentTyping] = useState(false);
  const [optimisticImages, setOptimisticImages] = useState<Array<{preview: string; name: string}>>([]);
  const [agentChips, setAgentChips] = useState<string[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  // True while Cortana is streaming tokens to the Output panel
  const [isCortanaStreaming, setIsCortanaStreaming] = useState(false);
  // Right-panel preview: set when user clicks a per-message Preview button (or auto on generation)
  const [selectedPreview, setSelectedPreview] = useState<PreviewData | null>(null);
  // Apps panel (integration status)
  // Auto-open after OAuth redirect back (?atlassian_connected=true, ?figma_connected=true, or ?gong_connected=true)
  const [appsOpen, setAppsOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("atlassian_connected") || params.has("figma_connected") || params.has("gong_connected");
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("atlassian_connected") || params.has("figma_connected") || params.has("gong_connected")) {
      // Clean the URL so a page refresh doesn't re-trigger the panel
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const headers = { Authorization: `Bearer ${user.access_token}` };
  // Ref so WS callbacks always see the current run without stale closures
  const activeRunRef = useRef<WorkflowRun | null>(null);
  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);
  // Buffer tickets from tickets_preview until the next assistant message arrives
  const pendingTicketsRef = useRef<TicketData[] | null>(null);
  // Buffer ticket from ticket_read / ticket_updated until the next assistant message arrives
  const pendingReadTicketRef = useRef<TicketData[]>([]);
  // Index (in chatMessages) of the last user message — used to bound retroactive preview patching
  // so we never accidentally patch the Jarvis greeting (which predates the user's prompt)
  const userMsgBoundaryRef = useRef(-1);
  // Guard against double-submit (Enter + click race, or rapid presses)
  const isSendingRef = useRef(false);
  // Flips to true the moment the user explicitly clicks Send — used to gate
  // Cortana answers from appearing in the Output panel before any user query.
  // More reliable than userMsgBoundaryRef because it updates synchronously
  // on the Send action, not via WS message ordering during replay.
  const astridUserHasSentRef = useRef(false);
  // Holds sources emitted by answer_sources log event until the next
  // chat_message finalises the answer bubble and picks them up.
  const pendingCortanaSourcesRef = useRef<CortanaSource[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<WorkflowSummary[]>("/api/workflows/", { headers })
      .then((r) => { if (!cancelled) { setWorkflows(r.data); setWorkflowsError(""); } })
      .catch((err) => {
        const msg = `${err?.response?.status ?? "network"}: ${JSON.stringify(err?.response?.data ?? err?.message)}`;
        console.error("[workflows fetch]", msg);
        if (!cancelled) setWorkflowsError(msg);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWsEvent = useCallback((e: WsEvent) => {
    if (e.event === "gate_pending") setPendingGate(e as GateEvent);
    if (e.event === "gate_resolved") setPendingGate(null);

    // Streaming token — render directly in the Output panel (right side).
    // The left chat panel keeps "Agent is thinking…" until the final chat_message.
    if (e.event === "chat_stream") {
      // Only stream to Output when the user has actually sent a query
      if (!astridUserHasSentRef.current) return;
      setAgentTyping(false);
      setIsCortanaStreaming(true);
      const token = (e as { event: string; content: string }).content;
      setSelectedPreview((prev) => ({
        type: "answer",
        content: prev?.type === "answer" ? prev.content + token : token,
        sources: prev?.type === "answer" ? prev.sources : undefined,
        // Preserve all extras patched by answer_extras — late tokens must not wipe them
        ...(prev?.type === "answer" ? {
          people: prev.people,
          whats_new: prev.whats_new,
          open_tickets: prev.open_tickets,
          suggested_questions: prev.suggested_questions,
          intent: prev.intent,
          entities: prev.entities,
          chunks_used: prev.chunks_used,
          hyde_used: prev.hyde_used,
        } : {}),
      }));
      return;
    }

    if (e.event === "chat_message") {
      // First assistant message — clear the typing indicator
      if (e.role === "assistant") { setAgentTyping(false); setOptimisticImages([]); }

      // Compute preview attachment before entering the state updater
      const currentWorkflowId = activeRunRef.current?.workflow_id;
      let preview: ChatMessage["preview"] = undefined;
      if (e.role === "assistant") {
        if (currentWorkflowId === "jarvis" && pendingReadTicketRef.current.length > 0) {
          // ticket_read / ticket_updated arrived before this message — attach now
          preview = { type: "tickets", tickets: pendingReadTicketRef.current };
          pendingReadTicketRef.current = [];
        } else if (currentWorkflowId === "jarvis" && pendingTicketsRef.current) {
          preview = { type: "tickets", tickets: pendingTicketsRef.current };
          pendingTicketsRef.current = null;
        } else if (currentWorkflowId === "cortana") {
          const isErrorResponse =
            typeof e.content === "string" &&
            (e.content.toLowerCase().includes("ran into an error") ||
              e.content.toLowerCase().includes("error searching") ||
              e.content.toLowerCase().includes("please try again") ||
              e.content.toLowerCase().startsWith("sorry,"));
          // A "follow-up only" message is short and contains no real answer content —
          // e.g. "Do you have another question?" sent as a standalone message.
          // Long responses that happen to end with "Is there anything else I can help with?"
          // are ANSWERS, not follow-ups, so we gate on length (< 300 chars).
          const isFollowUpPrompt =
            typeof e.content === "string" &&
            e.content.length < 300 &&
            (e.content.toLowerCase().includes("do you have another question") ||
              e.content.toLowerCase().includes("is there anything else i can help") ||
              e.content.toLowerCase().includes("anything else i can help with"));

          // Mid-stream error: tokens already in Output — clear them so the
          // partial answer doesn't stay stuck, then let the error show in chat.
          if (isErrorResponse && isCortanaStreaming) {
            setIsCortanaStreaming(false);
            setSelectedPreview(null);
          }

          if (astridUserHasSentRef.current && !isErrorResponse && !isFollowUpPrompt) {
            // Streaming already put the answer in Output; just attach sources
            // and stop the streaming cursor.
            const sources = pendingCortanaSourcesRef.current ?? undefined;
            pendingCortanaSourcesRef.current = null;
            setIsCortanaStreaming(false);
            // Finalise selectedPreview with sources — preserve extras already patched
            // by answer_extras (people, whats_new, intent, entities, etc.) which
            // arrive before chat_message and would be lost if we create a fresh object.
            setSelectedPreview((prev) => ({
              type: "answer",
              content: prev?.type === "answer" ? prev.content : e.content,
              sources,
              ...(prev?.type === "answer" ? {
                people: prev.people,
                whats_new: prev.whats_new,
                open_tickets: prev.open_tickets,
                suggested_questions: prev.suggested_questions,
                intent: prev.intent,
                entities: prev.entities,
                chunks_used: prev.chunks_used,
                hyde_used: prev.hyde_used,
              } : {}),
            }));
            preview = { type: "answer", content: e.content, sources };
            // Keep ref true for the lifetime of this Cortana session — every subsequent
            // answer in the same run still belongs in the Output panel. The ref is reset
            // only when a new run starts (see startRun / handleRestartWithMessage).
          }
        }
      }

      // For Cortana answers, show a brief confirmation in the chat bubble.
      // The full answer is already rendered in the Output panel via streaming.
      const isCortanaAnswer = preview?.type === "answer";
      const chatDisplayContent =
        isCortanaAnswer && e.role === "assistant"
          ? "✓ Answer ready — see Output panel →"
          : e.content;

      setChatMessages((prev) => {
        // Skip WS echo of a user message we already added optimistically in handleSend
        if (e.role === "user" && prev.some((m) => m.role === "user" && m.content === e.content)) {
          return prev;
        }
        // Deduplicate: skip if the last message is identical (replay + live-broadcast race)
        const last = prev[prev.length - 1];
        if (last && last.role === e.role && last.content === chatDisplayContent) {
          return prev;
        }
        // Track where user messages land so retroactive patching stays bounded
        if (e.role === "user") {
          userMsgBoundaryRef.current = prev.length;
        }
        return [
          ...prev,
          {
            role: e.role as ChatMessage["role"],
            content: chatDisplayContent,
            created_at: new Date().toISOString(),
            workflowId: currentWorkflowId,
            ...(preview ? { preview } : {}),
          },
        ];
      });
    }
    if (e.event === "agent_log") {
      setAgentLogs((prev) => [
        ...prev,
        { timestamp: new Date().toISOString(), agent: e.agent, level: e.level, event: e.log_event, metadata: e.metadata },
      ]);
      if (e.log_event === "routing_decision" && e.metadata?.confidence === "low") {
        const workflows = e.metadata?.available_workflows ?? [];
        const chips = (workflows as Record<string, string>[]).map((w) => w.agent_name || w.workflow_id || "").filter(Boolean);
        setAgentChips(chips);
      }
      if (e.log_event === "routing_complete") {
        setAgentChips([]);
      }
      // files_ready: make the download button available immediately (before run completes).
      // Merge into existing file_paths so multiple formats (DOCX + CSV) both appear.
      if (e.log_event === "files_ready" && e.metadata?.file_paths) {
        const incomingFilePaths = e.metadata.file_paths as Record<string, string>;
        setRunState((prev) => {
          const prevTickets = (prev.tickets as Record<string, unknown>) ?? {};
          const prevFilePaths = (prevTickets.file_paths as Record<string, string>) ?? {};
          return {
            ...prev,
            tickets: {
              ...prevTickets,
              file_paths: { ...prevFilePaths, ...incomingFilePaths },
            },
          };
        });
      }
      // tickets_created — tickets now exist in Jira; enrich selectedPreview with
      // jira_key on each ticket and store jira_base_url so "Open in Jira" shows
      // immediately without waiting for run_completed.
      if (e.log_event === "tickets_created" && e.metadata) {
        console.log("[tickets_created]", e.metadata);
        const finalTickets = e.metadata.ticket_list as TicketData[];
        if (Array.isArray(finalTickets) && finalTickets.length > 0) {
          setSelectedPreview({ type: "tickets", tickets: finalTickets });
        }
        setRunState((prev) => {
          const prevTickets = (prev.tickets as Record<string, unknown>) ?? {};
          return {
            ...prev,
            tickets: {
              ...prevTickets,
              jira_base_url: e.metadata?.jira_base_url ?? "",
              project_key:   e.metadata?.project_key   ?? "",
              created_keys:  e.metadata?.created_keys  ?? [],
              ticket_list:   finalTickets,
            },
          };
        });
      }
      // tickets_preview — bidirectional attach:
      // • Forward:     buffer in ref so the NEXT Jarvis chat_message picks it up
      // • Retroactive: if the chat_message ALREADY arrived first (ordering race),
      //                find the last unpreviewed Jarvis message and patch it now
      if (e.log_event === "tickets_preview" && e.metadata?.tickets) {
        const incomingTickets = e.metadata.tickets as TicketData[];
        pendingTicketsRef.current = incomingTickets; // forward buffer
        setSelectedPreview({ type: "tickets", tickets: incomingTickets });
        // Retroactive patch — only search messages that arrived AFTER the last user message
        // (prevents patching the Jarvis greeting which predates the user's requirement prompt)
        setChatMessages((prev) => {
          const boundary = userMsgBoundaryRef.current;
          let patchIdx = -1;
          for (let i = prev.length - 1; i > boundary; i--) {
            if (
              prev[i].role === "assistant" &&
              prev[i].workflowId === "jarvis" &&
              !prev[i].preview
            ) {
              patchIdx = i;
              break;
            }
          }
          if (patchIdx === -1) return prev; // no eligible message yet — forward buffer handles it
          // Patched retroactively — no need to forward-attach
          pendingTicketsRef.current = null;
          const updated = [...prev];
          updated[patchIdx] = {
            ...updated[patchIdx],
            preview: { type: "tickets", tickets: incomingTickets },
          };
          return updated;
        });
        setRunState((prev) => {
          const prevTickets = (prev.tickets as Record<string, unknown>) ?? {};
          return {
            ...prev,
            tickets: { ...prevTickets, ticket_list: incomingTickets },
          };
        });
      }
      // ticket_read / ticket_updated — show as a ticket tile using the same card design
      if ((e.log_event === "ticket_read" || e.log_event === "ticket_updated") && e.metadata?.ticket) {
        const t = e.metadata.ticket as Record<string, unknown>;
        const converted: TicketData = {
          issue_type:          (t.issue_type as string) ?? "Story",
          summary:             (t.summary as string) ?? "",
          description:         extractAdfText(t.description),
          acceptance_criteria: [],
          priority:            (t.priority as string) ?? "Medium",
          labels:              (t.labels as string[]) ?? [],
          story_points:        (t.story_points as number | null) ?? null,
          jira_key:            (t.key as string) ?? undefined,
          status:              (t.status as string) ?? undefined,
          assignee:            (t.assignee as string) ?? undefined,
          subtasks:            Array.isArray(t.subtasks)
            ? (t.subtasks as SubtaskData[]).map((s) => ({ ...s }))
            : undefined,
        };
        // Accumulate — multiple ticket_read events before the next assistant message
        // (e.g. "read PM-1, PM-2") all show as tiles rather than the last overwriting.
        pendingReadTicketRef.current = [...pendingReadTicketRef.current, converted];
        setSelectedPreview({ type: "tickets", tickets: pendingReadTicketRef.current });
        setRunState((prev) => ({
          ...prev,
          tickets: {
            ...((prev.tickets as Record<string, unknown>) ?? {}),
            jira_base_url: "https://your-domain.atlassian.net",
          },
        }));
      }

      // answer_generated — emits chunks_used; patch into selectedPreview immediately.
      if (e.log_event === "answer_generated" && e.metadata?.chunks_used != null) {
        const chunksUsed = e.metadata.chunks_used as number;
        setSelectedPreview((prev) => {
          if (prev?.type === "answer") return { ...prev, chunks_used: chunksUsed };
          return prev;
        });
      }

      // answer_sources — structured sources from Cortana RAG lookup.
      // Buffer in ref so the next chat_message (answer finalisation) picks them up
      // and attaches them to the selectedPreview for rendering as chips.
      if (e.log_event === "answer_sources" && e.metadata?.sources) {
        const sources = e.metadata.sources as import("@/types").CortanaSource[];
        pendingCortanaSourcesRef.current = sources;
        // Patch the current selectedPreview immediately if it's already an answer
        setSelectedPreview((prev) => {
          if (prev?.type === "answer") {
            return { ...prev, sources };
          }
          return prev;
        });
      }

      // answer_extras — rich extraction fields (people, whats_new, open_tickets, suggested_questions, intent, entities).
      if (e.log_event === "answer_extras") {
        const meta = e.metadata as {
          people?: import("@/types").KBPerson[];
          whats_new?: import("@/types").KBWhatsNew[];
          open_tickets?: import("@/types").KBTicket[];
          suggested_questions?: string[];
          intent?: string;
          entities?: string[];
        };
        setSelectedPreview((prev) => {
          // Base: preserve existing answer content, or create an empty anchor so extras
          // aren't lost when they arrive before the first chat_stream token.
          const base = prev?.type === "answer"
            ? prev
            : { type: "answer" as const, content: "", sources: undefined };
          return {
            ...base,
            ...(meta.people && { people: meta.people }),
            ...(meta.whats_new && { whats_new: meta.whats_new }),
            ...(meta.open_tickets && { open_tickets: meta.open_tickets }),
            ...(meta.suggested_questions && { suggested_questions: meta.suggested_questions }),
            ...(meta.intent !== undefined && { intent: meta.intent }),
            ...(meta.entities !== undefined && { entities: meta.entities }),
          };
        });
      }
    }
    if (e.event === "routed") {
      // Heimdall decided — start specialist run, preserve messages + logs so the
      // user sees their prompt + Heimdall card + specialist messages in one thread.
      // We do NOT forward initial_message to the specialist: the specialist's own
      // greeting already asks the user for requirements, and forwarding a brief
      // routing message (e.g. "Create Jira ticket") causes the specialist to send
      // a second "I need more info" reply immediately after its welcome message.
      startRun(e.workflow_id, { keepMessages: true, keepLogs: true }).then(() => {
        setAgentTyping(true);
      });
    }
    if (e.event === "run_completed" || e.event === "run_failed") {
      setAgentTyping(false);
      setActiveRun((r) =>
        r ? { ...r, status: e.event === "run_completed" ? "completed" : "failed" } : r
      );
      if (e.event === "run_completed" && e.state) {
        setRunState(e.state);
        // Enrich ticket preview with jira_keys from final state (populated after Jira creation)
        const finalTickets = ((e.state?.tickets as Record<string, unknown>)?.ticket_list) as TicketData[] | undefined;
        if (Array.isArray(finalTickets) && finalTickets.length > 0) {
          setSelectedPreview({ type: "tickets", tickets: finalTickets });
        }
      }
      if (e.event === "run_failed") setRunError((e as { event: string; error?: string }).error ?? "Unknown error");
    }
  }, []);

  useRunWebSocket(
    activeRun?.run_id ?? null,
    handleWsEvent,
    async () => {
      if (!activeRun) return;
      try {
        const { data } = await axios.get<ChatMessage[]>(
          `/api/runs/${activeRun.run_id}/chat`,
          { headers }
        );
        // Restore history only when we have none locally (e.g. page refresh /
        // reconnect). Never overwrite messages already set by handleSend, because
        // those carry workflowId context and the WS history lacks it.
        if (data.length > 0) setChatMessages(prev => prev.length === 0 ? data : prev);
      } catch {
        // ignore
      }
    },
    user.access_token,
  );

  const startRun = async (workflowId: string, opts?: { keepMessages?: boolean; keepLogs?: boolean }) => {
    setStarting(true);
    setPendingGate(null);
    setRunError(null);
    if (!opts?.keepMessages) setChatMessages([]);
    setRunState({});
    if (!opts?.keepMessages) { setSelectedPreview(null); pendingTicketsRef.current = null; pendingCortanaSourcesRef.current = null; userMsgBoundaryRef.current = -1; astridUserHasSentRef.current = false; setIsCortanaStreaming(false); }
    if (!opts?.keepLogs) setAgentLogs([]);
    try {
      const { data } = await axios.post<{ run_id: string; status: string }>(
        "/api/runs/",
        { workflow_id: workflowId },
        { headers }
      );
      setActiveRun({
        run_id: data.run_id,
        workflow_id: workflowId,
        status: "running",
        current_step: 0,
        state: {},
        created_at: new Date().toISOString(),
        completed_at: null,
      });
      setShowAllAgents(false);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.detail ?? err.message
        : "Failed to start workflow";
      setRunError(msg);
    } finally {
      setStarting(false);
    }
  };

  const onGateResolved = (_action: GateAction) => {
    setPendingGate(null);
    setActiveRun((r) => r ? { ...r, status: "running" } : r);
  };

  const handleSend = async () => {
    if (!prompt.trim() || starting || isSendingRef.current) return;
    isSendingRef.current = true;
    const captured = prompt.trim();
    setPrompt("");
    // Append the user's message — keep prior messages so "Preview answer" buttons persist
    setSelectedPreview(null); // clear output pane so new answer starts fresh (not stacked)
    astridUserHasSentRef.current = true;
    setChatMessages((prev) => {
      userMsgBoundaryRef.current = prev.length; // new message lands at this index
      return [...prev, { role: "user", content: captured, created_at: new Date().toISOString() }];
    });
    // Start the heimdall run without clearing the message we just added
    await startRun("heimdall", { keepMessages: true });
    setAgentTyping(true);
    setPendingInitialPrompt(captured);
    isSendingRef.current = false;
  };

  const sendPromptFromOutput = async (q: string) => {
    if (!activeRun?.run_id) return;
    setSelectedPreview(null);
    astridUserHasSentRef.current = true;
    setChatMessages((prev) => [...prev, { role: "user", content: q, created_at: new Date().toISOString() }]);
    setAgentTyping(true);
    try {
      await axios.post(
        `/api/runs/${activeRun.run_id}/chat`,
        { message: q },
        { headers: { Authorization: `Bearer ${user.access_token}` } }
      );
    } catch (err) {
      console.error("Failed to send quick action prompt", err);
      setAgentTyping(false);
    }
  };

  useEffect(() => {
    if (!activeRun || !pendingInitialPrompt) return;
    const runId = activeRun.run_id;
    const msg = pendingInitialPrompt;
    // Clear INSIDE the timer — clearing here triggers a re-render that runs
    // the effect cleanup (clearTimeout) and cancels the timer before it fires.
    const timer = setTimeout(() => {
      setPendingInitialPrompt(null);
      axios.post(
        `/api/runs/${runId}/chat`,
        { message: msg },
        { headers }
      ).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [activeRun?.run_id, pendingInitialPrompt]);

  const handleSuggestion = (text: string) => {
    setPrompt(text);
  };


  // ── Active run view ──────────────────────────────────────────────────────────
  if (activeRun) {
    const handleBackToHome = () => {
      setActiveRun(null); setShowAllAgents(true);
      setChatMessages([]); setRunState({}); setAgentLogs([]); setAgentTyping(false); setRunError(null);
      setSelectedPreview(null); pendingTicketsRef.current = null; pendingCortanaSourcesRef.current = null; userMsgBoundaryRef.current = -1; astridUserHasSentRef.current = false; setIsCortanaStreaming(false);
    };

    const handleRestartWithMessage = async (message: string) => {
      const workflowId = activeRun?.workflow_id ?? "heimdall";
      await startRun(workflowId);
      setPendingInitialPrompt(message);
    };

    // Per-workflow sub-labels shown under the agent name in chat cards
    const WORKFLOW_SUB_LABELS: Record<string, string> = {
      "jarvis": "Jira Requirements Agent",
      "cortana":           "Org Knowledge Agent",
      "heimdall":             "Intent Routing Agent",
    };

    // Build display map for agent cards: workflowId → { personaName, initials, subLabel }
    const workflowDisplayMap = Object.fromEntries(
      workflows.map((w) => {
        const name = w.persona_name || w.name;
        return [w.id, {
          personaName: name,
          initials: name.slice(0, 2).toUpperCase(),
          subLabel: WORKFLOW_SUB_LABELS[w.id],
        }];
      })
    );

    return (
      <div style={{ ...styles.gradientPage, height: "100vh", minHeight: "unset" }}>
        <header style={styles.gradientHeader}>
          <img src="/asgard-logo.svg" alt="Asgard" style={styles.logo} />
          <div style={styles.userInfo}>
            <span style={styles.emailDark}>{user.email}</span>
            <button style={styles.appsBtnDark} onClick={() => setAppsOpen(true)}>Apps</button>
            <button style={styles.signOutBtnDark} onClick={onLogout}>Sign out</button>
          </div>
        </header>

        <main style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Split panel: Chat (30%) | Output (70%) */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row" }}>
            {/* Left: Chat panel */}
            <div style={{
              width: "30%",
              minWidth: 320,
              display: "flex",
              flexDirection: "column",
              background: "#eeedf5",
            }}>
              <ChatPanel
                runId={activeRun.run_id}
                token={user.access_token}
                messages={chatMessages}
                pendingGate={pendingGate}
                onGateResolved={onGateResolved}
                runStatus={activeRun.status}
                onNewRun={handleBackToHome}
                onRestartWithMessage={handleRestartWithMessage}
                liveLogEntries={agentLogs}
                workflowDisplayMap={workflowDisplayMap}
                agentTyping={agentTyping}
                runError={runError ?? undefined}
                onUserSend={(msg, images) => {
                  setAgentTyping(true);
                  setSelectedPreview(null); // clear output pane so new answer doesn't stack
                  astridUserHasSentRef.current = true;
                  if (images && images.length > 0) setOptimisticImages(images);
                  // Add the user message optimistically so it appears immediately
                  // in the chat, and update the boundary so retroactive preview
                  // patching never reaches messages above this point.
                  setChatMessages((prev) => {
                    userMsgBoundaryRef.current = prev.length;
                    return [
                      ...prev,
                      {
                        role: "user" as const,
                        content: msg,
                        created_at: new Date().toISOString(),
                        workflowId: activeRunRef.current?.workflow_id,
                      },
                    ];
                  });
                }}
                workflowId={activeRun.workflow_id}
                onPreview={(data) => setSelectedPreview(data)}
                optimisticImages={optimisticImages}
                agentChips={agentChips}
                onChipSelect={async (agentName: string) => {
                  setAgentChips([]);
                  try {
                    await axios.post(
                      `/api/runs/${activeRun.run_id}/chat`,
                      { message: agentName },
                      { headers: { Authorization: `Bearer ${user.access_token}` } }
                    );
                  } catch (err) {
                    console.error("Failed to send chip selection", err);
                  }
                }}
              />
            </div>

            {/* Right: Structured output panel */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "#f5f3ff" }}>
              <OutputPanel
                selectedPreview={selectedPreview}
                runId={activeRun.run_id}
                token={user.access_token}
                runStatus={activeRun.status}
                runState={runState}
                isStreaming={isCortanaStreaming}
                workflowId={activeRun.workflow_id}
                onSendPrompt={sendPromptFromOutput}
                lastQuestion={[...chatMessages].reverse().find(m => m.role === "user")?.content}
              />
            </div>
          </div>
        </main>

      <AppsPanel
        isOpen={appsOpen}
        onClose={() => setAppsOpen(false)}
        token={user.access_token}
      />
      </div>
    );
  }

  // ── All agents view ──────────────────────────────────────────────────────────
  const FUNCTION_FILTERS = ["All", "Product", "GTM", "Marketing", "RevOps", "Finance", "HR"];

  if (showAllAgents) {
    const baseWorkflows = [...workflows];
    const filteredWorkflows = activeFilter === "All"
      ? baseWorkflows
      : baseWorkflows.filter((w) =>
          w.owner_teams.some((t) => t.toLowerCase() === activeFilter.toLowerCase())
        );

    return (
      <div style={styles.gradientPage}>
        <header style={styles.compactHeader}>
          <img src="/asgard-logo.svg" alt="Asgard" style={styles.logo} />
          <div style={styles.userInfo}>
            <span style={styles.emailDark}>{user.email}</span>
            <button style={styles.appsBtnDark} onClick={() => setAppsOpen(true)}>Apps</button>
            <button style={styles.signOutBtnDark} onClick={onLogout}>Sign out</button>
          </div>
        </header>
        <main style={styles.agentsMain}>
          <button style={styles.backLink} onClick={() => setShowAllAgents(false)}>← Back</button>
          <div style={styles.filterRow}>
            {FUNCTION_FILTERS.map((f) => (
              <button
                key={f}
                className={f === activeFilter ? "suggestion-chip filter-chip-active" : "suggestion-chip"}
                onClick={() => setActiveFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          {workflowsError && (
            <div style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12, wordBreak: "break-all" }}>
              ⚠️ API error: {workflowsError}
            </div>
          )}
          <WorkflowSelector workflows={filteredWorkflows} onStart={startRun} loading={starting} />
        </main>

      <AppsPanel
        isOpen={appsOpen}
        onClose={() => setAppsOpen(false)}
        token={user.access_token}
      />
      </div>
    );
  }

  // ── Home / landing view ──────────────────────────────────────────────────────
  return (
    <div style={styles.gradientPage}>
      <header style={styles.gradientHeader}>
        <img src="/asgard-logo.svg" alt="Asgard" style={styles.logo} />
        <div style={styles.userInfo}>
          <span style={styles.emailDark}>{user.email}</span>
          <button style={styles.appsBtnDark} onClick={() => setAppsOpen(true)}>Apps</button>
          <button style={styles.signOutBtnDark} onClick={onLogout}>Sign out</button>
        </div>
      </header>

      <main style={styles.heroMain}>
        <h1 style={styles.heroTitle}>
          Hi {getFirstName(user.email)},{" "}
          <span style={styles.heroGradient}>what would you like to do today?</span>
        </h1>

        {/* Prompt box */}
        <div style={styles.promptBox}>
          <textarea
            style={styles.promptInput}
            placeholder="Describe what you need. Eg: 'Create a Jira ticket' or 'Learn about Synthesis'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            rows={3}
          />
          <div style={styles.promptFooter}>
            <button style={styles.attachBtn} title="Attach file" onClick={() => {}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <button
              style={{ ...styles.sendBtn, opacity: prompt.trim() ? 1 : 0.4 }}
              onClick={handleSend}
              disabled={!prompt.trim()}
              title="Send"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Suggestions */}
        <div style={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="suggestion-chip" onClick={() => handleSuggestion(s)}>
              {s}
            </button>
          ))}
        </div>

        {/* Explore all agents */}
        <button style={styles.exploreBtn} onClick={() => setShowAllAgents(true)}>
          Explore all agents ↗
        </button>
      </main>

      <AppsPanel
        isOpen={appsOpen}
        onClose={() => setAppsOpen(false)}
        token={user.access_token}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  // ── Gradient home page ──────────────────────────────────────────────────────
  gradientPage: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #e8eaf6 0%, #ede7f6 40%, #e3f2fd 100%)",
    display: "flex",
    flexDirection: "column",
  },
  gradientHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 40px",
    width: "100%",
    boxSizing: "border-box" as const,
    background: "#fff",
  },
  heroMain: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 24px 80px",
    gap: 28,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 700,
    color: "#1a1a2e",
    textAlign: "center",
    margin: 0,
    lineHeight: 1.3,
    maxWidth: 780,
    whiteSpace: "nowrap" as const,
  },
  heroGradient: {
    background: "linear-gradient(135deg, #7c3aed, #6366f1, #3b82f6)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
  },
  promptBox: {
    width: "100%",
    maxWidth: 680,
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 4px 32px rgba(99,102,241,0.10)",
    overflow: "hidden",
    border: "1px solid #e0e0e0",
  },
  promptInput: {
    width: "100%",
    padding: "20px 20px 12px",
    border: "none",
    outline: "none",
    fontSize: 15,
    lineHeight: 1.6,
    resize: "none",
    fontFamily: "Inter, sans-serif",
    color: "#1a1a2e",
    background: "transparent",
    boxSizing: "border-box",
  },
  promptFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px 12px",
  },
  attachBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    background: "none",
    border: "none",
    borderRadius: 8,
    color: "#9ca3af",
    cursor: "pointer",
    transition: "color 0.2s, background 0.2s",
  },
  sendBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    background: "linear-gradient(135deg, #7c3aed, #6366f1)",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    cursor: "pointer",
    transition: "opacity 0.2s",
    flexShrink: 0,
  },
  suggestions: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 10,
    justifyContent: "center",
    maxWidth: 680,
  },
  exploreBtn: {
    marginTop: 4,
    padding: "10px 28px",
    background: "transparent",
    border: "1.5px solid #6366f1",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    color: "#6366f1",
    cursor: "pointer",
  },

  // ── Shared header pieces ────────────────────────────────────────────────────
  logo: {
    height: 36,
    width: "auto",
    objectFit: "contain" as const,
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  email: { fontSize: 13, color: "#374151" },
  emailDark: { fontSize: 13, color: "#374151", fontWeight: 500 },
  signOutBtn: {
    padding: "5px 14px",
    background: "none",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
    color: "#6b7280",
  },
  appsBtnDark: {
    padding: "5px 14px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(99,102,241,0.3)",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
    color: "#4338ca",
    fontWeight: 500,
  },
  signOutBtnDark: {
    padding: "5px 14px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(99,102,241,0.3)",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
    color: "#4338ca",
    fontWeight: 500,
  },
  connectJiraBtn: {
    padding: "5px 14px",
    background: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(0,100,200,0.35)",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
    color: "#0052cc",
    fontWeight: 500,
  },
  jiraConnectedBadge: {
    padding: "4px 10px",
    background: "rgba(0,200,120,0.12)",
    border: "1px solid rgba(0,180,100,0.4)",
    borderRadius: 6,
    fontSize: 13,
    color: "#057a55",
    fontWeight: 600,
  },

  agentsMain: {
    flex: 1,
    padding: "16px 40px 32px",
    width: "100%",
    boxSizing: "border-box" as const,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start",
    gap: 12,
  },
  compactHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 40px",
    width: "100%",
    boxSizing: "border-box" as const,
    background: "#fff",
  },
  agentsHeader: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    marginBottom: 16,
  },
  filterRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap" as const,
    alignItems: "center",
    marginBottom: 4,
  },
  backLink: {
    background: "none",
    border: "none",
    fontSize: 14,
    color: "#6366f1",
    cursor: "pointer",
    fontWeight: 500,
    padding: 0,
  },
};
