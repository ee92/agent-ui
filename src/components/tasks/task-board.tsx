import { useMemo, useState } from "react";
import type { Task, TaskStatus } from "../../lib/types";
import { TASK_COLUMNS, formatAbsolute } from "../../lib/ui-utils";

export function TaskBoard({
  tasks,
  activeTaskId,
  onAdd,
  onOpen,
  onUpdate,
  onMove,
  onStartChat
}: {
  tasks: Task[];
  activeTaskId: string | null;
  onAdd: (title: string) => void;
  onOpen: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onMove: (id: string, status: TaskStatus, index: number) => void;
  onStartChat: (task: Task) => void;
}) {
  const [draft, setDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const grouped = useMemo(
    () => TASK_COLUMNS.map((column) => ({ ...column, tasks: tasks.filter((task) => task.status === column.status) })),
    [tasks]
  );

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-hidden">
      <div className="rounded-[2rem] border border-white/8 bg-white/[0.03] p-4">
        <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Task Board</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.trim()) {
                onAdd(draft);
                setDraft("");
              }
            }}
            placeholder="Quick add a task"
            className="h-12 flex-1 rounded-2xl border border-white/8 bg-black/20 px-4 text-base text-white outline-none placeholder:text-zinc-600 focus:border-blue-500/40 sm:text-sm"
          />
          <button
            type="button"
            onClick={() => {
              if (draft.trim()) {
                onAdd(draft);
                setDraft("");
              }
            }}
            className="h-12 rounded-2xl bg-white/[0.05] px-4 text-base font-medium text-white hover:bg-white/[0.08] sm:text-sm"
          >
            Add
          </button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-x-hidden overflow-y-auto pr-1 xl:grid-cols-3 xl:overflow-visible xl:pr-0">
        {grouped.map((column) => (
          <section
            key={column.status}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggingId) {
                onMove(draggingId, column.status, column.tasks.length);
                setDraggingId(null);
              }
            }}
            className="flex min-h-[220px] min-w-0 flex-col rounded-[2rem] border border-white/8 bg-white/[0.03] p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">{column.label}</h3>
                <p className="text-xs text-zinc-500">{column.description}</p>
              </div>
              <span className="rounded-full bg-black/20 px-2 py-1 text-xs text-zinc-400">{column.tasks.length}</span>
            </div>
            <div className="scroll-soft flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1">
              {column.tasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
                  No {column.label.toLowerCase()} tasks yet.
                </div>
              ) : null}
              {column.tasks.map((task, index) => {
                const isOpen = activeTaskId === task.id;
                return (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDraggingId(task.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.stopPropagation();
                      if (draggingId) {
                        onMove(draggingId, column.status, index);
                        setDraggingId(null);
                      }
                    }}
                    className="min-w-0 rounded-3xl border border-white/8 bg-black/20 p-3"
                  >
                    <button type="button" onClick={() => onOpen(isOpen ? null : task.id)} className="w-full text-left">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="mb-2 flex items-center gap-2">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                task.priority === "high" ? "bg-rose-400" : task.priority === "medium" ? "bg-amber-400" : "bg-zinc-500"
                              }`}
                            />
                            <span className="break-words text-base font-medium text-white sm:text-sm">{task.title}</span>
                          </div>
                          <p className="text-sm text-zinc-500 sm:text-xs">{formatAbsolute(task.updatedAt)}</p>
                        </div>
                        <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                          {task.status}
                        </span>
                      </div>
                    </button>
                    {isOpen ? (
                      <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
                        <textarea
                          value={task.description}
                          onChange={(event) => onUpdate(task.id, { description: event.target.value })}
                          rows={4}
                          placeholder="Add context"
                          className="w-full rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-base text-zinc-100 outline-none sm:text-sm"
                        />
                        <input
                          value={task.tags.join(", ")}
                          onChange={(event) =>
                            onUpdate(task.id, {
                              tags: event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean)
                            })
                          }
                          placeholder="tags, comma separated"
                          className="h-11 w-full rounded-2xl border border-white/8 bg-black/20 px-3 text-base text-zinc-100 outline-none sm:text-sm"
                        />
                        <div className="flex flex-wrap gap-2">
                          {(["queue", "active", "done"] as TaskStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => onUpdate(task.id, { status })}
                              className={`rounded-full px-3 py-1.5 text-xs ${
                                task.status === status ? "bg-blue-500/14 text-blue-200" : "bg-white/[0.04] text-zinc-300"
                              }`}
                            >
                              {status}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => onStartChat(task)}
                          className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-zinc-200"
                        >
                          Start chat
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
