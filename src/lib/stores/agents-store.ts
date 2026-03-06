import { create } from "zustand";
import { nowIso, updateAgent, type AgentsStoreState } from "./shared";

export const useAgentsStore = create<AgentsStoreState>((set, get) => ({
  agents: [],
  handleAgentEvent: (payload) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const event = payload as Record<string, unknown>;
    const id = typeof event.runId === "string" ? event.runId : crypto.randomUUID();
    const stream = typeof event.stream === "string" ? event.stream : "lifecycle";
    const data = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
    const phase = typeof data.phase === "string" ? data.phase : null;
    const label =
      (typeof data.tool === "string" && data.tool) ||
      (typeof data.text === "string" && data.text.slice(0, 32)) ||
      "Active agent";
    const transcriptEntry =
      (typeof data.text === "string" && data.text) ||
      (typeof data.tool === "string" && `Tool: ${data.tool}`) ||
      (phase ? `Lifecycle: ${phase}` : `Stream: ${stream}`);
    const existing = get().agents.find((agent) => agent.id === id);
    const startedAt = existing?.startedAt ?? nowIso();
    const status =
      stream === "error" || phase === "error"
        ? "error"
        : phase === "end"
          ? "done"
          : stream === "tool"
            ? "waiting"
            : "running";
    set({
      agents: updateAgent(get().agents, {
        id,
        label: existing?.label ?? label,
        status,
        sessionKey: typeof event.sessionKey === "string" ? event.sessionKey.replace(/^agent:[^:]+:/, "") : existing?.sessionKey ?? null,
        startedAt,
        updatedAt: nowIso(),
        summary: phase === "end" ? "Completed recently." : existing?.summary,
        transcript: [...(existing?.transcript ?? []), transcriptEntry].slice(-12)
      })
    });
  },
  addPresenceBeacon: () => {
    const now = nowIso();
    set({
      agents: updateAgent(get().agents, {
        id: crypto.randomUUID(),
        label: "Gateway presence",
        status: "idle",
        sessionKey: null,
        startedAt: now,
        updatedAt: now,
        summary: "Presence update received.",
        transcript: ["Presence beacon"]
      })
    });
  }
}));
