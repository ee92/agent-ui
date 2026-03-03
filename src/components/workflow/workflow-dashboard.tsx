import { useState } from "react";
import type { AgentRun, ActivityEvent, Conversation } from "../../lib/types";
import { useAgentsStore, useGatewayStore } from "../../lib/store";
import { useActivityStore } from "../../lib/stores/activity-store";
import {
  useBlockedCount,
  useReviewCount,
  useTaskStore,
  useVisibleTasks,
} from "../../lib/stores/task-store-v2";
import type { TaskNode } from "../../lib/task-types";
import { ActivityFeed } from "./activity-feed";
import { StatsBar } from "./stats-bar";
import { StatusPulse } from "./status-pulse";
import { TaskPipeline } from "./task-pipeline";

type DashboardTab = "tasks" | "stats" | "activity";

function TabButton({ label, active, count, onClick }: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-white/[0.08] text-white"
          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
      }`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${
          active ? "bg-blue-500/20 text-blue-300" : "bg-white/[0.06] text-zinc-500"
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
  const connectionState = useGatewayStore((state) => state.connectionState);
  const liveTasks = useTaskStore((state) => state.tasks);
  const visibleTasks = useVisibleTasks();
  const reviewCount = useReviewCount();
  const blockedCount = useBlockedCount();
  const liveAgents = useAgentsStore((state) => state.agents);
  const liveActivities = useActivityStore((state) => state.events);

  const taskItems = tasks ?? liveTasks;
  const agentItems = agents ?? liveAgents;
  const activityItems = activities ?? liveActivities;

  const [activeTab, setActiveTab] = useState<DashboardTab>("tasks");

  const activeTaskCount = taskItems.filter((t) => t.status !== "done").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-3 xl:px-5">
      {/* Status pulse — always visible */}
      <div className="mb-3 shrink-0">
        <StatusPulse
          connectionState={connectionState}
          blockedCount={blockedCount}
          reviewCount={reviewCount}
          agents={agentItems}
        />
      </div>

      {/* Tab bar */}
      <div className="mb-3 flex shrink-0 items-center gap-1 overflow-x-auto rounded-xl border border-white/5 bg-black/20 p-1">
        <TabButton label="Tasks" active={activeTab === "tasks"} count={activeTaskCount} onClick={() => setActiveTab("tasks")} />
        <TabButton label="Stats" active={activeTab === "stats"} onClick={() => setActiveTab("stats")} />
        <TabButton label="Activity" active={activeTab === "activity"} count={activityItems.length} onClick={() => setActiveTab("activity")} />
      </div>

      {/* Tab content — fills remaining space */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
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
