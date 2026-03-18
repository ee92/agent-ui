import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getRunStatus, startRun } from "./claude/run-manager.mjs";

const DISPATCHER_CONFIG_PATH = resolve(homedir(), ".agent-ui", "dispatcher.json");
const DEFAULT_CONFIG = {
  enabled: false,
  maxConcurrent: 1,
  statuses: ["todo"],
  promptTemplate: null,
};

let lastReport = null;
let defaultTasksPath = null;
const activeRunBySessionKey = new Map();

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function isChildOfTodo(task, byId) {
  let cursor = task;
  while (cursor?.parentId) {
    const parent = byId.get(cursor.parentId);
    if (!parent) {
      break;
    }
    if (parent.status === "todo") {
      return true;
    }
    cursor = parent;
  }
  return false;
}

function isBlocked(task, byId) {
  const deps = Array.isArray(task.blockedBy) ? task.blockedBy : [];
  return deps.some((depId) => byId.get(depId)?.status !== "done");
}

function hasActiveRun(task) {
  if (!task.sessionKey) {
    return false;
  }
  const runId = activeRunBySessionKey.get(task.sessionKey);
  if (!runId) {
    return false;
  }
  const status = getRunStatus(runId);
  return Boolean(status && status.status === "running");
}

function summarizeSkip(task, reason) {
  return { taskId: task.id, title: task.title, reason };
}

function updateTaskFromEvent(taskId, tasksPath, event) {
  if (!event || event.type !== "event") {
    return;
  }
  if (event.event !== "session.completed" && event.event !== "session.error") {
    return;
  }
  const file = readJson(tasksPath, { version: 2, tasks: [] });
  if (!Array.isArray(file.tasks)) {
    return;
  }
  const task = file.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    return;
  }

  const previous = task.status;
  if (event.event === "session.completed") {
    task.status = "review";
  } else {
    task.status = "blocked";
    const detail = event.payload?.message || event.payload?.stderr || "dispatcher run failed";
    task.notes = `${task.notes || ""}\n\n[dispatcher] ${String(detail)}`.trim();
  }
  task.updatedAt = nowIso();
  task.history = [...(task.history || []), { from: previous, to: task.status, at: task.updatedAt, by: "dispatcher" }];
  writeFileSync(tasksPath, JSON.stringify(file, null, 2), "utf8");
}

export function configureDispatcherRuntime(options = {}) {
  if (typeof options.tasksPath === "string" && options.tasksPath.trim()) {
    defaultTasksPath = options.tasksPath;
  }
}

export function loadDispatcherConfig() {
  return { ...DEFAULT_CONFIG, ...readJson(DISPATCHER_CONFIG_PATH, {}) };
}

export function saveDispatcherConfig(patch = {}) {
  const next = { ...loadDispatcherConfig(), ...(patch || {}) };
  writeJson(DISPATCHER_CONFIG_PATH, next);
  return next;
}

export function buildPrompt(task, config = {}) {
  if (typeof config.promptTemplate === "string" && config.promptTemplate.trim()) {
    return config.promptTemplate
      .replaceAll("{title}", task.title || "")
      .replaceAll("{description}", task.description || "")
      .replaceAll("{notes}", task.notes || "")
      .replaceAll("{repo}", task.repo || "not specified")
      .replaceAll("{branch}", task.branch || "not specified");
  }

  return [
    `You are working on task: ${task.title}`,
    "",
    `Description: ${task.description || ""}`,
    "",
    "Notes so far:",
    task.notes || "",
    "",
    `Repo: ${task.repo || "not specified"}`,
    `Branch: ${task.branch || "not specified"}`,
    "",
    "Instructions:",
    "- Work on this task to completion",
    "- When done, update the task status by writing to tasks.json or report what you've accomplished",
    "- If you're blocked or need human input, note what you need",
    "- If the task is too vague, break it down into subtasks",
  ].join("\n");
}

export async function dispatch(tasksPath, config = {}) {
  const resolvedTasksPath = typeof tasksPath === "string" && tasksPath.trim() ? tasksPath : defaultTasksPath;
  if (!resolvedTasksPath) {
    throw new Error("tasksPath is required");
  }

  const cfg = { ...loadDispatcherConfig(), ...config };
  if (!cfg.enabled && !cfg.force) {
    lastReport = { ts: Date.now(), at: nowIso(), picked: [], skipped: [{ reason: "dispatcher disabled" }], blocked: [] };
    return lastReport;
  }

  const file = readJson(resolvedTasksPath, { version: 2, tasks: [] });
  const tasks = Array.isArray(file.tasks) ? file.tasks : [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const taskStatuses = Array.isArray(cfg.statuses) && cfg.statuses.length > 0 ? cfg.statuses : DEFAULT_CONFIG.statuses;

  const eligible = [];
  const skipped = [];
  const blocked = [];

  for (const task of tasks) {
    if (!taskStatuses.includes(task.status)) {
      skipped.push(summarizeSkip(task, `status=${task.status}`));
      continue;
    }
    if (isChildOfTodo(task, byId)) {
      skipped.push(summarizeSkip(task, "parent todo"));
      continue;
    }
    if (isBlocked(task, byId)) {
      blocked.push(summarizeSkip(task, "blockedBy"));
      continue;
    }
    if (hasActiveRun(task)) {
      skipped.push(summarizeSkip(task, "active run"));
      continue;
    }
    eligible.push(task);
  }

  const maxConcurrent = Number.isFinite(cfg.maxConcurrent) ? Math.max(1, Number(cfg.maxConcurrent)) : 1;
  const selected = eligible.sort((a, b) => a.order - b.order).slice(0, maxConcurrent);

  const picked = [];
  for (const task of selected) {
    const from = task.status;
    const run = await startRun(task.sessionKey || `task-${task.id}`, buildPrompt(task, cfg), {
      onEvent: (event) => updateTaskFromEvent(task.id, resolvedTasksPath, event),
    });

    activeRunBySessionKey.set(run.sessionKey, run.runId);
    task.status = "active";
    task.sessionKey = run.sessionKey;
    task.sessionKeys = [...new Set([...(task.sessionKeys || []), run.sessionKey])];
    task.updatedAt = nowIso();
    task.history = [...(task.history || []), { from, to: "active", at: task.updatedAt, by: "dispatcher" }];
    picked.push({ taskId: task.id, title: task.title, runId: run.runId, sessionKey: run.sessionKey, acceptedAt: run.acceptedAt });
  }

  writeFileSync(resolvedTasksPath, JSON.stringify(file, null, 2), "utf8");
  lastReport = { ts: Date.now(), at: nowIso(), picked, skipped, blocked, maxConcurrent };
  return lastReport;
}

export function getDispatchStatus() {
  return lastReport;
}
