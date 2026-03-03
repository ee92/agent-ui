import { useRef, useState } from "react";
import type { Conversation } from "../../lib/types";

type UrgencyLevel = "critical" | "high" | "normal";

function getUrgency(waitMs: number): UrgencyLevel {
  if (waitMs > 15 * 60_000) return "critical";
  if (waitMs > 5 * 60_000) return "high";
  return "normal";
}

const URGENCY_STYLES: Record<
  UrgencyLevel,
  { ring: string; dot: string; glow: string; animation: string | null }
> = {
  critical: {
    ring: "border-red-500/30",
    dot: "bg-red-400",
    glow: "shadow-[0_0_20px_rgba(239,68,68,0.15)]",
    animation: "attention-pulse 1.5s ease-in-out infinite",
  },
  high: {
    ring: "border-amber-500/25",
    dot: "bg-amber-400",
    glow: "shadow-[0_0_16px_rgba(245,158,11,0.12)]",
    animation: "attention-pulse 2.5s ease-in-out infinite",
  },
  normal: {
    ring: "border-blue-500/20",
    dot: "bg-blue-400",
    glow: "",
    animation: null,
  },
};

function formatWait(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const CHANNEL_ICONS: Record<string, string> = {
  telegram: "✈️",
  discord: "💬",
  signal: "📱",
  slack: "💼",
  web: "🌐",
};

function AttentionCard({
  conversation,
  onReply,
  onOpen,
}: {
  conversation: Conversation;
  onReply: (key: string, text: string) => void;
  onOpen: (key: string) => void;
}) {
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const waitMs = Date.now() - Date.parse(conversation.updatedAt);
  const urgency = getUrgency(waitMs);
  const styles = URGENCY_STYLES[urgency];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      onReply(conversation.key, text);
      setReplyText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <article
      className={`rounded-xl border ${styles.ring} ${styles.glow} bg-black/20 p-3 transition-all`}
      style={{ animation: styles.animation ?? undefined }}
    >
      <div className="flex items-start gap-3">
        {/* Urgency dot */}
        <div className="mt-1 flex flex-col items-center gap-1">
          <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} />
          <span className="text-[10px] text-zinc-600">{formatWait(waitMs)}</span>
        </div>

        <div className="min-w-0 flex-1">
          {/* Header */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpen(conversation.key)}
              className="truncate text-sm font-medium text-white hover:underline"
            >
              {conversation.title}
            </button>
            {conversation.channel && (
              <span className="shrink-0 text-xs" title={conversation.channel}>
                {CHANNEL_ICONS[conversation.channel] ?? "📨"}
              </span>
            )}
            {conversation.kind && conversation.kind !== "unknown" && (
              <span className="shrink-0 rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-500">
                {conversation.kind}
              </span>
            )}
          </div>

          {/* Agent's last message */}
          {conversation.preview && (
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-400">
              {conversation.preview}
            </p>
          )}

          {/* Inline reply */}
          <form onSubmit={handleSubmit} className="mt-2 flex gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Quick reply..."
              disabled={sending}
              className="min-h-8 flex-1 rounded-lg border border-white/8 bg-black/30 px-2.5 text-xs text-white placeholder-zinc-600 outline-none transition-colors focus:border-blue-500/40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!replyText.trim() || sending}
              className="min-h-8 rounded-lg bg-blue-500/20 px-3 text-xs font-medium text-blue-300 transition-all hover:bg-blue-500/30 disabled:opacity-30"
            >
              {sending ? "..." : "Send"}
            </button>
          </form>
        </div>
      </div>
    </article>
  );
}

export function AttentionQueue({
  conversations,
  onReply,
  onOpen,
}: {
  conversations: Conversation[];
  onReply: (key: string, text: string) => void;
  onOpen: (key: string) => void;
}) {
  if (conversations.length === 0) {
    return (
      <section className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-lg">
            ✓
          </span>
          <div>
            <p className="text-sm font-medium text-emerald-300">All clear</p>
            <p className="text-xs text-zinc-500">
              No sessions waiting for your input
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <style>{`
        @keyframes attention-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
      `}</style>
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Needs your attention</h2>
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-medium text-red-300">
            {conversations.length}
          </span>
        </div>
        <p className="text-[10px] text-zinc-600">Reply inline to unblock</p>
      </div>
      <div className="space-y-2">
        {conversations.map((conv) => (
          <AttentionCard
            key={conv.key}
            conversation={conv}
            onReply={onReply}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}
