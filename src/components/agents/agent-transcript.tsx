import type { AgentRun } from "../../lib/types";

export function AgentTranscript({
  agent,
  onOpenSession
}: {
  agent: AgentRun | null;
  onOpenSession: (key: string) => void;
}) {
  return (
    <div className="rounded-[2rem] border border-white/8 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Agent Transcript</p>
          <h3 className="mt-1 text-sm font-semibold text-white">{agent?.label || "No agent selected"}</h3>
        </div>
        {agent?.sessionKey ? (
          <button
            type="button"
            onClick={() => onOpenSession(agent.sessionKey as string)}
            className="rounded-full border border-white/8 px-3 py-1 text-xs text-zinc-300"
          >
            Open chat
          </button>
        ) : null}
      </div>
      <div className="scroll-soft max-h-[240px] space-y-2 overflow-y-auto pr-1">
        {agent ? (
          agent.transcript.map((entry, index) => (
            <div key={`${entry}-${index}`} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-sm text-zinc-200">
              {entry}
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
            Click an active agent in the sidebar to inspect its recent lifecycle.
          </div>
        )}
      </div>
    </div>
  );
}
