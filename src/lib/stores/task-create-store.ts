/**
 * Global store for the task creation modal.
 * Any component can trigger task creation by calling openTaskCreate().
 */
import { create } from "zustand";

export type TaskCreateContext = {
  title?: string;
  notes?: string;
  sessionKey?: string;
  repo?: string;
  branch?: string;
  status?: "todo" | "active" | "review" | "blocked";
  sourceLabel?: string;
};

interface TaskCreateStoreState {
  context: TaskCreateContext | null;
  openTaskCreate: (ctx: TaskCreateContext) => void;
  closeTaskCreate: () => void;
}

export const useTaskCreateStore = create<TaskCreateStoreState>((set) => ({
  context: null,
  openTaskCreate: (ctx) => set({ context: ctx }),
  closeTaskCreate: () => set({ context: null }),
}));
