import { useMemo } from "react";
import { useSessionFlowStore } from "../../lib/stores/session-flow-store";
import type { AgentRun, Conversation } from "../../lib/types";

type SessionStatus = "running" | "recent" | "idle" | "stale";

function getStatus(conv: Conversation, hasActiveRun: boolean): SessionStatus {
  if (conv.isStreaming || hasActiveRun) return "running";
  const age = Date.now() - Date.parse(conv.updatedAt);
  if (age < 5 * 60 * 1000) return "recent";
  if (age < 60 * 60 * 1000) return "idle";
  return "stale";
}

const STATUS_STYLES: Record<
  SessionStatus,
  { dot: string; label: string; ring: string }
> = {
  running: {
    dot: "bg-blue-400 animate-pulse",
    label: "Running",
    ring: "ring-1 ring-blue-400/20",
  },
  recent: { dot: "bg-emerald-400", label: "Active", ring: "ring-1 ring-emerald-400/10" },
  idle: { dot: "bg-zinc-400", label: "Idle", ring: "" },
  stale: { dot: "bg-zinc-600", label: "Stale", ring: "" },
};

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const delta = Math.max(0, Date.now() - Date.parse(iso));
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTokens(n: number | undefined): string {
  if (!n) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function Badge({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] leading-tight ${className ?? "bg-white/[0.06] text-zinc-400"}`}
    >
      {text}
    </span>
  );
}

const CHANNEL_COLORS: Record<string, string> = {
  telegram: "bg-blue-500/15 text-blue-300",
  discord: "bg-indigo-500/15 text-indigo-300",
  web: "bg-zinc-500/15 text-zinc-300",
  signal: "bg-sky-500/15 text-sky-300",
  slack: "bg-violet-500/15 text-violet-300",
};

function SessionCard({
  conversation,
  status,
  lastRunDuration,
  totalRuns,
  runningTools,
  agents,
  onOpen,
}: {
  conversation: Conversation;
  status: SessionStatus;
  lastRunDuration: number | null;
  totalRuns: number;
  runningTools: string[];
  agents: AgentRun[];
  onOpen: () => void;
}) {
  const styles = STATUS_STYLES[status];
  const sessionAgents = agents.filter((a) => a.sessionKey === conversation.key);

  // Shorten model name for display
  const shortModel = conversation.model
    ?.replace("anthropic/", "")
    .replace("claude-", "")
    .replace("openai/", "")
    .replace("gpt-", "");

  return (
    <article
      className={`rounded-xl border border-border bg-black/20 p-3 cursor-pointer transition-all hover:bg-white/[0.04] ${styles.ring}`}
      onClick={onOpen}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${styles.dot}`} />
        <div className="min-w-0 flex-1">
          {/* Title + status */}
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-white">
              {conversation.title}
            </p>
            <span className="shrink-0 text-[10px] text-zinc-600">{styles.label}</span>
          </div>

          {/* Badges */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {conversation.channel && (
              <Badge
                text={conversation.channel}
                className={
                  CHANNEL_COLORS[conversation.channel] ?? "bg-zinc-500/15 text-zinc-300"
                }
              />
            )}
            {shortModel && <Badge text={shortModel} />}
            {conversation.kind && conversation.kind !== "unknown" && (
              <Badge text={conversation.kind} className="bg-white/[0.04] text-zinc-500" />
            )}
          </div>

          {/* Stats */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
            <span title="Input tokens">↓ {formatTokens(conversation.inputTokens)}</span>
            <span title="Output tokens">↑ {formatTokens(conversation.outputTokens)}</span>
            {totalRuns > 0 && (
              <span title="Runs in the last hour">
                {totalRuns} run{totalRuns !== 1 ? "s" : ""}
              </span>
            )}
            {lastRunDuration !== null && (
              <span title="Last run duration">
                {lastRunDuration < 1000
                  ? `${lastRunDuration}ms`
                  : `${(lastRunDuration / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>

          {/* Active tool calls */}
          {runningTools.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {runningTools.map((tool) => (
                <span
                  key={tool}
                  className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
                >
                  ⚡ {tool}
                </span>
              ))}
            </div>
          )}

          {/* Sub-agents in this session */}
          {sessionAgents.length > 0 && (
            <div className="mt-2 space-y-0.5 border-l border-white/5 pl-2">
              {sessionAgents.slice(0, 4).map((agent) => (
                <div key={agent.id} className="flex items-center gap-1.5">
                  <span
                    className={`h-1 w-1 shrink-0 rounded-full ${
                      agent.status === "running"
                        ? "bg-blue-400 animate-pulse"
                        : agent.status === "error"
                          ? "bg-red-400"
                          : agent.status === "done"
                            ? "bg-emerald-400"
                            : "bg-zinc-500"
                    }`}
                  />
                  <span className="truncate text-[10px] text-zinc-500">
                    {agent.label}
                  </span>
                </div>
              ))}
              {sessionAgents.length > 4 && (
                <span className="text-[10px] text-zinc-600">
                  +{sessionAgents.length - 4} more
                </span>
              )}
            </div>
          )}

          <p className="mt-2 text-[10px] text-zinc-600">
            {timeAgo(conversation.updatedAt)}
          </p>
        </div>
      </div>
    </article>
  );
}

export function SessionGrid({
  conversations,
  agents,
  onOpenSession,
}: {
  conversations: Conversation[];
  agents: AgentRun[];
  onOpenSession: (key: string) => void;
}) {
  const runs = useSessionFlowStore((s) => s.runs);

  const sessionData = useMemo(() => {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

    return conversations
      .filter((c) => Date.parse(c.updatedAt) > dayAgo)
      .map((conv) => {
        const sessionRuns = runs.filter(
          (r) => r.sessionKey === conv.key && (r.endedAt ?? Date.now()) > hourAgo
        );
        const activeRun = sessionRuns.find((r) => r.state === "running");
        const lastCompleted = sessionRuns
          .filter((r) => r.endedAt)
          .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
        const lastDuration = lastCompleted?.endedAt
          ? lastCompleted.endedAt - lastCompleted.startedAt
          : null;

        return {
          conversation: conv,
          status: getStatus(conv, Boolean(activeRun)),
          lastRunDuration: lastDuration,
          totalRuns: sessionRuns.length,
          runningTools: activeRun?.toolCalls ?? [],
        };
      })
      .sort((a, b) => {
        const order: Record<SessionStatus, number> = {
          running: 0,
          recent: 1,
          idle: 2,
          stale: 3,
        };
        return (
          order[a.status] - order[b.status] ||
          Date.parse(b.conversation.updatedAt) - Date.parse(a.conversation.updatedAt)
        );
      });
  }, [conversations, runs]);

  const runningCount = sessionData.filter((s) => s.status === "running").length;
  const recentCount = sessionData.filter((s) => s.status === "recent").length;

  return (
    <section className="rounded-xl border border-border bg-zinc-900/80 backdrop-blur-xl overflow-hidden">
      <div className="border-b border-white/5 px-4 py-3">
        <h2 className="text-base font-semibold text-white">Sessions</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          {sessionData.length} in last 24h
          {runningCount > 0 && (
            <span className="text-blue-400"> · {runningCount} running</span>
          )}
          {recentCount > 0 && (
            <span className="text-emerald-400"> · {recentCount} active</span>
          )}
        </p>
      </div>

      {sessionData.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center p-4 text-sm text-zinc-600">
          No active sessions
        </div>
      ) : (
        <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
          {sessionData.map(
            ({ conversation, status, lastRunDuration, totalRuns, runningTools }) => (
              <SessionCard
                key={conversation.key}
                conversation={conversation}
                status={status}
                lastRunDuration={lastRunDuration}
                totalRuns={totalRuns}
                runningTools={runningTools}
                agents={agents}
                onOpen={() => onOpenSession(conversation.key)}
              />
            )
          )}
        </div>
      )}
    </section>
  );
}
