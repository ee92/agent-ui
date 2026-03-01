import type { ChatMessage } from "../../lib/types";
import { formatRelative } from "../../lib/ui-utils";
import { Markdown } from "./markdown";
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
  onTask: () => void;
}) {
  if (message.hidden) {
    return null;
  }
  const isUser = message.role === "user";
  const bubbleClass = isUser
    ? "bg-blue-500 text-white shadow-[0_20px_80px_rgba(59,130,246,0.22)]"
    : "bg-white/[0.04] text-zinc-100";

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`relative max-w-[92%] rounded-3xl px-4 py-3 md:max-w-[76%] ${bubbleClass}`}>
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/60">
          <span>{isUser ? "You" : "Assistant"}</span>
          <span className="text-white/30">{formatRelative(message.createdAt)}</span>
          {message.pending ? <span className="text-blue-200/80">Streaming</span> : null}
          {message.error ? <span className="text-rose-200/80">Issue</span> : null}
        </div>
        <div className="space-y-3">
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
                  className="max-h-72 rounded-2xl border border-white/10 object-cover"
                />
              );
            }
            return (
              <div
                key={`${part.type}-${index}`}
                className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
              >
                {part.name}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-200 hover:bg-black/30"
          >
            <CopyIcon />
            Copy
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-200 hover:bg-black/30"
          >
            <RetryIcon />
            Retry
          </button>
          {!isUser ? (
            <button
              type="button"
              onClick={onTask}
              className="rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-200 hover:bg-black/30"
            >
              Add to tasks
            </button>
          ) : null}
          <button
            type="button"
            onClick={onHide}
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-200 hover:bg-black/30"
          >
            <TrashIcon />
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}
