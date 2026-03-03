import type { AgentRun, ConnectionState } from "../../lib/types";

type PulseTone = "healthy" | "attention" | "degraded";

function getPulseState(
  connectionState: ConnectionState,
  blockedCount: number,
  reviewCount: number,
  agents: AgentRun[]
): { tone: PulseTone; label: string; detail: string; meta: string } {
  const errorAgents = agents.filter((agent) => agent.status === "error").length;
  const waitingAgents = agents.filter((agent) => agent.status === "waiting").length;

  if (connectionState !== "connected" || errorAgents > 0) {
    return {
      tone: "degraded",
      label: connectionState === "connected" ? "ERR" : "OFF",
      detail: connectionState !== "connected" ? "Disconnected" : `${errorAgents} agent${errorAgents === 1 ? "" : "s"} errored`,
      meta: connectionState !== "connected" ? `Gateway ${connectionState}` : "Intervention required",
    };
  }

  if (blockedCount > 0 || reviewCount > 0 || waitingAgents > 0) {
    const attentionCount = blockedCount + reviewCount;
    return {
      tone: "attention",
      label: "CHK",
      detail:
        attentionCount > 0
          ? `${attentionCount} task${attentionCount === 1 ? "" : "s"} need review`
          : `${waitingAgents} agent${waitingAgents === 1 ? "" : "s"} waiting`,
      meta: blockedCount > 0 ? "Blocked work in queue" : "Watch the queue",
    };
  }

  return {
    tone: "healthy",
    label: "OK",
    detail: "All systems nominal",
    meta: "Gateway live and clear",
  };
}

const TONE_STYLES: Record<PulseTone, { ring: string; core: string; glow: string; animation: string | null }> = {
  healthy: {
    ring: "border-emerald-400/70 text-emerald-300",
    core: "bg-emerald-400/14",
    glow: "rgba(74, 222, 128, 0.26)",
    animation: "workflow-breathe 3s ease-in-out infinite",
  },
  attention: {
    ring: "border-amber-400/70 text-amber-300",
    core: "bg-amber-400/12",
    glow: "rgba(251, 191, 36, 0.22)",
    animation: "workflow-breathe 2.2s ease-in-out infinite",
  },
  degraded: {
    ring: "border-red-400/70 text-red-300",
    core: "bg-red-400/10",
    glow: "rgba(248, 113, 113, 0.18)",
    animation: null,
  },
};

export function StatusPulse({
  connectionState,
  blockedCount,
  reviewCount,
  agents,
}: {
  connectionState: ConnectionState;
  blockedCount: number;
  reviewCount: number;
  agents: AgentRun[];
}) {
  const pulse = getPulseState(connectionState, blockedCount, reviewCount, agents);
  const styles = TONE_STYLES[pulse.tone];

  return (
    <section className="rounded-xl border border-border bg-zinc-900/90 p-3 backdrop-blur-xl xl:p-4">
      <style>{`
        @keyframes workflow-breathe {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.06); opacity: 1; }
        }
      `}</style>
      <div className="flex min-h-12 items-center gap-3 xl:gap-4">
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center xl:h-16 xl:w-16">
          <span
            aria-hidden
            className={`absolute inset-0 rounded-full border ${styles.ring}`}
            style={{
              animation: styles.animation ?? undefined,
              boxShadow: `0 0 28px ${styles.glow}`,
            }}
          />
          <span className={`absolute inset-2 rounded-full border border-white/6 ${styles.core}`} aria-hidden />
          <span className="relative text-[11px] font-semibold tracking-[0.18em]">{pulse.label}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">{pulse.detail}</p>
          <p className="mt-1 text-xs text-zinc-500">{pulse.meta}</p>
        </div>
      </div>
    </section>
  );
}
