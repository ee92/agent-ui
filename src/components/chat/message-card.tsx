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
  onTask: (text: string) => void;
}) {
  if (message.hidden) {
    return null;
  }
  const isUser = message.role === "user";
  const bubbleClass = isUser
    ? "bg-blue-500 text-white shadow-[0_20px_80px_rgba(59,130,246,0.22)]"
    : "bg-zinc-900/90 text-zinc-100 shadow-[0_16px_48px_rgba(0,0,0,0.2)]";

  return (
    <div className={`group flex px-1 ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`relative w-fit max-w-[85%] rounded-[1.75rem] px-4 py-3.5 sm:max-w-[78%] md:px-5 ${bubbleClass}`}>
        <div className={`mb-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.24em] ${isUser ? "text-white/60" : "text-zinc-400"}`}>
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
        <div className="mt-3 flex flex-wrap gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 hover:bg-black/30"
          >
            <CopyIcon />
            Copy
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 hover:bg-black/30"
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
              className="min-h-11 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 hover:bg-black/30"
            >
              📌 Create Task
            </button>
          ) : null}
          <button
            type="button"
            onClick={onHide}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-200 hover:bg-black/30"
          >
            <TrashIcon />
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}
