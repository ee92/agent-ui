import { create } from "zustand";

export type RunEndState = "done" | "error" | "aborted";
export type RunState = "running" | RunEndState;

export interface SessionRun {
  id: string;
  sessionKey: string;
  startedAt: number;
  endedAt: number | null;
  state: RunState;
  toolCalls: string[];
}

export interface SeedConversation {
  key: string;
  updatedAt: string;
  createdAt: string;
  isStreaming: boolean;
  runId?: string | null;
}

export interface SeedMessage {
  role: string;
  createdAt: string;
}

const MAX_RUNS = 500;
const PRUNE_AGE_MS = 2 * 60 * 60 * 1000;
const SEED_WINDOW_MS = 60 * 60 * 1000; // seed from last hour

interface SessionFlowState {
  runs: SessionRun[];
  timeWindowMinutes: number;
  seededKeys: Set<string>;

  recordRunDelta: (runId: string, sessionKey: string) => void;
  recordRunEnd: (runId: string, state: RunEndState) => void;
  recordToolCall: (runId: string, toolName: string) => void;
  setTimeWindow: (minutes: number) => void;
  prune: () => void;
  seedFromConversations: (conversations: SeedConversation[]) => void;
  seedFromHistory: (sessionKey: string, messages: SeedMessage[]) => void;
}

export const useSessionFlowStore = create<SessionFlowState>((set, get) => ({
  runs: [],
  timeWindowMinutes: 30,
  seededKeys: new Set(),

  recordRunDelta: (runId, sessionKey) => {
    if (get().runs.some((r) => r.id === runId)) return;
    const newRun: SessionRun = {
      id: runId,
      sessionKey,
      startedAt: Date.now(),
      endedAt: null,
      state: "running",
      toolCalls: [],
    };
    set((s) => ({
      runs: [newRun, ...s.runs].slice(0, MAX_RUNS),
    }));
  },

  recordRunEnd: (runId, state) => {
    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === runId && r.state === "running"
          ? { ...r, endedAt: Date.now(), state }
          : r
      ),
    }));
  },

  recordToolCall: (runId, toolName) => {
    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === runId && r.state === "running" && !r.toolCalls.includes(toolName)
          ? { ...r, toolCalls: [...r.toolCalls, toolName] }
          : r
      ),
    }));
  },

  setTimeWindow: (minutes) => set({ timeWindowMinutes: minutes }),

  prune: () => {
    const cutoff = Date.now() - PRUNE_AGE_MS;
    set((s) => ({
      runs: s.runs.filter((r) => (r.endedAt ?? Date.now()) > cutoff),
    }));
  },

  /**
   * Seed the timeline with synthetic runs from session list data.
   * Creates a completed run for each session active in the last hour,
   * and an active run for any currently streaming session.
   */
  seedFromConversations: (conversations) => {
    const now = Date.now();
    const cutoff = now - SEED_WINDOW_MS;
    const existing = get().runs;
    const seeded = get().seededKeys;
    const newRuns: SessionRun[] = [];

    for (const conv of conversations) {
      // Skip if we already have real runs for this session or already seeded it
      if (seeded.has(conv.key)) continue;
      if (existing.some((r) => r.sessionKey === conv.key)) continue;

      const updatedAt = Date.parse(conv.updatedAt);
      if (Number.isNaN(updatedAt) || updatedAt < cutoff) continue;

      if (conv.isStreaming && conv.runId) {
        // Currently streaming — create an active run
        newRuns.push({
          id: conv.runId,
          sessionKey: conv.key,
          startedAt: updatedAt - 10_000, // estimate: started ~10s before last update
          endedAt: null,
          state: "running",
          toolCalls: [],
        });
      } else {
        // Recently active — create a completed run
        // Estimate: run lasted ~15-45 seconds ending at updatedAt
        const estimatedDuration = 20_000 + Math.random() * 20_000;
        newRuns.push({
          id: `seed-${conv.key}-${updatedAt}`,
          sessionKey: conv.key,
          startedAt: updatedAt - estimatedDuration,
          endedAt: updatedAt,
          state: "done",
          toolCalls: [],
        });
      }
    }

    if (newRuns.length > 0) {
      const newSeeded = new Set(seeded);
      for (const conv of conversations) newSeeded.add(conv.key);
      set((s) => ({
        runs: [...newRuns, ...s.runs].slice(0, MAX_RUNS),
        seededKeys: newSeeded,
      }));
    }
  },

  /**
   * Seed the timeline from message history for a specific session.
   * Groups user→assistant message pairs into runs based on timestamps.
   */
  seedFromHistory: (sessionKey, messages) => {
    if (get().seededKeys.has(`hist:${sessionKey}`)) return;

    const now = Date.now();
    const cutoff = now - SEED_WINDOW_MS;
    const existing = get().runs;

    // Remove any seed-* placeholder runs for this session
    const filtered = existing.filter(
      (r) => !(r.id.startsWith("seed-") && r.sessionKey === sessionKey)
    );

    // Find user→assistant message pairs to create runs
    const newRuns: SessionRun[] = [];
    let pendingUserTime: number | null = null;

    for (const msg of messages) {
      const ts = Date.parse(msg.createdAt);
      if (Number.isNaN(ts) || ts < cutoff) continue;

      if (msg.role === "user") {
        pendingUserTime = ts;
      } else if (msg.role === "assistant" && pendingUserTime !== null) {
        // User message → Assistant response = one "run"
        newRuns.push({
          id: `hist-${sessionKey}-${pendingUserTime}`,
          sessionKey,
          startedAt: pendingUserTime,
          endedAt: ts,
          state: "done",
          toolCalls: [],
        });
        pendingUserTime = null;
      }
    }

    if (newRuns.length > 0) {
      const newSeeded = new Set(get().seededKeys);
      newSeeded.add(`hist:${sessionKey}`);
      set({
        runs: [...filtered, ...newRuns].slice(0, MAX_RUNS),
        seededKeys: newSeeded,
      });
    }
  },
}));
