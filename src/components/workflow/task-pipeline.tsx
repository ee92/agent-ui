import { useCallback, useMemo, useRef, useState } from "react";
import { useActivityStore } from "../../lib/stores/activity-store";
import { useTaskStore } from "../../lib/stores/task-store-v2";
import { TASK_STATUS_META, TASK_TRANSITIONS, type TaskNode, type TaskStatus } from "../../lib/task-types";

type VisibleTask = TaskNode & { depth: number };

const COLUMN_ORDER: TaskStatus[] = ["todo", "active", "review", "blocked", "done"];

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
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${
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
  onOpenSession,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  task: VisibleTask;
  childCount: number;
  onAdvance: (task: TaskNode) => void;
  onOpenSession: (key: string) => void;
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
      className={`rounded-xl bg-black/20 p-3 transition-all duration-150 hover:bg-white/[0.04] ${isDragging ? "opacity-50" : ""}`}
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
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAdvance(task);
          }}
          className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/30 text-white transition-all duration-150 hover:bg-white/[0.08] ${TASK_STATUS_META[task.status].dot}`}
          aria-label={`Advance ${task.title}`}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-current" />
        </button>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium leading-5 ${task.status === "done" ? "text-zinc-500 line-through" : "text-white"}`}>
            {task.title}
          </p>
          {blockedReason && <p className="mt-1 text-xs text-zinc-400">⚠️ {blockedReason}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {childCount > 0 && (
              <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-400">
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
                className="min-h-7 rounded-full bg-blue-500/12 px-2 py-1 text-[11px] text-blue-300 transition-all duration-150 hover:bg-blue-500/20"
              >
                {task.sessionKey}
              </button>
            )}
            {task.repo && (
              <span className="inline-flex min-h-7 items-center gap-1 rounded-full bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-400">
                <GitBranchIcon />
                {task.branch ? `${task.repo}:${task.branch}` : task.repo}
              </span>
            )}
            <span className="rounded-full bg-white/[0.02] px-2 py-1 text-[11px] text-zinc-500">{relativeTime(task.updatedAt)}</span>
          </div>
          <div
            className={`grid transition-all duration-150 ${expanded && task.notes.trim() ? "mt-2 grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            <div className="overflow-hidden">
              {task.notes.trim() && <p className="text-xs leading-5 text-zinc-400">{task.notes}</p>}
            </div>
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
  onOpenSession,
  draggingTaskId,
  onCardDragStart,
  onCardDragEnd,
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
  onOpenSession: (key: string) => void;
  draggingTaskId: string | null;
  onCardDragStart: (event: React.DragEvent<HTMLElement>, task: VisibleTask) => void;
  onCardDragEnd: () => void;
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
      className={`flex min-h-[12rem] flex-col rounded-xl border bg-zinc-900/80 p-3 backdrop-blur-xl xl:min-h-[24rem] ${dragOverColumn === status ? "border-blue-500/30" : "border-border"}`}
      onDragOver={(event) => onColumnDragOver(event, status)}
      onDragEnter={() => onColumnDragEnter(status)}
      onDragLeave={(event) => onColumnDragLeave(event, status)}
      onDrop={(event) => onColumnDrop(event, status)}
    >
      <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${meta.dot} ${isAttention ? "animate-pulse shadow-[0_0_10px_rgba(248,113,113,0.35)]" : tasks.length > 0 ? "shadow-[0_0_12px_rgba(255,255,255,0.12)]" : ""}`}
          />
          <p className="text-sm font-semibold text-white">{meta.label}</p>
          <span className="rounded-full bg-black/30 px-2 py-0.5 text-[11px] text-zinc-400">{tasks.length}</span>
        </div>
        {status === "done" && tasks.length > 0 && (
          <button
            type="button"
            onClick={onToggleDone}
            className="min-h-11 rounded-full px-3 text-xs text-zinc-400 transition-all duration-150 hover:text-white"
          >
            {doneExpanded ? "Collapse" : "Show recent"}
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {showTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            childCount={childCounts.get(task.id) ?? 0}
            onAdvance={onAdvance}
            onOpenSession={onOpenSession}
            isDragging={draggingTaskId === task.id}
            onDragStart={onCardDragStart}
            onDragEnd={onCardDragEnd}
          />
        ))}
        {status === "done" && tasks.length > 0 && !doneExpanded && (
          <button
            type="button"
            onClick={onToggleDone}
            className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-left text-sm text-zinc-500 transition-all duration-150 hover:border-white/20 hover:text-zinc-300"
          >
            {tasks.length} recent completed task{tasks.length === 1 ? "" : "s"}
          </button>
        )}
        {tasks.length === 0 && (
          <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-white/8 px-3 text-sm text-zinc-600">
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
  const addTask = useTaskStore((state) => state.add);
  const pushActivity = useActivityStore((state) => state.push);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [mobileColumn, setMobileColumn] = useState<TaskStatus>("active");

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

    if (!taskId || !currentStatus || currentStatus === status) {
      return;
    }
    if (!TASK_TRANSITIONS[currentStatus]?.includes(status)) {
      return;
    }

    void updateTask(taskId, { status }).catch(() => {});
  }, [updateTask]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div>
          <h2 className="text-base font-semibold text-white">Task Pipeline</h2>
          <p className="text-xs text-zinc-500">Swipe right on mobile to advance. Tap cards to expand notes.</p>
        </div>
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
            className="min-h-11 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-blue-500/50"
          />
          <button type="submit" className="min-h-11 rounded-xl bg-blue-500/20 px-4 text-sm text-blue-300 hover:bg-blue-500/30">Add</button>
          <button type="button" onClick={() => setAdding(false)} className="min-h-11 rounded-xl px-3 text-sm text-zinc-500 hover:text-white">Cancel</button>
        </form>
      )}

      {/* Mobile: tab bar to pick column + single column view */}
      <div className="xl:hidden">
        <div className="relative mb-3">
          <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-canvas to-transparent" />
        <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-white/5 bg-black/20 p-1 scrollbar-none">
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
          onOpenSession={onOpenSession}
          draggingTaskId={draggingTaskId}
          onCardDragStart={handleCardDragStart}
          onCardDragEnd={handleCardDragEnd}
          onColumnDragOver={handleColumnDragOver}
          onColumnDragEnter={handleColumnDragEnter}
          onColumnDragLeave={handleColumnDragLeave}
          onColumnDrop={handleColumnDrop}
        />
      </div>

      {/* Desktop: scrollable 5-col grid with more breathing room */}
      <div className="hidden xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-5 xl:gap-3 xl:overflow-x-auto xl:pb-4">
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
            onOpenSession={onOpenSession}
            draggingTaskId={draggingTaskId}
            onCardDragStart={handleCardDragStart}
            onCardDragEnd={handleCardDragEnd}
            onColumnDragOver={handleColumnDragOver}
            onColumnDragEnter={handleColumnDragEnter}
            onColumnDragLeave={handleColumnDragLeave}
            onColumnDrop={handleColumnDrop}
          />
        ))}
      </div>
    </section>
  );
}
