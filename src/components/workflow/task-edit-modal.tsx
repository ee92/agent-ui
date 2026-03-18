import { useCallback, useEffect, useRef, useState } from "react";
import { useTaskStore } from "../../lib/stores/task-store-v2";
import { TASK_STATUS_META, TASK_TRANSITIONS, type TaskNode, type TaskStatus } from "../../lib/task-types";

export function TaskEditModal({
  task,
  onClose,
}: {
  task: TaskNode;
  onClose: () => void;
}) {
  const update = useTaskStore((s) => s.update);
  const remove = useTaskStore((s) => s.remove);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [repo, setRepo] = useState(task.repo ?? "");
  const [branch, setBranch] = useState(task.branch ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setSaving(true);
    try {
      await update(task.id, {
        title: trimmedTitle,
        notes,
        repo: repo.trim() || null,
        branch: branch.trim() || null,
        status,
      });
      onClose();
    } catch {
      setSaving(false);
    }
  }, [task.id, title, notes, repo, branch, status, update, onClose]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await remove(task.id);
      onClose();
    } catch {
      setSaving(false);
    }
  }, [task.id, confirmDelete, remove, onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  }, [onClose]);

  // Valid statuses for this task
  const validStatuses: TaskStatus[] = [task.status, ...TASK_TRANSITIONS[task.status]];
  const uniqueStatuses = [...new Set(validStatuses)];

  const hasChanges =
    title.trim() !== task.title ||
    notes !== task.notes ||
    (repo.trim() || null) !== (task.repo ?? null) ||
    (branch.trim() || null) !== (task.branch ?? null) ||
    status !== task.status;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h3 className="text-base font-semibold text-white">Edit Task</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4 px-5 py-4">
          {/* Title */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Title</label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleSave(); }}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-blue-500/50"
              placeholder="Task title..."
            />
          </div>

          {/* Status */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Status</label>
            <div className="flex flex-wrap gap-1.5">
              {uniqueStatuses.map((s) => {
                const meta = TASK_STATUS_META[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                      status === s
                        ? "bg-white/[0.1] text-white ring-1 ring-white/20"
                        : "bg-white/[0.04] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleSave(); }}
              rows={5}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-blue-500/50"
              placeholder="Notes, context, blockers..."
            />
          </div>

          {/* Repo + Branch */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Repository</label>
              <input
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-blue-500/50"
                placeholder="my-project"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">Branch</label>
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-blue-500/50"
                placeholder="feat/my-feature"
              />
            </div>
          </div>

          {/* Meta info */}
          <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
            <span>ID: {task.id}</span>
            <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
            <span>Updated: {new Date(task.updatedAt).toLocaleDateString()}</span>
            {task.sessionKeys && task.sessionKeys.length > 0 && (
              <span>Sessions: {task.sessionKeys.length}</span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 px-5 py-4">
          <button
            type="button"
            onClick={handleDelete}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              confirmDelete
                ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                : "text-zinc-500 hover:bg-white/[0.04] hover:text-red-400"
            }`}
          >
            {confirmDelete ? "Confirm delete?" : "Delete"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim() || !hasChanges}
              className="rounded-lg bg-blue-500/20 px-4 py-2 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/30 disabled:opacity-40 disabled:hover:bg-blue-500/20"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
