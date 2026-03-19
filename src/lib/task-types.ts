/**
 * Task system types — Workflowy-style infinitely nestable task list.
 *
 * Design principles:
 * - Flat storage, tree rendering (parentId references)
 * - Order is explicit via `order` field (fractional indexing)
 * - Status flows: todo → active → review → done (or blocked at any point)
 * - Minimal fields — no priority levels, no due dates. Order IS priority.
 * - sessionKey links to where work happened. repo/branch link to code.
 */

/** Task status — 5 states, color-coded in UI */
export type TaskStatus = "todo" | "plan" | "active" | "review" | "blocked" | "done";

/** A state transition record */
export interface TaskTransition {
  /** Previous status */
  from: TaskStatus;
  /** New status */
  to: TaskStatus;
  /** ISO timestamp */
  at: string;
  /** Who triggered it (agent session key, "egor", etc.) */
  by?: string;
}

/** A single task node in the tree */
export interface TaskNode {
  /** Unique ID, format: t_{8-char-hex} */
  readonly id: string;
  /** Human-readable title, single line */
  title: string;
  /** What the task IS — written once, stable context */
  description: string;
  /** Append-only work diary (progress updates, status change reasons) */
  notes: string;
  /** Current status */
  status: TaskStatus;
  /** Parent task ID, or null for root-level */
  parentId: string | null;
  /** Sort order among siblings. Lower = higher in list. */
  order: number;
  /** Whether children are collapsed in UI */
  collapsed: boolean;
  /** Linked session key (where work is happening) — legacy single key */
  sessionKey: string | null;
  /** All session keys that have worked on this task */
  sessionKeys?: string[];
  /** Task IDs that must be done before this task can be picked up */
  blockedBy?: string[];
  /** Linked git repo name (e.g. "my-project") */
  repo: string | null;
  /** Linked git branch */
  branch: string | null;
  /** ISO timestamps */
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** State transition history */
  history?: TaskTransition[];
}

/** Persisted file format */
export interface TasksFile {
  version: 2;
  tasks: TaskNode[];
}

/** Status metadata for UI rendering */
export const TASK_STATUS_META: Record<
  TaskStatus,
  { label: string; dot: string; description: string }
> = {
  todo: { label: "To Do", dot: "bg-zinc-500", description: "Not started" },
  plan: { label: "Plan", dot: "bg-violet-400", description: "Awaiting plan approval" },
  active: { label: "Active", dot: "bg-blue-400", description: "In progress" },
  review: { label: "Review", dot: "bg-amber-400", description: "Needs attention" },
  blocked: { label: "Blocked", dot: "bg-red-400", description: "Waiting on something" },
  done: { label: "Done", dot: "bg-emerald-400", description: "Complete" },
};

/** Valid status transitions */
export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ["active", "plan", "done"],
  plan: ["active", "todo"],
  active: ["review", "blocked", "done"],
  review: ["active", "done"],
  blocked: ["active", "todo"],
  done: ["todo", "active"],
};
