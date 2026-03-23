import { useEffect, useState } from "react";
import type { AgentRun, ActivityEvent, Conversation } from "../../lib/types";
import { useAgentsStore } from "../../lib/store";
import { useActivityStore } from "../../lib/stores/activity-store";
import {
  useTaskStore,
  useVisibleTasks,
} from "../../lib/stores/task-store-v2";
import type { TaskNode } from "../../lib/task-types";
import { ActivityFeed } from "./activity-feed";
import { StatsBar } from "./stats-bar";
import { TaskPipeline } from "./task-pipeline";

type DashboardTab = "tasks" | "stats" | "activity";

type DispatchStatusPayload = {
  config?: { enabled?: boolean };
  report?: { at?: string; picked?: unknown[] } | null;
};

function TabButton({ label, active, count, onClick }: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200 ${
        active
          ? "bg-white/[0.08] text-white"
          : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
      }`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${
          active ? "bg-indigo-500/20 text-indigo-300" : "bg-white/[0.05] text-zinc-600"
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

export function WorkflowDashboard({
  conversations,
  agents,
  tasks,
  activities,
  onOpenSession,
  onQuickSend,
}: {
  conversations: Conversation[];
  agents?: AgentRun[];
  tasks?: TaskNode[];
  activities?: ActivityEvent[];
  onOpenSession: (key: string) => void;
  onQuickSend: (sessionKey: string, text: string) => Promise<void>;
}) {
  const liveTasks = useTaskStore((state) => state.tasks);
  const visibleTasks = useVisibleTasks();
  const liveAgents = useAgentsStore((state) => state.agents);
  const liveActivities = useActivityStore((state) => state.events);

  const taskItems = tasks ?? liveTasks;
  const agentItems = agents ?? liveAgents;
  const activityItems = activities ?? liveActivities;

  const [activeTab, setActiveTab] = useState<DashboardTab>("tasks");
  const [dispatchEnabled, setDispatchEnabled] = useState(false);
  const [dispatchLastRunAt, setDispatchLastRunAt] = useState<string | null>(null);
  const [dispatchPicked, setDispatchPicked] = useState(0);

  const activeTaskCount = taskItems.filter((t) => t.status !== "done").length;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const configRes = await fetch("/api/config");
        if (!configRes.ok) return;
        const configJson = await configRes.json() as { token?: string };
        if (!configJson.token) return;

        const statusRes = await fetch("/api/dispatch/status", {
          headers: { Authorization: `Bearer ${configJson.token}` },
        });
        if (!statusRes.ok || cancelled) return;
        const data = await statusRes.json() as DispatchStatusPayload;
        setDispatchEnabled(Boolean(data.config?.enabled));
        setDispatchLastRunAt(data.report?.at ?? null);
        setDispatchPicked(Array.isArray(data.report?.picked) ? data.report.picked.length : 0);
      } catch {
        // Keep prior status
      }
    };

    void load();
    const handle = window.setInterval(() => { void load(); }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-3 xl:px-5">
      {/* Tab bar */}
      <div className="mb-3 flex shrink-0 items-center gap-0.5 overflow-x-auto rounded-xl border border-white/[0.05] bg-surface-0 p-1">
        <TabButton label="Tasks" active={activeTab === "tasks"} count={activeTaskCount} onClick={() => setActiveTab("tasks")} />
        <TabButton label="Stats" active={activeTab === "stats"} onClick={() => setActiveTab("stats")} />
        <TabButton label="Activity" active={activeTab === "activity"} count={activityItems.length} onClick={() => setActiveTab("activity")} />
      </div>

      {/* Tab content — fills remaining space */}
      <div className="min-h-0 flex-1 scroll-soft overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {activeTab === "tasks" && (
          <TaskPipeline tasks={taskItems} visibleTasks={visibleTasks} onOpenSession={onOpenSession} />
        )}
        {activeTab === "stats" && (
          <div className="space-y-4">
            <StatsBar conversations={conversations} tasks={taskItems} agents={agentItems} />
          </div>
        )}
        {activeTab === "activity" && (
          <ActivityFeed events={activityItems} onOpenSession={onOpenSession} />
        )}
      </div>
    </div>
  );
}
