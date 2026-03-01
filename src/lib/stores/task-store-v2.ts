/**
 * Task store v2 — Workflowy-style nestable tasks.
 * Uses task-engine pure functions for all mutations.
 * Handles persistence to workspace/tasks.json via gateway or local API.
 */

import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import {
  createTask,
  deleteTask,
  deserialize,
  filterByStatus,
  flattenVisible,
  indentTask,
  moveTask,
  outdentTask,
  serialize,
  toggleCollapsed,
  updateTask,
  validate,
} from "../task-engine";
import type { TaskNode, TaskStatus } from "../task-types";
import { useGatewayStore } from "./gateway-store";

const TASKS_PATH = "workspace/tasks.json";
const LOCAL_KEY = "openclaw-ui-tasks-v2";
const DONE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

interface TaskStoreState {
  /** All tasks (flat array, tree via parentId) */
  tasks: TaskNode[];
  /** Has initial load completed? */
  ready: boolean;
  /** Are we using localStorage fallback? */
  fallback: boolean;
  /** Currently focused task ID (for inline editing) */
  focusedId: string | null;
  /** Active status filter, null = show all */
  statusFilter: TaskStatus[] | null;
  /** Persisting in progress */
  saving: boolean;
  /** Last save error */
  saveError: string | null;

  // ─── Actions ─────────────────────────────────────────
  load: () => Promise<void>;
  add: (title: string, parentId?: string | null, opts?: Partial<Pick<TaskNode, "notes" | "repo" | "branch" | "sessionKey">>) => Promise<string>;
  update: (id: string, patch: Partial<Omit<TaskNode, "id" | "createdAt">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  move: (id: string, newParentId: string | null, beforeId?: string | null) => Promise<void>;
  indent: (id: string) => Promise<void>;
  outdent: (id: string) => Promise<void>;
  toggle: (id: string) => void;
  setFocus: (id: string | null) => void;
  setStatusFilter: (statuses: TaskStatus[] | null) => void;

  // ─── Derived (computed in selectors, not stored) ─────
}

// ─── Persistence helpers ──────────────────────────────────

function saveLocal(tasks: TaskNode[]) {
  try {
    localStorage.setItem(LOCAL_KEY, serialize(tasks));
  } catch { /* quota exceeded, ignore */ }
}

function loadLocal(): TaskNode[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
      // Try migrating from v1 key
      const v1 = localStorage.getItem("openclaw-ui-tasks-v1");
      if (v1) return deserialize(v1);
      return [];
    }
    return deserialize(raw);
  } catch {
    return [];
  }
}

async function saveRemote(tasks: TaskNode[]): Promise<boolean> {
  try {
    const token = useGatewayStore.getState().gatewayToken;
    const res = await fetch("/api/files/write", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ path: TASKS_PATH, content: serialize(tasks) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function loadRemote(): Promise<TaskNode[] | null> {
  try {
    const token = useGatewayStore.getState().gatewayToken;
    const res = await fetch(`/api/files/read?path=${encodeURIComponent(TASKS_PATH)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content: string };
    return deserialize(data.content);
  } catch {
    return null;
  }
}

function pruneOldDone(tasks: TaskNode[]): TaskNode[] {
  const cutoff = Date.now() - DONE_RETENTION_MS;
  return tasks.filter((t) => {
    if (t.status !== "done" || !t.completedAt) return true;
    return Date.parse(t.completedAt) > cutoff;
  });
}

// ─── Store ────────────────────────────────────────────────

export const useTaskStore = create<TaskStoreState>((set, get) => {
  /** Persist tasks to both local and remote, update state */
  async function persist(tasks: TaskNode[]) {
    saveLocal(tasks);
    set({ saving: true, saveError: null });
    const ok = await saveRemote(tasks);
    set({ saving: false, fallback: !ok, saveError: ok ? null : "Failed to save" });
  }

  return {
    tasks: loadLocal(),
    ready: false,
    fallback: true,
    focusedId: null,
    statusFilter: null,
    saving: false,
    saveError: null,

    load: async () => {
      const remote = await loadRemote();
      if (remote !== null) {
        const { valid } = validate(remote);
        const tasks = valid ? pruneOldDone(remote) : loadLocal();
        set({ tasks, ready: true, fallback: !valid });
        saveLocal(tasks);
      } else {
        set({ tasks: loadLocal(), ready: true, fallback: true });
      }
    },

    add: async (title, parentId = null, opts = {}) => {
      const { tasks: next, created } = createTask(get().tasks, title, parentId, opts);
      set({ tasks: next, focusedId: created.id });
      await persist(next);
      return created.id;
    },

    update: async (id, patch) => {
      const next = updateTask(get().tasks, id, patch);
      set({ tasks: next });
      await persist(next);
    },

    remove: async (id) => {
      const next = deleteTask(get().tasks, id);
      set({ tasks: next, focusedId: get().focusedId === id ? null : get().focusedId });
      await persist(next);
    },

    move: async (id, newParentId, beforeId = null) => {
      const next = moveTask(get().tasks, id, newParentId, beforeId);
      set({ tasks: next });
      await persist(next);
    },

    indent: async (id) => {
      const next = indentTask(get().tasks, id);
      set({ tasks: next });
      await persist(next);
    },

    outdent: async (id) => {
      const next = outdentTask(get().tasks, id);
      set({ tasks: next });
      await persist(next);
    },

    toggle: (id) => {
      const next = toggleCollapsed(get().tasks, id);
      set({ tasks: next });
      // Don't persist collapsed state to remote — it's UI-only
      saveLocal(next);
    },

    setFocus: (id) => set({ focusedId: id }),
    setStatusFilter: (statuses) => set({ statusFilter: statuses }),
  };
});

// ─── Selectors (use these in components) ──────────────────

/** Get the visible flat list for rendering */
export function useVisibleTasks() {
  const tasks = useTaskStore((s) => s.tasks);
  const statusFilter = useTaskStore((s) => s.statusFilter);
  return useMemo(() => {
    const filtered = statusFilter ? filterByStatus(tasks, statusFilter) : tasks;
    return flattenVisible(filtered);
  }, [tasks, statusFilter]);
}

/** Get count of tasks needing review */
export function useReviewCount() {
  return useTaskStore((s) => s.tasks.filter((t) => t.status === "review").length);
}

/** Get count of blocked tasks */
export function useBlockedCount() {
  return useTaskStore((s) => s.tasks.filter((t) => t.status === "blocked").length);
}
