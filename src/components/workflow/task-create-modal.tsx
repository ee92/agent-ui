import { useState, useEffect } from "react";
import { useTaskStore } from "../../lib/stores/task-store-v2";
import { useTaskCreateStore, type TaskCreateContext } from "../../lib/stores/task-create-store";
import type { TaskStatus } from "../../lib/task-types";

function ModalInner({ context, onClose }: { context: TaskCreateContext; onClose: () => void }) {
  const [title, setTitle] = useState(context.title || "");
  const [notes, setNotes] = useState(context.notes || "");
  const [repo, setRepo] = useState(context.repo || "");
  const [sessionKey] = useState(context.sessionKey || "");
  const [status, setStatus] = useState<TaskStatus>(context.status || "todo");
  const [saving, setSaving] = useState(false);
  const addTask = useTaskStore((s) => s.add);
  const updateTask = useTaskStore((s) => s.update);

  // Reset form when context changes
  useEffect(() => {
    setTitle(context.title || "");
    setNotes(context.notes || "");
    setRepo(context.repo || "");
    setStatus(context.status || "todo");
  }, [context]);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const id = await addTask(title.trim(), null, {
        notes: notes.trim() || undefined,
        repo: repo.trim() || undefined,
        sessionKey: sessionKey || undefined,
      });
      if (status !== "todo") await updateTask(id, { status });
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-white/4 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/4 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">📌 Create Task</h2>
            {context.sourceLabel && <p className="mt-0.5 text-xs text-zinc-500">{context.sourceLabel}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSave(); } }}
              className="w-full rounded-lg border border-white/4 bg-surface-1 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/50" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Context, details, links..."
              className="w-full rounded-lg border border-white/4 bg-surface-1 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full rounded-lg border border-white/4 bg-surface-1 px-3 py-2 text-sm text-white outline-none">
                <option value="todo">To Do</option>
                <option value="active">Active</option>
                <option value="review">Review</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Project</label>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="e.g. my-project"
                className="w-full rounded-lg border border-white/4 bg-surface-1 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50" />
            </div>
          </div>

          {sessionKey && (
            <div className="rounded-lg border border-white/4 bg-surface-1 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Linked Session</p>
              <p className="mt-0.5 truncate text-xs text-zinc-300">{sessionKey}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/4 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || !title.trim()}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-400 disabled:opacity-50">
            {saving ? "Creating..." : "Create Task"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Global task creation modal — renders when useTaskCreateStore has a context. */
export function TaskCreateModalGlobal() {
  const context = useTaskCreateStore((s) => s.context);
  const close = useTaskCreateStore((s) => s.closeTaskCreate);
  if (!context) return null;
  return <ModalInner context={context} onClose={close} />;
}

// Re-export for backwards compat
export type { TaskCreateContext } from "../../lib/stores/task-create-store";
