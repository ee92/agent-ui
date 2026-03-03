import { useCallback, useMemo, useRef, useState } from "react";
import { useActivityStore } from "../../lib/stores/activity-store";
import { useTaskStore } from "../../lib/stores/task-store-v2";
import { TASK_STATUS_META, TASK_TRANSITIONS, type TaskNode, type TaskStatus } from "../../lib/task-types";

type VisibleTask = TaskNode & { depth: number };

const COLUMN_ORDER: TaskStatus[] = ["todo", "active", "review", "blocked", "done"];
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

function TaskCard({
  task,
  childCount,
  onAdvance,
  onOpenSession,
}: {
  task: VisibleTask;
  childCount: number;
  onAdvance: (task: TaskNode) => void;
  onOpenSession: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const gesture = useRef({ x: 0, y: 0, pointerType: "" });

  return (
    <article
      className="rounded-xl bg-black/20 p-3 transition-all duration-150 hover:bg-white/[0.04]"
      onClick={() => setExpanded((current) => !current)}
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
          <p className={`truncate text-sm font-medium ${task.status === "done" ? "text-zinc-500 line-through" : "text-white"}`}>
            {task.title}
          </p>
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
  onToggleDone,
  onAdvance,
  onOpenSession,
}: {
  status: TaskStatus;
  tasks: VisibleTask[];
  childCounts: Map<string, number>;
  doneExpanded: boolean;
  onToggleDone: () => void;
  onAdvance: (task: TaskNode) => void;
  onOpenSession: (key: string) => void;
}) {
  const meta = TASK_STATUS_META[status];
  const isAttention = (status === "review" || status === "blocked") && tasks.length > 0;
  const showTasks = status === "done" && !doneExpanded ? [] : tasks;

  return (
    <section className="flex min-h-[24rem] w-[85vw] shrink-0 snap-center flex-col rounded-xl border border-border bg-zinc-900/80 p-3 backdrop-blur-xl xl:min-h-0 xl:w-auto">
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

      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 -mx-3 px-3 xl:mx-0 xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-5 xl:overflow-x-visible xl:px-0">
        {COLUMN_ORDER.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={columns.get(status) ?? []}
            childCounts={childCounts}
            doneExpanded={doneExpanded}
            onToggleDone={() => setDoneExpanded((current) => !current)}
            onAdvance={handleAdvance}
            onOpenSession={onOpenSession}
          />
        ))}
      </div>
    </section>
  );
}
