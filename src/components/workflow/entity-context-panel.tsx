/**
 * Entity Context Panel — slide-out panel showing related entities for any item.
 * Shows linked tasks, sessions, projects, cron jobs, and agents.
 */

import type { EntityRef } from "../../lib/link-resolver";
import { navigate } from "../../lib/use-hash-router";
import { TASK_STATUS_META } from "../../lib/task-types";

const KIND_ICONS: Record<EntityRef["kind"], string> = {
  task: "📋",
  session: "💬",
  project: "📦",
  cron: "⏰",
  agent: "🤖",
};

const KIND_LABELS: Record<EntityRef["kind"], string> = {
  task: "Tasks",
  session: "Sessions",
  project: "Projects",
  cron: "Cron Jobs",
  agent: "Agents",
};

function EntityRefCard({ ref: entity, onClose }: { ref: EntityRef; onClose: () => void }) {
  const handleClick = () => {
    if (entity.kind === "session") {
      navigate(`#/chat/${encodeURIComponent(entity.key)}`);
      onClose();
    } else if (entity.kind === "project") {
      navigate("#/projects");
      onClose();
    } else if (entity.kind === "cron") {
      navigate("#/timeline");
      onClose();
    }
    // Tasks and agents don't navigate currently
  };

  const isClickable = entity.kind === "session" || entity.kind === "project" || entity.kind === "cron";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isClickable}
      className={`flex w-full items-center gap-2.5 rounded-lg border border-white/6 bg-zinc-950/60 px-3 py-2.5 text-left transition ${isClickable ? "cursor-pointer hover:border-white/12 hover:bg-zinc-900/80" : "cursor-default"}`}
    >
      <span className="shrink-0 text-sm">{KIND_ICONS[entity.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-100">
          {entity.kind === "task" ? entity.title :
           entity.kind === "session" ? entity.title :
           entity.kind === "project" ? entity.name :
           entity.kind === "cron" ? entity.name :
           entity.kind === "agent" ? entity.label : ""}
        </p>
        {entity.kind === "task" && (
          <span className={`inline-block mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TASK_STATUS_META[entity.status as keyof typeof TASK_STATUS_META]?.dot.replace("bg-", "text-").replace("-400", "-300")} bg-white/5`}>
            {TASK_STATUS_META[entity.status as keyof typeof TASK_STATUS_META]?.label || entity.status}
          </span>
        )}
        {entity.kind === "agent" && (
          <span className={`inline-block mt-0.5 text-[10px] ${entity.status === "running" ? "text-blue-300" : entity.status === "error" ? "text-red-300" : "text-zinc-500"}`}>
            {entity.status}
          </span>
        )}
      </div>
      {isClickable && <span className="shrink-0 text-xs text-zinc-600">→</span>}
    </button>
  );
}

export function EntityContextPanel({
  title,
  subtitle,
  refs,
  onClose,
  actions,
}: {
  title: string;
  subtitle?: string;
  refs: EntityRef[];
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  // Group refs by kind
  const grouped = new Map<EntityRef["kind"], EntityRef[]>();
  for (const ref of refs) {
    const list = grouped.get(ref.kind) ?? [];
    list.push(ref);
    grouped.set(ref.kind, list);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex w-full max-w-md flex-col border-l border-white/8 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/5 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-zinc-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="ml-3 shrink-0 text-zinc-400 hover:text-white">✕</button>
        </div>

        {/* Actions */}
        {actions && (
          <div className="flex flex-wrap gap-2 border-b border-white/5 px-5 py-3">
            {actions}
          </div>
        )}

        {/* Related entities */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {refs.length === 0 ? (
            <div className="flex min-h-32 items-center justify-center text-sm text-zinc-500">
              No linked entities found.
            </div>
          ) : (
            <div className="space-y-5">
              {Array.from(grouped.entries()).map(([kind, items]) => (
                <div key={kind}>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    {KIND_LABELS[kind]} ({items.length})
                  </h3>
                  <div className="space-y-1.5">
                    {items.map((item, i) => (
                      <EntityRefCard key={`${kind}-${i}`} ref={item} onClose={onClose} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
