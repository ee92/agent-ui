import { useState } from "react";
import type { ActivityEvent, ActivityEventKind, Conversation } from "../../lib/types";
import { useActivityStore } from "../../lib/stores/activity-store";
import { useChatStore } from "../../lib/stores/chat-store";
import { navigate } from "../../lib/use-hash-router";

/* ─── Styling ─── */
const EVENT_STYLES: Record<ActivityEventKind, { icon: string; border: string; iconBg: string }> = {
  session_start: { icon: "💬", border: "border-l-blue-400", iconBg: "bg-blue-500/10" },
  session_message: { icon: "📨", border: "border-l-cyan-400", iconBg: "bg-cyan-500/10" },
  agent_start: { icon: "🤖", border: "border-l-violet-400", iconBg: "bg-violet-500/10" },
  agent_done: { icon: "✅", border: "border-l-emerald-400", iconBg: "bg-emerald-500/10" },
  agent_error: { icon: "❌", border: "border-l-rose-400", iconBg: "bg-rose-500/10" },
  task_status: { icon: "📋", border: "border-l-amber-400", iconBg: "bg-amber-500/10" },
  cron: { icon: "⏰", border: "border-l-sky-400", iconBg: "bg-sky-500/10" },
  connection: { icon: "🔌", border: "border-l-zinc-400", iconBg: "bg-zinc-500/10" },
};

/* ─── Date helpers ─── */
function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function dayKey(d: Date) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

function formatDayLabel(d: Date, today: Date) {
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, addDays(today, -1))) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/* ─── Group activity events by day ─── */
type ActivityGroup = { label: string; key: string; events: ActivityEvent[] };

function buildActivityGroups(events: ActivityEvent[]): ActivityGroup[] {
  const now = new Date();
  const sorted = [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const groups = new Map<string, ActivityGroup>();
  for (const ev of sorted) {
    const d = new Date(ev.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const day = startOfDay(d);
    const k = dayKey(day);
    const g = groups.get(k);
    if (g) { g.events.push(ev); } else { groups.set(k, { key: k, label: formatDayLabel(day, now), events: [ev] }); }
  }
  return [...groups.values()];
}

/* ─── Build 7-day week grid ─── */
type WeekDay = { date: Date; key: string; isToday: boolean; items: Conversation[] };

function buildWeekDays(conversations: Conversation[]): WeekDay[] {
  const today = startOfDay(new Date());
  const offset = (today.getDay() + 6) % 7;
  const weekStart = addDays(today, -offset);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dayStart = date.getTime();
    const dayEnd = addDays(date, 1).getTime();
    const items = conversations
      .filter((c) => { const t = new Date(c.updatedAt).getTime(); return t >= dayStart && t < dayEnd; })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { date, key: dayKey(date), isToday: isSameDay(date, today), items };
  });
}

function openChat(key: string) { navigate(`#/chat/${encodeURIComponent(key)}`); }

/* ─── Tab button ─── */
function TabButton({ label, active, count, onClick }: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
      }`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${
          active ? "bg-blue-500/20 text-blue-300" : "bg-white/[0.06] text-zinc-500"
        }`}>{count}</span>
      )}
    </button>
  );
}

/* ─── Activity Timeline panel ─── */
function ActivityTimeline({ groups }: { groups: ActivityGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">
        No activity recorded yet.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="sticky top-0 z-10 mb-3 py-1">
            <span className="inline-flex rounded-full border border-white/8 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
              {group.label}
            </span>
          </div>
          <div className="relative space-y-2 pl-5 before:absolute before:bottom-1 before:left-[9px] before:top-1 before:w-px before:bg-white/8">
            {group.events.map((event) => {
              const style = EVENT_STYLES[event.kind];
              const clickable = Boolean(event.sessionKey);
              const Wrapper = clickable ? "button" : "div";
              return (
                <Wrapper
                  key={event.id}
                  type={clickable ? "button" : undefined}
                  onClick={clickable && event.sessionKey ? () => openChat(event.sessionKey!) : undefined}
                  className={`relative block w-full rounded-xl border border-white/6 px-3 py-3 text-left transition ${
                    clickable ? "hover:border-white/12 hover:bg-zinc-950 cursor-pointer" : ""
                  } bg-zinc-950/80 ${style.border} border-l-2`}
                >
                  <div className="absolute left-[-19px] top-5 h-2.5 w-2.5 rounded-full border border-zinc-900 bg-zinc-700" />
                  <div className="flex items-start gap-3">
                    <div className="pt-0.5 text-xs tabular-nums text-zinc-500">{formatTime(event.timestamp)}</div>
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.iconBg}`}>
                      <span aria-hidden>{style.icon}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-6 text-zinc-100">{event.summary}</p>
                      {event.sessionKey && (
                        <p className="mt-1 truncate text-xs text-zinc-500">{event.sessionKey}</p>
                      )}
                    </div>
                  </div>
                </Wrapper>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Cron Calendar panel ─── */
function CronCalendar({ weekDays, cronCount }: { weekDays: WeekDay[]; cronCount: number }) {
  // On mobile, show as a list. On desktop, show as a proper grid.
  if (cronCount === 0) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">
        No cron sessions found.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {/* Mobile: stacked day cards */}
      <div className="space-y-3 xl:hidden">
        {weekDays.map((day) => (
          <div
            key={day.key}
            className={`rounded-xl border p-3 ${
              day.isToday ? "border-blue-400/20 bg-blue-500/5" : "border-white/6 bg-zinc-950/70"
            }`}
          >
            <div className="mb-2 flex items-center gap-2 border-b border-white/6 pb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {day.date.toLocaleDateString(undefined, { weekday: "short" })}
              </p>
              <p className="text-sm text-zinc-200">
                {day.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </p>
              {day.isToday && <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-300">Today</span>}
              <span className="ml-auto text-xs text-zinc-500">{day.items.length} run{day.items.length !== 1 ? "s" : ""}</span>
            </div>
            {day.items.length === 0 ? (
              <p className="py-2 text-center text-xs text-zinc-600">No runs</p>
            ) : (
              <div className="space-y-1.5">
                {day.items.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => openChat(c.key)}
                    className="flex w-full items-center justify-between rounded-lg border border-white/6 bg-zinc-900 px-3 py-2 text-left transition hover:border-white/12"
                  >
                    <span className="min-w-0 truncate text-sm text-zinc-100">{c.title?.trim() || c.key}</span>
                    <span className="ml-3 shrink-0 text-xs text-zinc-500">{formatTime(c.updatedAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop: horizontal grid */}
      <div className="hidden xl:grid xl:grid-cols-7 xl:gap-3">
        {weekDays.map((day) => (
          <div
            key={day.key}
            className={`flex flex-col rounded-xl border p-3 ${
              day.isToday ? "border-blue-400/20 bg-blue-500/5" : "border-white/6 bg-zinc-950/70"
            }`}
          >
            <div className="mb-3 border-b border-white/6 pb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {day.date.toLocaleDateString(undefined, { weekday: "short" })}
              </p>
              <p className="mt-1 text-sm text-zinc-200">
                {day.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </p>
            </div>
            {day.items.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-white/8 py-6 text-xs text-zinc-600">
                No runs
              </div>
            ) : (
              <div className="space-y-2">
                {day.items.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => openChat(c.key)}
                    className="block w-full rounded-lg border border-white/6 bg-zinc-900 px-2.5 py-2 text-left transition hover:border-white/12 hover:bg-zinc-800"
                    title={c.key}
                  >
                    <p className="truncate text-xs font-medium text-zinc-100">{c.title?.trim() || c.key}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">Last run {formatTime(c.updatedAt)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main page ─── */
type TimelineTab = "activity" | "cron";

export function TimelinePage() {
  const events = useActivityStore((s) => s.events);
  const conversations = useChatStore((s) => s.conversations);
  const [activeTab, setActiveTab] = useState<TimelineTab>("activity");

  const activityGroups = buildActivityGroups(events);
  const cronConversations = conversations.filter((c) => c.key.includes("cron:"));
  const weekDays = buildWeekDays(cronConversations);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 xl:px-5">
      {/* Header */}
      <div className="mb-3 shrink-0">
        <h1 className="text-lg font-semibold text-white">Timeline</h1>
        <p className="text-xs text-zinc-400">Activity events and scheduled cron runs.</p>
      </div>

      {/* Tab bar */}
      <div className="mb-3 flex shrink-0 items-center gap-1 rounded-xl border border-white/5 bg-black/20 p-1">
        <TabButton label="Activity" active={activeTab === "activity"} count={events.length} onClick={() => setActiveTab("activity")} />
        <TabButton label="Cron Calendar" active={activeTab === "cron"} count={cronConversations.length} onClick={() => setActiveTab("cron")} />
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {activeTab === "activity" && <ActivityTimeline groups={activityGroups} />}
        {activeTab === "cron" && <CronCalendar weekDays={weekDays} cronCount={cronConversations.length} />}
      </div>
    </div>
  );
}
