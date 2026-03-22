import { useMemo } from "react";
import type { ActivityEvent, ActivityEventKind } from "../../lib/types";

const KIND_STYLES: Record<ActivityEventKind, { border: string; dot: string; icon: string }> = {
  session_start: { border: "border-blue-400/40", dot: "bg-blue-400", icon: "S" },
  session_message: { border: "border-blue-400/40", dot: "bg-blue-400", icon: "M" },
  agent_start: { border: "border-amber-400/40", dot: "bg-amber-400", icon: "A" },
  agent_done: { border: "border-emerald-400/40", dot: "bg-emerald-400", icon: "D" },
  agent_error: { border: "border-red-400/40", dot: "bg-red-400", icon: "!" },
  task_status: { border: "border-zinc-400/30", dot: "bg-zinc-400", icon: "T" },
  cron: { border: "border-emerald-400/30", dot: "bg-emerald-400", icon: "C" },
  connection: { border: "border-zinc-500/30", dot: "bg-zinc-500", icon: "N" },
};

function formatRelative(iso: string) {
  const delta = Math.max(0, Date.now() - Date.parse(iso));
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getBucketLabel(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

  if (date >= new Date(Date.now() - 15 * 60 * 1000)) {
    return "Just now";
  }
  if (date >= startOfToday) {
    return "Earlier today";
  }
  if (date >= startOfYesterday) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ActivityFeed({
  events,
  onOpenSession,
}: {
  events: ActivityEvent[];
  onOpenSession: (key: string) => void;
}) {
  const grouped = useMemo(() => {
    const ordered = events.slice(0, 50);
    const buckets: Array<{ label: string; items: ActivityEvent[] }> = [];

    for (const event of ordered) {
      const label = getBucketLabel(event.timestamp);
      const current = buckets[buckets.length - 1];
      if (current?.label === label) {
        current.items.push(event);
      } else {
        buckets.push({ label, items: [event] });
      }
    }

    return buckets;
  }, [events]);

  return (
    <section className="rounded-lg border border-border bg-surface-1 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:p-4">
      <style>{`
        @keyframes workflow-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Activity Feed</h2>
          <p className="text-xs text-zinc-500">Recent system events, newest first.</p>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-white/4 text-sm text-zinc-600">
          No activity yet
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.label}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{group.label}</p>
              <div className="space-y-2">
                {group.items.map((event, index) => {
                  const style = KIND_STYLES[event.kind];
                  return (
                    <article
                      key={event.id}
                      className={`rounded-lg border-l-2 ${style.border} bg-surface-1 px-3 py-3`}
                      style={{
                        animation: index < 5 ? "workflow-fade-in 320ms ease-out both" : undefined,
                        animationDelay: index < 5 ? `${index * 60}ms` : undefined,
                      }}
                    >
                      <div className="flex gap-3">
                        <div className="flex shrink-0 items-start gap-2 pt-0.5">
                          <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${style.dot} text-[10px] font-semibold text-black`}>
                            {style.icon}
                          </span>
                          <span className="text-xs text-zinc-500">{formatRelative(event.timestamp)}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-zinc-200">{event.summary}</p>
                          {event.sessionKey && (
                            <button
                              type="button"
                              onClick={() => onOpenSession(event.sessionKey!)}
                              className="mt-2 min-h-7 rounded-full bg-blue-500/12 px-2 py-1 text-[10px] text-blue-300 transition-all duration-150 hover:bg-blue-500/20"
                            >
                              {event.sessionKey}
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
