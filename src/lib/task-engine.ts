/**
 * Task engine — pure functions for manipulating the task tree.
 * No side effects, no persistence, no UI. Just data transforms.
 * The store calls these and handles persistence separately.
 */

import type { TaskNode, TasksFile, TaskStatus } from "./task-types";

// ─── ID Generation ───────────────────────────────────────────────

export function generateTaskId(): string {
  return `t_${crypto.randomUUID().slice(0, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ─── Tree Operations ─────────────────────────────────────────────

/** Get direct children of a parent, sorted by order */
export function getChildren(tasks: TaskNode[], parentId: string | null): TaskNode[] {
  return tasks
    .filter((t) => t.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

/** Get all descendant IDs (recursive) */
export function getDescendantIds(tasks: TaskNode[], parentId: string): string[] {
  const ids: string[] = [];
  const queue = [parentId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const children = tasks.filter((t) => t.parentId === current);
    for (const child of children) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

/** Get ancestor chain from task to root (bottom-up) */
export function getAncestors(tasks: TaskNode[], taskId: string): TaskNode[] {
  const ancestors: TaskNode[] = [];
  let current = tasks.find((t) => t.id === taskId);
  while (current?.parentId) {
    const parent = tasks.find((t) => t.id === current!.parentId);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

/** Check if a task has children */
export function hasChildren(tasks: TaskNode[], taskId: string): boolean {
  return tasks.some((t) => t.parentId === taskId);
}

/** Count children (direct only) */
export function childCount(tasks: TaskNode[], taskId: string): number {
  return tasks.filter((t) => t.parentId === taskId).length;
}

/** Get the depth of a task (0 = root level) */
export function getDepth(tasks: TaskNode[], taskId: string): number {
  return getAncestors(tasks, taskId).length;
}

/** Compute next order value for a new sibling under parentId */
export function nextOrder(tasks: TaskNode[], parentId: string | null): number {
  const siblings = getChildren(tasks, parentId);
  if (siblings.length === 0) return 1;
  return siblings[siblings.length - 1].order + 1;
}

/** Compute order value to insert between two siblings */
export function orderBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return after! - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

// ─── CRUD Operations ─────────────────────────────────────────────

/** Create a new task */
export function createTask(
  tasks: TaskNode[],
  title: string,
  parentId: string | null = null,
  opts: Partial<Pick<TaskNode, "notes" | "repo" | "branch" | "sessionKey">> = {}
): { tasks: TaskNode[]; created: TaskNode } {
  const task: TaskNode = {
    id: generateTaskId(),
    title: title.trim(),
    description: "",
    notes: opts.notes ?? "",
    status: "todo",
    parentId,
    order: nextOrder(tasks, parentId),
    collapsed: false,
    sessionKey: opts.sessionKey ?? null,
    repo: opts.repo ?? null,
    branch: opts.branch ?? null,
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
  };
  return { tasks: [...tasks, task], created: task };
}

/** Update a task's fields */
export function updateTask(
  tasks: TaskNode[],
  id: string,
  patch: Partial<Omit<TaskNode, "id" | "createdAt">>
): TaskNode[] {
  return tasks.map((t) => {
    if (t.id !== id) return t;
    const updated = { ...t, ...patch, updatedAt: now() };
    // Auto-set completedAt
    if (patch.status === "done" && !t.completedAt) {
      updated.completedAt = now();
    } else if (patch.status && patch.status !== "done") {
      updated.completedAt = null;
    }
    return updated;
  });
}

/** Delete a task and all its descendants */
export function deleteTask(tasks: TaskNode[], id: string): TaskNode[] {
  const toRemove = new Set([id, ...getDescendantIds(tasks, id)]);
  return tasks.filter((t) => !toRemove.has(t.id));
}

/** Move a task to a new parent and/or position */
export function moveTask(
  tasks: TaskNode[],
  id: string,
  newParentId: string | null,
  beforeId: string | null = null
): TaskNode[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return tasks;

  // Prevent moving a task into its own subtree
  if (newParentId !== null) {
    const descIds = getDescendantIds(tasks, id);
    if (descIds.includes(newParentId)) return tasks;
  }

  const siblings = getChildren(tasks, newParentId).filter((t) => t.id !== id);
  let newOrder: number;

  if (beforeId === null) {
    // Move to end
    newOrder = nextOrder(tasks, newParentId);
  } else {
    const beforeTask = siblings.find((t) => t.id === beforeId);
    if (!beforeTask) {
      newOrder = nextOrder(tasks, newParentId);
    } else {
      const idx = siblings.indexOf(beforeTask);
      const prevOrder = idx > 0 ? siblings[idx - 1].order : null;
      newOrder = orderBetween(prevOrder, beforeTask.order);
    }
  }

  return updateTask(tasks, id, { parentId: newParentId, order: newOrder });
}

/** Indent: make a task a child of the sibling above it */
export function indentTask(tasks: TaskNode[], id: string): TaskNode[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return tasks;

  const siblings = getChildren(tasks, task.parentId);
  const idx = siblings.findIndex((t) => t.id === id);
  if (idx <= 0) return tasks; // Can't indent first child

  const newParent = siblings[idx - 1];
  return moveTask(tasks, id, newParent.id);
}

/** Outdent: move a task up to its grandparent level */
export function outdentTask(tasks: TaskNode[], id: string): TaskNode[] {
  const task = tasks.find((t) => t.id === id);
  if (!task || task.parentId === null) return tasks; // Already at root

  const parent = tasks.find((t) => t.id === task.parentId);
  if (!parent) return tasks;

  // Place after the parent in the grandparent's children
  const grandparentChildren = getChildren(tasks, parent.parentId);
  const parentIdx = grandparentChildren.findIndex((t) => t.id === parent.id);
  const afterParent = grandparentChildren[parentIdx + 1]?.id ?? null;

  return moveTask(tasks, id, parent.parentId, afterParent);
}

/** Toggle collapsed state */
export function toggleCollapsed(tasks: TaskNode[], id: string): TaskNode[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return tasks;
  return updateTask(tasks, id, { collapsed: !task.collapsed });
}

// ─── Queries ─────────────────────────────────────────────────────

/** Get all tasks needing review (for "your attention" view) */
export function needsReview(tasks: TaskNode[]): TaskNode[] {
  return tasks.filter((t) => t.status === "review");
}

/** Get all blocked tasks */
export function blockedTasks(tasks: TaskNode[]): TaskNode[] {
  return tasks.filter((t) => t.status === "blocked");
}

/** Get all todo tasks (available for pickup) */
export function availableTasks(tasks: TaskNode[]): TaskNode[] {
  return tasks.filter((t) => t.status === "todo");
}

/** Get tasks linked to a specific session */
export function tasksBySession(tasks: TaskNode[], sessionKey: string): TaskNode[] {
  return tasks.filter((t) => t.sessionKey === sessionKey);
}

/** Get tasks linked to a specific repo */
export function tasksByRepo(tasks: TaskNode[], repo: string): TaskNode[] {
  return tasks.filter((t) => t.repo === repo);
}

/** Build flattened visible list for rendering (respects collapsed state) */
export function flattenVisible(tasks: TaskNode[], parentId: string | null = null, depth = 0): Array<TaskNode & { depth: number }> {
  const children = getChildren(tasks, parentId);
  const result: Array<TaskNode & { depth: number }> = [];
  for (const child of children) {
    result.push({ ...child, depth });
    if (!child.collapsed) {
      result.push(...flattenVisible(tasks, child.id, depth + 1));
    }
  }
  return result;
}

/** Filter tasks by status, preserving tree structure (show parents of matching tasks) */
export function filterByStatus(tasks: TaskNode[], statuses: TaskStatus[]): TaskNode[] {
  const matching = new Set<string>();
  for (const task of tasks) {
    if (statuses.includes(task.status)) {
      matching.add(task.id);
      // Include all ancestors so tree structure is preserved
      for (const ancestor of getAncestors(tasks, task.id)) {
        matching.add(ancestor.id);
      }
    }
  }
  return tasks.filter((t) => matching.has(t.id));
}

// ─── Persistence ─────────────────────────────────────────────────

export function serialize(tasks: TaskNode[]): string {
  const file: TasksFile = { version: 2, tasks };
  return JSON.stringify(file, null, 2);
}

export function deserialize(raw: string): TaskNode[] {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];

    // Handle v1 format migration
    if (parsed.version === 1 && Array.isArray(parsed.tasks)) {
      return parsed.tasks.map((t: Record<string, unknown>) => migrateV1Task(t));
    }

    if (parsed.version === 2 && Array.isArray(parsed.tasks)) {
      // Backfill optional fields for backwards compatibility
      return parsed.tasks.map((t: TaskNode) => ({
        ...t,
        description: t.description ?? "",
        history: t.history ?? [],
      }));
    }

    return [];
  } catch {
    return [];
  }
}

/** Migrate a v1 task to v2 format */
function migrateV1Task(v1: Record<string, unknown>): TaskNode {
  const statusMap: Record<string, TaskStatus> = {
    queue: "todo",
    active: "active",
    done: "done",
  };
  return {
    id: String(v1.id ?? generateTaskId()),
    title: String(v1.title ?? "Untitled"),
    description: "",
    notes: String(v1.description ?? ""),
    status: statusMap[String(v1.status)] ?? "todo",
    parentId: null,
    order: 1,
    collapsed: false,
    sessionKey: typeof v1.agentSession === "string" ? v1.agentSession : null,
    repo: null,
    branch: null,
    createdAt: String(v1.createdAt ?? new Date().toISOString()),
    updatedAt: String(v1.updatedAt ?? new Date().toISOString()),
    completedAt: typeof v1.completedAt === "string" ? v1.completedAt : null,
  };
}

// ─── Validation ──────────────────────────────────────────────────

/** Check tree integrity — no orphans, no cycles */
export function validate(tasks: TaskNode[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(tasks.map((t) => t.id));

  for (const task of tasks) {
    // Check for orphaned parentId references
    if (task.parentId !== null && !ids.has(task.parentId)) {
      errors.push(`Task ${task.id} references missing parent ${task.parentId}`);
    }
    // Check for duplicate IDs
    if (tasks.filter((t) => t.id === task.id).length > 1) {
      errors.push(`Duplicate task ID: ${task.id}`);
    }
  }

  // Check for cycles
  for (const task of tasks) {
    const visited = new Set<string>();
    let current: TaskNode | undefined = task;
    while (current?.parentId) {
      if (visited.has(current.id)) {
        errors.push(`Cycle detected involving task ${task.id}`);
        break;
      }
      visited.add(current.id);
      current = tasks.find((t) => t.id === current!.parentId);
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
