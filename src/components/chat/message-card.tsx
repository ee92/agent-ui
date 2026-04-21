import type { ChatMessage } from "../../lib/types";
import { formatRelative } from "../../lib/ui-utils";
import { Markdown } from "./markdown";
import { ThinkingCard } from "./parts/thinking-card";
import { ToolUseCard } from "./parts/tool-use-card";
import { SubAgentTrace } from "./parts/sub-agent-trace";
import { CopyIcon, RetryIcon, TrashIcon } from "../ui/icons";

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

  return (
    <div className={`group flex px-1 ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`relative w-fit max-w-[85%] rounded-lg px-4 py-3.5 sm:max-w-[78%] md:px-5 ${bubbleClass}`}>
        <div className={`mb-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide ${isUser ? "text-white/60" : "text-zinc-400"}`}>
          <span>{isUser ? "You" : "Assistant"}</span>
          <span className={isUser ? "text-white/30" : "text-zinc-500"}>{formatRelative(message.createdAt)}</span>
          {message.pending ? <span className="text-blue-200/80">Streaming</span> : null}
          {message.error ? <span className="text-rose-200/80">Issue</span> : null}
        </div>
        <div className="space-y-3 overflow-x-hidden">
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return <Markdown key={`${part.type}-${index}`} text={part.text || " "} />;
            }
            if (part.type === "image") {
              return (
                <img
                  key={`${part.type}-${index}`}
                  src={part.url}
                  alt={part.alt}
                  className="max-h-72 rounded-lg border border-white/[0.06] object-cover"
                />
              );
            }
            if (part.type === "thinking") {
              return <ThinkingCard key={`think-${index}`} part={part} />;
            }
            if (part.type === "tool_use") {
              return (
                <div key={`tool-${index}-${part.id}`} className="space-y-2">
                  <ToolUseCard part={part} />
                  {part.name === "Agent" && part.subAgentParts && part.subAgentParts.length > 0 ? (
                    <SubAgentTrace parts={part.subAgentParts} />
                  ) : null}
                </div>
              );
            }
            if (part.type === "compact_boundary") {
              // Shouldn't usually reach here — the role==="system" short-circuit
              // above handles the standalone case. Render a tiny inline marker
              // for the odd case where it's mixed with other parts.
              return (
                <div key={`cb-${index}`} className="text-[10px] uppercase tracking-wider text-zinc-500">
                  — context compacted —
                </div>
              );
            }
            if (part.type === "attachment") {
              return (
                <div
                  key={`${part.type}-${index}`}
                  className="rounded-lg border border-white/[0.06] bg-surface-1 px-3 py-2 text-sm text-zinc-100"
                >
                  {part.name}
                </div>
              );
            }
            return null;
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/[0.06] bg-surface-1 px-3 py-2 text-[10px] text-zinc-200 hover:bg-surface-1"
          >
            <CopyIcon />
            Copy
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/[0.06] bg-surface-1 px-3 py-2 text-[10px] text-zinc-200 hover:bg-surface-1"
          >
            <RetryIcon />
            Retry
          </button>
          {!isUser ? (
            <button
              type="button"
              onClick={() => {
                const text = message.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n").trim();
                onTask(text);
              }}
              className="min-h-9 rounded-lg border border-white/[0.06] bg-surface-1 px-3 py-2 text-[10px] text-zinc-200 hover:bg-surface-1"
            >
              📌 Create Task
            </button>
          ) : null}
          <button
            type="button"
            onClick={onHide}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-white/[0.06] bg-surface-1 px-3 py-2 text-[10px] text-zinc-200 hover:bg-surface-1"
          >
            <TrashIcon />
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}
