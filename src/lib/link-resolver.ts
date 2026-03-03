/**
 * Link Resolver — derives relationships between entities using existing data.
 * No link database. All computed from conventions and field values.
 */

import type { TaskNode } from "./task-types";
import type { Conversation, AgentRun } from "./types";
import type { CronJob } from "./stores/cron-store";

export type EntityRef =
  | { kind: "task"; id: string; title: string; status: string }
  | { kind: "session"; key: string; title: string }
  | { kind: "project"; name: string; dir: string }
  | { kind: "cron"; id: string; name: string }
  | { kind: "agent"; id: string; label: string; status: string };

export type RepoInfo = { name: string; dir: string };

/**
 * Resolve file path → project name by checking which repo dir contains it.
 */
export function fileToProject(filePath: string, repos: RepoInfo[]): RepoInfo | null {
  // Sort by dir length descending so we match the most specific repo first
  const sorted = [...repos].sort((a, b) => b.dir.length - a.dir.length);
  for (const repo of sorted) {
    if (filePath.startsWith(repo.dir + "/") || filePath === repo.dir) {
      return repo;
    }
  }
  return null;
}

/**
 * Find all tasks linked to a specific session key.
 */
export function tasksForSession(tasks: TaskNode[], sessionKey: string): TaskNode[] {
  return tasks.filter((t) => t.sessionKey === sessionKey);
}

/**
 * Find all tasks linked to a specific project/repo.
 */
export function tasksForProject(tasks: TaskNode[], repoName: string): TaskNode[] {
  return tasks.filter((t) => t.repo === repoName);
}

/**
 * Find sessions linked to a specific project by checking session labels/keys for project name.
 */
export function sessionsForProject(conversations: Conversation[], repoName: string): Conversation[] {
  const lower = repoName.toLowerCase();
  return conversations.filter((c) => {
    const key = c.key.toLowerCase();
    const title = (c.title || "").toLowerCase();
    const derived = (c.derivedTitle || "").toLowerCase();
    return key.includes(lower) || title.includes(lower) || derived.includes(lower);
  });
}

/**
 * Find cron jobs linked to a session key pattern.
 */
export function cronsForSession(crons: CronJob[], sessionKeyPattern: string): CronJob[] {
  return crons.filter((c) => c.sessionKey?.includes(sessionKeyPattern));
}

/**
 * Find agents working on a specific session.
 */
export function agentsForSession(agents: AgentRun[], sessionKey: string): AgentRun[] {
  return agents.filter((a) => a.sessionKey === sessionKey);
}

/**
 * Build all related entities for a given task.
 */
export function relatedToTask(
  task: TaskNode,
  ctx: { conversations: Conversation[]; crons: CronJob[]; agents: AgentRun[]; tasks: TaskNode[] }
): EntityRef[] {
  const refs: EntityRef[] = [];

  // Linked session
  if (task.sessionKey) {
    const conv = ctx.conversations.find((c) => c.key === task.sessionKey);
    refs.push({ kind: "session", key: task.sessionKey, title: conv?.title || conv?.derivedTitle || task.sessionKey });
  }

  // Linked project
  if (task.repo) {
    refs.push({ kind: "project", name: task.repo, dir: "" });
  }

  // Active agents on the task's session
  if (task.sessionKey) {
    for (const agent of agentsForSession(ctx.agents, task.sessionKey)) {
      refs.push({ kind: "agent", id: agent.id, label: agent.label, status: agent.status });
    }
  }

  // Child tasks
  for (const child of ctx.tasks.filter((t) => t.parentId === task.id)) {
    refs.push({ kind: "task", id: child.id, title: child.title, status: child.status });
  }

  return refs;
}

/**
 * Build all related entities for a given project.
 */
export function relatedToProject(
  repoName: string,
  ctx: { tasks: TaskNode[]; conversations: Conversation[]; crons: CronJob[]; agents: AgentRun[] }
): EntityRef[] {
  const refs: EntityRef[] = [];

  // Tasks linked to this project
  for (const task of tasksForProject(ctx.tasks, repoName)) {
    if (task.status !== "done") {
      refs.push({ kind: "task", id: task.id, title: task.title, status: task.status });
    }
  }

  // Sessions mentioning this project
  for (const conv of sessionsForProject(ctx.conversations, repoName).slice(0, 5)) {
    refs.push({ kind: "session", key: conv.key, title: conv.title || conv.derivedTitle || conv.key });
  }

  // Cron jobs whose name/description mentions project
  const lower = repoName.toLowerCase();
  for (const cron of ctx.crons) {
    if (cron.name.toLowerCase().includes(lower) || (cron.description || "").toLowerCase().includes(lower)) {
      refs.push({ kind: "cron", id: cron.id, name: cron.name });
    }
  }

  return refs;
}

/**
 * Build all related entities for a given session.
 */
export function relatedToSession(
  sessionKey: string,
  ctx: { tasks: TaskNode[]; crons: CronJob[]; agents: AgentRun[]; conversations: Conversation[] }
): EntityRef[] {
  const refs: EntityRef[] = [];

  // Tasks linked to this session
  for (const task of tasksForSession(ctx.tasks, sessionKey)) {
    refs.push({ kind: "task", id: task.id, title: task.title, status: task.status });
  }

  // Active agents in this session
  for (const agent of agentsForSession(ctx.agents, sessionKey)) {
    refs.push({ kind: "agent", id: agent.id, label: agent.label, status: agent.status });
  }

  // Cron jobs that run in this session
  for (const cron of cronsForSession(ctx.crons, sessionKey)) {
    refs.push({ kind: "cron", id: cron.id, name: cron.name });
  }

  return refs;
}
