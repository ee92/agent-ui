import { useMemo } from "react";
import type { Conversation } from "../../lib/types";
import { useSessionFlowStore } from "../../lib/stores/session-flow-store";

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

type MetricTone = "urgent" | "warn" | "ok" | "neutral";

const TONE_COLORS: Record<MetricTone, string> = {
  urgent: "text-red-400",
  warn: "text-amber-400",
  ok: "text-emerald-400",
  neutral: "text-zinc-300",
};

const TONE_BG: Record<MetricTone, string> = {
  urgent: "bg-red-500/10 border-red-500/20",
  warn: "bg-amber-500/10 border-amber-500/20",
  ok: "bg-emerald-500/10 border-emerald-500/20",
  neutral: "bg-white/[0.03] border-white/[0.06]",
};

function Metric({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: MetricTone;
}) {
  return (
    <div className={`flex-1 min-w-[120px] rounded-lg border px-3 py-2.5 ${TONE_BG[tone]}`}>
      <div className={`text-lg font-semibold leading-tight ${TONE_COLORS[tone]}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
    </div>
  );
}

export function BottleneckMetrics({
  conversations,
  waitingCount,
  avgWaitMs,
}: {
  conversations: Conversation[];
  waitingCount: number;
  avgWaitMs: number;
}) {
  const runs = useSessionFlowStore((s) => s.runs);

  const { processing, completedLastHour, utilization } = useMemo(() => {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const activeRuns = runs.filter((r) => r.state === "running");
    const recentCompleted = runs.filter(
      (r) => r.state === "done" && r.endedAt && r.endedAt > hourAgo
    );

    // Utilization: total processing time in last hour / 1 hour
    const totalMs = runs
      .filter((r) => r.startedAt > hourAgo)
      .reduce((sum, r) => {
        const start = Math.max(r.startedAt, hourAgo);
        const end = Math.min(r.endedAt ?? now, now);
        return sum + Math.max(0, end - start);
      }, 0);
    const util = Math.min(100, (totalMs / (60 * 60 * 1000)) * 100);

    return {
      processing: activeRuns.length + conversations.filter((c) => c.isStreaming).length,
      completedLastHour: recentCompleted.length,
      utilization: util,
    };
  }, [runs, conversations]);

  const waitingTone: MetricTone =
    waitingCount === 0 ? "ok" : waitingCount >= 3 ? "urgent" : "warn";
  const waitTimeTone: MetricTone =
    avgWaitMs < 5 * 60_000 ? "ok" : avgWaitMs < 15 * 60_000 ? "warn" : "urgent";

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 xl:mx-0 xl:px-0">
      <Metric
        value={String(waitingCount)}
        label="Waiting on you"
        tone={waitingTone}
      />
      <Metric
        value={avgWaitMs > 0 ? formatDuration(avgWaitMs) : "—"}
        label="Avg wait"
        tone={waitTimeTone}
      />
      <Metric
        value={processing > 0 ? String(processing) : "Idle"}
        label="Processing"
        tone={processing > 0 ? "ok" : "neutral"}
      />
      <Metric
        value={String(completedLastHour)}
        label="Done (1h)"
        tone="neutral"
      />
      <Metric
        value={`${utilization.toFixed(0)}%`}
        label="Utilization"
        tone={utilization > 50 ? "ok" : utilization > 20 ? "neutral" : "neutral"}
      />
    </div>
  );
}
