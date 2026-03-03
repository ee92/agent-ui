import { useMemo } from "react";
import type { AgentRun, Conversation } from "../../lib/types";
import { AttentionQueue } from "./attention-queue";
import { BottleneckMetrics } from "./bottleneck-metrics";
import { SessionGrid } from "./session-grid";
import { WorkStream } from "./work-stream";

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

function isWaitingForHuman(conv: Conversation): boolean {
  // Session is waiting for human input if:
  // 1. Not currently streaming/processing
  // 2. Last message was from the assistant (agent asked/delivered something)
  // 3. Session was active recently (not stale)
  if (conv.isStreaming) return false;
  if (conv.lastMessageRole !== "assistant") return false;
  const age = Date.now() - Date.parse(conv.updatedAt);
  if (age > STALE_THRESHOLD_MS) return false;
  // Skip cron sessions — they don't need human input
  if (conv.key.includes("cron:")) return false;
  return true;
}

export function SystemFlow({
  conversations,
  agents,
  onOpenSession,
  onQuickSend,
}: {
  conversations: Conversation[];
  agents: AgentRun[];
  onOpenSession: (key: string) => void;
  onQuickSend: (sessionKey: string, text: string) => Promise<void>;
}) {
  // Split conversations into categories
  const { waiting, rest, avgWaitMs } = useMemo(() => {
    const waitingConvs: Conversation[] = [];
    const restConvs: Conversation[] = [];

    for (const conv of conversations) {
      if (isWaitingForHuman(conv)) {
        waitingConvs.push(conv);
      } else {
        restConvs.push(conv);
      }
    }

    // Sort waiting by longest wait first
    waitingConvs.sort(
      (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
    );

    // Average wait time
    const now = Date.now();
    const totalWait = waitingConvs.reduce(
      (sum, c) => sum + (now - Date.parse(c.updatedAt)),
      0
    );
    const avg = waitingConvs.length > 0 ? totalWait / waitingConvs.length : 0;

    return { waiting: waitingConvs, rest: restConvs, avgWaitMs: avg };
  }, [conversations]);

  const handleReply = (key: string, text: string) => {
    void onQuickSend(key, text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 xl:px-5 xl:pb-5">
      {/* Metrics bar */}
      <BottleneckMetrics
        conversations={conversations}
        waitingCount={waiting.length}
        avgWaitMs={avgWaitMs}
      />

      {/* Main content: attention + work stream */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)] xl:gap-5">
        {/* Left column: Attention Queue */}
        <div className="flex flex-col gap-4">
          <AttentionQueue
            conversations={waiting}
            onReply={handleReply}
            onOpen={onOpenSession}
          />

          {/* Work Stream below attention on mobile, always visible */}
          <div className="xl:hidden">
            <WorkStream
              conversations={conversations}
              agents={agents}
              onOpenSession={onOpenSession}
            />
          </div>

          {/* Session grid (compact) for remaining sessions */}
          <SessionGrid
            conversations={rest}
            agents={agents}
            onOpenSession={onOpenSession}
          />
        </div>

        {/* Right column (desktop): Work Stream */}
        <div className="hidden xl:flex xl:flex-col xl:gap-4 xl:overflow-y-auto">
          <WorkStream
            conversations={conversations}
            agents={agents}
            onOpenSession={onOpenSession}
          />
        </div>
      </div>
    </div>
  );
}
