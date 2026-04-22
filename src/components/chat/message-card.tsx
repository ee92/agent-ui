import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatMessage, MessageContentPart } from "../../lib/types";
import { formatRelative } from "../../lib/ui-utils";
import { Markdown } from "./markdown";
import { ThinkingCard } from "./parts/thinking-card";
import { ToolUseCard } from "./parts/tool-use-card";
import { ToolLogGroup } from "./parts/tool-log-group";
import { SubAgentTrace } from "./parts/sub-agent-trace";
import { CopyIcon, RetryIcon, TrashIcon } from "../ui/icons";

type ToolUsePart = Extract<MessageContentPart, { type: "tool_use" }>;

function EllipsisIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

type MenuPos = { top: number; left: number };

export function MessageCard({
  message,
  onCopy,
  onRetry,
  onHide,
  onTask
}: {
  message: ChatMessage;
  onCopy: () => void;
  onRetry: () => void;
  onHide: () => void;
  onTask: (text: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos>({ top: 0, left: 0 });

  // Recompute menu position on open (against the trigger button). Using a
  // portal keeps us out of the transcript's overflow:hidden clipping.
  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 160) });
    }
    setMenuOpen(true);
  }

  // Close the menu on Escape — standard dropdown UX.
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (message.hidden) {
    return null;
  }

  // System-only marker messages (e.g. /compact boundary) render as a slim
  // divider instead of a chat bubble so they don't masquerade as assistant
  // output.
  if (
    message.role === "system" &&
    message.parts.length === 1 &&
    message.parts[0].type === "compact_boundary"
  ) {
    const part = message.parts[0];
    const pre = typeof part.preTokens === "number" ? part.preTokens : null;
    const post = typeof part.postTokens === "number" ? part.postTokens : null;
    const stats =
      pre != null && post != null
        ? `${Math.round(pre / 1000)}k → ${Math.round(post / 1000)}k tokens`
        : null;
    return (
      <div className="my-2 flex items-center gap-3 px-1 text-[10px] uppercase tracking-wider text-zinc-500">
        <span className="h-px flex-1 bg-white/[0.06]" />
        <span className="whitespace-nowrap">
          Context compacted{stats ? ` · ${stats}` : ""}
        </span>
        <span className="h-px flex-1 bg-white/[0.06]" />
      </div>
    );
  }

  const isUser = message.role === "user";
  const bubbleClass = isUser
    ? "bg-blue-500 text-white"
    : "bg-surface-1 text-zinc-100";

  // Lift text out of the message once for onTask and potential re-use.
  const messageText = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n")
    .trim();

  return (
    <div className={`group flex px-1 ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`relative w-fit max-w-[85%] rounded-lg px-4 py-3.5 sm:max-w-[78%] md:px-5 ${bubbleClass}`}>
        {/* Single kebab trigger, top-right. Always visible on mobile (always
            within finger reach), dim-until-hover on desktop. */}
        <button
          ref={triggerRef}
          type="button"
          aria-label="Message actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            menuOpen ? setMenuOpen(false) : openMenu();
          }}
          className={`absolute right-1.5 top-1.5 rounded-md p-1 transition ${
            isUser ? "text-white/60 hover:bg-white/10 hover:text-white" : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
          } md:opacity-0 md:group-hover:opacity-100 ${menuOpen ? "!opacity-100" : ""}`}
        >
          <EllipsisIcon />
        </button>

        <div className={`mb-2 flex flex-wrap items-center gap-2 pr-7 text-[10px] uppercase tracking-wide ${isUser ? "text-white/60" : "text-zinc-400"}`}>
          <span>{isUser ? "You" : "Assistant"}</span>
          <span className={isUser ? "text-white/30" : "text-zinc-500"}>{formatRelative(message.createdAt)}</span>
          {message.pending ? <span className="text-blue-200/80">Streaming</span> : null}
          {message.error ? <span className="text-rose-200/80">Issue</span> : null}
        </div>
        <div className="space-y-3 overflow-x-hidden">
          {renderParts(message.parts)}
        </div>
      </div>

      {menuOpen
        ? createPortal(
            <>
              {/* Invisible backdrop — captures clicks to close menu. */}
              <div
                className="fixed inset-0 z-[9998]"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setMenuOpen(false);
                }}
              />
              <div
                role="menu"
                className="fixed z-[9999] min-w-[160px] rounded-lg border border-white/[0.06] bg-surface-1 py-1 shadow-xl shadow-black/40"
                style={{ top: menuPos.top, left: menuPos.left }}
              >
                <MenuItem
                  icon={<CopyIcon />}
                  label="Copy"
                  onClick={() => {
                    onCopy();
                    setMenuOpen(false);
                  }}
                />
                {!isUser ? (
                  <MenuItem
                    icon={<span aria-hidden="true">📌</span>}
                    label="Create task"
                    onClick={() => {
                      onTask(messageText);
                      setMenuOpen(false);
                    }}
                  />
                ) : null}
                <MenuItem
                  icon={<RetryIcon />}
                  label="Retry"
                  onClick={() => {
                    onRetry();
                    setMenuOpen(false);
                  }}
                />
                <MenuItem
                  icon={<TrashIcon />}
                  label="Hide"
                  danger
                  onClick={() => {
                    onHide();
                    setMenuOpen(false);
                  }}
                />
              </div>
            </>,
            document.body
          )
        : null}
    </div>
  );
}

// Walk the parts array rendering each component inline, but collapse runs of
// consecutive plain `tool_use` parts into a single `ToolLogGroup` so we get
// the compact-log-under-one-rail treatment. `Agent` tool parts opt out — they
// keep the full-card rendering (plus their <SubAgentTrace>) because sub-agent
// traces are substantive work, not chrome.
function renderParts(parts: MessageContentPart[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let toolBuf: ToolUsePart[] = [];
  let toolBufStart = 0;

  const flushTools = () => {
    if (toolBuf.length === 0) return;
    nodes.push(
      <ToolLogGroup key={`tools-${toolBufStart}`} parts={toolBuf} />
    );
    toolBuf = [];
  };

  parts.forEach((part, index) => {
    if (part.type === "tool_use" && part.name !== "Agent") {
      if (toolBuf.length === 0) toolBufStart = index;
      toolBuf.push(part);
      return;
    }
    // Any non-grouped part flushes the buffer so ordering is preserved.
    flushTools();
    if (part.type === "text") {
      nodes.push(<Markdown key={`text-${index}`} text={part.text || " "} />);
      return;
    }
    if (part.type === "image") {
      nodes.push(
        <img
          key={`image-${index}`}
          src={part.url}
          alt={part.alt}
          className="max-h-72 rounded-lg border border-white/[0.06] object-cover"
        />
      );
      return;
    }
    if (part.type === "thinking") {
      // Hide empty thinking blocks — opus[1m] returns signed-but-redacted
      // thinking (signature present, text ""), and resumed transcripts often
      // have the same pattern. Show while streaming so the "Thinking…"
      // indicator still appears for models that emit deltas.
      if (part.complete && !part.text.trim()) return;
      nodes.push(<ThinkingCard key={`think-${index}`} part={part} />);
      return;
    }
    if (part.type === "tool_use") {
      // Agent tool — keep the full card + sub-agent trace.
      nodes.push(
        <div key={`tool-${index}-${part.id}`} className="space-y-2">
          <ToolUseCard part={part} />
          {part.subAgentParts && part.subAgentParts.length > 0 ? (
            <SubAgentTrace parts={part.subAgentParts} />
          ) : null}
        </div>
      );
      return;
    }
    if (part.type === "compact_boundary") {
      nodes.push(
        <div key={`cb-${index}`} className="text-[10px] uppercase tracking-wider text-zinc-500">
          — context compacted —
        </div>
      );
      return;
    }
    if (part.type === "attachment") {
      nodes.push(
        <div
          key={`attachment-${index}`}
          className="rounded-lg border border-white/[0.06] bg-surface-1 px-3 py-2 text-sm text-zinc-100"
        >
          {part.name}
        </div>
      );
      return;
    }
  });

  // Trailing tools that never hit a flushing part.
  flushTools();
  return nodes;
}

function MenuItem({
  icon,
  label,
  danger,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm ${
        danger
          ? "text-rose-300 hover:bg-rose-500/10"
          : "text-zinc-300 hover:bg-white/[0.06]"
      }`}
    >
      <span className="flex h-4 w-4 items-center justify-center">{icon}</span>
      {label}
    </button>
  );
}
