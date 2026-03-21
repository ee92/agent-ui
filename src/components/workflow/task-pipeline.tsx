import { useCallback, useMemo, useRef, useState } from "react";
import { useActivityStore } from "../../lib/stores/activity-store";
import { useTaskStore } from "../../lib/stores/task-store-v2";
import { TASK_STATUS_META, TASK_TRANSITIONS, type TaskNode, type TaskStatus } from "../../lib/task-types";
import { TaskEditModal } from "./task-edit-modal";

type VisibleTask = TaskNode & { depth: number };
type DropHint = { status: TaskStatus; targetId: string; position: "before" | "after" } | null;

const COLUMN_ORDER: TaskStatus[] = ["todo", "plan", "active", "review", "blocked", "done"];

function ColumnTab({ status, count, active, onClick }: { status: TaskStatus; count: number; active: boolean; onClick: () => void }) {
  const meta = TASK_STATUS_META[status];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
      {meta.label}
      {count > 0 && (
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
          active ? "bg-white/10 text-zinc-200" : "bg-white/[0.04] text-zinc-500"
        }`}>{count}</span>
      )}
    </button>
  );
}
const DONE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

function GitBranchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10-5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
      <path d="M7 9v6" />
      <path d="M9 7h4a4 4 0 0 1 4 4" />
    </svg>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

function TaskCard({
  task,
  childCount,
  onAdvance,
  onEdit,
  onOpenSession,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  task: VisibleTask;
  childCount: number;
  onAdvance: (task: TaskNode) => void;
  onEdit: (task: TaskNode) => void;
  onOpenSession: (key: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: (task: VisibleTask) => void;
  onMoveDown: (task: VisibleTask) => void;
  isDragging: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>, task: VisibleTask) => void;
  onDragEnd: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const gesture = useRef({ x: 0, y: 0, pointerType: "" });
  const blockedReason = useMemo(() => {
    if (task.status !== "blocked" || !task.notes.trim()) {
      return null;
    }
    const lines = task.notes.split(/\r?\n/).map((line) => line.trim());
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (/^\[BLOCKED\b/i.test(lines[index])) {
        return lines[index];
      }
    }
    return null;
  }, [task.notes, task.status]);

  return (
    <article
      draggable="true"
      className={`group/card rounded-lg bg-surface-1 p-3 transition-colors duration-150 hover:bg-white/[0.04] ${isDragging ? "opacity-50" : ""}`}
      onClick={() => setExpanded((current) => !current)}
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
      onPointerDown={(event) => {
        gesture.current = { x: event.clientX, y: event.clientY, pointerType: event.pointerType };
      }}
      onPointerUp={(event) => {
        if (gesture.current.pointerType !== "touch") {
          return;
        }
        const deltaX = event.clientX - gesture.current.x;
        const deltaY = Math.abs(event.clientY - gesture.current.y);
        if (deltaX > 72 && deltaY < 36) {
          event.preventDefault();
          onAdvance(task);
        }
      }}
    >
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <p className={`flex-1 text-sm font-medium leading-5 ${task.status === "done" ? "text-zinc-500 line-through" : "text-white"}`}>
            {task.title}
          </p>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(task);
            }}
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-zinc-500 opacity-0 transition-colors duration-150 hover:bg-white/[0.08] hover:text-zinc-200 group-hover/card:opacity-100"
            aria-label={`Edit ${task.title}`}
            title="Edit task"
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
              <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM11.189 6.25 9.75 4.811l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.249.249 0 0 0 .108-.064l6.286-6.286Z" />
            </svg>
          </button>
        </div>
          {blockedReason && <p className="mt-1 text-xs text-zinc-400">⚠️ {blockedReason}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.sessionKey && task.status === "active" && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-300">
                🤖 Agent working
              </span>
            )}
            {childCount > 0 && (
              <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-400">
                {childCount} child{childCount === 1 ? "" : "ren"}
              </span>
            )}
            {task.sessionKey && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenSession(task.sessionKey!);
                }}
                className="min-h-7 rounded-full bg-blue-500/12 px-2 py-1 text-[10px] text-blue-300 transition-all duration-150 hover:bg-blue-500/20"
              >
                {task.sessionKey}
              </button>
            )}
            {task.repo && (
              <span className="inline-flex min-h-7 items-center gap-1 rounded-full bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-400">
                <GitBranchIcon />
                {task.branch ? `${task.repo}:${task.branch}` : task.repo}
              </span>
            )}
            <span className="rounded-full bg-white/[0.02] px-2 py-1 text-[10px] text-zinc-500">{relativeTime(task.updatedAt)}</span>
            <div className="flex items-center gap-1 xl:hidden">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveUp(task);
                }}
                disabled={!canMoveUp}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05] text-zinc-300 transition-all duration-150 hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                aria-label={`Move ${task.title} up`}
                title="Move up"
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="m3.5 10 4.5-4.5L12.5 10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveDown(task);
                }}
                disabled={!canMoveDown}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05] text-zinc-300 transition-all duration-150 hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                aria-label={`Move ${task.title} down`}
                title="Move down"
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="m3.5 6 4.5 4.5L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        <div
          className={`grid transition-all duration-150 ${expanded && task.notes.trim() ? "mt-2 grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="overflow-hidden">
            {task.notes.trim() && <p className="line-clamp-3 text-xs leading-5 text-zinc-400">{task.notes}</p>}
          </div>
        </div>
      </div>
    </article>
  );
}

function Column({
  status,
  tasks,
  childCounts,
  doneExpanded,
  dragOverColumn,
  onToggleDone,
  onAdvance,
  onEdit,
  onOpenSession,
  draggingTaskId,
  dropHint,
  onCardDragStart,
  onCardDragEnd,
  onTaskDragOver,
  onTaskDrop,
  onMoveUp,
  onMoveDown,
  onColumnDragOver,
  onColumnDragEnter,
  onColumnDragLeave,
  onColumnDrop,
}: {
  status: TaskStatus;
  tasks: VisibleTask[];
  childCounts: Map<string, number>;
  doneExpanded: boolean;
  dragOverColumn: TaskStatus | null;
  onToggleDone: () => void;
  onAdvance: (task: TaskNode) => void;
  onEdit: (task: TaskNode) => void;
  onOpenSession: (key: string) => void;
  draggingTaskId: string | null;
  dropHint: DropHint;
  onCardDragStart: (event: React.DragEvent<HTMLElement>, task: VisibleTask) => void;
  onCardDragEnd: () => void;
  onTaskDragOver: (event: React.DragEvent<HTMLDivElement>, status: TaskStatus, task: VisibleTask) => void;
  onTaskDrop: (event: React.DragEvent<HTMLDivElement>, status: TaskStatus, task: VisibleTask) => void;
  onMoveUp: (task: VisibleTask) => void;
  onMoveDown: (task: VisibleTask) => void;
  onColumnDragOver: (event: React.DragEvent<HTMLElement>, status: TaskStatus) => void;
  onColumnDragEnter: (status: TaskStatus) => void;
  onColumnDragLeave: (event: React.DragEvent<HTMLElement>, status: TaskStatus) => void;
  onColumnDrop: (event: React.DragEvent<HTMLElement>, status: TaskStatus) => void;
}) {
  const meta = TASK_STATUS_META[status];
  const isAttention = (status === "review" || status === "blocked") && tasks.length > 0;
  const showTasks = status === "done" && !doneExpanded ? [] : tasks;

  return (
    <section
      className={`flex min-h-[12rem] flex-col rounded-lg border bg-surface-1 p-3 xl:min-h-[24rem] ${dragOverColumn === status ? "border-blue-500/30" : "border-border"}`}
      onDragOver={(event) => onColumnDragOver(event, status)}
      onDragEnter={() => onColumnDragEnter(status)}
      onDragLeave={(event) => onColumnDragLeave(event, status)}
      onDrop={(event) => onColumnDrop(event, status)}
    >
      <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${meta.dot} ${isAttention ? "animate-pulse" : tasks.length > 0 ? "shadow-[0_0_12px_rgba(255,255,255,0.12)]" : ""}`}
          />
          <p className="text-sm font-semibold text-white">{meta.label}</p>
          <span className="rounded-full bg-surface-1 px-2 py-0.5 text-[10px] text-zinc-400">{tasks.length}</span>
        </div>
        {status === "done" && tasks.length > 0 && (
          <button
            type="button"
            onClick={onToggleDone}
            className="min-h-9 rounded-full px-3 text-xs text-zinc-400 transition-all duration-150 hover:text-white"
          >
            {doneExpanded ? "Collapse" : "Show recent"}
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {showTasks.map((task, index) => {
          const dropBefore = dropHint?.status === status && dropHint.targetId === task.id && dropHint.position === "before";
          const dropAfter = dropHint?.status === status && dropHint.targetId === task.id && dropHint.position === "after";
          return (
            <div
              key={task.id}
              className="relative"
              onDragOver={(event) => onTaskDragOver(event, status, task)}
              onDrop={(event) => onTaskDrop(event, status, task)}
            >
              {dropBefore ? <div className="pointer-events-none absolute -top-1 left-2 right-2 h-0.5 rounded-full bg-blue-400" /> : null}
              {dropAfter ? <div className="pointer-events-none absolute -bottom-1 left-2 right-2 h-0.5 rounded-full bg-blue-400" /> : null}
              <TaskCard
                task={task}
                childCount={childCounts.get(task.id) ?? 0}
                onAdvance={onAdvance}
                onEdit={onEdit}
                onOpenSession={onOpenSession}
                canMoveUp={index > 0}
                canMoveDown={index < showTasks.length - 1}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                isDragging={draggingTaskId === task.id}
                onDragStart={onCardDragStart}
                onDragEnd={onCardDragEnd}
              />
            </div>
          );
        })}
        {status === "done" && tasks.length > 0 && !doneExpanded && (
          <button
            type="button"
            onClick={onToggleDone}
            className="rounded-lg border border-dashed border-white/4 px-3 py-4 text-left text-sm text-zinc-500 transition-all duration-150 hover:border-white/20 hover:text-zinc-300"
          >
            {tasks.length} recent completed task{tasks.length === 1 ? "" : "s"}
          </button>
        )}
        {tasks.length === 0 && (
          <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-white/4 px-3 text-sm text-zinc-600">
            No tasks
          </div>
        )}
      </div>
    </section>
  );
}

export function TaskPipeline({
  tasks,
  visibleTasks,
  onOpenSession,
}: {
  tasks: TaskNode[];
  visibleTasks: VisibleTask[];
  onOpenSession: (key: string) => void;
}) {
  const updateTask = useTaskStore((state) => state.update);
  const moveTask = useTaskStore((state) => state.move);
  const addTask = useTaskStore((state) => state.add);
  const pushActivity = useActivityStore((state) => state.push);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint>(null);
  const [mobileColumn, setMobileColumn] = useState<TaskStatus>("active");
  const [editingTask, setEditingTask] = useState<TaskNode | null>(null);

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

  const columns = useMemo(() => {
    const grouped = new Map<TaskStatus, VisibleTask[]>(
      COLUMN_ORDER.map((status) => [status, [] as VisibleTask[]])
    );

    for (const task of visibleTasks) {
      if (task.status === "done") {
        const completedAt = task.completedAt ? Date.parse(task.completedAt) : 0;
        if (Date.now() - completedAt > DONE_RETENTION_MS) {
          continue;
        }
      }
      grouped.get(task.status)?.push(task);
    }

    for (const status of COLUMN_ORDER) {
      grouped.get(status)?.sort((left, right) => left.order - right.order);
    }

    return grouped;
  }, [visibleTasks]);

  const tasksById = useMemo(() => {
    const map = new Map<string, TaskNode>();
    for (const task of tasks) {
      map.set(task.id, task);
    }
    return map;
  }, [tasks]);

  const getMoveTarget = useCallback((target: TaskNode, position: "before" | "after") => {
    const siblings = tasks
      .filter((task) => task.parentId === target.parentId)
      .sort((left, right) => left.order - right.order);
    const targetIndex = siblings.findIndex((task) => task.id === target.id);
    if (position === "before") {
      return { newParentId: target.parentId, beforeId: target.id as string | null };
    }
    const nextSibling = targetIndex >= 0 ? siblings[targetIndex + 1] : null;
    return { newParentId: target.parentId, beforeId: nextSibling?.id ?? null };
  }, [tasks]);

  const handleAdvance = (task: TaskNode) => {
    const nextStatus = TASK_TRANSITIONS[task.status][0] ?? task.status;
    if (nextStatus === task.status) {
      return;
    }
    void updateTask(task.id, { status: nextStatus })
      .then(() => {
        pushActivity("task_status", `Task moved: "${task.title}" -> ${TASK_STATUS_META[nextStatus].label}`, {
          sessionKey: task.sessionKey ?? undefined,
          metadata: { from: task.status, to: nextStatus, taskId: task.id },
        });
      })
      .catch(() => {});
  };

  const handleCardDragStart = useCallback((event: React.DragEvent<HTMLElement>, task: VisibleTask) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.setData("application/x-task-id", task.id);
    event.dataTransfer.setData("application/x-task-status", task.status);
    setDraggingTaskId(task.id);
  }, []);

  const handleCardDragEnd = useCallback(() => {
    setDraggingTaskId(null);
    setDragOverColumn(null);
    setDropHint(null);
  }, []);

  const handleColumnDragOver = useCallback((event: React.DragEvent<HTMLElement>, status: TaskStatus) => {
    event.preventDefault();
    if (dragOverColumn !== status) {
      setDragOverColumn(status);
    }
  }, [dragOverColumn]);

  const handleColumnDragEnter = useCallback((status: TaskStatus) => {
    setDragOverColumn(status);
  }, []);

  const handleColumnDragLeave = useCallback((event: React.DragEvent<HTMLElement>, status: TaskStatus) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null) && dragOverColumn === status) {
      setDragOverColumn(null);
    }
  }, [dragOverColumn]);

  const handleColumnDrop = useCallback((event: React.DragEvent<HTMLElement>, status: TaskStatus) => {
    event.preventDefault();

    const taskId =
      event.dataTransfer.getData("application/x-task-id") ||
      event.dataTransfer.getData("text/plain");
    const currentStatus = event.dataTransfer.getData("application/x-task-status") as TaskStatus;

    setDragOverColumn(null);
    setDraggingTaskId(null);
    setDropHint(null);

    if (!taskId || !currentStatus || currentStatus === status) {
      return;
    }
    if (!TASK_TRANSITIONS[currentStatus]?.includes(status)) {
      return;
    }

    void updateTask(taskId, { status }).catch(() => {});
  }, [updateTask]);

  const resolveDropPosition = useCallback((event: React.DragEvent<HTMLDivElement>): "before" | "after" => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }, []);

  const handleTaskDragOver = useCallback((event: React.DragEvent<HTMLDivElement>, status: TaskStatus, target: VisibleTask) => {
    const taskId =
      event.dataTransfer.getData("application/x-task-id") ||
      event.dataTransfer.getData("text/plain") ||
      draggingTaskId;
    const statusFromTransfer = event.dataTransfer.getData("application/x-task-status") as TaskStatus;
    const currentStatus = statusFromTransfer || (taskId ? tasksById.get(taskId)?.status : undefined);

    if (!taskId || taskId === target.id) {
      return;
    }
    if (currentStatus !== status) {
      setDropHint(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const position = resolveDropPosition(event);
    setDropHint((current) => {
      if (current?.status === status && current.targetId === target.id && current.position === position) {
        return current;
      }
      return { status, targetId: target.id, position };
    });
  }, [draggingTaskId, resolveDropPosition, tasksById]);

  const handleTaskDrop = useCallback((event: React.DragEvent<HTMLDivElement>, status: TaskStatus, target: VisibleTask) => {
    event.preventDefault();
    event.stopPropagation();

    const taskId =
      event.dataTransfer.getData("application/x-task-id") ||
      event.dataTransfer.getData("text/plain") ||
      draggingTaskId;
    const statusFromTransfer = event.dataTransfer.getData("application/x-task-status") as TaskStatus;
    const currentStatus = statusFromTransfer || (taskId ? tasksById.get(taskId)?.status : undefined);

    setDragOverColumn(null);
    setDraggingTaskId(null);

    if (!taskId || taskId === target.id || !currentStatus) {
      setDropHint(null);
      return;
    }

    if (currentStatus !== status) {
      setDropHint(null);
      if (!TASK_TRANSITIONS[currentStatus]?.includes(status)) {
        return;
      }
      void updateTask(taskId, { status }).catch(() => {});
      return;
    }

    const position = resolveDropPosition(event);
    const { newParentId, beforeId } = getMoveTarget(target, position);
    setDropHint(null);
    void moveTask(taskId, newParentId, beforeId).catch(() => {});
  }, [draggingTaskId, getMoveTarget, moveTask, resolveDropPosition, tasksById, updateTask]);

  const moveWithinColumn = useCallback((task: VisibleTask, direction: -1 | 1) => {
    const columnTasks = columns.get(task.status) ?? [];
    const currentIndex = columnTasks.findIndex((candidate) => candidate.id === task.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= columnTasks.length) {
      return;
    }

    const target = columnTasks[targetIndex];
    const { newParentId, beforeId } = getMoveTarget(target, direction < 0 ? "before" : "after");
    void moveTask(task.id, newParentId, beforeId).catch(() => {});
  }, [columns, getMoveTarget, moveTask]);

  const handleMoveUp = useCallback((task: VisibleTask) => {
    moveWithinColumn(task, -1);
  }, [moveWithinColumn]);

  const handleMoveDown = useCallback((task: VisibleTask) => {
    moveWithinColumn(task, 1);
  }, [moveWithinColumn]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 className="text-sm font-semibold text-white">Task Pipeline</h2>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-9 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-sm text-zinc-300 transition-all duration-150 hover:bg-white/[0.1] hover:text-white"
        >
          <span className="text-base leading-none">+</span> Add
        </button>
      </div>

      {adding && (
        <form
          className="mb-3 flex gap-2 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            const val = newTitle.trim();
            if (val) {
              void addTask(val).then(() => {
                pushActivity("task_status", `Task created: "${val}"`);
              });
              setNewTitle("");
              setAdding(false);
            }
          }}
        >
          <input
            autoFocus
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }}
            placeholder="Task title..."
            className="min-h-9 flex-1 rounded-lg border border-white/4 bg-surface-1 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-blue-500/50"
          />
          <button type="submit" className="min-h-9 rounded-lg bg-blue-500/20 px-4 text-sm text-blue-300 hover:bg-blue-500/30">Add</button>
          <button type="button" onClick={() => setAdding(false)} className="min-h-9 rounded-lg px-3 text-sm text-zinc-500 hover:text-white">Cancel</button>
        </form>
      )}

      {/* Mobile: tab bar to pick column + single column view */}
      <div className="xl:hidden">
        <div className="relative mb-3">
          <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-canvas to-transparent" />
        <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-white/4 bg-surface-1 p-1 scrollbar-none">
          {COLUMN_ORDER.map((status) => (
            <ColumnTab
              key={status}
              status={status}
              count={(columns.get(status) ?? []).length}
              active={mobileColumn === status}
              onClick={() => setMobileColumn(status)}
            />
          ))}
        </div>
        </div>
        <Column
          status={mobileColumn}
          tasks={columns.get(mobileColumn) ?? []}
          childCounts={childCounts}
          doneExpanded={doneExpanded}
          dragOverColumn={dragOverColumn}
          onToggleDone={() => setDoneExpanded((current) => !current)}
          onAdvance={handleAdvance}
          onEdit={setEditingTask}
          onOpenSession={onOpenSession}
          draggingTaskId={draggingTaskId}
          dropHint={dropHint}
          onCardDragStart={handleCardDragStart}
          onCardDragEnd={handleCardDragEnd}
          onTaskDragOver={handleTaskDragOver}
          onTaskDrop={handleTaskDrop}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onColumnDragOver={handleColumnDragOver}
          onColumnDragEnter={handleColumnDragEnter}
          onColumnDragLeave={handleColumnDragLeave}
          onColumnDrop={handleColumnDrop}
        />
      </div>

      {/* Desktop: scrollable 5-col grid with more breathing room */}
      <div className="hidden xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-[repeat(6,minmax(200px,1fr))] xl:gap-3 xl:overflow-x-auto xl:pb-4">
        {COLUMN_ORDER.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={columns.get(status) ?? []}
            childCounts={childCounts}
            doneExpanded={doneExpanded}
            dragOverColumn={dragOverColumn}
            onToggleDone={() => setDoneExpanded((current) => !current)}
            onAdvance={handleAdvance}
            onEdit={setEditingTask}
            onOpenSession={onOpenSession}
            draggingTaskId={draggingTaskId}
            dropHint={dropHint}
            onCardDragStart={handleCardDragStart}
            onCardDragEnd={handleCardDragEnd}
            onTaskDragOver={handleTaskDragOver}
            onTaskDrop={handleTaskDrop}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onColumnDragOver={handleColumnDragOver}
            onColumnDragEnter={handleColumnDragEnter}
            onColumnDragLeave={handleColumnDragLeave}
            onColumnDrop={handleColumnDrop}
          />
        ))}
      </div>

      {editingTask && (
        <TaskEditModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
        />
      )}
    </section>
  );
}
