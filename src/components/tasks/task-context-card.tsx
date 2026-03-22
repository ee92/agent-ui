import type { TaskNode, TaskStatus } from "../../lib/task-types";
import { TASK_STATUS_META, TASK_TRANSITIONS } from "../../lib/task-types";
import { useTaskStore } from "../../lib/stores/task-store-v2";

const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: "bg-zinc-500",
  plan: "bg-violet-400",
  active: "bg-blue-400",
  review: "bg-amber-400",
  blocked: "bg-red-400",
  done: "bg-emerald-400",
};

const ACTION_LABELS: Partial<Record<TaskStatus, { label: string; next: TaskStatus }>> = {
  plan: { label: "Approve plan", next: "active" },
  blocked: { label: "Unblock", next: "active" },
  review: { label: "Approve", next: "done" },
  active: { label: "Mark done", next: "done" },
};

export function TaskContextCard({ task }: { task: TaskNode }) {
  const updateTask = useTaskStore((s) => s.update);
  const action = ACTION_LABELS[task.status];

  return (
    <div className="mx-auto mb-6 w-full max-w-lg rounded-lg border border-white/4 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-3 w-3 shrink-0 rounded-full ${STATUS_COLORS[task.status] ?? "bg-zinc-500"}`} />
          <p className="text-base font-semibold text-white truncate">{task.title}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
          {TASK_STATUS_META[task.status].label}
        </span>
      </div>
      {task.notes ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
          {task.notes}
        </p>
      ) : null}
      {task.status === "blocked" ? (
        <p className="mt-3 text-xs text-red-300/70">⚠️ This task is blocked. Reply below to help unblock it.</p>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={() => void updateTask(task.id, { status: action.next })}
          className="mt-4 inline-flex min-h-9 items-center rounded-full bg-white/8 px-4 text-sm font-medium text-zinc-200 transition-all duration-150 hover:bg-white/12 active:scale-95 xl:hidden"
        >
          {action.label} →
        </button>
      ) : null}
    </div>
  );
}
