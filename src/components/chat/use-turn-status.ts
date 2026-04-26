import { useEffect, useState } from "react";
import { useChatStore } from "../../lib/store";
import type { ChatMessage, MessageContentPart } from "../../lib/types";

type ToolUsePart = Extract<MessageContentPart, { type: "tool_use" }>;

// Duplicated from tool-log-row so we don't tangle the import graph (this hook
// doesn't need anything visual from that file). Kept in sync by convention —
// both are 4 lines long.
function isBusyTool(part: ToolUsePart): boolean {
  if (part.result) return false;
  return true; // either streaming or running — both count as "busy"
}

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== "object") {
    return typeof input === "string" ? firstLine(input) : "";
  }
  const rec = input as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookRead":
    case "NotebookEdit":
      return firstLine(str(rec.file_path) || str(rec.notebook_path));
    case "Bash":
      return firstLine(str(rec.command));
    case "Grep":
      return firstLine(str(rec.pattern));
    case "Glob":
      return firstLine(str(rec.pattern));
    case "WebFetch":
      return firstLine(str(rec.url));
    case "WebSearch":
      return firstLine(str(rec.query));
    default:
      return "";
  }
}

function firstLine(value: string): string {
  const line = (value.split("\n")[0] ?? "").trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

function verbFor(name: string): string {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return "Reading";
    case "Write":
      return "Writing";
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "Editing";
    case "Bash":
      return "Running bash";
    case "Grep":
    case "Glob":
      return "Searching";
    case "WebFetch":
      return "Fetching";
    case "WebSearch":
      return "Searching web";
    case "TodoWrite":
      return "Updating todos";
    case "Agent":
    case "Task":
      return "Delegating";
    default:
      return `Running ${name}`;
  }
}

function deriveStatus(message: ChatMessage | undefined): string {
  if (!message) return "Waiting for Claude…";
  // Newest part wins — the activity line tracks the frontier.
  for (let i = message.parts.length - 1; i >= 0; i--) {
    const part = message.parts[i];
    if (part.type === "tool_use" && isBusyTool(part)) {
      const summary = summarizeInput(part.name, part.input);
      const verb = verbFor(part.name);
      return summary ? `${verb} ${summary}…` : `${verb}…`;
    }
    if (part.type === "text") {
      // A text part that's still growing means the model is writing prose.
      // If it's empty, treat the turn as between blocks.
      if (part.text.trim()) return "Writing…";
      continue;
    }
    if (part.type === "thinking" && !part.complete) {
      return "Thinking…";
    }
  }
  return "Waiting for Claude…";
}

export function useTurnStatus(sessionKey: string | null): {
  text: string | null;
  elapsedMs: number;
} {
  const isStreaming = useChatStore((s) =>
    sessionKey ? s.conversations.find((c) => c.key === sessionKey)?.isStreaming ?? false : false
  );
  const lastMessage = useChatStore((s) => {
    if (!sessionKey) return undefined;
    const msgs = s.messagesByConversation[sessionKey];
    if (!msgs) return undefined;
    // Scan from the end for the newest pending assistant message; if none is
    // pending but we're still streaming, fall back to the last assistant entry.
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "assistant" && m.pending) return m;
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "assistant") return m;
    }
    return undefined;
  });
  const lastEventAt = useChatStore((s) =>
    sessionKey ? s.lastEventAtBySession[sessionKey] ?? null : null
  );

  // Tick every second so the elapsed counter updates live. Only runs while
  // the session is streaming, so no wasted work when idle.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isStreaming) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  if (!isStreaming) return { text: null, elapsedMs: 0 };
  // Elapsed time since the backend last emitted any event for this session.
  // Exposed as a live counter instead of a hard-coded stall threshold —
  // the user can read "42s" or "2m 15s" and make their own judgment about
  // whether something's wrong. No arbitrary cutoff to produce false alarms.
  const elapsedMs = lastEventAt !== null ? Math.max(0, now - lastEventAt) : 0;
  return { text: deriveStatus(lastMessage), elapsedMs };
}
