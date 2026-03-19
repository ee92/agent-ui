import { useEffect, useMemo, useRef, useState } from "react";
import { getChildren } from "../../lib/task-engine";
import type { TaskNode, TaskStatus } from "../../lib/task-types";
import { TASK_STATUS_META, TASK_TRANSITIONS } from "../../lib/task-types";
import { useBlockedCount, useReviewCount, useTaskStore } from "../../lib/stores/task-store-v2";
import { ChatIcon, TaskIcon } from "../ui/icons";

type VisibleTask = TaskNode & { depth: number };
type FilterKey = "all" | "review" | "blocked" | "active" | "done";
type ContextMenuState = { taskId: string; x: number; y: number } | null;
type DropPosition = "before" | "after" | "inside" | "list-end";
type DropHint = { targetId: string | null; position: DropPosition } | null;
type TaskEditDraft = {
  title: string;
  notes: string;
  status: TaskStatus;
  repo: string;
  branch: string;
};

const FILTERS: Array<{ key: FilterKey; label: string; statuses: TaskStatus[] | null; count?: "review" | "blocked" }> = [
  { key: "all", label: "All", statuses: null },
  { key: "review", label: "Review", statuses: ["review"], count: "review" },
  { key: "blocked", label: "Blocked", statuses: ["blocked"], count: "blocked" },
  { key: "active", label: "Active", statuses: ["active"] },
  { key: "done", label: "Done", statuses: ["done"] }
];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 transition-all duration-150 ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function GitBranchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10-5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
      <path d="M7 9v6" />
      <path d="M9 7h4a4 4 0 0 1 4 4" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <circle cx="8" cy="6" r="1.4" />
      <circle cx="8" cy="12" r="1.4" />
      <circle cx="8" cy="18" r="1.4" />
      <circle cx="16" cy="6" r="1.4" />
      <circle cx="16" cy="12" r="1.4" />
      <circle cx="16" cy="18" r="1.4" />
    </svg>
  );
}

function getActiveFilterKey(statusFilter: TaskStatus[] | null): FilterKey {
  if (!statusFilter || statusFilter.length === 0) {
    return "all";
  }
  if (statusFilter.length === 1) {
    const [status] = statusFilter;
    if (status === "review" || status === "blocked" || status === "active" || status === "done") {
      return status;
    }
  }
  return "all";
}

function getNextStatus(status: TaskStatus) {
  return TASK_TRANSITIONS[status][0] ?? status;
}

function getSwipeStatus(status: TaskStatus) {
  if (status === "done") {
    return null;
  }
  return TASK_TRANSITIONS[status].includes("done") ? "done" : (TASK_TRANSITIONS[status][0] ?? null);
}

function createEditDraft(task: TaskNode): TaskEditDraft {
  return {
    title: task.title,
    notes: task.notes,
    status: task.status,
    repo: task.repo ?? "",
    branch: task.branch ?? ""
  };
}

export function TaskList({
  tasks,
  visibleTasks,
  currentSessionKey,
  onOpenSession
}: {
  tasks: TaskNode[];
  visibleTasks: VisibleTask[];
  currentSessionKey: string | null;
  onOpenSession: (key: string) => void;
}) {
  const reviewCount = useReviewCount();
  const blockedCount = useBlockedCount();
  const focusedId = useTaskStore((state) => state.focusedId);
  const statusFilter = useTaskStore((state) => state.statusFilter);
  const addTask = useTaskStore((state) => state.add);
  const updateTask = useTaskStore((state) => state.update);
  const removeTask = useTaskStore((state) => state.remove);
  const moveTask = useTaskStore((state) => state.move);
  const indentTask = useTaskStore((state) => state.indent);
  const outdentTask = useTaskStore((state) => state.outdent);
  const toggleTask = useTaskStore((state) => state.toggle);
  const setFocus = useTaskStore((state) => state.setFocus);
  const setStatusFilter = useTaskStore((state) => state.setStatusFilter);

  const [draft, setDraft] = useState("");
  const [draftParentId, setDraftParentId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<TaskEditDraft | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint>(null);

  const editingInputRef = useRef<HTMLInputElement | null>(null);
  const notesInputRef = useRef<HTMLTextAreaElement | null>(null);
  const editingPanelRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const gestureRef = useRef<{
    taskId: string | null;
    startX: number;
    startY: number;
    pointerType: string;
    longPress: boolean;
    timer: number | null;
  }>({
    taskId: null,
    startX: 0,
    startY: 0,
    pointerType: "",
    longPress: false,
    timer: null
  });

  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      counts.set(task.id, 0);
    }
    for (const task of tasks) {
      if (task.parentId) {
        counts.set(task.parentId, (counts.get(task.parentId) ?? 0) + 1);
      }
    }
    return counts;
  }, [tasks]);
  const activeFilterKey = getActiveFilterKey(statusFilter);

  useEffect(() => {
    if (editingId) {
      editingInputRef.current?.focus();
      editingInputRef.current?.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!editingDraft || !notesInputRef.current) {
      return;
    }
    notesInputRef.current.style.height = "0px";
    notesInputRef.current.style.height = `${notesInputRef.current.scrollHeight}px`;
  }, [editingDraft?.notes]);

  useEffect(() => {
    if (!editingId) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      finishEditing(false);
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [editingId, editingDraft]);

  useEffect(() => {
    if (draftParentId && !tasksById.has(draftParentId)) {
      setDraftParentId(null);
    }
  }, [draftParentId, tasksById]);

  useEffect(() => {
    if (editingId && !tasksById.has(editingId)) {
      setEditingId(null);
      setEditingDraft(null);
    }
  }, [editingId, tasksById]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!focusedId || editingId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if (isTypingTarget) {
        return;
      }

      const focusedTask = tasksById.get(focusedId);
      if (!focusedTask) {
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey) {
          void outdentTask(focusedId);
        } else {
          void indentTask(focusedId);
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        void (async () => {
          const parentId = event.shiftKey ? focusedTask.id : focusedTask.parentId;
          const beforeId = !event.shiftKey
            ? getChildren(tasks, focusedTask.parentId).find((task, index, siblings) => siblings[index - 1]?.id === focusedTask.id)?.id ?? null
            : null;
          const createdId = await addTask("New task", parentId);
          if (beforeId) {
            await moveTask(createdId, parentId, beforeId);
          }
          setFocus(createdId);
          setEditingId(createdId);
          setEditingDraft({ title: "New task", notes: "", status: "todo", repo: "", branch: "" });
        })();
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const index = visibleTasks.findIndex((task) => task.id === focusedId);
        if (index === -1) {
          return;
        }
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = visibleTasks[index + delta];
        if (!next) {
          return;
        }
        setFocus(next.id);
        rowRefs.current.get(next.id)?.focus();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setFocus(null);
        rowRefs.current.get(focusedId)?.blur();
        return;
      }

      if (event.key === "Backspace" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void removeTask(focusedId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addTask, editingId, focusedId, indentTask, moveTask, outdentTask, removeTask, setFocus, tasks, tasksById, visibleTasks]);

  const focusTask = (taskId: string) => {
    setFocus(taskId);
    rowRefs.current.get(taskId)?.focus();
  };

  const beginEditing = (task: TaskNode) => {
    setContextMenu(null);
    setFocus(task.id);
    setEditingId(task.id);
    setEditingDraft(createEditDraft(task));
  };

  const finishEditing = (save: boolean) => {
    const targetId = editingId;
    const currentDraft = editingDraft;
    setEditingId(null);
    setEditingDraft(null);

    if (!save || !targetId || !currentDraft) {
      return;
    }

    const existing = tasksById.get(targetId);
    if (!existing) {
      return;
    }

    const nextTitle = currentDraft.title.trim() || existing.title;
    const nextNotes = currentDraft.notes;
    const nextRepo = currentDraft.repo.trim() || null;
    const nextBranch = currentDraft.branch.trim() || null;
    const patch: Partial<Omit<TaskNode, "id" | "createdAt">> = {};

    if (existing.title !== nextTitle) {
      patch.title = nextTitle;
    }
    if (existing.notes !== nextNotes) {
      patch.notes = nextNotes;
    }
    if (existing.status !== currentDraft.status) {
      patch.status = currentDraft.status;
    }
    if (existing.repo !== nextRepo) {
      patch.repo = nextRepo;
    }
    if (existing.branch !== nextBranch) {
      patch.branch = nextBranch;
    }

    if (Object.keys(patch).length > 0) {
      void updateTask(targetId, patch);
    }
  };

  const cycleStatus = (task: TaskNode) => {
    const nextStatus = getNextStatus(task.status);
    if (nextStatus !== task.status) {
      void updateTask(task.id, { status: nextStatus });
    }
  };

  const submitQuickAdd = () => {
    const title = draft.trim();
    if (!title) {
      return;
    }
    void addTask(title, draftParentId);
    setDraft("");
  };

  const clearGesture = () => {
    if (gestureRef.current.timer !== null) {
      window.clearTimeout(gestureRef.current.timer);
    }
    gestureRef.current.timer = null;
    gestureRef.current.longPress = false;
    gestureRef.current.taskId = null;
  };

  const openMenu = (taskId: string, x: number, y: number) => {
    setContextMenu({ taskId, x, y });
    focusTask(taskId);
  };

  const resolveDropIntent = (event: React.DragEvent<HTMLDivElement>): DropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    if (offsetY < rect.height * 0.3) {
      return "before";
    }
    if (offsetY > rect.height * 0.7) {
      return "after";
    }
    return "inside";
  };

  const resolveDropTarget = (target: VisibleTask, position: DropPosition): { newParentId: string | null; beforeId: string | null } => {
    if (position === "inside") {
      return { newParentId: target.id, beforeId: null };
    }

    const siblings = getChildren(tasks, target.parentId);
    const targetIndex = siblings.findIndex((item) => item.id === target.id);

    if (position === "before") {
      return { newParentId: target.parentId, beforeId: target.id };
    }

    const nextSibling = targetIndex >= 0 ? siblings[targetIndex + 1] : null;
    return { newParentId: target.parentId, beforeId: nextSibling?.id ?? null };
  };

  const handleDropOnTask = (target: VisibleTask, position: DropPosition) => {
    if (!draggingId || draggingId === target.id) {
      setDropHint(null);
      return;
    }

    const { newParentId, beforeId } = resolveDropTarget(target, position);
    void moveTask(draggingId, newParentId, beforeId);
    setDraggingId(null);
    setDropHint(null);
  };

  const contextTask = contextMenu ? tasksById.get(contextMenu.taskId) ?? null : null;
  const draftParent = draftParentId ? tasksById.get(draftParentId) ?? null : null;

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-hidden">
      <div className="rounded-xl border border-white/5 bg-zinc-900/90 p-4">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const count = filter.count === "review" ? reviewCount : filter.count === "blocked" ? blockedCount : null;
            const active = filter.key === activeFilterKey;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setStatusFilter(filter.statuses)}
                className={`inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-sm transition-all duration-150 ${
                  active ? "bg-blue-400/15 text-blue-400" : "bg-black/30 text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                }`}
              >
                <span>{filter.label}</span>
                {typeof count === "number" ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-blue-400/20" : "bg-white/5"}`}>{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="mt-4">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitQuickAdd();
              }
              if (event.key === "Tab") {
                event.preventDefault();
                if (event.shiftKey) {
                  setDraftParentId((current) => {
                    if (!current) {
                      return null;
                    }
                    return tasksById.get(current)?.parentId ?? null;
                  });
                } else if (visibleTasks.length > 0) {
                  setDraftParentId(visibleTasks[visibleTasks.length - 1]?.id ?? null);
                }
              }
            }}
            placeholder="Add a task..."
            className="h-12 w-full rounded-xl bg-black/30 px-4 text-sm text-zinc-100 outline-none transition-all duration-150 placeholder:text-zinc-500 focus:bg-black/40 focus:ring-1 focus:ring-blue-400/40"
          />
          {draftParent ? (
            <p className="mt-2 text-xs text-zinc-500">
              Adding under <span className="text-zinc-300">{draftParent.title}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/5 bg-zinc-900/90 p-3">
        {tasks.length === 0 ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center text-zinc-500">
            <div className="rounded-full bg-white/5 p-3 text-zinc-400">
              <TaskIcon />
            </div>
            <p className="text-sm text-zinc-300">No tasks yet. Type above to add one.</p>
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-zinc-500">No tasks match this filter.</div>
        ) : (
          <div
            className="space-y-2"
            onDragOver={(event) => {
              if (!draggingId) {
                return;
              }
              const target = event.target as HTMLElement;
              if (!target.closest("[data-task-row='true']")) {
                event.preventDefault();
                setDropHint({ targetId: null, position: "list-end" });
              }
            }}
            onDrop={(event) => {
              if (!draggingId) {
                return;
              }
              const target = event.target as HTMLElement;
              if (!target.closest("[data-task-row='true']")) {
                event.preventDefault();
                void moveTask(draggingId, null, null);
                setDraggingId(null);
                setDropHint(null);
              }
            }}
          >
            {visibleTasks.map((task) => {
              const children = childCounts.get(task.id) ?? 0;
              const isEditing = editingId === task.id;
              const isFocused = focusedId === task.id;
              const hasNested = children > 0;
              const statusMeta = TASK_STATUS_META[task.status];
              const dropBefore = dropHint?.targetId === task.id && dropHint.position === "before";
              const dropAfter = dropHint?.targetId === task.id && dropHint.position === "after";
              const dropInside = dropHint?.targetId === task.id && dropHint.position === "inside";
              const linkedSessionKeys = Array.from(new Set([
                ...((task as TaskNode & { sessionKeys?: string[] }).sessionKeys ?? []),
                ...(task.sessionKey ? [task.sessionKey] : [])
              ]));
              const transitionStatuses = Array.from(new Set([editingDraft?.status ?? task.status, ...TASK_TRANSITIONS[editingDraft?.status ?? task.status]]));

              return (
                <div
                  key={task.id}
                  data-task-row="true"
                  ref={(node) => {
                    if (node) {
                      rowRefs.current.set(task.id, node);
                    } else {
                      rowRefs.current.delete(task.id);
                    }
                  }}
                  tabIndex={0}
                  onFocus={() => setFocus(task.id)}
                  onMouseDown={() => setFocus(task.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu(task.id, event.clientX, event.clientY);
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }
                    gestureRef.current.taskId = task.id;
                    gestureRef.current.startX = event.clientX;
                    gestureRef.current.startY = event.clientY;
                    gestureRef.current.pointerType = event.pointerType;
                    gestureRef.current.longPress = false;
                    gestureRef.current.timer = window.setTimeout(() => {
                      gestureRef.current.longPress = true;
                      openMenu(task.id, event.clientX, event.clientY);
                    }, 300);
                  }}
                  onPointerMove={(event) => {
                    if (!gestureRef.current.taskId) {
                      return;
                    }
                    const deltaX = Math.abs(event.clientX - gestureRef.current.startX);
                    const deltaY = Math.abs(event.clientY - gestureRef.current.startY);
                    if (deltaX > 12 || deltaY > 12) {
                      if (gestureRef.current.timer !== null) {
                        window.clearTimeout(gestureRef.current.timer);
                        gestureRef.current.timer = null;
                      }
                    }
                  }}
                  onPointerUp={(event) => {
                    const gesture = gestureRef.current;
                    const deltaX = event.clientX - gesture.startX;
                    const deltaY = Math.abs(event.clientY - gesture.startY);
                    if (gesture.timer !== null) {
                      window.clearTimeout(gesture.timer);
                    }
                    if (
                      gesture.taskId === task.id &&
                      gesture.pointerType !== "mouse" &&
                      !gesture.longPress &&
                      deltaX > 72 &&
                      deltaY < 32
                    ) {
                      const nextStatus = getSwipeStatus(task.status);
                      if (nextStatus) {
                        void updateTask(task.id, { status: nextStatus });
                      }
                    }
                    clearGesture();
                  }}
                  onPointerCancel={clearGesture}
                  onDragOver={(event) => {
                    if (!draggingId || draggingId === task.id) {
                      return;
                    }
                    event.preventDefault();
                    setDropHint({ targetId: task.id, position: resolveDropIntent(event) });
                  }}
                  onDrop={(event) => {
                    if (!draggingId) {
                      return;
                    }
                    event.preventDefault();
                    handleDropOnTask(task, resolveDropIntent(event));
                  }}
                  className={`relative rounded-xl bg-black/20 py-1.5 outline-none transition-all duration-150 ${
                    isFocused ? "bg-white/[0.06] ring-1 ring-blue-400/30" : "hover:bg-white/[0.04]"
                  } ${draggingId === task.id ? "opacity-45" : ""}`}
                  style={{ paddingLeft: `${16 + task.depth * 24}px` }}
                >
                  {dropBefore ? (
                    <div
                      className="pointer-events-none absolute top-0 h-0.5 rounded-full bg-blue-400"
                      style={{ left: `${16 + task.depth * 24}px`, right: "12px" }}
                    />
                  ) : null}
                  {dropAfter ? (
                    <div
                      className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-blue-400"
                      style={{ left: `${16 + task.depth * 24}px`, right: "12px" }}
                    />
                  ) : null}
                  {dropInside ? (
                    <div
                      className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-blue-400"
                      style={{ left: `${16 + (task.depth + 1) * 24}px`, right: "12px" }}
                    />
                  ) : null}

                  {Array.from({ length: task.depth }).map((_, index) => (
                    <span
                      key={`${task.id}-line-${index}`}
                      aria-hidden
                      className="pointer-events-none absolute top-2 bottom-2 w-px bg-white/5"
                      style={{ left: `${12 + index * 24}px` }}
                    />
                  ))}
                  <div className="flex min-h-12 items-center gap-1.5 pr-2">
                    <button
                      type="button"
                      draggable
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                      onDragStart={(event) => {
                        event.stopPropagation();
                        setDraggingId(task.id);
                        setDropHint(null);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", task.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropHint(null);
                      }}
                      className="inline-flex h-12 w-8 shrink-0 cursor-grab items-center justify-center rounded-full text-zinc-500 transition-all duration-150 hover:bg-white/5 hover:text-zinc-100 active:cursor-grabbing"
                      aria-label="Drag task"
                    >
                      <GripIcon />
                    </button>
                    {hasNested ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleTask(task.id);
                        }}
                        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-all duration-150 hover:bg-white/5 hover:text-zinc-100"
                        aria-label={task.collapsed ? "Expand task" : "Collapse task"}
                      >
                        <ChevronIcon open={!task.collapsed} />
                      </button>
                    ) : (
                      <span className="block h-12 w-12 shrink-0" aria-hidden />
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        cycleStatus(task);
                      }}
                      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all duration-150 hover:bg-white/5"
                      aria-label={`Set task status, currently ${statusMeta.label}`}
                    >
                      <span className={`h-3 w-3 rounded-full ${statusMeta.dot}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          const sessionKey = linkedSessionKeys[linkedSessionKeys.length - 1] ?? null;
                          if (sessionKey) {
                            onOpenSession(sessionKey);
                          } else {
                            beginEditing(task);
                          }
                        }}
                        className="min-h-12 w-full text-left text-sm text-zinc-100 transition-all duration-150 hover:text-white"
                      >
                        <span className={task.status === "done" ? "text-zinc-500 line-through" : ""}>{task.title}</span>
                      </button>
                      {task.notes && task.status === "blocked" ? (
                        <p className="mt-1 line-clamp-2 text-xs text-red-300/70">
                          {task.notes.split("\n").filter(Boolean).pop()}
                        </p>
                      ) : null}
                      {(linkedSessionKeys.length > 0 || (task.repo && task.branch)) ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                          {task.sessionKey && task.status === "active" ? (
                            <span className="inline-flex min-h-8 items-center rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-300">
                              🤖 Agent working
                            </span>
                          ) : null}
                          {linkedSessionKeys.map((key) => (
                            <button
                              key={key}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenSession(key);
                              }}
                              className="inline-flex min-h-8 items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 transition-all duration-150 hover:bg-white/10 hover:text-zinc-100"
                            >
                              <ChatIcon />
                              <span className="truncate">{key}</span>
                            </button>
                          ))}
                          {task.repo && task.branch ? (
                            <span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-white/5 px-2.5 py-1">
                              <GitBranchIcon />
                              <span className="truncate">
                                {task.repo}/{task.branch}
                              </span>
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {hasNested ? (
                      <span className="shrink-0 rounded-full bg-white/5 px-2 py-1 text-xs text-zinc-400">{children}</span>
                    ) : null}
                  </div>

                  {isEditing && editingDraft ? (
                    <div
                      ref={editingPanelRef}
                      onBlurCapture={(event) => {
                        const next = event.relatedTarget as Node | null;
                        if (next && event.currentTarget.contains(next)) {
                          return;
                        }
                        finishEditing(true);
                      }}
                      className="mx-2 mt-2 rounded-xl border border-white/10 bg-black/30 p-3"
                    >
                      <div className="space-y-3">
                        <input
                          ref={editingInputRef}
                          value={editingDraft.title}
                          onChange={(event) => setEditingDraft((current) => (current ? { ...current, title: event.target.value } : current))}
                          className="h-11 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-zinc-100 outline-none transition-all duration-150 focus:border-blue-400/40"
                          placeholder="Task title"
                        />
                        <textarea
                          ref={notesInputRef}
                          rows={1}
                          value={editingDraft.notes}
                          onChange={(event) => setEditingDraft((current) => (current ? { ...current, notes: event.target.value } : current))}
                          className="max-h-56 min-h-20 w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none transition-all duration-150 placeholder:text-zinc-500 focus:border-blue-400/40"
                          placeholder="Notes"
                        />
                        <div className="flex flex-wrap gap-2">
                          {transitionStatuses.map((status) => {
                            const meta = TASK_STATUS_META[status];
                            const isActive = editingDraft.status === status;
                            return (
                              <button
                                key={`${task.id}-${status}`}
                                type="button"
                                onClick={() => setEditingDraft((current) => (current ? { ...current, status } : current))}
                                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs transition-all duration-150 ${
                                  isActive
                                    ? "bg-blue-400/20 text-blue-300"
                                    : "bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
                                }`}
                              >
                                <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                                {meta.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            value={editingDraft.repo}
                            onChange={(event) => setEditingDraft((current) => (current ? { ...current, repo: event.target.value } : current))}
                            className="h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-zinc-100 outline-none transition-all duration-150 placeholder:text-zinc-500 focus:border-blue-400/40"
                            placeholder="Repo (optional)"
                          />
                          <input
                            value={editingDraft.branch}
                            onChange={(event) => setEditingDraft((current) => (current ? { ...current, branch: event.target.value } : current))}
                            className="h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-zinc-100 outline-none transition-all duration-150 placeholder:text-zinc-500 focus:border-blue-400/40"
                            placeholder="Branch (optional)"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => finishEditing(false)}
                            className="inline-flex h-9 items-center rounded-lg bg-white/5 px-3 text-xs text-zinc-300 transition-all duration-150 hover:bg-white/10 hover:text-zinc-100"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => finishEditing(true)}
                            className="inline-flex h-9 items-center rounded-lg bg-blue-400/20 px-3 text-xs text-blue-200 transition-all duration-150 hover:bg-blue-400/30"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {dropHint?.position === "list-end" ? (
              <div className="h-0.5 rounded-full bg-blue-400" />
            ) : null}
          </div>
        )}
      </div>

      {contextMenu && contextTask ? (
        <div
          className="fixed z-40 w-48 rounded-xl border border-white/5 bg-zinc-900/95 p-1.5 shadow-2xl"
          style={{
            left: `${Math.min(contextMenu.x, window.innerWidth - 208)}px`,
            top: `${Math.min(contextMenu.y, window.innerHeight - 240)}px`
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => beginEditing(contextTask)}
            className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-zinc-100 transition-all duration-150 hover:bg-white/5"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              void indentTask(contextTask.id);
            }}
            className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-zinc-100 transition-all duration-150 hover:bg-white/5"
          >
            Indent
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              void outdentTask(contextTask.id);
            }}
            className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-zinc-100 transition-all duration-150 hover:bg-white/5"
          >
            Outdent
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              void (async () => {
                if (contextTask.collapsed) {
                  toggleTask(contextTask.id);
                }
                const createdId = await addTask("New task", contextTask.id);
                setFocus(createdId);
                setEditingId(createdId);
                setEditingDraft({ title: "New task", notes: "", status: "todo", repo: "", branch: "" });
              })();
            }}
            className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-zinc-100 transition-all duration-150 hover:bg-white/5"
          >
            Add subtask
          </button>
          <button
            type="button"
            disabled={!currentSessionKey}
            onClick={() => {
              setContextMenu(null);
              if (currentSessionKey) {
                const existing = (contextTask as TaskNode & { sessionKeys?: string[] }).sessionKeys ?? [];
                const updated = existing.includes(currentSessionKey) ? existing : [...existing, currentSessionKey];
                void updateTask(contextTask.id, { sessionKey: currentSessionKey, sessionKeys: updated } as Partial<TaskNode>);
              }
            }}
            className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-zinc-100 transition-all duration-150 hover:bg-white/5 disabled:text-zinc-600"
          >
            Link session
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              void removeTask(contextTask.id);
            }}
            className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-red-300 transition-all duration-150 hover:bg-white/5"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
