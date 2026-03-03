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
  const hasQuickSend = Boolean(onQuickSend);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 xl:px-5 xl:pb-5"
      data-has-quick-send={hasQuickSend}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)] xl:gap-4">
        <div className="sticky top-0 z-10 xl:hidden">
          <StatusPulse
            connectionState={connectionState}
            blockedCount={blockedCount}
            reviewCount={reviewCount}
            agents={agentItems}
          />
        </div>

        <div className="xl:min-h-0 xl:overflow-hidden">
          <TaskPipeline tasks={taskItems} visibleTasks={visibleTasks} onOpenSession={onOpenSession} />
        </div>

        <div className="flex min-h-0 flex-col gap-3 xl:overflow-y-auto">
          <div className="hidden xl:block">
            <StatusPulse
              connectionState={connectionState}
              blockedCount={blockedCount}
              reviewCount={reviewCount}
              agents={agentItems}
            />
          </div>
          <StatsBar conversations={conversations} tasks={taskItems} agents={agentItems} />
          <ActivityFeed events={activityItems} onOpenSession={onOpenSession} />
        </div>
      </div>
    </div>
  );
}
