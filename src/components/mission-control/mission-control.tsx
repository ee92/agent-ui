import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun, Conversation } from "../../lib/types";
import { getBackendAdapter } from "../../lib/adapters";

/* ─── helpers ─── */

function shortModel(model: string | null | undefined): string | null {
  if (!model) return null;
  const name = model.split("/").pop() ?? model;
  return name.replace(/^claude-/, "").replace(/^gpt-/, "gpt");
}

function channelIcon(channel: string | null | undefined): string {
  if (!channel) return "💬";
  if (channel.includes("telegram")) return "✈️";
  if (channel.includes("discord")) return "🎮";
  if (channel.includes("webchat")) return "🌐";
  if (channel.includes("signal")) return "🔒";
  return "💬";
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

type PreviewItem = { role: string; text: string };

type SessionPriority = "attention" | "active" | "recent" | "idle";

function getSessionPriority(conv: Conversation, agents: AgentRun[]): SessionPriority {
  // Check if any agent in this session is waiting/errored
  const sessionAgents = agents.filter((a) => a.sessionKey === conv.key);
  if (sessionAgents.some((a) => a.status === "error")) return "attention";
  if (sessionAgents.some((a) => a.status === "waiting")) return "attention";
  // Streaming = active
  if (conv.isStreaming) return "active";
  if (sessionAgents.some((a) => a.status === "running")) return "active";
  // Recent = updated within last hour
  const age = Date.now() - Date.parse(conv.updatedAt);
  if (age < 3_600_000) return "recent";
  return "idle";
}

const PRIORITY_ORDER: Record<SessionPriority, number> = {
  attention: 0,
  active: 1,
  recent: 2,
  idle: 3,
};

const PRIORITY_STYLES: Record<SessionPriority, { dot: string; border: string; bg: string }> = {
  attention: { dot: "bg-amber-400", border: "border-amber-500/25", bg: "bg-amber-500/[0.04]" },
  active: { dot: "animate-pulse bg-emerald-400", border: "border-emerald-500/20", bg: "bg-emerald-500/[0.03]" },
  recent: { dot: "bg-blue-400", border: "border-white/5", bg: "bg-white/[0.02]" },
  idle: { dot: "bg-zinc-600", border: "border-white/5", bg: "bg-transparent" },
};

/* ─── inline preview ─── */

function InlinePreview({
  sessionKey,
  onSend,
}: {
  sessionKey: string;
  onSend: (key: string, text: string) => void;
}) {
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const adapter = getBackendAdapter();
    if (!adapter.isConnected()) {
      setLoading(false);
      return;
    }
    adapter.sessions
      .history(sessionKey)
      .then((messages) => {
        if (cancelled) return;
        const previewItems = messages
          .slice(-4)
          .map((message) => ({
            role: message.role,
            text: message.content.slice(0, 200),
          }));
        setItems(previewItems);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionKey]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [loading]);

  const handleSend = () => {
    const text = reply.trim();
    if (!text) return;
    onSend(sessionKey, text);
    setReply("");
  };

  return (
    <div className="mt-2 space-y-2 border-t border-white/5 pt-2">
      {loading ? (
        <div className="flex items-center gap-2 py-2">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          <span className="text-xs text-zinc-500">Loading...</span>
        </div>
      ) : items.length === 0 ? (
        <p className="py-1 text-xs text-zinc-600">No messages yet.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className={`shrink-0 font-medium ${
                item.role === "user" ? "text-blue-400" : item.role === "assistant" ? "text-zinc-300" : "text-zinc-500"
              }`}>
                {item.role === "user" ? "You" : item.role === "assistant" ? "AI" : item.role}
              </span>
              <span className="min-w-0 text-zinc-400">{item.text}</span>
            </div>
          ))}
        </div>
      )}
      {/* Quick reply */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
          placeholder="Quick reply..."
          className="h-9 min-w-0 flex-1 rounded-lg bg-black/30 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-blue-500/30"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!reply.trim()}
          className="shrink-0 rounded-lg bg-blue-500/20 px-3 text-sm font-medium text-blue-300 transition hover:bg-blue-500/30 disabled:opacity-30"
        >
          Send
        </button>
      </div>
    </div>
  );
}

/* ─── session row ─── */

function SessionRow({
  conv,
  priority,
  agents,
  expanded,
  onToggle,
  onOpen,
  onQuickSend,
}: {
  conv: Conversation;
  priority: SessionPriority;
  agents: AgentRun[];
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onQuickSend: (key: string, text: string) => void;
}) {
  const styles = PRIORITY_STYLES[priority];
  const model = shortModel(conv.model);
  const sessionAgents = agents.filter((a) => a.sessionKey === conv.key);

  return (
    <div className={`rounded-xl border ${styles.border} ${styles.bg} transition-all duration-200`}>
      {/* Main row — tap to expand, title click to open full chat */}
      <div
        className="flex min-h-[52px] cursor-pointer items-center gap-3 px-3 py-2.5"
        onClick={onToggle}
      >
        {/* Status dot */}
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${styles.dot}`} />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm">{channelIcon(conv.channel)}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className="min-w-0 truncate text-sm font-medium text-white hover:text-blue-300 transition-colors"
            >
              {conv.title}
            </button>
          </div>
          {!expanded && conv.preview && (
            <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">{conv.preview}</p>
          )}
        </div>

        {/* Right side: metadata */}
        <div className="flex shrink-0 items-center gap-2">
          {model && (
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300">
              {model}
            </span>
          )}
          {sessionAgents.length > 0 && (
            <span className="rounded-full bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-300">
              {sessionAgents.length} agent{sessionAgents.length > 1 ? "s" : ""}
            </span>
          )}
          <span className="text-[11px] text-zinc-600">{timeAgo(conv.updatedAt)}</span>
        </div>
      </div>

      {/* Sub-agents (always visible if present) */}
      {sessionAgents.length > 0 && !expanded && (
        <div className="flex gap-3 border-t border-white/[0.03] px-3 py-1.5">
          {sessionAgents.slice(0, 3).map((agent) => (
            <span key={agent.id} className="flex items-center gap-1 text-[11px] text-zinc-500">
              <span className={`h-1.5 w-1.5 rounded-full ${
                agent.status === "running" ? "animate-pulse bg-emerald-400"
                : agent.status === "waiting" ? "bg-amber-400"
                : agent.status === "error" ? "bg-rose-400"
                : "bg-zinc-600"
              }`} />
              {agent.label}
            </span>
          ))}
          {sessionAgents.length > 3 && (
            <span className="text-[11px] text-zinc-600">+{sessionAgents.length - 3}</span>
          )}
        </div>
      )}

      {/* Expanded: inline preview + quick reply */}
      {expanded && (
        <div className="px-3 pb-3">
          <InlinePreview sessionKey={conv.key} onSend={onQuickSend} />
        </div>
      )}
    </div>
  );
}

/* ─── Mission Control ─── */

export function MissionControl({
  conversations,
  agents,
  onOpenSession,
  onQuickSend,
}: {
  conversations: Conversation[];
  agents: AgentRun[];
  onOpenSession: (key: string) => void;
  onQuickSend: (sessionKey: string, text: string) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const sorted = useMemo(() => {
    return [...conversations]
      .map((conv) => ({
        conv,
        priority: getSessionPriority(conv, agents),
      }))
      .sort((a, b) => {
        const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (pDiff !== 0) return pDiff;
        return Date.parse(b.conv.updatedAt) - Date.parse(a.conv.updatedAt);
      });
  }, [conversations, agents]);

  const attentionCount = sorted.filter((s) => s.priority === "attention").length;
  const activeCount = sorted.filter((s) => s.priority === "active").length;

  const toggle = useCallback((key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-4 xl:px-6">
        <h1 className="text-lg font-semibold text-white">Mission Control</h1>
        <div className="mt-1 flex items-center gap-4 text-xs text-zinc-500">
          <span>{conversations.length} sessions</span>
          {activeCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {activeCount} active
            </span>
          )}
          {attentionCount > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {attentionCount} need attention
            </span>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 xl:px-5">
        <div className="space-y-1.5">
          {sorted.map(({ conv, priority }) => (
            <SessionRow
              key={conv.key}
              conv={conv}
              priority={priority}
              agents={agents}
              expanded={expandedKey === conv.key}
              onToggle={() => toggle(conv.key)}
              onOpen={() => onOpenSession(conv.key)}
              onQuickSend={onQuickSend}
            />
          ))}
        </div>
        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-base text-zinc-400">No sessions yet</p>
            <p className="mt-1 text-sm text-zinc-600">Start a new chat to get going.</p>
          </div>
        )}
      </div>
    </div>
  );
}
