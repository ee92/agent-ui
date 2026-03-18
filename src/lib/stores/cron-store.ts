import { create } from "zustand";
import { getBackendAdapter } from "../adapters";
import type { CronJob, CronRunEntry } from "../adapters/types";

export type { CronJob, CronRunEntry } from "../adapters/types";

interface CronStoreState {
  jobs: CronJob[];
  runs: CronRunEntry[];
  loading: boolean;
  error: string | null;
  loadJobs: () => Promise<void>;
  loadRuns: (jobId?: string) => Promise<void>;
  updateJob: (id: string, patch: Record<string, unknown>) => Promise<void>;
  removeJob: (id: string) => Promise<void>;
  runJob: (id: string) => Promise<void>;
}

export const useCronStore = create<CronStoreState>((set, get) => ({
  jobs: [],
  runs: [],
  loading: false,
  error: null,

  loadJobs: async () => {
    const cronAdapter = getBackendAdapter().crons;
    if (!cronAdapter) {
      set({ jobs: [], loading: false, error: "Cron jobs not available with this backend" });
      return;
    }
    set({ loading: true, error: null });
    try {
      const jobs = await cronAdapter.list();
      set({ jobs, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadRuns: async (jobId?: string) => {
    const cronAdapter = getBackendAdapter().crons;
    if (!cronAdapter) {
      set({ runs: [] });
      return;
    }
    try {
      const runs = await cronAdapter.runs(jobId);
      set({ runs });
    } catch { /* ignore */ }
  },

  updateJob: async (id, patch) => {
    const cronAdapter = getBackendAdapter().crons;
    if (!cronAdapter) return;
    await cronAdapter.update(id, patch);
    await get().loadJobs();
  },

  removeJob: async (id) => {
    const cronAdapter = getBackendAdapter().crons;
    if (!cronAdapter) return;
    await cronAdapter.remove(id);
    await get().loadJobs();
  },

  runJob: async (id) => {
    const cronAdapter = getBackendAdapter().crons;
    if (!cronAdapter) return;
    await cronAdapter.run(id);
    await get().loadJobs();
  },
}));
