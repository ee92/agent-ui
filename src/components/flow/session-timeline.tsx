import { useEffect, useMemo, useState } from "react";
import { useSessionFlowStore, type SessionRun } from "../../lib/stores/session-flow-store";
import type { Conversation } from "../../lib/types";

type SessionRow = {
  sessionKey: string;
  title: string;
  kind: string;
  runs: SessionRun[];
  isActive: boolean;
};

const KIND_COLORS: Record<string, { bg: string; active: string; glow: string }> = {
  direct: { bg: "bg-blue-500/50", active: "bg-blue-400/70", glow: "rgba(59,130,246,0.3)" },
  group: { bg: "bg-purple-500/50", active: "bg-purple-400/70", glow: "rgba(147,51,234,0.3)" },
  cron: { bg: "bg-emerald-500/50", active: "bg-emerald-400/70", glow: "rgba(16,185,129,0.3)" },
  subagent: { bg: "bg-amber-500/50", active: "bg-amber-400/70", glow: "rgba(245,158,11,0.3)" },
  unknown: { bg: "bg-zinc-500/40", active: "bg-zinc-400/60", glow: "rgba(161,161,170,0.2)" },
};

function inferKind(sessionKey: string, convKind?: string): string {
  if (sessionKey.includes("cron:")) return "cron";
  if (convKind === "group") return "group";
  if (convKind === "direct") return "direct";
  if (sessionKey.includes("subagent") || sessionKey.includes("spawn")) return "subagent";
  return "unknown";
}

function getTitle(key: string, conversations: Conversation[]): string {
  const conv = conversations.find((c) => c.key === key);
  if (conv?.title) return conv.title;
  if (key.includes("cron:")) {
    const label = key.split(":").pop() || "Cron";
    return "⏲ " + label.replace(/-/g, " ");
  }
  return key.replace(/^agent:main:/, "").replace(/[-_]/g, " ").slice(0, 28);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function SessionTimeline({
  conversations,
  onOpenSession,
}: {
  conversations: Conversation[];
  onOpenSession: (key: string) => void;
}) {
  const runs = useSessionFlowStore((s) => s.runs);
  const timeWindowMinutes = useSessionFlowStore((s) => s.timeWindowMinutes);
  const setTimeWindow = useSessionFlowStore((s) => s.setTimeWindow);
  const [, setTick] = useState(0);

  // Tick every second to keep "now" moving
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Prune old runs every 5 minutes
  useEffect(() => {
    const id = setInterval(() => useSessionFlowStore.getState().prune(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const rangeStart = now - timeWindowMinutes * 60 * 1000;
  const rangeDuration = timeWindowMinutes * 60 * 1000;

  // Group runs by session, filter to visible window
  const rows = useMemo(() => {
    const visible = runs.filter((r) => {
      const end = r.endedAt ?? now;
      return end >= rangeStart && r.startedAt <= now;
    });

    const grouped = new Map<string, SessionRun[]>();
    for (const run of visible) {
      const arr = grouped.get(run.sessionKey) ?? [];
      arr.push(run);
      grouped.set(run.sessionKey, arr);
    }

    const result: SessionRow[] = [];
    for (const [sessionKey, sessionRuns] of grouped) {
      const conv = conversations.find((c) => c.key === sessionKey);
      result.push({
        sessionKey,
        title: getTitle(sessionKey, conversations),
        kind: inferKind(sessionKey, conv?.kind),
        runs: sessionRuns.sort((a, b) => a.startedAt - b.startedAt),
        isActive: sessionRuns.some((r) => r.state === "running"),
      });
    }

    return result.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      const aLast = Math.max(...a.runs.map((r) => r.endedAt ?? now));
      const bLast = Math.max(...b.runs.map((r) => r.endedAt ?? now));
      return bLast - aLast;
    });
  }, [runs, rangeStart, now, conversations]);

  // Detect runs that were likely queued (started within 3s of another session's run ending)
  const queuedRunIds = useMemo(() => {
    const ids = new Set<string>();
    const sorted = [...runs]
      .filter((r) => r.endedAt !== null || r.state === "running")
      .sort((a, b) => a.startedAt - b.startedAt);

    for (let i = 1; i < sorted.length; i++) {
      const curr = sorted[i];
      const prev = sorted[i - 1];
      if (
        prev.endedAt &&
        curr.sessionKey !== prev.sessionKey &&
        curr.startedAt - prev.endedAt < 3000
      ) {
        ids.add(curr.id);
      }
    }
    return ids;
  }, [runs]);

  // Concurrency sparkline: sample queue depth across the window
  const SPARKLINE_SAMPLES = 60;
  const sparkline = useMemo(() => {
    const step = rangeDuration / SPARKLINE_SAMPLES;
    return Array.from({ length: SPARKLINE_SAMPLES + 1 }, (_, i) => {
      const t = rangeStart + i * step;
      return runs.filter((r) => r.startedAt <= t && (r.endedAt ?? now) >= t).length;
    });
  }, [runs, rangeStart, rangeDuration, now]);
  const maxDepth = Math.max(...sparkline, 1);

  // Compute utilization
  const totalProcessingMs = useMemo(() => {
    return runs
      .filter((r) => r.startedAt >= rangeStart)
      .reduce((sum, r) => {
        const start = Math.max(r.startedAt, rangeStart);
        const end = Math.min(r.endedAt ?? now, now);
        return sum + Math.max(0, end - start);
      }, 0);
  }, [runs, rangeStart, now]);
  const utilization = Math.min(100, (totalProcessingMs / rangeDuration) * 100);

  // Time axis ticks
  const tickInterval = timeWindowMinutes <= 15 ? 1 : timeWindowMinutes <= 30 ? 5 : 10;
  const axisTicks = useMemo(() => {
    const ticks: { pos: number; label: string }[] = [];
    for (let m = 0; m <= timeWindowMinutes; m += tickInterval) {
      const pos = (m / timeWindowMinutes) * 100;
      const ago = timeWindowMinutes - m;
      ticks.push({ pos, label: ago === 0 ? "Now" : `-${ago}m` });
    }
    return ticks;
  }, [timeWindowMinutes, tickInterval]);

  const LABEL_W = "160px";

  return (
    <section className="rounded-xl border border-border bg-zinc-900/80 backdrop-blur-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-white">Session Timeline</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {rows.length} session{rows.length !== 1 ? "s" : ""} ·{" "}
            {utilization.toFixed(0)}% utilization
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-0.5">
          {[15, 30, 60].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setTimeWindow(m)}
              className={`rounded-md px-2.5 py-1.5 text-xs transition-all ${
                timeWindowMinutes === m
                  ? "bg-white/10 text-white font-medium shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-4 pt-2">
        {/* Time axis */}
        <div className="relative mb-1.5 h-5" style={{ marginLeft: LABEL_W }}>
          {axisTicks.map((tick) => (
            <div
              key={tick.label}
              className="absolute top-0 flex flex-col items-center"
              style={{ left: `${tick.pos}%`, transform: "translateX(-50%)" }}
            >
              <span className="text-[10px] text-zinc-600 select-none">{tick.label}</span>
              <div className="mt-0.5 h-1.5 w-px bg-zinc-700/60" />
            </div>
          ))}
        </div>

        {/* Session rows */}
        {rows.length === 0 ? (
          <div className="flex min-h-28 items-center justify-center text-sm text-zinc-600">
            <div className="text-center">
              <p>No session activity in the last {timeWindowMinutes} minutes</p>
              <p className="mt-1 text-xs text-zinc-700">
                Activity will appear here as sessions are processed
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-px">
            {rows.map((row) => {
              const colors = KIND_COLORS[row.kind] ?? KIND_COLORS.unknown;

              return (
                <div key={row.sessionKey} className="group flex items-center gap-2">
                  {/* Session label */}
                  <button
                    type="button"
                    onClick={() => onOpenSession(row.sessionKey)}
                    className="flex items-center gap-1.5 shrink-0 text-right text-xs text-zinc-400 transition-colors hover:text-white"
                    style={{ width: LABEL_W }}
                    title={row.sessionKey}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        row.isActive ? "bg-blue-400 animate-pulse" : "bg-zinc-600"
                      }`}
                    />
                    <span className="truncate text-right flex-1">{row.title}</span>
                  </button>

                  {/* Bar track */}
                  <div className="relative h-6 flex-1 rounded bg-white/[0.015]">
                    {/* Gridlines */}
                    {axisTicks.map((tick) => (
                      <div
                        key={tick.label}
                        className="absolute top-0 bottom-0 w-px bg-white/[0.03]"
                        style={{ left: `${tick.pos}%` }}
                      />
                    ))}

                    {/* Run bars */}
                    {row.runs.map((run) => {
                      const left =
                        Math.max(0, (run.startedAt - rangeStart) / rangeDuration) * 100;
                      const right =
                        Math.min(1, ((run.endedAt ?? now) - rangeStart) / rangeDuration) * 100;
                      const width = Math.max(0.2, right - left);
                      const isRunning = run.state === "running";
                      const isError = run.state === "error";
                      const isQueued = queuedRunIds.has(run.id);
                      const duration = (run.endedAt ?? now) - run.startedAt;

                      return (
                        <div
                          key={run.id}
                          className={`absolute top-0.5 bottom-0.5 rounded transition-all ${
                            isError
                              ? "bg-red-500/50"
                              : isRunning
                                ? colors.active
                                : colors.bg
                          }`}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            minWidth: "3px",
                            boxShadow: isRunning
                              ? `0 0 14px ${colors.glow}, inset 0 1px 0 rgba(255,255,255,0.1)`
                              : "inset 0 1px 0 rgba(255,255,255,0.05)",
                            animation: isRunning
                              ? "flow-pulse 2s ease-in-out infinite"
                              : undefined,
                          }}
                          title={[
                            formatDuration(duration),
                            run.toolCalls.length
                              ? `Tools: ${run.toolCalls.join(", ")}`
                              : null,
                            isQueued ? "⏳ Was queued behind another session" : null,
                            isError ? "❌ Error" : null,
                          ]
                            .filter(Boolean)
                            .join("\n")}
                        >
                          {/* Tool call indicators */}
                          {run.toolCalls.length > 0 && width > 1.5 && (
                            <div className="absolute inset-x-0.5 top-1/2 -translate-y-1/2 flex gap-px overflow-hidden">
                              {run.toolCalls.slice(0, 12).map((tool, i) => (
                                <div
                                  key={`${tool}-${i}`}
                                  className="h-0.5 w-0.5 rounded-full bg-white/50 shrink-0"
                                />
                              ))}
                            </div>
                          )}

                          {/* Queued indicator — amber tick at the start */}
                          {isQueued && (
                            <div className="absolute -left-px top-0 bottom-0 w-0.5 rounded-full bg-amber-400/80" />
                          )}
                        </div>
                      );
                    })}

                    {/* Now marker */}
                    <div
                      className="absolute top-0 bottom-0 w-px bg-white/25"
                      style={{ right: 0 }}
                    >
                      <div className="absolute -top-0.5 -right-px h-1 w-1 rounded-full bg-white/40" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Concurrency sparkline */}
        {rows.length > 0 && (
          <div className="mt-3 flex items-end gap-2">
            <span
              className="shrink-0 text-right text-[10px] text-zinc-600 uppercase tracking-wider"
              style={{ width: LABEL_W }}
            >
              Concurrency
            </span>
            <div className="flex h-3 flex-1 items-end gap-px rounded bg-white/[0.015] overflow-hidden">
              {sparkline.map((depth, i) => (
                <div
                  key={i}
                  className={`flex-1 transition-all rounded-t-sm ${
                    depth === 0
                      ? ""
                      : depth === 1
                        ? "bg-emerald-500/35"
                        : depth === 2
                          ? "bg-amber-500/45"
                          : "bg-red-500/55"
                  }`}
                  style={{
                    height: depth > 0 ? `${Math.max(20, (depth / maxDepth) * 100)}%` : "0",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Legend */}
        {rows.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1" style={{ marginLeft: LABEL_W }}>
            {(
              [
                ["direct", "Direct", "bg-blue-500/50"],
                ["group", "Group", "bg-purple-500/50"],
                ["cron", "Cron", "bg-emerald-500/50"],
                ["subagent", "Sub-agent", "bg-amber-500/50"],
              ] as const
            ).map(([, label, bg]) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`h-2 w-4 rounded-sm ${bg}`} />
                <span className="text-[10px] text-zinc-600">{label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-0.5 rounded-full bg-amber-400/80" />
              <span className="text-[10px] text-zinc-600">Queued</span>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes flow-pulse {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
      `}</style>
    </section>
  );
}
