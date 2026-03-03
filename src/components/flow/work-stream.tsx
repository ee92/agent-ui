import { useMemo } from "react";
import { useSessionFlowStore, type SessionRun } from "../../lib/stores/session-flow-store";
import type { AgentRun, Conversation } from "../../lib/types";

function timeAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

type StreamItemState = "processing" | "queued" | "completed" | "error";

interface StreamItem {
  sessionKey: string;
  title: string;
  channel?: string | null;
  state: StreamItemState;
  detail: string;
  timestamp: number;
  toolCalls: string[];
  duration?: number;
}

const STATE_STYLES: Record<
  StreamItemState,
  { dot: string; label: string; border: string }
> = {
  processing: {
    dot: "bg-blue-400 animate-pulse",
    label: "Processing",
    border: "border-l-blue-400/50",
  },
  queued: {
    dot: "bg-amber-400 animate-pulse",
    label: "Queued",
    border: "border-l-amber-400/50",
  },
  completed: {
    dot: "bg-emerald-400",
    label: "Done",
    border: "border-l-emerald-400/30",
  },
  error: {
    dot: "bg-red-400",
    label: "Error",
    border: "border-l-red-400/40",
  },
};

function StreamCard({
  item,
  onOpen,
}: {
  item: StreamItem;
  onOpen: (key: string) => void;
}) {
  const styles = STATE_STYLES[item.state];

  return (
    <article
      className={`rounded-lg border border-border border-l-2 ${styles.border} bg-black/20 px-3 py-2 cursor-pointer transition-all hover:bg-white/[0.03]`}
      onClick={() => onOpen(item.sessionKey)}
    >
      <div className="flex items-center gap-2.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-medium text-white">
              {item.title}
            </span>
            <span className="shrink-0 text-[10px] text-zinc-600">
              {styles.label}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
            <span>{item.detail}</span>
            {item.duration != null && (
              <span className="text-zinc-600">· {formatDuration(item.duration)}</span>
            )}
          </div>
        </div>
        {/* Tool badges for active runs */}
        {item.toolCalls.length > 0 && (
          <div className="flex shrink-0 gap-1">
            {item.toolCalls.slice(0, 2).map((tool) => (
              <span
                key={tool}
                className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] text-blue-300"
              >
                {tool}
              </span>
            ))}
            {item.toolCalls.length > 2 && (
              <span className="text-[9px] text-zinc-600">
                +{item.toolCalls.length - 2}
              </span>
            )}
          </div>
        )}
        <span className="shrink-0 text-[10px] text-zinc-600">
          {timeAgo(Date.now() - item.timestamp)}
        </span>
      </div>
    </article>
  );
}

export function WorkStream({
  conversations,
  agents,
  onOpenSession,
}: {
  conversations: Conversation[];
  agents: AgentRun[];
  onOpenSession: (key: string) => void;
}) {
  const runs = useSessionFlowStore((s) => s.runs);

  const items = useMemo(() => {
    const now = Date.now();
    const recentCutoff = now - 30 * 60_000; // 30 min
    const result: StreamItem[] = [];
    const seen = new Set<string>();

    // 1. Currently processing sessions
    const activeRuns = runs.filter((r) => r.state === "running");
    for (const run of activeRuns) {
      if (seen.has(run.sessionKey)) continue;
      seen.add(run.sessionKey);
      const conv = conversations.find((c) => c.key === run.sessionKey);
      result.push({
        sessionKey: run.sessionKey,
        title: conv?.title ?? run.sessionKey.slice(0, 24),
        channel: conv?.channel,
        state: "processing",
        detail: run.toolCalls.length > 0
          ? `Using ${run.toolCalls[run.toolCalls.length - 1]}`
          : "Working...",
        timestamp: run.startedAt,
        toolCalls: run.toolCalls,
        duration: now - run.startedAt,
      });
    }

    // Also catch streaming conversations not yet in flow store
    for (const conv of conversations) {
      if (conv.isStreaming && !seen.has(conv.key)) {
        seen.add(conv.key);
        result.push({
          sessionKey: conv.key,
          title: conv.title,
          channel: conv.channel,
          state: "processing",
          detail: "Working...",
          timestamp: Date.parse(conv.updatedAt),
          toolCalls: [],
        });
      }
    }

    // 2. Recently completed
    const completed = runs
      .filter(
        (r) =>
          (r.state === "done" || r.state === "error") &&
          r.endedAt &&
          r.endedAt > recentCutoff &&
          !r.id.startsWith("seed-") &&
          !r.id.startsWith("hist-")
      )
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));

    for (const run of completed) {
      if (seen.has(`done-${run.sessionKey}-${run.id}`)) continue;
      seen.add(`done-${run.sessionKey}-${run.id}`);
      const conv = conversations.find((c) => c.key === run.sessionKey);
      result.push({
        sessionKey: run.sessionKey,
        title: conv?.title ?? run.sessionKey.slice(0, 24),
        channel: conv?.channel,
        state: run.state === "error" ? "error" : "completed",
        detail: run.state === "error"
          ? "Run failed"
          : run.toolCalls.length > 0
            ? `Used ${run.toolCalls.join(", ")}`
            : "Completed",
        timestamp: run.endedAt ?? now,
        toolCalls: [],
        duration: run.endedAt ? run.endedAt - run.startedAt : undefined,
      });
    }

    return result;
  }, [runs, conversations, agents]);

  const processing = items.filter((i) => i.state === "processing");
  const completed = items.filter(
    (i) => i.state === "completed" || i.state === "error"
  );

  if (items.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-zinc-900/60 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-sm">
            💤
          </span>
          <div>
            <p className="text-sm text-zinc-400">No active work</p>
            <p className="text-[10px] text-zinc-600">
              Agent is idle — send a message to start
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-2 px-1">
        <h2 className="text-sm font-semibold text-white">Work Stream</h2>
        <p className="text-[10px] text-zinc-600">
          {processing.length > 0
            ? `${processing.length} processing`
            : "No active runs"}
          {completed.length > 0 && ` · ${completed.length} completed recently`}
        </p>
      </div>
      <div className="space-y-1.5">
        {processing.map((item) => (
          <StreamCard
            key={`p-${item.sessionKey}`}
            item={item}
            onOpen={onOpenSession}
          />
        ))}
        {completed.slice(0, 8).map((item, i) => (
          <StreamCard
            key={`c-${item.sessionKey}-${i}`}
            item={item}
            onOpen={onOpenSession}
          />
        ))}
      </div>
    </section>
  );
}
