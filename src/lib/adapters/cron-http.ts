import type { CronAdapter, CronJob, CronRunEntry } from "./types";

type BuiltinCronJob = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: string;
  command: string;
  cwd?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: "ok" | "error";
  lastError?: string;
  nextRunAt?: string;
};

type BuiltinCronRun = {
  ts?: number;
  jobId?: string;
  jobName?: string;
  status?: string;
  error?: string;
  summary?: string;
  durationMs?: number;
  nextRunAt?: string;
};

function toMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fromBuiltinSchedule(expr: string): CronJob["schedule"] {
  const text = typeof expr === "string" ? expr.trim() : "";
  const everyMinutes = text.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) {
    const n = Number(everyMinutes[1]);
    if (Number.isFinite(n) && n > 0) {
      return { kind: "every", everyMs: n * 60_000 };
    }
  }

  const everyHours = text.match(/^0 \*\/(\d+) \* \* \*$/);
  if (everyHours) {
    const n = Number(everyHours[1]);
    if (Number.isFinite(n) && n > 0) {
      return { kind: "every", everyMs: n * 60 * 60_000 };
    }
  }

  return { kind: "cron", expr: text || "*/60 * * * *" };
}

function toBuiltinSchedule(schedule: unknown): string | undefined {
  if (!schedule || typeof schedule !== "object") {
    return undefined;
  }
  const source = schedule as Record<string, unknown>;
  if (source.kind === "cron" && typeof source.expr === "string" && source.expr.trim()) {
    return source.expr.trim();
  }

  if (source.kind === "every" && typeof source.everyMs === "number" && Number.isFinite(source.everyMs) && source.everyMs > 0) {
    const minutes = Math.max(1, Math.round(source.everyMs / 60_000));
    if (minutes % 60 === 0) {
      return `0 */${Math.max(1, Math.round(minutes / 60))} * * *`;
    }
    return `*/${minutes} * * * *`;
  }

  return undefined;
}

function commandFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const source = payload as Record<string, unknown>;
  if (source.kind === "systemEvent" && typeof source.text === "string") {
    return source.text;
  }
  if (source.kind === "agentTurn" && typeof source.message === "string") {
    return source.message;
  }
  return undefined;
}

function toCronJob(job: BuiltinCronJob): CronJob {
  const createdAtMs = toMs(job.createdAt) ?? Date.now();
  const updatedAtMs = toMs(job.updatedAt) ?? createdAtMs;
  return {
    id: job.id,
    name: job.name,
    description: job.description,
    enabled: job.enabled,
    createdAtMs,
    updatedAtMs,
    schedule: fromBuiltinSchedule(job.schedule),
    sessionTarget: "main",
    wakeMode: "now",
    payload: { kind: "systemEvent", text: job.command },
    state: {
      nextRunAtMs: toMs(job.nextRunAt),
      lastRunAtMs: toMs(job.lastRunAt),
      lastRunStatus: job.lastRunStatus,
      lastError: job.lastError,
    },
  };
}

function toCronRunEntry(run: BuiltinCronRun): CronRunEntry {
  return {
    ts: typeof run.ts === "number" ? run.ts : Date.now(),
    jobId: typeof run.jobId === "string" ? run.jobId : "",
    status: typeof run.status === "string" ? run.status : undefined,
    error: typeof run.error === "string" ? run.error : undefined,
    summary: typeof run.summary === "string" ? run.summary : undefined,
    durationMs: typeof run.durationMs === "number" ? run.durationMs : undefined,
    nextRunAtMs: toMs(run.nextRunAt),
    jobName: typeof run.jobName === "string" ? run.jobName : undefined,
  };
}

function toBuiltinPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  if (typeof patch.name === "string") {
    next.name = patch.name;
  }
  if (typeof patch.description === "string" || patch.description === undefined || patch.description === null) {
    next.description = typeof patch.description === "string" ? patch.description : undefined;
  }
  if (typeof patch.enabled === "boolean") {
    next.enabled = patch.enabled;
  }
  if (typeof patch.cwd === "string") {
    next.cwd = patch.cwd;
  }
  if (typeof patch.command === "string") {
    next.command = patch.command;
  }

  const schedule = toBuiltinSchedule(patch.schedule);
  if (schedule) {
    next.schedule = schedule;
  }

  const command = commandFromPayload(patch.payload);
  if (typeof command === "string") {
    next.command = command;
  }

  return next;
}

export class HttpCronAdapter implements CronAdapter {
  constructor(private readonly request: <T>(input: string, init?: RequestInit) => Promise<T>) {}

  async list(): Promise<CronJob[]> {
    const data = await this.request<{ jobs?: BuiltinCronJob[] }>("/api/crons");
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    return jobs.map(toCronJob);
  }

  async runs(jobId?: string): Promise<CronRunEntry[]> {
    const suffix = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
    const data = await this.request<{ runs?: BuiltinCronRun[] }>(`/api/crons/runs${suffix}`);
    const runs = Array.isArray(data.runs) ? data.runs : [];
    return runs.map(toCronRunEntry);
  }

  async update(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.request(`/api/crons/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(toBuiltinPatch(patch)),
    });
  }

  async remove(id: string): Promise<void> {
    await this.request(`/api/crons/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async run(id: string): Promise<void> {
    await this.request(`/api/crons/${encodeURIComponent(id)}/run`, {
      method: "POST",
    });
  }
}
