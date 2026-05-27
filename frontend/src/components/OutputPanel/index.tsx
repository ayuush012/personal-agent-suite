import React, { useState, useEffect, useRef } from "react";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ReactMarkdown from "react-markdown";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import remarkGfm from "remark-gfm";
import type { TicketData, PreviewData, CortanaSource, KBWhatsNew, KBPerson, KBTicket } from "@/types";

// Inject keyframes for streaming cursor + pulse dot (once per page load)
if (typeof document !== "undefined" && !document.getElementById("astrid-stream-css")) {
  const style = document.createElement("style");
  style.id = "astrid-stream-css";
  style.textContent = `
    @keyframes astrid-blink { 0%,100%{opacity:1} 50%{opacity:0} }
    @keyframes astrid-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }
    @keyframes kb-spin { to { transform: rotate(360deg); } }
    @keyframes kb-indeterminate { 0%{margin-left:-30%;width:30%} 100%{margin-left:100%;width:30%} }
  `;
  document.head.appendChild(style);
}

interface Props {
  selectedPreview: PreviewData | null;
  runId: string;
  token: string;
  runStatus: string;
  runState: Record<string, unknown>;
  isStreaming?: boolean;
  workflowId?: string;
  onSendPrompt?: (q: string) => void;
  lastQuestion?: string;
}


const issueTypeBadge = (type: string): { bg: string; color: string } => {
  const map: Record<string, { bg: string; color: string }> = {
    story:    { bg: "#deebff", color: "#0052cc" },
    epic:     { bg: "#eae6ff", color: "#5243aa" },
    bug:      { bg: "#ffebe6", color: "#de350b" },
    task:     { bg: "#e3fcef", color: "#006644" },
    sub_task: { bg: "#e4f0fb", color: "#0747a6" },
  };
  return map[type?.toLowerCase()] ?? { bg: "#f4f5f7", color: "#5e6c84" };
};

const priorityBadge = (p: string): { bg: string; color: string } => {
  const lower = p?.toLowerCase() ?? "";
  if (lower === "highest" || lower === "high") return { bg: "#ffebe6", color: "#de350b" };
  if (lower === "medium") return { bg: "#fffae6", color: "#b8730a" };
  return { bg: "#e4f0fb", color: "#0747a6" };
};

// ── Cortana two-column workspace helpers ──────────────────────────────────────

const INTENT_LABELS: Record<string, string> = {
  feature_ownership: "Ownership lookup",
  contact_lookup:    "Contact lookup",
  release_notes:     "Release notes",
  process_sop:       "Process guide",
  status_update:     "Status overview",
  general_info:      "Knowledge overview",
};

interface TableData {
  headers: string[];
  rows: string[][];
}

interface AnswerBlock {
  id: string;
  type: "summary" | "capabilities" | "section" | "release" | "faq" | "alert" | "comparison" | "table" | "metric" | "timeline";
  title: string;
  content: string;
  items?: CapItem[];
  tableData?: TableData;
  metrics?: MetricItem[];
  timelineEvents?: TimelineEvent[];
}

interface MetricItem {
  label: string;
  value: string;
  delta?: string;
}

interface TimelineEvent {
  version: string;
  date?: string;
  description: string;
}

interface CapItem {
  icon: string;
  title: string;
  desc: string;
}

interface ScoredBlock extends AnswerBlock {
  relevance: number;
  defaultOpen: boolean;
}

// Base relevance scores by block type
const _BLOCK_BASE_SCORE: Record<string, number> = {
  summary:      0.95,
  alert:        0.90,
  metric:       0.88,
  table:        0.85,
  capabilities: 0.80,
  timeline:     0.78,
  release:      0.70,
  comparison:   0.65,
  section:      0.55,
  faq:          0.50,
};

// Per-intent adjustments (added to base score)
const _INTENT_BOOST: Record<string, Partial<Record<string, number>>> = {
  general_info:      { capabilities: +0.15, section: +0.05 },
  feature_ownership: { table: +0.15, section: +0.10, summary: -0.10, capabilities: -0.20 },
  release_notes:     { release: +0.25, section: +0.10, summary: -0.05, capabilities: -0.20 },
  process_sop:       { section: +0.20, summary: +0.05, capabilities: -0.10 },
  status_update:     { release: +0.10, section: +0.15, summary: +0.05 },
  contact_lookup:    { section: +0.10, summary: -0.15 },
};

function _scoreBlocks(
  blocks: AnswerBlock[],
  intent: string | null,
  _entities: string[],
): ScoredBlock[] {
  const boosts = _INTENT_BOOST[intent ?? "general_info"] ?? {};
  return blocks.map((block, i) => {
    const base = _BLOCK_BASE_SCORE[block.type] ?? 0.55;
    const intentAdj = boosts[block.type] ?? 0;
    const positionPenalty = i * 0.02;
    const relevance = Math.min(1.0, Math.max(0.0, base + intentAdj - positionPenalty));
    return { ...block, relevance, defaultOpen: relevance >= 0.75 };
  });
}

const _RENDER_THRESHOLD = 0.62;

type BlockRenderMode = "hero" | "standard" | "compact" | "hidden";

function _blockRenderMode(relevance: number): BlockRenderMode {
  if (relevance >= 0.88) return "hero";
  if (relevance >= 0.72) return "standard";
  if (relevance >= _RENDER_THRESHOLD) return "compact";
  return "hidden";
}

function _visibleMode(mode: BlockRenderMode): "hero" | "standard" | "compact" {
  return mode === "hidden" ? "compact" : mode;
}

const _TABLE_PAGE_SIZE = 8;

function _parseMarkdownTable(content: string): TableData | null {
  const lines = content.split("\n").map(l => l.trim()).filter(l => l.startsWith("|"));
  if (lines.length < 3) return null;
  const parseRow = (line: string) =>
    line.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  const headers = parseRow(lines[0]);
  // lines[1] is the separator row (|---|---|)
  const rows = lines.slice(2).map(parseRow).filter(r => r.some(c => c.length > 0));
  if (rows.length === 0) return null;
  return { headers, rows };
}

function _renderCell(text: string): React.ReactNode {
  // Turn bare emails or (email) patterns into mailto links
  const emailRe = /\(([^\s@)]+@[^\s@)]+\.[^\s@)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = emailRe.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const email = m[1];
    parts.push(<a key={m.index} href={`mailto:${email}`} style={{ color: "#7c3aed", textDecoration: "none", fontSize: 11 }}>{email}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 1 ? <>{parts}</> : text;
}

function PaginatedTable({ data }: { data: TableData; title?: string }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(data.rows.length / _TABLE_PAGE_SIZE);
  const pageRows = data.rows.slice(page * _TABLE_PAGE_SIZE, (page + 1) * _TABLE_PAGE_SIZE);
  const start = page * _TABLE_PAGE_SIZE + 1;
  const end = Math.min((page + 1) * _TABLE_PAGE_SIZE, data.rows.length);

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              {data.headers.map((h, i) => (
                <th key={i} style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600, color: "#9ca3af", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#faf9ff")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                {row.map((cell, j) => (
                  <td key={j} style={{ padding: "8px 12px", color: "#374151", verticalAlign: "top", lineHeight: 1.5 }}>
                    {j === 0 ? <span style={{ fontWeight: 600, color: "#111827" }}>{cell}</span> : _renderCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, marginTop: 8, borderTop: "1px solid #f0f0f0" }}>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>Showing {start}–{end} of {data.rows.length}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              onClick={() => setPage(p => p - 1)} disabled={page === 0}
              style={{ padding: "4px 10px", border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff", color: page === 0 ? "#d1d5db" : "#374151", cursor: page === 0 ? "default" : "pointer", fontSize: 12, fontWeight: 500 }}
            >‹ Prev</button>
            {Array.from({ length: Math.min(totalPages, 6) }, (_, i) => (
              <button key={i} onClick={() => setPage(i)}
                style={{ width: 28, height: 28, border: "1px solid", borderColor: page === i ? "#7c3aed" : "#e5e7eb", borderRadius: 6, background: page === i ? "#7c3aed" : "#fff", color: page === i ? "#fff" : "#374151", cursor: "pointer", fontSize: 12, fontWeight: page === i ? 700 : 400 }}
              >{i + 1}</button>
            ))}
            {totalPages > 6 && <span style={{ fontSize: 12, color: "#9ca3af" }}>…</span>}
            <button
              onClick={() => setPage(p => p + 1)} disabled={page === totalPages - 1}
              style={{ padding: "4px 10px", border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff", color: page === totalPages - 1 ? "#d1d5db" : "#374151", cursor: page === totalPages - 1 ? "default" : "pointer", fontSize: 12, fontWeight: 500 }}
            >Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
}

function _capIcon(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("api") || t.includes("integrat")) return "⚡";
  if (t.includes("edit") || t.includes("smart")) return "✏";
  if (t.includes("parallel") || t.includes("multi")) return "🔀";
  if (t.includes("file") || t.includes("attach")) return "📎";
  if (t.includes("prompt")) return "→";
  return "✦";
}

function _parseAnswerBlocks(md: string): AnswerBlock[] {
  if (!md || md.trim().length === 0) return [];
  const headerRe = /\n(?=#{2,3}\s)/;
  const parts = ("\n" + md).split(headerRe).map(c => c.trim()).filter(c => c.length > 0);
  if (parts.length === 0) return [];
  if (parts.length === 1 && !parts[0].match(/^#{2,3}\s/)) {
    return [{ id: "summary-0", type: "summary", title: "Summary", content: parts[0] }];
  }
  return parts.map((chunk, i) => {
    const lines = chunk.trim().split("\n");
    const firstLine = lines[0] || "";
    const titleMatch = firstLine.match(/^#{2,3}\s+(.+)/);
    const title = titleMatch ? titleMatch[1].trim() : (i === 0 ? "Summary" : "Section");
    const rawContent = titleMatch ? lines.slice(1).join("\n").trim() : chunk.trim();
    // Strip inline source citations the LLM embeds (e.g. "(Source: file.csv | 2025-09-17)")
    // since sources are rendered as chips below the blocks.
    const content = rawContent.replace(/\s*\(Source:[^)]*\)/g, "").trim();
    const contentLines = content.split("\n");
    const bulletLines = contentLines.filter(l => /^[-*•]|\d+\./.test(l.trim()));
    const tl = title.toLowerCase();
    const tableData = _parseMarkdownTable(content);
    let type: AnswerBlock["type"] = "section";
    if (tableData && tableData.rows.length > _TABLE_PAGE_SIZE) type = "table";
    else if (i === 0 && !titleMatch) type = "summary";
    else if (tl.includes("summary") || tl.includes("overview")) type = "summary";
    else if (tl.includes("metric") || tl.includes("kpi") || tl.includes("stats") || tl.includes("numbers")) type = "metric";
    else if (tl.includes("timeline") || tl.includes("history") || tl.includes("version history")) type = "timeline";
    else if (tl.includes("capabilit") || tl.includes("feature") || tl.includes("what can") || tl.includes("key feature")) type = "capabilities";
    else if (tl.includes("release") || tl.includes("changelog") || tl.includes("version") || tl.includes("what's new") || tl.includes("latest update")) type = "release";
    else if (tl.includes("faq") || tl.includes("question") || tl.includes("common")) type = "faq";
    else if (tl.includes("alert") || tl.includes("warning") || tl.includes("important") || tl.includes("note") || tl.includes("limitation")) type = "alert";
    else if (tl.includes("compar") || tl.includes("vs ") || tl.includes("versus") || tl.includes("differenc")) type = "comparison";
    let items: CapItem[] | undefined;
    let metrics: MetricItem[] | undefined;
    let timelineEvents: TimelineEvent[] | undefined;
    if (type === "capabilities") {
      items = bulletLines.slice(0, 8).map((line) => {
        const text = line.replace(/^[-*•]\s*/, "").replace(/^\d+\.\s*/, "").trim();
        const boldMatch = text.match(/\*\*([^*]+)\*\*/);
        // If bold delimiter present: title = bold text, desc = remainder
        // If colon present: title = before colon, desc = after colon
        // Otherwise: title = full text, desc = empty (no mid-word truncation)
        let capTitle: string;
        let desc: string;
        if (boldMatch) {
          capTitle = boldMatch[1].trim();
          desc = text.replace(/\*\*[^*]+\*\*:?\s*/, "").trim();
        } else if (text.includes(":")) {
          capTitle = text.split(":")[0].trim();
          desc = text.split(":").slice(1).join(":").trim();
        } else {
          capTitle = text;
          desc = "";
        }
        return { icon: _capIcon(text), title: capTitle, desc };
      });
    } else if (type === "metric") {
      metrics = bulletLines.slice(0, 6).map((line) => {
        const text = line.replace(/^[-*•]\s*/, "").replace(/^\d+\.\s*/, "");
        // Match "Label: value (delta)" or "**value** label" or "value units label"
        const colonMatch = text.match(/^\*?\*?([^*:]+?)\*?\*?\s*:\s*([\d.,]+\s*\S*)(?:\s*\(([^)]+)\))?$/);
        if (colonMatch) {
          return { label: colonMatch[1].trim(), value: colonMatch[2].trim(), delta: colonMatch[3]?.trim() };
        }
        const valueMatch = text.match(/([\d.,]+\s*%?)\s+(.+)/);
        if (valueMatch) {
          return { label: valueMatch[2].trim(), value: valueMatch[1].trim() };
        }
        return { label: text.slice(0, 40), value: "" };
      }).filter(m => m.value || m.label);
    } else if (type === "timeline") {
      // Look for "### vX.Y.Z (date) - description" or "- vX.Y.Z (date): description" patterns
      const eventRe = /^(?:###\s+|[-*•]\s+)?(?:\*\*)?v?([\d.]+|[A-Za-z][\w-]+)(?:\*\*)?\s*(?:\(([^)]+)\))?\s*[—:-]\s*(.+)$/i;
      timelineEvents = contentLines
        .map(l => l.trim().match(eventRe))
        .filter((m): m is RegExpMatchArray => m !== null)
        .slice(0, 8)
        .map(m => ({ version: m[1], date: m[2], description: m[3].trim() }));
      if (timelineEvents.length === 0) {
        // Fall back to release-style rendering if we can't parse timeline events
        type = "release";
      }
    }
    return {
      id: `block-${i}`,
      type,
      title,
      content,
      items,
      tableData: type === "table" ? tableData ?? undefined : undefined,
      metrics,
      timelineEvents,
    };
  });
}

// Extract people from a Team & Contacts / PM Ownership block (table or text).
function _extractPeopleFromText(content: string, tableData?: TableData): KBPerson[] {
  const out: KBPerson[] = [];
  // 1. Table form: find name/PM column + optional email column
  if (tableData && tableData.rows.length) {
    const { headers, rows } = tableData;
    const nameIdx = headers.findIndex(h => /name|pm|owner|contact/i.test(h));
    const emailIdx = headers.findIndex(h => /email|contact/i.test(h));
    const featureIdx = headers.findIndex(h => /feature|product/i.test(h));
    if (nameIdx !== -1) {
      for (const row of rows.slice(0, 8)) {
        const rawName = (row[nameIdx] || "").replace(/\([^)]*\)/g, "").trim();
        if (!rawName) continue;
        const emailMatch = (row[emailIdx !== -1 ? emailIdx : nameIdx] || "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        const person: KBPerson = { name: rawName };
        if (emailMatch) person.email = emailMatch[0];
        if (featureIdx !== -1 && row[featureIdx]) person.features = [row[featureIdx]];
        out.push(person);
      }
    }
  }
  // 2. Text form: `- Name: Role (email)` or `**Name** — Role (email@x.com)`
  if (out.length === 0) {
    const lines = content.split("\n").filter(l => /^[-*•]|\*\*/.test(l.trim()));
    for (const line of lines.slice(0, 8)) {
      const text = line.replace(/^[-*•]\s*/, "").trim();
      const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      const boldMatch = text.match(/\*\*([^*]+)\*\*/);
      const name = boldMatch ? boldMatch[1] : text.split(/[:—-]/)[0].slice(0, 40);
      const cleanName = name.replace(/\([^)]*\)/g, "").trim();
      if (!cleanName) continue;
      const person: KBPerson = { name: cleanName };
      if (emailMatch) person.email = emailMatch[0];
      out.push(person);
    }
  }
  return out;
}

// Fallback: if backend extraction missed people/whats_new, derive from parsed sections.
function _deriveRailDataFromBlocks(
  blocks: AnswerBlock[],
  backendPeople: KBPerson[],
  backendWhatsNew: KBWhatsNew[],
): { people: KBPerson[]; whatsNew: KBWhatsNew[] } {
  let people = backendPeople;
  let whatsNew = backendWhatsNew;
  if (people.length === 0) {
    const ownerBlock = blocks.find(b => /team|contact|ownership|owner|pm/i.test(b.title));
    if (ownerBlock) people = _extractPeopleFromText(ownerBlock.content, ownerBlock.tableData);
  }
  if (whatsNew.length === 0) {
    const releaseBlock = blocks.find(b =>
      b.type === "release" || b.type === "timeline" || /latest update|what.?s new|enhancement|release/i.test(b.title)
    );
    if (releaseBlock) {
      const items = releaseBlock.content
        .split("\n")
        .filter(l => /^[-*•]/.test(l.trim()))
        .map(l => l.replace(/^[-*•]\s*/, "").replace(/\*\*/g, "").trim())
        .filter(Boolean)
        .slice(0, 6);
      if (items.length) whatsNew = [{ version: "Latest", items }];
    }
  }
  return { people, whatsNew };
}

// Replace "(Source: filename | date)" with "[n]" footnote chips and return the
// citation→source mapping so we can render hover tooltips.
function _injectCitations(text: string, sources: CortanaSource[]): { text: string; citations: { n: number; name: string; url?: string }[] } {
  const citations: { n: number; name: string; url?: string }[] = [];
  const sourceMap = new Map<string, number>();
  const processed = text.replace(/\s*\(Source:\s*([^|)]+)(?:\|[^)]*)?\)/g, (_, name) => {
    const key = name.trim();
    if (!sourceMap.has(key)) {
      const n = sourceMap.size + 1;
      sourceMap.set(key, n);
      const match = sources.find(s => (s.file_name || "").toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes((s.file_name || "").toLowerCase()));
      citations.push({ n, name: key, url: match?.source_url });
    }
    return ` ⁽${sourceMap.get(key)}⁾`;
  });
  return { text: processed, citations };
}

// Generate two contextual follow-up prompts for a block.
function _genFollowUpsForBlock(block: AnswerBlock, entity: string | null): string[] {
  const e = entity || "this";
  switch (block.type) {
    case "capabilities":
      return block.items && block.items.length > 0
        ? [`How do I use ${block.items[0].title} in ${e}?`, `What's the limit on ${e} capabilities?`]
        : [`How do I get started with ${e}?`, `What integrations does ${e} support?`];
    case "release":
    case "timeline":
      return [`What's coming next for ${e}?`, `Which ${e} version am I on?`];
    case "table": {
      const firstName = block.tableData?.rows[0]?.[0];
      return firstName
        ? [`Show ${firstName}'s other features`, `How do I contact ${firstName}?`]
        : [`Show all owners`, `Filter by team`];
    }
    case "alert":
      return [`How do I work around this?`, `Is there an alternative?`];
    case "metric":
      return [`How is this measured?`, `Show historical trend`];
    case "comparison":
      return [`Which is recommended for new projects?`, `Show migration path`];
    case "faq":
      return [`What other common questions exist?`, `Show troubleshooting steps`];
    default:
      return [`Tell me more about ${block.title}`, `Show related ${e} info`];
  }
}

function _BlockActions({ onCopy, onAskMore, compact = false }: { onCopy?: () => void; onAskMore?: () => void; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!onCopy && !onAskMore) return null;
  const btnStyle: React.CSSProperties = {
    padding: compact ? "2px 7px" : "3px 9px",
    fontSize: compact ? 10 : 11,
    border: "1px solid #e9d5ff",
    background: "#faf5ff",
    color: "#7c3aed",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 500,
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
  };
  return (
    <div style={{ display: "flex", gap: 5, marginLeft: 8 }} onClick={e => e.stopPropagation()}>
      {onCopy && (
        <button
          style={btnStyle}
          onClick={() => { onCopy(); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          title="Copy block content"
        >{copied ? "✓ Copied" : "📋 Copy"}</button>
      )}
      {onAskMore && (
        <button style={btnStyle} onClick={onAskMore} title="Ask more about this">💬 Ask more</button>
      )}
    </div>
  );
}

function _FollowUpChips({ followUps, onFollowUpClick }: { followUps?: string[]; onFollowUpClick?: (q: string) => void }) {
  if (!followUps || followUps.length === 0 || !onFollowUpClick) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, paddingTop: 8, borderTop: "1px dashed #ede9fe" }}>
      <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, marginRight: 4, alignSelf: "center", textTransform: "uppercase", letterSpacing: "0.05em" }}>↳ Follow up:</span>
      {followUps.map((q, i) => (
        <button
          key={i}
          onClick={() => onFollowUpClick(q)}
          style={{ padding: "3px 9px", background: "#fff", border: "1px solid #ddd6fe", borderRadius: 12, fontSize: 11, color: "#6d28d9", cursor: "pointer", fontWeight: 500 }}
        >{q}</button>
      ))}
    </div>
  );
}

function CollapsibleBlock({ title, icon, children, defaultOpen = true, mode = "standard", subtitle, onCopy, onAskMore, followUps, onFollowUpClick }: {
  title: string; icon?: string; children: React.ReactNode; defaultOpen?: boolean;
  mode?: "hero" | "standard" | "compact"; subtitle?: string;
  onCopy?: () => void; onAskMore?: () => void;
  followUps?: string[]; onFollowUpClick?: (q: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (mode === "hero") {
    return (
      <div style={{ background: "#fff", border: "1px solid #e9d5ff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(124,58,237,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 16px 6px" }}>
          {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
          <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{title}</span>
          {subtitle && <span style={{ fontSize: 10, color: "#9ca3af", fontStyle: "italic" }}>{subtitle}</span>}
          <div style={{ marginLeft: "auto" }}>
            <_BlockActions onCopy={onCopy} onAskMore={onAskMore} />
          </div>
        </div>
        <div style={{ padding: "0 16px 14px" }}>
          {children}
          <_FollowUpChips followUps={followUps} onFollowUpClick={onFollowUpClick} />
        </div>
      </div>
    );
  }

  if (mode === "compact") {
    return (
      <div style={{ background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden" }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", cursor: "pointer", userSelect: "none" as const }}
          onClick={() => setOpen((o) => !o)}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", display: "flex", alignItems: "center", gap: 5 }}>
            {icon && <span>{icon}</span>}{title}
            {subtitle && <span style={{ fontWeight: 400 }}> · {subtitle}</span>}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {open && <_BlockActions onCopy={onCopy} onAskMore={onAskMore} compact />}
            <span style={{ fontSize: 11, color: "#d1d5db", display: "inline-block", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>▾</span>
          </div>
        </div>
        <div style={{ maxHeight: open ? 9999 : 0, overflow: "hidden", transition: "max-height 0.25s ease" }}>
          <div style={{ padding: "0 12px 10px" }}>
            {children}
            <_FollowUpChips followUps={followUps} onFollowUpClick={onFollowUpClick} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, overflow: "hidden" }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", cursor: "pointer", userSelect: "none" as const }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: 6 }}>
          {icon && <span>{icon}</span>}{title}
          {subtitle && <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}> · {subtitle}</span>}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {open && <_BlockActions onCopy={onCopy} onAskMore={onAskMore} />}
          <span style={{ fontSize: 14, color: "#9ca3af", display: "inline-block", transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>▾</span>
        </div>
      </div>
      <div style={{ maxHeight: open ? 9999 : 0, overflow: "hidden", transition: "max-height 0.3s ease" }}>
        <div style={{ padding: "0 14px 12px" }}>
          {children}
          <_FollowUpChips followUps={followUps} onFollowUpClick={onFollowUpClick} />
        </div>
      </div>
    </div>
  );
}

// TL;DR Answer Card pinned at the top of the primary column.
function TLDRCard({ intent, entities, summary, sourcesCount, confidence, isStreaming }: {
  intent: string | null;
  entities: string[];
  summary: string;
  sourcesCount: number;
  confidence: number;
  isStreaming?: boolean;
}) {
  const confidenceLabel = confidence >= 0.85 ? "High" : confidence >= 0.65 ? "Moderate" : "Low";
  const confidenceColor = confidence >= 0.85 ? "#16a34a" : confidence >= 0.65 ? "#ca8a04" : "#9ca3af";
  const intentLabel = INTENT_LABELS[intent ?? "general_info"] ?? "Answer";
  return (
    <div style={{
      background: "linear-gradient(135deg, #faf5ff 0%, #ffffff 100%)",
      border: "1px solid #ddd6fe",
      borderRadius: 14,
      padding: "14px 18px",
      marginBottom: 14,
      boxShadow: "0 2px 8px rgba(124,58,237,0.06)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", background: "#7c3aed", color: "#fff", borderRadius: 12, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
          ✦ {intentLabel}
        </span>
        {entities.slice(0, 3).map(e => (
          <span key={e} style={{ fontSize: 11, padding: "2px 8px", background: "#f5f3ff", color: "#7c3aed", borderRadius: 12, fontWeight: 500 }}>{e}</span>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#9ca3af" }}>{sourcesCount} source{sourcesCount === 1 ? "" : "s"}</span>
          {sourcesCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, color: confidenceColor }}>● {confidenceLabel} confidence</span>
          )}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "#1f2937", lineHeight: 1.6 }}>
        {summary || (isStreaming ? "Answering…" : "")}
        {isStreaming && <span style={{ display: "inline-block", width: 6, height: 12, background: "#7c3aed", marginLeft: 3, verticalAlign: "middle", animation: "astrid-blink 0.8s step-end infinite" }} />}
      </div>
    </div>
  );
}

// Metric block — KPI stat tiles
function MetricBlock({ metrics }: { metrics: MetricItem[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(120px, 1fr))`, gap: 10 }}>
      {metrics.map((m, i) => (
        <div key={i} style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "10px 14px" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#7c3aed", lineHeight: 1.2 }}>{m.value || "—"}</div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, lineHeight: 1.4 }}>{m.label}</div>
          {m.delta && (
            <div style={{ fontSize: 10, color: m.delta.startsWith("-") ? "#dc2626" : "#16a34a", marginTop: 3, fontWeight: 600 }}>{m.delta}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// Timeline block — horizontal version strip
function TimelineBlock({ events }: { events: TimelineEvent[] }) {
  return (
    <div style={{ position: "relative" as const, paddingLeft: 24, paddingTop: 6 }}>
      <div style={{ position: "absolute" as const, left: 8, top: 14, bottom: 6, width: 2, background: "linear-gradient(180deg, #c4b5fd 0%, #ede9fe 100%)" }} />
      {events.map((ev, i) => (
        <div key={i} style={{ position: "relative" as const, marginBottom: 12 }}>
          <div style={{ position: "absolute" as const, left: -20, top: 4, width: 10, height: 10, borderRadius: "50%", background: i === 0 ? "#7c3aed" : "#c4b5fd", border: "2px solid #fff", boxShadow: "0 0 0 2px #ddd6fe" }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>
            v{ev.version}
            {ev.date && <span style={{ fontSize: 10, fontWeight: 400, color: "#9ca3af", marginLeft: 6 }}>{ev.date}</span>}
          </div>
          <div style={{ fontSize: 12, color: "#4b5563", marginTop: 2, lineHeight: 1.5 }}>{ev.description}</div>
        </div>
      ))}
    </div>
  );
}

// Render block content with inline [n] citation chips
function _renderWithCitations(text: string, sources: CortanaSource[]): React.ReactNode {
  const { text: processed, citations } = _injectCitations(text, sources);
  if (citations.length === 0) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{processed}</ReactMarkdown>;
  }
  // Replace ⁽n⁾ with hoverable spans via a custom text renderer
  const components = {
    ...MD_COMPONENTS,
    text: ({ children }: { children?: React.ReactNode }) => {
      const str = String(children ?? "");
      const parts: React.ReactNode[] = [];
      const re = /⁽(\d+)⁾/g;
      let last = 0;
      let m;
      while ((m = re.exec(str)) !== null) {
        if (m.index > last) parts.push(str.slice(last, m.index));
        const n = parseInt(m[1], 10);
        const cite = citations.find(c => c.n === n);
        parts.push(
          <sup key={`${m.index}-${n}`} title={cite?.name} style={{ color: "#7c3aed", fontWeight: 700, fontSize: 9, padding: "0 3px", marginLeft: 2, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 4, cursor: cite?.url ? "pointer" : "default" }}>
            {cite?.url ? <a href={cite.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{n}</a> : n}
          </sup>
        );
        last = m.index + m[0].length;
      }
      if (last < str.length) parts.push(str.slice(last));
      return <>{parts}</>;
    },
  };
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{processed}</ReactMarkdown>;
}

const MD_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => <p style={{ margin: "0 0 10px 0", lineHeight: 1.7 }}>{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul style={{ margin: "4px 0 10px 0", paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol style={{ margin: "4px 0 10px 0", paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li style={{ marginBottom: 4, lineHeight: 1.65 }}>{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong style={{ fontWeight: 600, color: "#111827" }}>{children}</strong>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px 0", color: "#111827" }}>{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px 0", color: "#111827" }}>{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 6px 0", color: "#374151" }}>{children}</h3>,
  code: ({ children }: { children?: React.ReactNode }) => <code style={{ background: "rgba(99,102,241,0.08)", borderRadius: 4, padding: "2px 5px", fontSize: 13, color: "#4338ca", fontFamily: "ui-monospace, monospace" }}>{children}</code>,
  blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote style={{ borderLeft: "3px solid #c4b5fd", margin: "8px 0", paddingLeft: 14, color: "#6b7280", fontStyle: "italic" }}>{children}</blockquote>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div style={{ overflowX: "auto", margin: "8px 0 12px 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead style={{ background: "#f3f4f6" }}>{children}</thead>,
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr style={{ borderBottom: "1px solid #e5e7eb" }}>{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => <th style={{ padding: "6px 12px", textAlign: "left" as const, fontWeight: 600, color: "#374151", whiteSpace: "nowrap" as const, borderBottom: "2px solid #e5e7eb" }}>{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td style={{ padding: "6px 12px", color: "#4b5563", verticalAlign: "top" as const }}>{children}</td>,
};

const _KNOWN_PRODUCTS = ["Workspace", "Synthesis", "Template Converter", "Brand Kit", "Auto Generator", "Slide Library", "BizGenius"];

// ─────────────────────────────────────────────────────────────────────────────

export function OutputPanel({ selectedPreview, runId, token, runStatus, runState, isStreaming = false, workflowId, onSendPrompt }: Props) {
  const isCortana = workflowId === "cortana";
  // Derive typed view from selectedPreview
  const tickets: TicketData[] = selectedPreview?.type === "tickets" ? selectedPreview.tickets : [];
  const _rawAnswerContent: string | null = selectedPreview?.type === "answer" ? selectedPreview.content : null;
  // Strip partial FOLLOW_UP: marker that streaming may leak before the agent detects it
  const answerContent: string | null = _rawAnswerContent !== null
    ? _rawAnswerContent.replace(/\n*FOLLOW_UP:[\s\S]*$/i, "").replace(/\n*FOLLOW\s*$/i, "").trim() || _rawAnswerContent
    : null;
  const answerSources: CortanaSource[] = selectedPreview?.type === "answer" ? (selectedPreview.sources ?? []) : [];
  const answerIntent: string | null = selectedPreview?.type === "answer" ? (selectedPreview.intent ?? null) : null;
  const answerEntities: string[] = selectedPreview?.type === "answer" ? (selectedPreview.entities ?? []) : [];
  const answerSuggestedQs: string[] = selectedPreview?.type === "answer" ? (selectedPreview.suggested_questions ?? []) : [];
  const _backendWhatsNew: KBWhatsNew[] = selectedPreview?.type === "answer" ? (selectedPreview.whats_new ?? []) : [];
  const _backendPeople: KBPerson[] = selectedPreview?.type === "answer" ? (selectedPreview.people ?? []) : [];
  // Derive people / whats_new from parsed answer sections when backend extraction returned empty.
  const _derived = answerContent !== null
    ? _deriveRailDataFromBlocks(_parseAnswerBlocks(answerContent), _backendPeople, _backendWhatsNew)
    : { people: _backendPeople, whatsNew: _backendWhatsNew };
  const answerPeople: KBPerson[] = _derived.people;
  const answerWhatsNew: KBWhatsNew[] = _derived.whatsNew;
  const _answerBlocks = answerContent !== null ? _parseAnswerBlocks(answerContent) : [];
  const _hasReleaseBlock = _answerBlocks.some(b => b.type === "release");
  const answerOpenTickets: KBTicket[] = selectedPreview?.type === "answer" ? (selectedPreview.open_tickets ?? []) : [];
  const [vectorCount, setVectorCount] = useState<number | null>(null);
  const [sourceCounts, setSourceCounts] = useState<{ google_drive?: number; confluence?: number }>({});
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingSource, setSyncingSource] = useState<"drive" | "confluence" | "all" | null>(null);
  const [forceReindexing, setForceReindexing] = useState(false);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    drive: { done: number; total: number | null };
    confluence: { done: number; total: number | null };
  }>({ drive: { done: 0, total: null }, confluence: { done: 0, total: null } });
  const abortRef = React.useRef<AbortController | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [modalExportMenuOpen, setModalExportMenuOpen] = useState(false);
  const [tileExportOpen, setTileExportOpen] = useState<number | null>(null);
  // Tracks which tile (by index) just had its copy button clicked — shows "Copied" feedback
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [modalCopied, setModalCopied] = useState(false);
  const exportBtnRef = useRef<HTMLDivElement>(null) as React.MutableRefObject<HTMLDivElement>;
  const modalExportBtnRef = useRef<HTMLDivElement>(null) as React.MutableRefObject<HTMLDivElement>;

  // Derived values from runState
  const ticketsResult = (runState?.tickets ?? {}) as Record<string, unknown>;
  const jiraBaseUrl = (ticketsResult.jira_base_url as string) ?? "";
  const projectKey = (ticketsResult.project_key as string) ?? "";
  // createdKeys kept for potential future use (e.g. global "Open in Jira" project link)
  // const createdKeys = (ticketsResult.created_keys as string[]) ?? [];

  const isRunning = runStatus === "running" || runStatus === "pending";

  // Fetch KB vector count + per-source counts on mount (for Cortana)
  const refreshKbStatus = () => {
    fetch("/api/kb/status")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        if (d.vectors_count != null) setVectorCount(d.vectors_count);
        if (d.source_counts) setSourceCounts(d.source_counts);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!isCortana) return;
    refreshKbStatus();
  }, [isCortana]);

  const handleSync = async (source: "drive" | "confluence" | "all" = "all") => {
    if (syncing) return;
    setSyncing(true);
    setSyncingSource(source);
    setSyncProgress((prev) => ({
      drive: source === "confluence" ? prev.drive : { done: 0, total: null },
      confluence: source === "drive" ? prev.confluence : { done: 0, total: null },
    }));

    // Fire-and-forget: POST returns immediately with a job_id
    let jobId: string | null = null;
    try {
      const url = source === "all" ? "/api/kb/sync" : `/api/kb/sync?source=${source}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`sync start failed: ${resp.status}`);
      const data = await resp.json();
      jobId = data.job_id ?? null;
    } catch {
      setSyncing(false);
      setSyncingSource(null);
      return;
    }

    if (!jobId) { setSyncing(false); setSyncingSource(null); return; }

    // Poll /sync/status every 2 s until done or error
    const pollId = setInterval(async () => {
      try {
        const r = await fetch(`/api/kb/sync/status?job_id=${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const job = await r.json();

        // Update counters from job state
        const isDrive = source !== "confluence";
        const isConf  = source !== "drive";
        if (isDrive && job.total != null) {
          setSyncProgress((prev) => ({
            ...prev,
            drive: { done: job.done ?? 0, total: job.total },
          }));
        }
        if (isConf && job.total != null) {
          setSyncProgress((prev) => ({
            ...prev,
            confluence: { done: job.done ?? 0, total: job.total },
          }));
        }

        if (job.status === "done" || job.status === "error") {
          clearInterval(pollId);
          if (job.result?.vectors_count != null) setVectorCount(job.result.vectors_count);
          setSyncing(false);
          setSyncingSource(null);
          refreshKbStatus();
        }
      } catch { /* network blip — keep polling */ }
    }, 2000);

    // Store the interval id so Stop can cancel it
    (abortRef.current as unknown as { pollId?: ReturnType<typeof setInterval> }) = { pollId };
  };

  const handleStopSync = () => {
    const ref = abortRef.current as unknown as { pollId?: ReturnType<typeof setInterval> };
    if (ref?.pollId) clearInterval(ref.pollId);
    abortRef.current = null;
    setSyncing(false);
    setSyncingSource(null);
  };

  const handleForceReindex = async () => {
    setShowForceConfirm(false);
    setForceReindexing(true);
    try {
      const resp = await fetch("/api/kb/sync/force", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) { setForceReindexing(false); return; }
      const data = await resp.json();
      const jobId: string = data.job_id;

      const pollId = setInterval(async () => {
        try {
          const r = await fetch(`/api/kb/sync/status?job_id=${jobId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) return;
          const job = await r.json();
          if (job.status === "done" || job.status === "error") {
            clearInterval(pollId);
            setForceReindexing(false);
            refreshKbStatus();
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch {
      setForceReindexing(false);
    }
  };

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportBtnRef.current && !exportBtnRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!modalExportMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modalExportBtnRef.current && !modalExportBtnRef.current.contains(e.target as Node)) {
        setModalExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modalExportMenuOpen]);

  // Close tile export dropdown on outside click
  useEffect(() => {
    if (tileExportOpen === null) return;
    const handler = (e: MouseEvent) => {
      const el = document.getElementById(`tile-export-${tileExportOpen}`);
      if (el && !el.contains(e.target as Node)) setTileExportOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tileExportOpen]);

  const exportTickets = async (format: "docx" | "csv", ticketsToExport: TicketData[]) => {
    if (ticketsToExport.length === 0) return;
    try {
      const res = await fetch(`/api/runs/${runId}/export-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tickets: ticketsToExport, format, project_key: projectKey || "TICKETS" }),
      });
      if (!res.ok) { alert(`Export failed (${res.status}): ${await res.text().catch(() => res.statusText)}`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const nameMatch = res.headers.get("content-disposition")?.match(/filename="?([^"]+)"?/);
      a.download = nameMatch?.[1] ?? `tickets.${format}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { alert(`Export error: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleExport = async (format: "docx" | "csv") => {
    setExportMenuOpen(false);
    setModalExportMenuOpen(false);
    await exportTickets(format, tickets);
  };

  const isExportDisabled = (_format: "docx" | "csv") => tickets.length === 0;

  const expandedTicket = expandedIndex !== null ? tickets[expandedIndex] : null;

  // Export dropdown component (reusable)
  const ExportDropdown = ({
    open,
    btnRef,
    onToggle,
    direction = "down",
  }: {
    open: boolean;
    btnRef: React.RefObject<HTMLDivElement>;
    onToggle: () => void;
    direction?: "up" | "down";
  }) => (
    <div ref={btnRef} style={{ position: "relative" as const }}>
      <button style={styles.exportBtn} onClick={onToggle}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Export
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2 }}>
          <polyline points={direction === "up" ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/>
        </svg>
      </button>
      {open && (
        <div style={{
          ...styles.exportDropdown,
          ...(direction === "up"
            ? { bottom: "calc(100% + 4px)", top: "auto" }
            : { top: "calc(100% + 4px)" }),
        }}>
          {(["docx", "csv"] as const).map((fmt) => {
            const disabled = isExportDisabled(fmt);
            return (
              <button
                key={fmt}
                style={{
                  ...styles.exportDropdownItem,
                  opacity: disabled ? 0.45 : 1,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
                onClick={() => !disabled && handleExport(fmt)}
                disabled={disabled}
              >
                Export as {fmt.toUpperCase()}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ ...styles.container, position: "relative" as const }}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Output</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
          {isCortana && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {vectorCount != null && (
                <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>
                  {vectorCount.toLocaleString()} vectors
                </span>
              )}
              <button
                onClick={() => setSyncPanelOpen((o) => !o)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 12px",
                  background: syncing ? "rgba(99,102,241,0.10)" : "linear-gradient(135deg,#7c3aed,#6366f1)",
                  color: syncing ? "#6366f1" : "#fff",
                  border: syncing ? "1px solid #c4b5fd" : "none",
                  borderRadius: 7, fontSize: 12, fontWeight: 600,
                  cursor: "pointer",
                }}
                title="Sync & Re-ingest knowledge base"
              >
                <span style={{ display: "inline-block", animation: syncing ? "kb-spin 1s linear infinite" : "none" }}>↻</span>
                {syncing ? "Syncing…" : "Sync"}
              </button>
            </div>
          )}
          {selectedPreview?.type === "tickets" && (
            <div style={styles.headerActions}>
              <ExportDropdown
                open={exportMenuOpen}
                btnRef={exportBtnRef}
                onToggle={() => setExportMenuOpen((o) => !o)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Sync Panel — slide-in overlay */}
      {isCortana && syncPanelOpen && (
        <div style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: 340,
          background: "#fff", borderLeft: "1px solid #e5e7eb",
          boxShadow: "-6px 0 32px rgba(99,102,241,0.10)",
          display: "flex", flexDirection: "column", zIndex: 20,
        }}>
          {/* Panel header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: "1px solid #f3f4f6" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Sync Sources</span>
            <button onClick={() => setSyncPanelOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#6b7280", lineHeight: 1 }}>✕</button>
          </div>

          {/* Source cards */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Google Drive */}
            {(() => {
              const { done, total } = syncProgress.drive;
              const isActive = syncingSource === "drive" || syncingSource === "all";
              const pct = total ? Math.min(100, Math.round((done / total) * 100)) : (isActive && done > 0 ? 60 : 0);
              return (
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, background: "#fafafa" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 20 }}>📁</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Google Drive</span>
                    </div>
                    <button
                      onClick={() => handleSync("drive")}
                      disabled={syncing}
                      style={{ padding: "4px 12px", background: syncing ? "rgba(99,102,241,0.08)" : "#6366f1", color: syncing ? "#6366f1" : "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: syncing ? "not-allowed" : "pointer" }}
                    >
                      {isActive ? "Syncing…" : "Sync"}
                    </button>
                  </div>
                  <div style={{ height: 5, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3,
                      background: sourceCounts.google_drive && !isActive && done === 0 ? "linear-gradient(90deg,#16a34a,#22c55e)" : "linear-gradient(90deg,#7c3aed,#6366f1)",
                      width: sourceCounts.google_drive && !isActive && done === 0 ? "100%" : `${pct}%`,
                      transition: "width 0.4s ease",
                      ...(isActive && done === 0 ? { animation: "kb-indeterminate 1.5s ease-in-out infinite", width: "30%" } : {}),
                    }} />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                    {isActive
                      ? <span style={{ color: "#6b7280" }}>{done > 0 ? `${done}${total ? `/${total}` : ""} files processed…` : "Starting…"}</span>
                      : sourceCounts.google_drive
                      ? <><span style={{ color: "#16a34a" }}>✓</span><span style={{ color: "#16a34a" }}>Synced ({sourceCounts.google_drive.toLocaleString()} vectors)</span></>
                      : done > 0
                      ? <><span style={{ color: "#ef4444" }}>✗</span><span style={{ color: "#ef4444" }}>Sync failed — check permissions</span></>
                      : <span style={{ color: "#6b7280" }}>Not synced yet</span>}
                  </div>
                </div>
              );
            })()}

            {/* Confluence */}
            {(() => {
              const { done } = syncProgress.confluence;
              const isActive = syncingSource === "confluence" || syncingSource === "all";
              return (
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, background: "#fafafa" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 20 }}>📄</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Confluence</span>
                    </div>
                    <button
                      onClick={() => handleSync("confluence")}
                      disabled={syncing}
                      style={{ padding: "4px 12px", background: syncing ? "rgba(99,102,241,0.08)" : "#6366f1", color: syncing ? "#6366f1" : "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: syncing ? "not-allowed" : "pointer" }}
                    >
                      {isActive ? "Syncing…" : "Sync"}
                    </button>
                  </div>
                  <div style={{ height: 5, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3,
                      background: sourceCounts.confluence && !isActive ? "linear-gradient(90deg,#16a34a,#22c55e)" : "linear-gradient(90deg,#7c3aed,#6366f1)",
                      width: done > 0 ? `${Math.min(100, done * 10)}%` : (sourceCounts.confluence && !isActive ? "100%" : "0%"),
                      transition: "width 0.4s ease",
                      ...(isActive && done === 0 ? { animation: "kb-indeterminate 1.5s ease-in-out infinite", width: "30%" } : {}),
                    }} />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                    {isActive
                      ? <span style={{ color: "#6b7280" }}>{done > 0 ? `${done} pages processed…` : "Starting…"}</span>
                      : sourceCounts.confluence
                      ? <><span style={{ color: "#16a34a" }}>✓</span><span style={{ color: "#16a34a" }}>Synced ({sourceCounts.confluence.toLocaleString()} vectors)</span></>
                      : done > 0
                      ? <><span style={{ color: "#ef4444" }}>✗</span><span style={{ color: "#ef4444" }}>Auth error — 403 Forbidden on Confluence API</span></>
                      : <span style={{ color: "#6b7280" }}>Not synced yet</span>}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Bottom buttons */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid #f3f4f6", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleStopSync}
                disabled={!syncing}
                style={{ flex: 1, padding: "8px 0", background: syncing ? "#fee2e2" : "#f3f4f6", color: syncing ? "#dc2626" : "#9ca3af", border: "none", borderRadius: 8, cursor: syncing ? "pointer" : "default", fontWeight: 600, fontSize: 13 }}
              >
                Stop Sync
              </button>
              <button
                onClick={() => handleSync("all")}
                disabled={syncing || forceReindexing}
                style={{ flex: 1, padding: "8px 0", background: syncing ? "rgba(99,102,241,0.12)" : "linear-gradient(135deg,#7c3aed,#6366f1)", color: syncing ? "#6366f1" : "#fff", border: "none", borderRadius: 8, cursor: (syncing || forceReindexing) ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13 }}
              >
                {syncing ? "Syncing…" : "Sync All"}
              </button>
            </div>
            <button
              onClick={() => setShowForceConfirm(true)}
              disabled={syncing || forceReindexing}
              style={{ width: "100%", padding: "8px 0", background: "#fff", color: forceReindexing ? "#9ca3af" : "#6b7280", border: "1px solid #e5e7eb", borderRadius: 8, cursor: (syncing || forceReindexing) ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
            >
              {forceReindexing ? "Reindexing…" : "⟳ Force Full Reindex"}
            </button>
          </div>

          {/* Confirmation dialog */}
          {showForceConfirm && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
              <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", maxWidth: 420, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.14)" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 10 }}>Force Full Reindex</div>
                <div style={{ fontSize: 14, color: "#4b5563", lineHeight: 1.6, marginBottom: 24 }}>
                  This will reindex data from all sources. Are you sure you want to proceed?
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button
                    onClick={() => setShowForceConfirm(false)}
                    style={{ padding: "8px 18px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleForceReindex}
                    style={{ padding: "8px 18px", background: "linear-gradient(135deg,#dc2626,#ef4444)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    Yes, Reindex
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scroll area */}
      <div style={styles.scrollArea}>
        {/* State: nothing generated yet — running */}
        {!selectedPreview && isRunning && (
          <div style={styles.placeholder}>
            <div style={styles.spinnerWrap}>
              <div style={styles.spinner} />
              <div style={styles.spinnerRing} />
            </div>
            <p style={styles.placeholderText}>Brewing…</p>
            <p style={styles.placeholderSub}>Your outputs will appear here</p>
          </div>
        )}

        {/* State: nothing generated yet — idle */}
        {!selectedPreview && !isRunning && (
          <div style={styles.placeholder}>
            <div style={styles.placeholderIconWrap}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>
                <line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="9" y1="21" x2="9" y2="9"/>
              </svg>
            </div>
            <p style={styles.placeholderText}>Your outputs will appear here</p>
          </div>
        )}

        {/* Cortana answer panel — two-column enterprise workspace */}
        {!!answerContent && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", background: "#fff", borderRadius: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04)" }}>

            {/* Two-column body */}
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

              {/* Primary column — 68% */}
              <div style={{ flex: "0 0 68%", overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>

                {/* Skeleton while streaming with little content yet */}
                {isStreaming && (answerContent?.length ?? 0) < 50 ? (
                  <>
                    {[1, 2, 3].map((n) => (
                      <div key={n} style={{ height: 12, background: "linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%)", borderRadius: 6, marginBottom: 8, animation: "astrid-pulse 1.4s ease infinite" }} />
                    ))}
                  </>
                ) : (
                  <>
                    {(() => {
                      const parsedBlocks = _parseAnswerBlocks(answerContent ?? "");
                      const scoredBlocks = _scoreBlocks(parsedBlocks, answerIntent, answerEntities)
                        .sort((a, b) => b.relevance - a.relevance)
                        .filter(b => _blockRenderMode(b.relevance) !== "hidden");

                      // TL;DR data
                      const summaryBlock = parsedBlocks.find(b => b.type === "summary");
                      const tldrText = summaryBlock
                        ? summaryBlock.content.replace(/\*\*/g, "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").trim()
                        : "";
                      const avgConfidence = answerSources.length > 0
                        ? answerSources.reduce((a, s) => a + (s.final_score || s.similarity || 0), 0) / answerSources.length
                        : 0;

                      const blockEls: React.ReactNode[] = [];
                      blockEls.push(
                        <TLDRCard
                          key="tldr"
                          intent={answerIntent}
                          entities={answerEntities}
                          summary={tldrText}
                          sourcesCount={answerSources.length}
                          confidence={avgConfidence}
                          isStreaming={isStreaming && !tldrText}
                        />
                      );

                      if (scoredBlocks.length === 0 && !isStreaming) {
                        blockEls.push(
                          <div key="raw-answer" style={{ fontSize: 14, color: "#1f2937", lineHeight: 1.7, padding: "4px 0" }}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{answerContent ?? ""}</ReactMarkdown>
                          </div>
                        );
                        return blockEls;
                      }

                      const askMore = (q: string) => onSendPrompt?.(q);
                      const copyBlock = (text: string) => navigator.clipboard?.writeText(text);

                      scoredBlocks.forEach((block, bi) => {
                        const mode = _blockRenderMode(block.relevance);
                        const visMode = _visibleMode(mode);
                        const followUps = onSendPrompt ? _genFollowUpsForBlock(block, answerEntities[0] ?? null).slice(0, 2) : undefined;
                        const onAskMore = onSendPrompt ? () => askMore(`Tell me more about ${block.title}`) : undefined;
                        const onCopy = () => copyBlock(block.content);
                        const commonProps = { onCopy, onAskMore, followUps, onFollowUpClick: onSendPrompt };

                        if (block.type === "capabilities") {
                          const items = block.items ?? [];
                          if (mode === "hero" && items.length >= 4) {
                            blockEls.push(
                              <CollapsibleBlock key={block.id} title="Key capabilities" icon="⚡" defaultOpen mode="hero" {...commonProps}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                                  {items.map((item, ii) => (
                                    <div key={ii} style={{ padding: "10px 12px", background: "#f9fafb", border: "1px solid #f0f0f0", borderRadius: 8 }}
                                      onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(124,58,237,0.10)")}
                                      onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
                                    >
                                      <div style={{ fontSize: 17, marginBottom: 3 }}>{item.icon}</div>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", marginBottom: 2, lineHeight: 1.4, wordBreak: "break-word" as const }}>{item.title}</div>
                                      {item.desc && <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.5, wordBreak: "break-word" as const }}>{item.desc}</div>}
                                    </div>
                                  ))}
                                </div>
                              </CollapsibleBlock>
                            );
                            return;
                          }
                          if (items.length >= 2) {
                            blockEls.push(
                              <CollapsibleBlock key={block.id} title="Key capabilities" icon="⚡" defaultOpen={visMode !== "compact"} mode={visMode} {...commonProps}>
                                <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginTop: 4 }}>
                                  {items.map((item, ii) => (
                                    <span key={ii} style={{ padding: "4px 10px", background: "#f5f3ff", border: "1px solid #e9d5ff", borderRadius: 20, fontSize: 12, color: "#6d28d9", fontWeight: 500 }}>
                                      {item.icon} {item.title}
                                    </span>
                                  ))}
                                </div>
                              </CollapsibleBlock>
                            );
                            return;
                          }
                          blockEls.push(
                            <CollapsibleBlock key={block.id} title={block.title} defaultOpen={visMode !== "compact"} mode={visMode} {...commonProps}>
                              <div style={{ fontSize: 13, color: "#1f2937", lineHeight: 1.7 }}>
                                {_renderWithCitations(block.content, answerSources)}
                              </div>
                            </CollapsibleBlock>
                          );
                          return;
                        }

                        if (block.type === "metric" && block.metrics) {
                          blockEls.push(
                            <CollapsibleBlock key={block.id} title={block.title} icon="📈" defaultOpen mode={visMode === "compact" ? "standard" : visMode} {...commonProps}>
                              <MetricBlock metrics={block.metrics} />
                            </CollapsibleBlock>
                          );
                          return;
                        }
                        if (block.type === "timeline" && block.timelineEvents) {
                          blockEls.push(
                            <CollapsibleBlock key={block.id} title={block.title} icon="🕐" defaultOpen={visMode !== "compact"} mode={visMode} {...commonProps}>
                              <TimelineBlock events={block.timelineEvents} />
                            </CollapsibleBlock>
                          );
                          return;
                        }

                        if (block.type === "table" && block.tableData) {
                          blockEls.push(
                            <CollapsibleBlock key={block.id} title={`${block.title} (${block.tableData.rows.length})`} icon="📊" defaultOpen={visMode !== "compact"} mode={visMode} {...commonProps}>
                              <PaginatedTable data={block.tableData} title={block.title} />
                            </CollapsibleBlock>
                          );
                          return;
                        }
                        if (block.type === "alert") {
                          blockEls.push(
                            <CollapsibleBlock key={block.id} title={block.title} icon="⚠️" defaultOpen mode={visMode} {...commonProps}>
                              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#92400e", lineHeight: 1.6 }}>
                                {_renderWithCitations(block.content, answerSources)}
                              </div>
                            </CollapsibleBlock>
                          );
                          return;
                        }
                        if (block.type === "release") {
                          blockEls.push(
                            <CollapsibleBlock key={block.id} title={block.title} icon="🚀" defaultOpen={visMode !== "compact"} mode={visMode} {...commonProps}>
                              <div style={{ fontSize: 13, color: "#1f2937", lineHeight: 1.7 }}>
                                {_renderWithCitations(block.content, answerSources)}
                              </div>
                            </CollapsibleBlock>
                          );
                          return;
                        }
                        if (block.type === "comparison") {
                          blockEls.push(
                            <CollapsibleBlock key={block.id} title={block.title} icon="⚖️" defaultOpen={visMode !== "compact"} mode={visMode} {...commonProps}>
                              <div style={{ fontSize: 13, color: "#1f2937", lineHeight: 1.7, overflowX: "auto" }}>
                                {_renderWithCitations(block.content, answerSources)}
                              </div>
                            </CollapsibleBlock>
                          );
                          return;
                        }
                        if (block.type === "faq") {
                          blockEls.push(
                            <CollapsibleBlock key={block.id} title={block.title} icon="❓" defaultOpen={visMode !== "compact"} mode={visMode} {...commonProps}>
                              <div style={{ fontSize: 13, color: "#1f2937", lineHeight: 1.7 }}>
                                {_renderWithCitations(block.content, answerSources)}
                              </div>
                            </CollapsibleBlock>
                          );
                          return;
                        }
                        const isSummary = block.type === "summary";
                        // Hide summary block in primary column since TLDR card already shows it
                        if (isSummary) return;
                        blockEls.push(
                          <CollapsibleBlock key={block.id} title={block.title} defaultOpen={visMode !== "compact"} mode={visMode} {...commonProps}>
                            <div style={{ fontSize: 13, color: "#1f2937", lineHeight: 1.7 }}>
                              {_renderWithCitations(block.content, answerSources)}
                              {isStreaming && bi === 0 && <span style={styles.streamingCursor} />}
                            </div>
                          </CollapsibleBlock>
                        );
                      });
                      return blockEls;
                    })()}
                  </>
                )}

                {/* Sources — inline chips, always visible below blocks */}
                {answerSources.length > 0 && !isStreaming && (() => {
                  const deduped = Array.from(
                    answerSources.reduce((map, src) => {
                      const key = src.file_name ?? src.source_url ?? "unknown";
                      const existing = map.get(key);
                      const score = src.similarity ?? 0;
                      if (!existing || score > (existing.similarity ?? 0)) map.set(key, src);
                      return map;
                    }, new Map<string, CortanaSource>()).values()
                  )
                    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
                    .slice(0, 5);
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const, paddingTop: 2, paddingBottom: 2 }}>
                      <span style={{ fontSize: 10, color: "#d1d5db", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.06em", whiteSpace: "nowrap" as const }}>Sources</span>
                      {deduped.map((src, j) => {
                        const ext = (src.file_name ?? "").split(".").pop()?.toLowerCase() ?? "";
                        const isSheet = ["csv", "xlsx", "xls"].includes(ext);
                        const iconLabel = isSheet ? "⊞" : "⊟";
                        const matchPct = src.similarity != null ? `${(src.similarity * 100).toFixed(0)}%` : null;
                        const chip = (
                          <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 20, fontSize: 10, color: "#6b7280", fontWeight: 500 }}>
                            {iconLabel} {(src.file_name ?? "Source").replace(/\.[^.]+$/, "").slice(0, 26)}
                            {matchPct && <span style={{ color: "#a78bfa", marginLeft: 2 }}>{matchPct}</span>}
                          </span>
                        );
                        return src.source_url
                          ? <a key={j} href={src.source_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>{chip}</a>
                          : <React.Fragment key={j}>{chip}</React.Fragment>;
                      })}
                    </div>
                  );
                })()}

              </div>

              {/* Intelligence rail — 32% */}
              {(() => {
                const content = answerContent ?? "";
                const hasOwnershipTable = /pm owner|feature owner|pm 1|pm owner 1/i.test(content);
                const relatedSystems = _KNOWN_PRODUCTS.filter(p => content.includes(p));
                // Also include entity names that aren't already in relatedSystems
                const entitySystems = answerEntities.filter(e => !relatedSystems.includes(e) && e.length > 2);
                const allRelated = [...relatedSystems, ...entitySystems];

                // Feature→PM table summary (only for PM mapping tables)
                let featureOwnerCard: React.ReactNode = null;
                if (hasOwnershipTable) {
                  const tableBlock = _parseAnswerBlocks(content).find(b => b.type === "table" && b.tableData);
                  if (tableBlock?.tableData) {
                    const { headers, rows } = tableBlock.tableData;
                    const featureColIdx = headers.findIndex(h => /feature/i.test(h));
                    const pmColIdx = headers.findIndex(h => /pm|owner/i.test(h));
                    if (featureColIdx !== -1 && pmColIdx !== -1) {
                      featureOwnerCard = (
                        <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                            👤 Feature Ownership
                            <span style={{ marginLeft: "auto", fontSize: 10, color: "#7c3aed", fontWeight: 600 }}>{rows.length} features</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {rows.slice(0, 4).map((row, i) => (
                              <div key={i} style={{ display: "flex", alignItems: "flex-start", padding: "4px 0", borderBottom: i < 3 ? "1px solid #f9fafb" : "none" }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", lineHeight: 1.3 }}>{row[featureColIdx]}</div>
                                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>{row[pmColIdx].replace(/\(.*?\)/g, "").trim()}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                          {rows.length > 4 && <div style={{ fontSize: 11, color: "#7c3aed", marginTop: 8, fontWeight: 500 }}>+{rows.length - 4} more features →</div>}
                        </div>
                      );
                    }
                  }
                }

                const railHasContent = true; // Quick Actions always render

                return (
                  <div style={{ flex: "0 0 32%", overflowY: "auto", padding: "12px 12px", display: "flex", flexDirection: "column", gap: 10, borderLeft: "1px solid #f0f0f0", background: "#fafafa" }}>

                    {/* QUICK ACTIONS — always at top of rail */}
                    {(() => {
                      const content = answerContent ?? "";
                      const hasOwnershipTable = /pm owner|feature owner|pm 1|pm owner 1/i.test(content);
                      const hasReleaseData = /version|release|changelog|what's new/i.test(content);
                      const isOwnershipQ = answerIntent === "feature_ownership" || answerIntent === "contact_lookup" || hasOwnershipTable;
                      const isReleaseQ = answerIntent === "release_notes" || hasReleaseData;
                      const entityName = answerEntities.length > 0 ? answerEntities[0] : null;
                      let prompts: string[];
                      if (answerSuggestedQs.length > 0) {
                        prompts = answerSuggestedQs.slice(0, 4);
                      } else if (entityName && !isOwnershipQ && !isReleaseQ) {
                        prompts = [
                          `Who is the PM for ${entityName}?`,
                          `Latest ${entityName} enhancements`,
                          `Show ${entityName} open issues`,
                          `How does ${entityName} integrate with other tools?`,
                        ];
                      } else if (isOwnershipQ) {
                        prompts = entityName
                          ? [`Who is the PM for ${entityName}?`, "List all PMs and their features", `Show contact info for ${entityName} team`, "Show full org ownership"]
                          : ["Who owns Auto Generator?", "List all PMs and their features", "Show contact info for PMs", "Show full org ownership"];
                      } else if (isReleaseQ) {
                        prompts = entityName
                          ? [`Latest ${entityName} release notes`, `What was fixed in ${entityName}?`, "Show version history", "What's coming next?"]
                          : ["Latest release notes", "What was fixed in the last version?", "Show version history", "What's coming next?"];
                      } else {
                        prompts = ["Who owns this feature?", "Show related release notes", "What are the key capabilities?", "Show usage metrics"];
                      }
                      if (!onSendPrompt) return null;
                      return (
                        <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 8 }}>→ Quick actions</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {prompts.map((q, i) => (
                              <button key={i}
                                style={{ padding: "5px 10px", background: "#f5f3ff", border: "1px solid #e9d5ff", borderRadius: 8, fontSize: 11, color: "#7c3aed", fontWeight: 500, cursor: "pointer", textAlign: "left" as const, lineHeight: 1.4 }}
                                onClick={() => onSendPrompt(q)}
                              >{q}</button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* WHO TO REACH OUT — auto-promoted for any query with people data */}
                    {answerPeople.length > 0 && (
                      <div style={{ background: "#fff", border: "1px solid #ede9fe", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 8 }}>👤 Who to reach out</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {answerPeople.map((p, i) => (
                            <div key={i} style={styles.astridPersonCard}>
                              <div style={styles.astridPersonAvatar}>
                                <span style={styles.astridPersonInitials}>
                                  {p.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
                                </span>
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={styles.astridPersonName}>{p.name}</div>
                                {p.features && p.features.length > 0 && (
                                  <div style={styles.astridPersonFeatures}>{p.features.slice(0, 2).join(", ")}</div>
                                )}
                              </div>
                              {p.email && (
                                <a href={`mailto:${p.email}`} style={styles.astridMailtoBtn} title={`Email ${p.name}`}>✉</a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Feature ownership table summary (PM mapping answers) */}
                    {featureOwnerCard}

                    {/* Latest Enhancements — hidden when main content already has a release block */}
                    {answerWhatsNew.length > 0 && !_hasReleaseBlock && (
                      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 8 }}>✦ Latest Enhancements</div>
                        <ul style={{ margin: "0 0 6px 0", paddingLeft: 16 }}>
                          {(answerWhatsNew[0].items ?? []).slice(0, 4).map((item, i) => (
                            <li key={i} style={styles.astridWhatsNewItem}>{item}</li>
                          ))}
                        </ul>
                        {answerWhatsNew[0].url && (
                          <a href={answerWhatsNew[0].url} target="_blank" rel="noreferrer" style={styles.astridWhatsNewLink}>Full release notes ↗</a>
                        )}
                      </div>
                    )}

                    {/* Open Issues */}
                    {answerOpenTickets.length > 0 && (
                      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 8 }}>🎫 Open Issues ({answerOpenTickets.length})</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {answerOpenTickets.slice(0, 3).map((t, i) => (
                            <a key={i} href={t.url || "#"} target="_blank" rel="noreferrer" style={styles.astridTicketRow}>
                              <span style={{
                                ...styles.astridTicketStatus,
                                background: t.status === "In Progress" ? "#fef3c7" : t.status === "Done" ? "#d1fae5" : "#e0e7ff",
                                color: t.status === "In Progress" ? "#92400e" : t.status === "Done" ? "#065f46" : "#3730a3",
                              }}>
                                {t.status}
                              </span>
                              <span style={styles.astridTicketTitle}>{t.id}: {t.title}</span>
                              {t.assignee && <span style={styles.astridTicketAssignee}>{t.assignee}</span>}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Related Systems — shows known products + detected entities */}
                    {allRelated.length > 0 && (
                      <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 8 }}>🔗 Related Systems</div>
                        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginTop: 4 }}>
                          {allRelated.map((p, i) => (
                            <span key={i} style={{ padding: "3px 10px", background: "#f5f3ff", border: "1px solid #e9d5ff", borderRadius: 20, fontSize: 11, color: "#7c3aed", fontWeight: 500 }}>
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Empty rail placeholder (never shown since Quick Actions always render) */}
                    {!railHasContent && (
                      <div style={{ padding: "20px 14px", textAlign: "center" as const, color: "#d1d5db", fontSize: 12 }}>
                        Ask about a specific feature to see ownership & context here
                      </div>
                    )}

                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Ticket cards */}
        {tickets.length > 0 && (
          <div style={styles.ticketList}>
            {tickets.map((ticket, i) => {
              const ts = issueTypeBadge(ticket.issue_type);
              const pb = priorityBadge(ticket.priority);
              const visibleLabels = ticket.labels.slice(0, 3);
              const extraLabels = ticket.labels.length - 3;
              return (
                <div key={i} style={styles.card}>
                  {/* Top row: badges | Copy | Export ▾ | expand */}
                  <div style={styles.cardTopRow}>
                    <div style={styles.cardBadges}>
                      <span style={{ ...styles.badge, background: ts.bg, color: ts.color }}>
                        {ticket.issue_type.replace(/_/g, " ")}
                      </span>
                      <span style={{ ...styles.badge, background: pb.bg, color: pb.color }}>
                        {ticket.priority}
                      </span>
                    </div>
                    <div style={styles.cardTopActions}>
                      {/* Open in Jira — only when ticket has been created */}
                      {ticket.jira_key && jiraBaseUrl && (
                        <a
                          href={`${jiraBaseUrl}/browse/${ticket.jira_key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.tileActionBtn as React.CSSProperties}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                          Open in Jira
                        </a>
                      )}
                      {/* Copy */}
                      <button
                        style={{
                          ...styles.tileActionBtn,
                          ...(copiedIndex === i ? { background: "#16a34a" } : {}),
                        }}
                        title="Copy summary and description"
                        onClick={() => {
                          navigator.clipboard.writeText(ticket.summary + "\n\n" + ticket.description).catch(() => {});
                          setCopiedIndex(i);
                          setTimeout(() => setCopiedIndex((c) => (c === i ? null : c)), 1800);
                        }}
                      >
                        {copiedIndex === i ? (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            Copied
                          </>
                        ) : (
                          <>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                            Copy
                          </>
                        )}
                      </button>

                      {/* Per-tile Export dropdown */}
                      <div id={`tile-export-${i}`} style={{ position: "relative" as const }}>
                        <button
                          style={styles.tileActionBtn}
                          onClick={() => setTileExportOpen(tileExportOpen === i ? null : i)}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          Export
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                        {tileExportOpen === i && (
                          <div style={{ ...styles.exportDropdown, minWidth: 140, top: "calc(100% + 4px)" }}>
                            {(["docx", "csv"] as const).map((fmt) => (
                              <button
                                key={fmt}
                                style={styles.exportDropdownItem}
                                onClick={() => { setTileExportOpen(null); exportTickets(fmt, [ticket]); }}
                              >
                                Export as {fmt.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Expand */}
                      <button
                        style={{ ...styles.expandBtn, gap: 4, padding: "4px 8px", fontSize: 11, fontWeight: 600 }}
                        onClick={() => setExpandedIndex(i)}
                        title="View Description"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="15 3 21 3 21 9"/>
                          <polyline points="9 21 3 21 3 15"/>
                          <line x1="21" y1="3" x2="14" y2="10"/>
                          <line x1="3" y1="21" x2="10" y2="14"/>
                        </svg>
                        View Description
                      </button>
                    </div>
                  </div>

                  {/* Summary — 2-line clamp */}
                  <h3 style={styles.cardSummary}>{ticket.summary}</h3>

                  {/* Labels */}
                  {ticket.labels.length > 0 && (
                    <div style={styles.labelsRow}>
                      {visibleLabels.map((label, li) => (
                        <span key={li} style={styles.labelChip}>{label}</span>
                      ))}
                      {extraLabels > 0 && (
                        <span style={styles.labelChip}>+{extraLabels} more</span>
                      )}
                    </div>
                  )}

                  {/* Subtasks */}
                  {ticket.subtasks && ticket.subtasks.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 5, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
                        Subtasks ({ticket.subtasks.length})
                      </div>
                      {ticket.subtasks.map((sub) => (
                        <div key={sub.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#4338ca", fontFamily: "monospace", flexShrink: 0 }}>
                            {sub.key}
                          </span>
                          <span style={{ fontSize: 12, color: "#374151", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                            {sub.summary}
                          </span>
                          <span style={{ fontSize: 10, color: "#6b7280", background: "rgba(107,114,128,0.1)", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
                            {sub.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Expanded modal */}
      {expandedTicket !== null && expandedIndex !== null && (
        <div
          style={styles.modalBackdrop}
          onClick={() => setExpandedIndex(null)}
        >
          <div
            style={styles.modalCard}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal sticky header */}
            <div style={styles.modalHeader}>
              <div style={styles.modalHeaderBadges}>
                {expandedTicket.jira_key && (
                  <span style={styles.jiraKeyPill}>{expandedTicket.jira_key}</span>
                )}
                <span style={{ ...styles.badge, background: issueTypeBadge(expandedTicket.issue_type).bg, color: issueTypeBadge(expandedTicket.issue_type).color }}>
                  {expandedTicket.issue_type.replace(/_/g, " ")}
                </span>
                <span style={{ ...styles.badge, background: priorityBadge(expandedTicket.priority).bg, color: priorityBadge(expandedTicket.priority).color }}>
                  {expandedTicket.priority}
                </span>
              </div>
              {/* Copy + Export + Close in header right */}
              <div style={styles.modalHeaderRight}>
                <button
                  style={{ ...styles.copyBtn, ...(modalCopied ? { background: "#16a34a", color: "#fff", borderColor: "#16a34a" } : {}) }}
                  onClick={() => {
                    const ac = expandedTicket.acceptance_criteria?.length
                      ? "\n\nAcceptance Criteria:\n" + expandedTicket.acceptance_criteria.map((c: string) => `- ${c}`).join("\n")
                      : "";
                    navigator.clipboard.writeText(
                      expandedTicket.summary + "\n\n" + expandedTicket.description + ac
                    ).catch(() => {});
                    setModalCopied(true);
                    setTimeout(() => setModalCopied(false), 1800);
                  }}
                >
                  {modalCopied ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      Copy
                    </>
                  )}
                </button>
                <ExportDropdown
                  open={modalExportMenuOpen}
                  btnRef={modalExportBtnRef}
                  onToggle={() => setModalExportMenuOpen((o) => !o)}
                  direction="down"
                />
                <button
                  style={styles.modalCloseBtn}
                  onClick={() => setExpandedIndex(null)}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div style={styles.modalBody}>
              <h2 style={styles.modalTitle}>{expandedTicket.summary}</h2>

              {/* Metadata grid */}
              <div style={styles.metaGrid}>
                <div style={styles.metaCell}>
                  <span style={styles.metaLabel}>Story Points</span>
                  <span style={styles.metaValue}>{expandedTicket.story_points ?? "—"}</span>
                </div>
                <div style={styles.metaCell}>
                  <span style={styles.metaLabel}>Priority</span>
                  <span style={styles.metaValue}>{expandedTicket.priority}</span>
                </div>
                <div style={styles.metaCell}>
                  <span style={styles.metaLabel}>Issue Type</span>
                  <span style={styles.metaValue}>{expandedTicket.issue_type.replace(/_/g, " ")}</span>
                </div>
                <div style={styles.metaCell}>
                  <span style={styles.metaLabel}>Status</span>
                  <span style={styles.metaValue}>{expandedTicket.status ?? (expandedTicket.jira_key ? "Created" : "To Do")}</span>
                </div>
              </div>

              {/* Assignee — only for read tickets */}
              {expandedTicket.assignee && (
                <div style={{ marginBottom: 16 }}>
                  <div style={styles.sectionLabel}>ASSIGNEE</div>
                  <div style={styles.sectionContent}>{expandedTicket.assignee}</div>
                </div>
              )}

              {/* Labels */}
              {expandedTicket.labels.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={styles.sectionLabel}>LABELS</div>
                  <div style={styles.labelsRow}>
                    {expandedTicket.labels.map((label, li) => (
                      <span key={li} style={styles.labelChip}>{label}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              <div style={{ marginBottom: 20 }}>
                <div style={styles.sectionLabel}>DESCRIPTION</div>
                <div style={styles.sectionContent}>
                  {expandedTicket.description}
                </div>
              </div>

              {/* Acceptance Criteria */}
              {expandedTicket.acceptance_criteria.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={styles.sectionLabel}>ACCEPTANCE CRITERIA</div>
                  <ul style={styles.acList}>
                    {expandedTicket.acceptance_criteria.map((ac, ai) => (
                      <li key={ai} style={styles.acItem}>{ac}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Footer — Open in Jira only */}
              {expandedTicket.jira_key && jiraBaseUrl && (
                <div style={styles.modalFooter}>
                  <a
                    href={`${jiraBaseUrl}/browse/${expandedTicket.jira_key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.jiraBtn}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/>
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    Open in Jira
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 24px",
    background: "transparent",
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#6d28d9",
    letterSpacing: "-0.01em",
  },
  headerActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  exportBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.01em",
    boxShadow: "0 1px 4px rgba(99,102,241,0.3)",
  },
  exportDropdown: {
    position: "absolute" as const,
    right: 0,
    background: "#fff",
    borderRadius: 8,
    boxShadow: "0 4px 16px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08)",
    zIndex: 200,
    minWidth: 160,
    overflow: "hidden",
  },
  exportDropdownItem: {
    display: "block",
    width: "100%",
    padding: "9px 14px",
    background: "none",
    border: "none",
    textAlign: "left" as const,
    fontSize: 13,
    color: "#111827",
    fontWeight: 500,
    cursor: "pointer",
  },
  jiraBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    background: "#0052cc",
    color: "#fff",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    textDecoration: "none",
    letterSpacing: "0.01em",
    boxShadow: "0 1px 4px rgba(0,82,204,0.3)",
  },
  scrollArea: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 24px",
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    minHeight: 320,
    gap: 14,
    textAlign: "center" as const,
    padding: "0 32px",
  },
  placeholderIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    background: "rgba(99,102,241,0.07)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  spinnerWrap: {
    position: "relative" as const,
    width: 48,
    height: 48,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  spinner: {
    width: 36,
    height: 36,
    border: "3px solid rgba(99,102,241,0.12)",
    borderTop: "3px solid #6366f1",
    borderRadius: "50%",
    animation: "spin 0.75s linear infinite",
  },
  spinnerRing: {
    position: "absolute" as const,
    inset: 0,
    borderRadius: "50%",
    border: "3px solid rgba(124,58,237,0.08)",
    borderBottom: "3px solid #7c3aed",
    animation: "spin 1.5s linear infinite reverse",
  },
  placeholderText: {
    fontSize: 15,
    fontWeight: 600,
    color: "#374151",
    margin: 0,
    letterSpacing: "-0.01em",
  },
  placeholderSub: {
    fontSize: 13,
    color: "#9ca3af",
    margin: 0,
    maxWidth: 260,
    lineHeight: 1.6,
  },
  ticketList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  runningPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    background: "rgba(99,102,241,0.08)",
    color: "#4338ca",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    alignSelf: "flex-start",
    marginBottom: 4,
  },
  runningDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#6366f1",
    animation: "pulse-dot 1.4s ease-in-out infinite",
    flexShrink: 0,
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "16px 18px",
    borderLeft: "3px solid #6366f1",
    boxShadow: "0 2px 8px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04)",
  },
  cardTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 8,
  },
  cardBadges: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    flexWrap: "wrap" as const,
    flex: 1,
    minWidth: 0,
  },
  cardTopActions: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  expandBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 5,
    background: "rgba(99,102,241,0.07)",
    border: "none",
    borderRadius: 6,
    color: "#6366f1",
    cursor: "pointer",
    flexShrink: 0,
  },
  cardSummary: {
    fontSize: 14,
    fontWeight: 700,
    color: "#111827",
    margin: "0 0 10px 0",
    lineHeight: 1.45,
    letterSpacing: "-0.01em",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as const,
    overflow: "hidden",
  },
  labelsRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 5,
    marginBottom: 10,
  },
  labelChip: {
    display: "inline-flex",
    padding: "2px 9px",
    background: "rgba(99,102,241,0.08)",
    color: "#4338ca",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.01em",
  },
  cardBottom: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  tileActionBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    background: "#6366f1",
    border: "none",
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 600,
    color: "#fff",
    cursor: "pointer",
    letterSpacing: "0.01em",
    boxShadow: "0 1px 3px rgba(99,102,241,0.3)",
    textDecoration: "none",
  },
  openInJiraBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 9px",
    background: "#0052cc",
    color: "#fff",
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 600,
    textDecoration: "none",
    letterSpacing: "0.01em",
    boxShadow: "0 1px 3px rgba(0,82,204,0.25)",
  },
  // ── Cortana streaming indicators ──────────────────────────────────────────────
  streamingDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#7c3aed",
    animation: "astrid-pulse 1s ease-in-out infinite",
    flexShrink: 0,
  },
  streamingCursor: {
    display: "inline-block",
    width: 2,
    height: "1em",
    background: "#6366f1",
    marginLeft: 2,
    verticalAlign: "text-bottom",
    animation: "astrid-blink 0.8s step-end infinite",
  },

  // ── Cortana source cards (used in Sources collapsible) ────────────────────────
  astridSourceCard: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 8 },
  astridSourceIcon: { fontSize: 16, flexShrink: 0, width: 20, textAlign: "center" as const },
  astridSourceFileName: { fontSize: 12, color: "#374151", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const },
  astridSourceDate: { fontSize: 11, color: "#9ca3af", marginTop: 1 },
  astridMatchBadge: { padding: "2px 7px", background: "rgba(99,102,241,0.1)", color: "#4f46e5", borderRadius: 4, fontSize: 11, fontWeight: 600, flexShrink: 0 },
  astridSourceLink: { fontSize: 12, color: "#9ca3af", flexShrink: 0 },

  // ── Cortana people cards (used in Ownership rail card) ─────────────────────────
  astridPersonCard: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 8 },
  astridPersonAvatar: { width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg, #7c3aed, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  astridPersonInitials: { fontSize: 12, fontWeight: 700, color: "#fff" },
  astridPersonName: { fontSize: 13, fontWeight: 600, color: "#111827" },
  astridPersonFeatures: { fontSize: 11, color: "#9ca3af", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const },
  astridMailtoBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, background: "#ede9fe", borderRadius: "50%", fontSize: 13, color: "#7c3aed", textDecoration: "none", flexShrink: 0 },

  // ── Cortana what's new (used in Enhancements rail card) ───────────────────────
  astridVersionBadge: { padding: "2px 8px", background: "#7c3aed", color: "#fff", borderRadius: 4, fontSize: 11, fontWeight: 700 },
  astridWhatsNewList: { margin: "0 0 8px 0", paddingLeft: 16 },
  astridWhatsNewItem: { fontSize: 13, color: "#374151", lineHeight: 1.6, marginBottom: 3 },
  astridWhatsNewLink: { fontSize: 12, color: "#7c3aed", fontWeight: 600, textDecoration: "none" },

  // ── Cortana ticket rows (used in Open Issues rail card) ───────────────────────
  astridTicketRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 8, textDecoration: "none" },
  astridTicketStatus: { padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600, flexShrink: 0 },
  astridTicketTitle: { flex: 1, fontSize: 12, color: "#374151", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const },
  astridTicketAssignee: { fontSize: 11, color: "#9ca3af", flexShrink: 0 },

  // Modal
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(15,15,30,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    background: "#fff",
    borderRadius: 16,
    maxWidth: 720,
    width: "90vw",
    maxHeight: "85vh",
    overflow: "auto",
    boxShadow: "0 8px 24px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08)",
    display: "flex",
    flexDirection: "column",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    background: "#fff",
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
  },
  modalHeaderBadges: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    flexWrap: "wrap" as const,
    flex: 1,
    minWidth: 0,
  },
  modalHeaderRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  jiraKeyPill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 10px",
    background: "rgba(99,102,241,0.1)",
    color: "#4338ca",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
  },
  modalCloseBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    background: "#f3f4f6",
    border: "none",
    borderRadius: "50%",
    fontSize: 18,
    color: "#6b7280",
    cursor: "pointer",
    flexShrink: 0,
    lineHeight: 1,
  },
  modalBody: {
    padding: "20px 24px 24px",
    flex: 1,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: "#111827",
    margin: "0 0 18px 0",
    lineHeight: 1.3,
    letterSpacing: "-0.02em",
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px 20px",
    marginBottom: 20,
    padding: "14px 16px",
    background: "#f9fafb",
    borderRadius: 10,
  },
  metaCell: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#9ca3af",
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
  },
  metaValue: {
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
    textTransform: "capitalize" as const,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#6b7280",
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    marginBottom: 8,
  },
  sectionContent: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 1.65,
    whiteSpace: "pre-wrap" as const,
  },
  acList: {
    margin: 0,
    paddingLeft: 18,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  acItem: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 1.55,
  },
  modalFooter: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingTop: 16,
    flexWrap: "wrap" as const,
  },
  copyBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    background: "#f3f4f6",
    border: "none",
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    color: "#374151",
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
  },
};
