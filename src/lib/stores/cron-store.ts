import { create } from "zustand";
import { useGatewayStore } from "./gateway-store";

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string; staggerMs?: number };

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | { kind: "agentTurn"; message: string; model?: string; thinking?: string; deliver?: boolean; channel?: string; to?: string };

export type CronDelivery = {
  mode: "none" | "announce" | "webhook";
  channel?: string;
  to?: string;
  bestEffort?: boolean;
};

export type CronJobState = {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
};

export type CronJob = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: "main" | "isolated";
  wakeMode: "next-heartbeat" | "now";
  payload: CronPayload;
  delivery?: CronDelivery;
  state: CronJobState;
  sessionKey?: string;
  agentId?: string;
};

export type CronRunEntry = {
  ts: number;
  jobId: string;
  status?: string;
  error?: string;
  summary?: string;
  durationMs?: number;
  nextRunAtMs?: number;
  jobName?: string;
};

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
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) return;
    set({ loading: true, error: null });
    try {
      const res = await client.request<{ jobs?: CronJob[] }>("cron.list", {
        includeDisabled: true,
        limit: 100,
        sortBy: "nextRunAtMs",
        sortDir: "asc",
      });
      set({ jobs: Array.isArray(res.jobs) ? res.jobs : [], loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadRuns: async (jobId?: string) => {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) return;
    try {
      const params: Record<string, unknown> = { limit: 50, sortDir: "desc" };
      if (jobId) { params.jobId = jobId; params.scope = "job"; }
      const res = await client.request<{ runs?: CronRunEntry[] }>("cron.runs", params);
      set({ runs: Array.isArray(res.runs) ? res.runs : [] });
    } catch { /* ignore */ }
  },

  updateJob: async (id, patch) => {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) return;
    await client.request("cron.update", { id, patch });
    await get().loadJobs();
  },

  removeJob: async (id) => {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) return;
    await client.request("cron.remove", { id });
    await get().loadJobs();
  },

  runJob: async (id) => {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) return;
    await client.request("cron.run", { id, mode: "force" });
    await get().loadJobs();
  },
}));
