import type { ActivityEvent, ActivityEventKind, Conversation } from "../../lib/types";
import { useActivityStore } from "../../lib/stores/activity-store";
import { useChatStore } from "../../lib/stores/chat-store";
import { navigate } from "../../lib/use-hash-router";

const EVENT_STYLES: Record<ActivityEventKind, { icon: string; border: string; iconBg: string; iconText: string }> = {
  session_start: {
    icon: "💬",
    border: "border-l-blue-400",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-300",
  },
  session_message: {
    icon: "📨",
    border: "border-l-cyan-400",
    iconBg: "bg-cyan-500/10",
    iconText: "text-cyan-300",
  },
  agent_start: {
    icon: "🤖",
    border: "border-l-violet-400",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-300",
  },
  agent_done: {
    icon: "✅",
    border: "border-l-emerald-400",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-300",
  },
  agent_error: {
    icon: "❌",
    border: "border-l-rose-400",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-300",
  },
  task_status: {
    icon: "📋",
    border: "border-l-amber-400",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-300",
  },
  cron: {
    icon: "⏰",
    border: "border-l-sky-400",
    iconBg: "bg-sky-500/10",
    iconText: "text-sky-300",
  },
  connection: {
    icon: "🔌",
    border: "border-l-zinc-400",
    iconBg: "bg-zinc-500/10",
    iconText: "text-zinc-300",
  },
};

type ActivityGroup = {
  label: string;
  key: string;
  events: ActivityEvent[];
};

type WeekDay = {
  date: Date;
  key: string;
  isToday: boolean;
  items: Conversation[];
};

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayLabel(value: Date, today: Date): string {
  const todayStart = startOfDay(today);
  if (isSameDay(value, todayStart)) {
    return "Today";
  }
  if (isSameDay(value, addDays(todayStart, -1))) {
    return "Yesterday";
  }
  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toDayKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

function buildActivityGroups(events: ActivityEvent[]): ActivityGroup[] {
  const now = new Date();
  const sorted = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const groups = new Map<string, ActivityGroup>();

  for (const event of sorted) {
    const date = new Date(event.timestamp);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    const day = startOfDay(date);
    const key = toDayKey(day);
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(event);
      continue;
    }
    groups.set(key, {
      key,
      label: formatDayLabel(day, now),
      events: [event],
    });
  }

  return [...groups.values()];
}

function buildWeekDays(conversations: Conversation[]): WeekDay[] {
  const today = startOfDay(new Date());
  const dayOffset = (today.getDay() + 6) % 7;
  const weekStart = addDays(today, -dayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const dayStart = date.getTime();
    const dayEnd = addDays(date, 1).getTime();
    const items = conversations
      .filter((conversation) => {
        const updatedAt = new Date(conversation.updatedAt).getTime();
        return updatedAt >= dayStart && updatedAt < dayEnd;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return {
      date,
      key: toDayKey(date),
      isToday: isSameDay(date, today),
      items,
    };
  });
}

function getConversationLabel(conversation: Conversation): string {
  const source = conversation.title?.trim() || conversation.key;
  return source;
}

function openChat(sessionKey: string) {
  navigate(`#/chat/${encodeURIComponent(sessionKey)}`);
}

export function TimelinePage() {
  const events = useActivityStore((state) => state.events);
  const conversations = useChatStore((state) => state.conversations);

  const activityGroups = buildActivityGroups(events);
  const cronConversations = conversations.filter((conversation) => conversation.key.includes("cron:"));
  const weekDays = buildWeekDays(cronConversations);

  return (
    <div className="min-h-full bg-zinc-950 px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Timeline</h1>
          <p className="mt-1 text-sm text-zinc-400">Activity events and cron session history for the current week.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <section className="lg:col-span-3">
            <div className="rounded-2xl border border-white/8 bg-zinc-900/90 p-4 shadow-2xl shadow-black/20">
              <div className="mb-4 flex items-end justify-between gap-3 border-b border-white/6 pb-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Activity Timeline</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    {events.length} event{events.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              {activityGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-zinc-950/60 px-4 py-10 text-center text-sm text-zinc-500">
                  No activity recorded yet.
                </div>
              ) : (
                <div className="space-y-6">
                  {activityGroups.map((group) => (
                    <div key={group.key}>
                      <div className="sticky top-0 z-10 mb-3 bg-zinc-900/95 py-1">
                        <div className="inline-flex rounded-full border border-white/8 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                          {group.label}
                        </div>
                      </div>

                      <div className="relative space-y-3 pl-5 before:absolute before:bottom-1 before:left-[9px] before:top-1 before:w-px before:bg-white/8">
                        {group.events.map((event) => {
                          const style = EVENT_STYLES[event.kind];
                          const clickable = Boolean(event.sessionKey);
                          const content = (
                            <>
                              <div className="flex items-start gap-3">
                                <div className="pt-0.5 text-xs tabular-nums text-zinc-500">{formatTime(event.timestamp)}</div>
                                <div
                                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.iconBg} ${style.iconText}`}
                                >
                                  <span aria-hidden="true">{style.icon}</span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm leading-6 text-zinc-100">{event.summary}</p>
                                  {event.sessionKey ? (
                                    <p className="mt-1 truncate text-xs text-zinc-500">{event.sessionKey}</p>
                                  ) : null}
                                </div>
                              </div>
                            </>
                          );

                          if (clickable && event.sessionKey) {
                            const sessionKey = event.sessionKey;
                            return (
                              <button
                                key={event.id}
                                type="button"
                                onClick={() => openChat(sessionKey)}
                                className={`relative block w-full rounded-xl border border-white/6 bg-zinc-950/80 px-3 py-3 text-left transition hover:border-white/12 hover:bg-zinc-950 ${style.border} border-l-2`}
                              >
                                <div className="absolute left-[-19px] top-5 h-2.5 w-2.5 rounded-full border border-zinc-900 bg-zinc-700" />
                                {content}
                              </button>
                            );
                          }

                          return (
                            <div
                              key={event.id}
                              className={`relative rounded-xl border border-white/6 bg-zinc-950/70 px-3 py-3 ${style.border} border-l-2`}
                            >
                              <div className="absolute left-[-19px] top-5 h-2.5 w-2.5 rounded-full border border-zinc-900 bg-zinc-700" />
                              {content}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="lg:col-span-2">
            <div className="rounded-2xl border border-white/8 bg-zinc-900/90 p-4 shadow-2xl shadow-black/20">
              <div className="mb-4 flex items-end justify-between gap-3 border-b border-white/6 pb-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Cron Calendar</h2>
                  <p className="mt-1 text-xs text-zinc-500">Mon-Sun view of cron sessions updated this week.</p>
                </div>
              </div>

              <div className="-mx-1 overflow-x-auto px-1">
                <div className="grid min-w-[42rem] grid-cols-7 gap-3">
                  {weekDays.map((day) => (
                    <div
                      key={day.key}
                      className={`rounded-xl border p-3 ${
                        day.isToday
                          ? "border-blue-400/20 bg-blue-500/5"
                          : "border-white/6 bg-zinc-950/70"
                      }`}
                    >
                      <div className="mb-3 border-b border-white/6 pb-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                          {day.date.toLocaleDateString(undefined, { weekday: "short" })}
                        </p>
                        <p className="mt-1 text-sm text-zinc-200">
                          {day.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </p>
                      </div>

                      {day.items.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-white/8 px-2 py-6 text-center text-xs text-zinc-600">
                          No runs
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {day.items.map((conversation) => (
                            <button
                              key={conversation.key}
                              type="button"
                              onClick={() => openChat(conversation.key)}
                              className="block w-full rounded-lg border border-white/6 bg-zinc-900 px-2.5 py-2 text-left transition hover:border-white/12 hover:bg-zinc-800"
                              title={conversation.key}
                            >
                              <p className="truncate text-xs font-medium text-zinc-100">
                                {getConversationLabel(conversation)}
                              </p>
                              <p className="mt-1 text-[11px] text-zinc-500">
                                Last run {formatTime(conversation.updatedAt)}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {cronConversations.length === 0 ? (
                <p className="mt-4 text-xs text-zinc-500">No cron conversations found.</p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
