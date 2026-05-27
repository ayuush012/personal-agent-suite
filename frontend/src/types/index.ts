export type Team = "gtm" | "sales" | "product" | "marketing" | "engineering" | "design" | "revops" | "finance" | "hr";

export type RunStatus =
  | "pending"
  | "running"
  | "awaiting_gate"
  | "completed"
  | "failed"
  | "cancelled"
  | "suspended";

export interface AgentLogEntry {
  timestamp: string;
  agent: string;
  level: string;
  event: string;
  metadata: Record<string, unknown>;
}

export type GateAction = "approved" | "rejected" | "edited";

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  owner_teams: Team[];
  execution_pattern: "sequential" | "operator" | "agent_teams" | "conversational";
  step_count: number;
  gate_count: number;
  integration_deps: string[];
  persona_name?: string;
}

export interface WorkflowRun {
  run_id: string;
  workflow_id: string;
  status: RunStatus;
  current_step: number;
  state: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export interface GateEvent {
  event: "gate_pending";
  gate_id: string;
  gate_index: number;
  prompt: string;
  context_keys: string[];
  context: Record<string, unknown>;
}

export interface StepEvent {
  event: "step_started" | "step_completed";
  step: number;
  agent: string;
  output?: Record<string, unknown>;
}

export type WsEvent =
  | GateEvent
  | StepEvent
  | { event: "run_completed"; run_id: string; state?: Record<string, unknown> }
  | { event: "run_failed"; error: string }
  | { event: "gate_resolved"; gate_id: string; approved: boolean }
  | { event: "chat_message"; role: string; content: string }
  | { event: "chat_stream"; content: string }
  | { event: "agent_log"; agent: string; level: string; log_event: string; metadata: Record<string, unknown> }
  | { event: "routed"; workflow_id: string; initial_message: string };

export interface AstridSource {
  file_name?: string;
  source_url?: string;
  source_updated_at?: string;
  source_tool?: string;
  similarity?: number;
  final_score?: number;
}

// Backward-compatible alias used by sanitized Asgard UI labels.
export type CortanaSource = AstridSource;

export type PreviewData =
  | { type: "tickets"; tickets: TicketData[] }
  | {
      type: "answer";
      content: string;
      sources?: AstridSource[];
      chunks_used?: number;
      intent?: string;
      entities?: string[];
      hyde_used?: boolean;
      suggested_questions?: string[];
      whats_new?: KBWhatsNew[];
      people?: KBPerson[];
      open_tickets?: KBTicket[];
    };

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  workflowId?: string;
  preview?: PreviewData;
  streaming?: boolean;  // true while tokens are still arriving (chat_stream events)
  images?: Array<{preview: string; name: string}>;  // blob preview URLs for uploaded images
}

export interface SubtaskData {
  key: string;
  summary: string;
  status: string;
  issue_type: string;
  priority?: string;
}

export interface TicketData {
  issue_type: string;
  summary: string;
  description: string;
  acceptance_criteria: string[];
  priority: string;
  labels: string[];
  story_points: number | null;
  jira_key?: string;
  status?: string;  // populated for read/updated Jira tickets
  assignee?: string;
  subtasks?: SubtaskData[];
}

export interface User {
  email: string;
  team: Team;
  access_token: string;
  atlassian_connected?: boolean;
}

// Knowledge Base (Org-Mind)
export interface KBStatus {
  collection: string;
  vectors_count: number;
  status: string;
}

export interface KBSource {
  file_name: string | null;
  source_url: string | null;
  source_updated_at: string | null;
  similarity: number | null;
  final_score: number | null;
  chunk_index?: number | null;
}

export interface KBWhatsNew {
  version: string;
  date?: string;
  items: string[];
  url?: string;
}

export interface KBPerson {
  name: string;
  features?: string[];
  email?: string;
}

export interface KBTicket {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  url?: string;
}

export interface KBChatResponse {
  answer: string;
  sources: KBSource[];
  chunks_used: number;
  model?: string;
  intent?: string;
  expanded_query?: string;
  entities?: string[];
  hyde_used?: boolean;
  follow_up?: string;
  suggested_questions?: string[];
  whats_new?: KBWhatsNew[];
  people?: KBPerson[];
  open_tickets?: KBTicket[];
}
