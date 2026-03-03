import { create } from "zustand";
import type { ActivityEvent, ActivityEventKind } from "../types";

const MAX_EVENTS = 200;

interface ActivityStoreState {
  events: ActivityEvent[];
  push: (
    kind: ActivityEventKind,
    summary: string,
    opts?: { sessionKey?: string; metadata?: Record<string, unknown> }
  ) => void;
  clear: () => void;
}

export const useActivityStore = create<ActivityStoreState>((set) => ({
  events: [],
  push: (kind, summary, opts) =>
    set((state) => ({
      events: [
        {
          id: crypto.randomUUID(),
          kind,
          summary,
          timestamp: new Date().toISOString(),
          sessionKey: opts?.sessionKey,
          metadata: opts?.metadata,
        },
        ...state.events,
      ].slice(0, MAX_EVENTS),
    })),
  clear: () => set({ events: [] }),
}));
