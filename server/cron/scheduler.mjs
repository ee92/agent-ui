import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { dispatch } from "../dispatcher.mjs";

const DATA_DIR = resolve(homedir(), ".agent-ui");
const JOBS_PATH = join(DATA_DIR, "crons.json");
const RUNS_PATH = join(DATA_DIR, "cron-runs.json");
const MAX_RUNS = 100;
const TICK_MS = 60_000;

let intervalHandle = null;
let ticking = false;
const runningJobs = new Set();

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(path, fallback) {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(path, value) {
  ensureDataDir();
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function parseSchedule(expr) {
  const text = typeof expr === "string" ? expr.trim() : "";

  const everyMinutes = text.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) {
    const n = Number(everyMinutes[1]);
    if (Number.isFinite(n) && n > 0) {
      return { kind: "everyMinutes", every: n };
    }
  }

  const dailyHour = text.match(/^0 (\d{1,2}) \* \* \*$/);
  if (dailyHour) {
    const hour = Number(dailyHour[1]);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
      return { kind: "dailyHour", hour };
    }
  }

  const everyHours = text.match(/^0 \*\/(\d+) \* \* \*$/);
  if (everyHours) {
    const n = Number(everyHours[1]);
    if (Number.isFinite(n) && n > 0) {
      return { kind: "everyHours", every: n };
    }
  }

  throw new Error(`Unsupported cron expression: ${text}`);
}

function matchesSchedule(schedule, date) {
  if (schedule.kind === "everyMinutes") {
    return date.getMinutes() % schedule.every === 0;
  }
  if (schedule.kind === "dailyHour") {
    return date.getMinutes() === 0 && date.getHours() === schedule.hour;
  }
  return date.getMinutes() === 0 && date.getHours() % schedule.every === 0;
}

function computeNextRunAt(expr, fromMs = Date.now()) {
  const schedule = parseSchedule(expr);
  const probe = new Date(fromMs);
  probe.setSeconds(0, 0);
  probe.setMinutes(probe.getMinutes() + 1);

  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (matchesSchedule(schedule, probe)) {
      return probe.toISOString();
    }
    probe.setMinutes(probe.getMinutes() + 1);
  }

  throw new Error(`Unable to compute next run for ${expr}`);
}

function normalizeJob(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw;
  if (typeof source.id !== "string" || !source.id.trim()) {
    return null;
  }
  if (typeof source.name !== "string" || !source.name.trim()) {
    return null;
  }
  if (typeof source.command !== "string" || !source.command.trim()) {
    return null;
  }

  const schedule = typeof source.schedule === "string" ? source.schedule.trim() : "";
  if (!schedule) {
    return null;
  }

  try {
    parseSchedule(schedule);
  } catch {
    return null;
  }

  return {
    id: source.id,
    name: source.name.trim(),
    description: typeof source.description === "string" ? source.description : undefined,
    enabled: source.enabled !== false,
    schedule,
    command: source.command,
    cwd: typeof source.cwd === "string" && source.cwd.trim() ? source.cwd.trim() : undefined,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : nowIso(),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : nowIso(),
    lastRunAt: typeof source.lastRunAt === "string" ? source.lastRunAt : undefined,
    lastRunStatus: source.lastRunStatus === "ok" || source.lastRunStatus === "error" ? source.lastRunStatus : undefined,
    lastError: typeof source.lastError === "string" ? source.lastError : undefined,
    nextRunAt: typeof source.nextRunAt === "string" ? source.nextRunAt : undefined,
  };
}

function loadJobs() {
  const rows = readJsonFile(JOBS_PATH, []);
  const jobs = [];
  for (const row of rows) {
    const normalized = normalizeJob(row);
    if (normalized) {
      jobs.push(normalized);
    }
  }
  return jobs;
}

function saveJobs(jobs) {
  writeJsonFile(JOBS_PATH, jobs);
}

function loadRuns() {
  return readJsonFile(RUNS_PATH, []);
}

function saveRuns(runs) {
  const capped = runs.slice(-MAX_RUNS);
  writeJsonFile(RUNS_PATH, capped);
}

function refreshNextRun(job, fromMs = Date.now(), force = false) {
  if (!job.enabled) {
    return { ...job, nextRunAt: undefined };
  }

  if (!force && typeof job.nextRunAt === "string") {
    const parsed = Date.parse(job.nextRunAt);
    if (Number.isFinite(parsed)) {
      return job;
    }
  }

  try {
    return { ...job, nextRunAt: computeNextRunAt(job.schedule, fromMs) };
  } catch (error) {
    return {
      ...job,
      lastRunStatus: "error",
      lastError: error instanceof Error ? error.message : String(error),
      nextRunAt: undefined,
      updatedAt: nowIso(),
    };
  }
}

function withUpdatedTimestamps(job, patch) {
  return {
    ...job,
    ...patch,
    updatedAt: nowIso(),
  };
}

function runCommand(job) {
  if (job.command.trim() === "@dispatch") {
    return dispatch().then((report) => ({
      status: "ok",
      summary: `Dispatched ${Array.isArray(report?.picked) ? report.picked.length : 0} task(s)`,
      durationMs: 0,
    })).catch((error) => ({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      summary: "Dispatcher run failed",
      durationMs: 0,
    }));
  }

  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const child = spawn(job.command, {
      cwd: job.cwd || process.cwd(),
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const append = (chunk) => {
      output += chunk.toString();
      if (output.length > 4000) {
        output = output.slice(output.length - 4000);
      }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    child.on("error", (error) => {
      const durationMs = Date.now() - startedAt;
      resolveRun({
        status: "error",
        error: error.message,
        summary: output.trim().slice(0, 500) || error.message,
        durationMs,
      });
    });

    child.on("close", (code, signal) => {
      const durationMs = Date.now() - startedAt;
      const ok = code === 0;
      resolveRun({
        status: ok ? "ok" : "error",
        error: ok ? undefined : `Process exited with code ${code}${signal ? ` (signal ${signal})` : ""}`,
        summary: output.trim().slice(0, 500) || (ok ? "Command completed" : "Command failed"),
        durationMs,
      });
    });
  });
}

function appendRun(entry) {
  const runs = loadRuns();
  runs.push(entry);
  saveRuns(runs);
}

async function executeJob(jobId) {
  if (runningJobs.has(jobId)) {
    return;
  }

  const jobs = loadJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index < 0) {
    throw new Error("Job not found");
  }

  const job = jobs[index];
  runningJobs.add(jobId);

  try {
    const result = await runCommand(job);
    const finishedAtIso = nowIso();
    const updated = refreshNextRun(
      withUpdatedTimestamps(job, {
        lastRunAt: finishedAtIso,
        lastRunStatus: result.status,
        lastError: result.error,
      }),
      Date.now(),
      true
    );

    jobs[index] = updated;
    saveJobs(jobs);

    appendRun({
      ts: Date.now(),
      jobId: job.id,
      jobName: job.name,
      status: result.status,
      error: result.error,
      summary: result.summary,
      durationMs: result.durationMs,
      nextRunAt: updated.nextRunAt,
    });
  } finally {
    runningJobs.delete(jobId);
  }
}

async function tick() {
  if (ticking) {
    return;
  }
  ticking = true;

  try {
    const nowMs = Date.now();
    const jobs = loadJobs();
    let changed = false;

    for (let i = 0; i < jobs.length; i += 1) {
      const job = jobs[i];
      const next = refreshNextRun(job, nowMs);
      if (next.nextRunAt !== job.nextRunAt || next.lastError !== job.lastError || next.lastRunStatus !== job.lastRunStatus) {
        jobs[i] = next;
        changed = true;
      }
    }

    if (changed) {
      saveJobs(jobs);
    }

    const dueJobs = jobs.filter((job) => {
      if (!job.enabled || !job.nextRunAt) {
        return false;
      }
      const dueAt = Date.parse(job.nextRunAt);
      return Number.isFinite(dueAt) && dueAt <= nowMs;
    });

    for (const job of dueJobs) {
      await executeJob(job.id);
    }
  } finally {
    ticking = false;
  }
}

export function listJobs() {
  const source = loadJobs();
  const jobs = source.map((job) => refreshNextRun(job));
  const changed = jobs.some((job, index) => job.nextRunAt !== source[index]?.nextRunAt);
  if (changed) {
    saveJobs(jobs);
  }
  return jobs;
}

export function getRuns(jobId) {
  const runs = loadRuns();
  const filtered = typeof jobId === "string" && jobId ? runs.filter((run) => run?.jobId === jobId) : runs;
  return [...filtered].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
}

export function createJob(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid job payload");
  }

  const now = nowIso();
  const candidate = normalizeJob({
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    enabled: input.enabled !== false,
  });

  if (!candidate) {
    throw new Error("Invalid job payload");
  }

  const jobs = loadJobs();
  const prepared = refreshNextRun(candidate, Date.now(), true);
  jobs.push(prepared);
  saveJobs(jobs);
  return prepared;
}

export function updateJob(id, patch) {
  const jobs = loadJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) {
    throw new Error("Job not found");
  }

  const current = jobs[index];
  const next = {
    ...current,
    ...(typeof patch === "object" && patch ? patch : {}),
    id: current.id,
    createdAt: current.createdAt,
  };

  const normalized = normalizeJob(withUpdatedTimestamps(next, {}));
  if (!normalized) {
    throw new Error("Invalid job patch");
  }

  jobs[index] = refreshNextRun(normalized, Date.now(), true);
  saveJobs(jobs);
  return jobs[index];
}

export function removeJob(id) {
  const jobs = loadJobs();
  const next = jobs.filter((job) => job.id !== id);
  if (next.length === jobs.length) {
    throw new Error("Job not found");
  }
  saveJobs(next);
}

export async function runJobNow(id) {
  await executeJob(id);
}

export function startScheduler() {
  if (intervalHandle) {
    return;
  }

  void tick();
  intervalHandle = setInterval(() => {
    void tick();
  }, TICK_MS);
}

export function stopScheduler() {
  if (!intervalHandle) {
    return;
  }
  clearInterval(intervalHandle);
  intervalHandle = null;
}
