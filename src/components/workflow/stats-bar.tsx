import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun, Conversation } from "../../lib/types";
import type { TaskNode } from "../../lib/task-types";

type Tone = "active" | "healthy" | "attention" | "error" | "inactive";

function timeAgo(iso: string | null) {
  if (!iso) {
    return "No recent";
  }
  const delta = Math.max(0, Date.now() - Date.parse(iso));
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getSessionTone(conversation: Conversation, agents: AgentRun[]): Tone {
  const sessionAgents = agents.filter((agent) => agent.sessionKey === conversation.key);
  if (sessionAgents.some((agent) => agent.status === "error")) return "error";
  if (sessionAgents.some((agent) => agent.status === "waiting")) return "attention";
  if (conversation.isStreaming || sessionAgents.some((agent) => agent.status === "running")) return "active";
  if (Date.now() - Date.parse(conversation.updatedAt) < 3_600_000) return "healthy";
  return "inactive";
}

const TONE_STYLES: Record<Tone, string> = {
  active: "border-l-blue-400",
  healthy: "border-l-emerald-400",
  attention: "border-l-amber-400",
  error: "border-l-red-400",
  inactive: "border-l-zinc-500",
};

function MetricCard({
  value,
  label,
  detail,
  tone,
  valueKey,
}: {
  value: string;
  label: string;
  detail: string;
  tone: Tone;
  valueKey: string;
}) {
  const [flash, setFlash] = useState(false);
  const previousKey = useRef<string | null>(null);

  useEffect(() => {
    if (previousKey.current !== null && previousKey.current !== valueKey) {
      setFlash(true);
      const timer = window.setTimeout(() => setFlash(false), 300);
      previousKey.current = valueKey;
      return () => window.clearTimeout(timer);
    }
    previousKey.current = valueKey;
    return;
  }, [valueKey]);

  return (
    <div
      className={`min-w-[180px] rounded-xl border border-white/[0.05] border-l-2 bg-surface-0 px-4 py-3.5 transition-all duration-200 ${TONE_STYLES[tone]} ${
        flash ? "ring-1 ring-white/[0.08]" : ""
      }`}
    >
      <div className="text-2xl font-semibold tabular-nums text-zinc-100">{value}</div>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-zinc-600">{label}</p>
      <p className="mt-1.5 text-[12px] text-zinc-500">{detail}</p>
    </div>
  );
}

export function StatsBar({
  conversations,
  tasks,
  agents,
}: {
  conversations: Conversation[];
  tasks: TaskNode[];
  agents: AgentRun[];
}) {
  const activeSessions = useMemo(
    () => conversations.filter((conversation) => Date.now() - Date.parse(conversation.updatedAt) < 3_600_000),
    [conversations]
  );

  const mostUrgentTone = useMemo(() => {
    const ordered: Tone[] = ["error", "attention", "active", "healthy", "inactive"];
    const tones = activeSessions.map((conversation) => getSessionTone(conversation, agents));
    return ordered.find((tone) => tones.includes(tone)) ?? "inactive";
  }, [activeSessions, agents]);

  const activeTaskCount = tasks.filter((task) => task.status !== "done").length;
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;
  const reviewCount = tasks.filter((task) => task.status === "review").length;
  const runningAgents = agents.filter((agent) => agent.status === "running").length;
  const waitingAgents = agents.filter((agent) => agent.status === "waiting").length;
  const latestSessionUpdate = conversations
    .map((conversation) => conversation.updatedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

  return (
    <section className="-mx-3 overflow-x-auto px-3 xl:mx-0 xl:px-0">
      <div className="flex gap-3 pb-1 xl:grid xl:grid-cols-2">
        <MetricCard
          value={String(activeSessions.length)}
          label="Active Sessions"
          detail={activeSessions.length > 0 ? "Updated in the last hour" : "Quiet right now"}
          tone={mostUrgentTone}
          valueKey={`sessions:${activeSessions.length}:${mostUrgentTone}`}
        />
        <MetricCard
          value={String(activeTaskCount)}
          label="Tasks"
          detail={`${tasks.filter((task) => task.status === "active").length} active · ${blockedCount} blocked · ${reviewCount} review`}
          tone={blockedCount > 0 ? "error" : reviewCount > 0 ? "attention" : activeTaskCount > 0 ? "active" : "inactive"}
          valueKey={`tasks:${activeTaskCount}:${blockedCount}:${reviewCount}`}
        />
        <MetricCard
          value={runningAgents + waitingAgents > 0 ? String(runningAgents + waitingAgents) : "Idle"}
          label="Agents"
          detail={
            runningAgents + waitingAgents > 0
              ? `${runningAgents} running · ${waitingAgents} waiting`
              : "No active agents"
          }
          tone={waitingAgents > 0 ? "attention" : runningAgents > 0 ? "active" : "inactive"}
          valueKey={`agents:${runningAgents}:${waitingAgents}`}
        />
        <MetricCard
          value={timeAgo(latestSessionUpdate)}
          label="Last Activity"
          detail={latestSessionUpdate ? "Most recent session update" : "Waiting for activity"}
          tone={latestSessionUpdate ? "healthy" : "inactive"}
          valueKey={`activity:${latestSessionUpdate ?? "none"}`}
        />
      </div>
    </section>
  );
}
