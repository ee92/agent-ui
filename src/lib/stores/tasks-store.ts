import { create } from "zustand";
import type { Task } from "../types";
import { useGatewayStore } from "./gateway-store";
import {
  TASKS_PATH,
  nowIso,
  persistFallbackTasks,
  priorityFromText,
  readFallbackTasks,
  requestFileMethod,
  safeJsonParse,
  serializeTasks,
  sortTasks,
  type TasksStoreState
} from "./shared";

async function persistTaskList(previous: Task[], next: Task[]) {
  persistFallbackTasks(next);
  const gateway = useGatewayStore.getState();
  const client = gateway.gatewayClient;
  if (!client || !client.isConnected()) {
    return { ok: true, fallback: true };
  }
  try {
    await requestFileMethod(client, "write", TASKS_PATH, serializeTasks(next), undefined);
    return { ok: true, fallback: false };
  } catch {
    persistFallbackTasks(previous);
    return { ok: false, fallback: true };
  }
}

export const useTasksStore = create<TasksStoreState>((set, get) => ({
  tasks: readFallbackTasks(),
  tasksReady: false,
  tasksFallback: true,
  activeTaskId: null,
  addTask: async (title) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    const task: Task = {
      id: `t_${crypto.randomUUID().slice(0, 8)}`,
      title: trimmed,
      description: "",
      status: "queue",
      priority: priorityFromText(trimmed),
      tags: [],
      agentSession: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null
    };
    const previous = get().tasks;
    const nextTasks = sortTasks([task, ...previous]);
    set({ tasks: nextTasks, activeTaskId: task.id });
    const result = await persistTaskList(previous, nextTasks);
    if (!result.ok) {
      set({ tasks: previous, activeTaskId: null, tasksFallback: true });
      return;
    }
    set({ tasksFallback: result.fallback });
  },
  updateTask: async (id, patch) => {
    const previous = get().tasks;
    const nextTasks = sortTasks(
      previous.flatMap((task) => {
        if (task.id !== id) {
          return task;
        }
        const nextStatus = patch.status ?? task.status;
        return {
          ...task,
          ...patch,
          status: nextStatus,
          updatedAt: nowIso(),
          completedAt:
            nextStatus === "done"
              ? task.completedAt ?? nowIso()
              : patch.completedAt === null
                ? null
                : task.completedAt
        };
      })
    );
    set({ tasks: nextTasks });
    const result = await persistTaskList(previous, nextTasks);
    set({ tasks: result.ok ? nextTasks : previous, tasksFallback: result.fallback });
  },
  moveTask: async (id, status, index) => {
    const previous = get().tasks;
    const moving = previous.find((task) => task.id === id);
    if (!moving) {
      return;
    }
    const remaining = previous.filter((task) => task.id !== id);
    const updatedTask: Task = {
      ...moving,
      status,
      updatedAt: nowIso(),
      completedAt: status === "done" ? moving.completedAt ?? nowIso() : null
    };
    const group = remaining.filter((task) => task.status === status);
    const others = remaining.filter((task) => task.status !== status);
    group.splice(Math.max(0, Math.min(index, group.length)), 0, updatedTask);
    const nextTasks = sortTasks([...others, ...group]);
    set({ tasks: nextTasks });
    const result = await persistTaskList(previous, nextTasks);
    set({ tasks: result.ok ? nextTasks : previous, tasksFallback: result.fallback });
  },
  setActiveTaskId: (id) => set({ activeTaskId: id }),
  loadTasks: async () => {
    const gateway = useGatewayStore.getState();
    const client = gateway.gatewayClient;
    if (!client || !client.isConnected()) {
      set({ tasks: readFallbackTasks(), tasksReady: true, tasksFallback: true });
      return;
    }
    try {
      const { data } = await requestFileMethod<unknown>(client, "read", TASKS_PATH, undefined, undefined);
      const parsed = safeJsonParse<{ version: 1; tasks: Task[] }>(
        typeof (data as { content?: unknown }).content === "string" ? String((data as { content: string }).content) : "",
        { version: 1, tasks: [] }
      );
      const filtered = parsed.tasks.filter((task) => {
        if (task.status !== "done" || !task.completedAt) {
          return true;
        }
        return Date.now() - Date.parse(task.completedAt) < 7 * 24 * 60 * 60 * 1000;
      });
      set({ tasks: sortTasks(filtered), tasksReady: true, tasksFallback: false });
    } catch {
      set({ tasks: readFallbackTasks(), tasksReady: true, tasksFallback: true });
    }
  },
  createTaskFromMessage: async (text) => {
    const title = text.split("\n")[0] || "New task";
    await get().addTask(title);
    const id = get().activeTaskId;
    if (id) {
      await get().updateTask(id, { description: text });
    }
  }
}));
