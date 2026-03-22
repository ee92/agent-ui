import { useRef, useState, useEffect } from "react";
import type { AgentRun, ConnectionState } from "../../lib/types";

type PulseTone = "healthy" | "attention" | "degraded";

function getPulseState(
  connectionState: ConnectionState,
  blockedCount: number,
  reviewCount: number,
  agents: AgentRun[]
): { tone: PulseTone; lines: string[] } {
  const errorAgents = agents.filter((a) => a.status === "error").length;
  const waitingAgents = agents.filter((a) => a.status === "waiting").length;
  const runningAgents = agents.filter((a) => a.status === "running").length;

  if (connectionState !== "connected" || errorAgents > 0) {
    const lines: string[] = [];
    if (connectionState !== "connected") lines.push(`Gateway ${connectionState}`);
    if (errorAgents > 0) lines.push(`${errorAgents} agent${errorAgents === 1 ? "" : "s"} errored`);
    return { tone: "degraded", lines };
  }

  if (blockedCount > 0 || reviewCount > 0 || waitingAgents > 0) {
    const lines: string[] = [];
    if (blockedCount > 0) lines.push(`${blockedCount} blocked task${blockedCount === 1 ? "" : "s"}`);
    if (reviewCount > 0) lines.push(`${reviewCount} task${reviewCount === 1 ? "" : "s"} in review`);
    if (waitingAgents > 0) lines.push(`${waitingAgents} agent${waitingAgents === 1 ? "" : "s"} waiting`);
    return { tone: "attention", lines };
  }

  const lines = ["All systems nominal"];
  if (runningAgents > 0) lines.push(`${runningAgents} agent${runningAgents === 1 ? "" : "s"} running`);
  return { tone: "healthy", lines };
}

const DOT_COLORS: Record<PulseTone, string> = {
  healthy: "bg-emerald-400",
  attention: "bg-amber-400",
  degraded: "bg-red-400",
};

const PULSE_ANIM: Record<PulseTone, string> = {
  healthy: "animate-[status-breathe_3s_ease-in-out_infinite]",
  attention: "animate-[status-breathe_2s_ease-in-out_infinite]",
  degraded: "",
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <>
      <style>{`
        @keyframes status-breathe {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.3); opacity: 1; }
        }
      `}</style>
      <div ref={ref} className="relative inline-flex">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="group relative flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.04]"
          title={pulse.lines[0]}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${DOT_COLORS[pulse.tone]} ${PULSE_ANIM[pulse.tone]}`} />
        </button>
        {open && (
          <div className="absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 rounded-lg border border-white/4 bg-surface-1 p-3 shadow-xl shadow-black/40">
            <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-white/4 bg-surface-1" />
            {pulse.lines.map((line, i) => (
              <p key={i} className={`text-sm ${i === 0 ? "font-medium text-white" : "mt-1 text-zinc-400"}`}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
