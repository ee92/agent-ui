import { useEffect, useState } from "react";
import type { ActivityEvent, ActivityEventKind } from "../../lib/types";
import { useActivityStore } from "../../lib/stores/activity-store";
import { useCronStore, type CronJob } from "../../lib/stores/cron-store";
import { useTaskCreateStore } from "../../lib/stores/task-create-store";
import { useAdapterStore } from "../../lib/adapters";
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

/* ─── Date helpers (all browser local timezone) ─── */
function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function dayKey(d: Date) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

function formatDayLabel(d: Date, today: Date) {
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, addDays(today, -1))) return "Yesterday";
  if (isSameDay(d, addDays(today, 1))) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTimeIso(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSchedule(s: CronJob["schedule"]): string {
  if (s.kind === "cron") return s.expr + (s.tz ? ` (${s.tz})` : "");
  if (s.kind === "every") {
    const mins = Math.round(s.everyMs / 60000);
    if (mins < 60) return `Every ${mins}m`;
    const hrs = Math.round(mins / 60);
    return `Every ${hrs}h`;
  }
  if (s.kind === "at") return `Once at ${new Date(s.at).toLocaleString()}`;
  return "Unknown";
}

function getPayloadMessage(p: CronJob["payload"]): string {
  if (p.kind === "agentTurn") return p.message;
  if (p.kind === "systemEvent") return p.text;
  return "";
}

/* ─── Tab button ─── */
function TabButton({ label, active, count, onClick }: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"}`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${active ? "bg-blue-500/20 text-blue-300" : "bg-white/[0.06] text-zinc-500"}`}>{count}</span>
      )}
    </button>
  );
}

/* ─── Activity Timeline panel ─── */
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
    if (g) g.events.push(ev); else groups.set(k, { key: k, label: formatDayLabel(day, now), events: [ev] });
  }
  return [...groups.values()];
}

function ActivityTimeline({ groups }: { groups: ActivityGroup[] }) {
  if (groups.length === 0) {
    return <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">No activity recorded yet.</div>;
  }
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="sticky top-0 z-10 mb-3 py-1">
            <span className="inline-flex rounded-full border border-white/8 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">{group.label}</span>
          </div>
          <div className="relative space-y-2 pl-5 before:absolute before:bottom-1 before:left-[9px] before:top-1 before:w-px before:bg-white/8">
            {group.events.map((event) => {
              const style = EVENT_STYLES[event.kind];
              const clickable = Boolean(event.sessionKey);
              const Wrapper = clickable ? "button" : "div";
              return (
                <Wrapper key={event.id} type={clickable ? "button" : undefined}
                  onClick={clickable && event.sessionKey ? () => navigate(`#/chat/${encodeURIComponent(event.sessionKey!)}`) : undefined}
                  className={`relative block w-full rounded-xl border border-white/6 px-3 py-3 text-left transition ${clickable ? "hover:border-white/12 cursor-pointer" : ""} bg-zinc-950/80 ${style.border} border-l-2`}>
                  <div className="absolute left-[-19px] top-5 h-2.5 w-2.5 rounded-full border border-zinc-900 bg-zinc-700" />
                  <div className="flex items-start gap-3">
                    <div className="pt-0.5 text-xs tabular-nums text-zinc-500">{formatTimeIso(event.timestamp)}</div>
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${style.iconBg}`}><span aria-hidden>{style.icon}</span></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-6 text-zinc-100">{event.summary}</p>
                      {event.sessionKey && <p className="mt-1 truncate text-xs text-zinc-500">{event.sessionKey}</p>}
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

/* ─── Cron Job Card ─── */
function CronJobCard({ job, onEdit, onRun, onCreateTask }: { job: CronJob; onEdit: () => void; onRun: () => void; onCreateTask: () => void }) {
  const nextRun = job.state.nextRunAtMs;
  const lastRun = job.state.lastRunAtMs;
  const status = job.state.lastRunStatus;

  return (
    <div className={`rounded-xl border transition-colors ${!job.enabled ? "border-white/4 bg-zinc-950/40 opacity-60" : status === "error" ? "border-red-500/15 bg-red-500/[0.02]" : "border-white/6 bg-zinc-950/70"}`}>
      <button type="button" onClick={onEdit} className="flex w-full items-start gap-3 p-4 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-lg">⏰</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{job.name}</h3>
            {!job.enabled && <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-medium text-zinc-500">Disabled</span>}
            {status === "error" && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300">Error</span>}
            {status === "ok" && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">OK</span>}
          </div>
          {job.description && <p className="mt-0.5 text-xs text-zinc-500">{job.description}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
            <span className="font-mono text-zinc-300">{formatSchedule(job.schedule)}</span>
            {nextRun && <span>Next: <span className="text-blue-300">{formatTime(nextRun)}</span></span>}
            {lastRun && <span>Last: {formatTime(lastRun)}</span>}
            {job.state.lastDurationMs != null && <span>{Math.round(job.state.lastDurationMs / 1000)}s</span>}
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500">{getPayloadMessage(job.payload)}</p>
        </div>
        <span className="mt-1 text-xs text-zinc-500">✏️</span>
      </button>
      <div className="flex items-center gap-2 border-t border-white/5 px-4 py-2">
        <button type="button" onClick={onRun} className="rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/20">Run Now</button>
        <button type="button" onClick={onCreateTask} className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20">📌 Task</button>
        {job.sessionKey && (
          <button type="button" onClick={() => navigate(`#/chat/${encodeURIComponent(job.sessionKey!)}`)} className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/[0.06]">View Session</button>
        )}
      </div>
    </div>
  );
}

/* ─── Cron Editor Modal ─── */
function CronEditor({ job, onClose, onSave }: { job: CronJob; onClose: () => void; onSave: (id: string, patch: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(job.name);
  const [description, setDescription] = useState(job.description ?? "");
  const [enabled, setEnabled] = useState(job.enabled);
  const [message, setMessage] = useState(getPayloadMessage(job.payload));
  const [scheduleExpr, setScheduleExpr] = useState(job.schedule.kind === "cron" ? job.schedule.expr : "");
  const [scheduleEveryMin, setScheduleEveryMin] = useState(job.schedule.kind === "every" ? Math.round(job.schedule.everyMs / 60000) : 60);
  const [scheduleKind, setScheduleKind] = useState(job.schedule.kind);
  const [model, setModel] = useState(job.payload.kind === "agentTurn" ? (job.payload.model ?? "") : "");
  const [thinking, setThinking] = useState(job.payload.kind === "agentTurn" ? (job.payload.thinking ?? "") : "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const patch: Record<string, unknown> = { name, description: description || undefined, enabled };

    // Build schedule
    if (scheduleKind === "cron" && scheduleExpr.trim()) {
      patch.schedule = { kind: "cron", expr: scheduleExpr.trim() };
    } else if (scheduleKind === "every") {
      patch.schedule = { kind: "every", everyMs: scheduleEveryMin * 60000 };
    }

    // Build payload
    if (job.payload.kind === "agentTurn") {
      const p: Record<string, unknown> = { kind: "agentTurn", message: message.trim() || undefined };
      if (model.trim()) p.model = model.trim();
      if (thinking.trim()) p.thinking = thinking.trim();
      patch.payload = p;
    } else {
      patch.payload = { kind: "systemEvent", text: message.trim() || undefined };
    }

    try {
      await onSave(job.id, patch);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/8 bg-zinc-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Edit Cron Job</h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">✕</button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50" />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50" placeholder="Optional" />
          </div>

          {/* Schedule */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Schedule</label>
            <div className="mb-2 flex gap-2">
              <button type="button" onClick={() => setScheduleKind("cron")} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${scheduleKind === "cron" ? "bg-blue-500/20 text-blue-300" : "bg-white/[0.04] text-zinc-400"}`}>Cron Expression</button>
              <button type="button" onClick={() => setScheduleKind("every")} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${scheduleKind === "every" ? "bg-blue-500/20 text-blue-300" : "bg-white/[0.04] text-zinc-400"}`}>Interval</button>
            </div>
            {scheduleKind === "cron" ? (
              <input value={scheduleExpr} onChange={(e) => setScheduleExpr(e.target.value)} placeholder="0 9 * * *" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:border-blue-500/50" />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Every</span>
                <input type="number" value={scheduleEveryMin} onChange={(e) => setScheduleEveryMin(Number(e.target.value) || 1)} min={1} className="w-20 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50" />
                <span className="text-xs text-zinc-400">minutes</span>
              </div>
            )}
          </div>

          {/* Instructions / Message */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              {job.payload.kind === "agentTurn" ? "Instructions (prompt)" : "System Event Text"}
            </label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50" />
          </div>

          {/* Model + Thinking (for agentTurn only) */}
          {job.payload.kind === "agentTurn" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Model</label>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Default" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Thinking</label>
                <input value={thinking} onChange={(e) => setThinking(e.target.value)} placeholder="off" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50" />
              </div>
            </div>
          )}

          {/* Enabled */}
          <label className="flex items-center gap-3 text-sm text-zinc-200">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-black/30" />
            Enabled
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/5 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-400 disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Cron Schedule panel (with future + past) ─── */
function CronSchedulePanel({ jobs, onEdit, onRun }: { jobs: CronJob[]; onEdit: (job: CronJob) => void; onRun: (id: string) => void }) {
  const now = Date.now();
  const today = startOfDay(new Date());

  // Build 14-day view: 7 days back + 7 days forward
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(today, i - 3); // 3 days back, today, 10 days forward
    return { date, key: dayKey(date), isToday: isSameDay(date, today), isPast: date < today && !isSameDay(date, today) };
  });

  // Map jobs to days based on nextRunAtMs and lastRunAtMs
  const jobsByDay = new Map<string, Array<{ job: CronJob; time: number; isFuture: boolean }>>();
  for (const day of days) jobsByDay.set(day.key, []);

  for (const job of jobs) {
    // Place on next run day
    if (job.state.nextRunAtMs) {
      const d = new Date(job.state.nextRunAtMs);
      const k = dayKey(startOfDay(d));
      const bucket = jobsByDay.get(k);
      if (bucket) bucket.push({ job, time: job.state.nextRunAtMs, isFuture: job.state.nextRunAtMs > now });
    }
    // Place on last run day
    if (job.state.lastRunAtMs) {
      const d = new Date(job.state.lastRunAtMs);
      const k = dayKey(startOfDay(d));
      const bucket = jobsByDay.get(k);
      if (bucket && !bucket.some((e) => e.job.id === job.id)) {
        bucket.push({ job, time: job.state.lastRunAtMs, isFuture: false });
      }
    }
  }

  // Sort entries within each day by time
  for (const entries of jobsByDay.values()) entries.sort((a, b) => a.time - b.time);

  if (jobs.length === 0) {
    return <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">No cron jobs configured.</div>;
  }

  return (
    <div className="space-y-2">
      {days.map((day) => {
        const entries = jobsByDay.get(day.key) ?? [];
        if (entries.length === 0 && day.isPast) return null; // Skip empty past days
        return (
          <div key={day.key} className={`rounded-xl border p-3 ${day.isToday ? "border-blue-400/20 bg-blue-500/5" : day.isPast ? "border-white/4 bg-zinc-950/40 opacity-70" : "border-white/6 bg-zinc-950/70"}`}>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-sm font-semibold text-zinc-200">{formatDayLabel(day.date, today)}</p>
              {day.isToday && <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-300">Today</span>}
              <span className="ml-auto text-xs text-zinc-500">{entries.length} job{entries.length !== 1 ? "s" : ""}</span>
            </div>
            {entries.length === 0 ? (
              <p className="py-2 text-center text-xs text-zinc-600">No scheduled runs</p>
            ) : (
              <div className="space-y-1.5">
                {entries.map((entry) => (
                  <button key={`${entry.job.id}-${entry.time}`} type="button" onClick={() => onEdit(entry.job)}
                    className="flex w-full items-center justify-between rounded-lg border border-white/6 bg-zinc-900 px-3 py-2 text-left transition hover:border-white/12">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${entry.isFuture ? "bg-blue-400" : entry.job.state.lastRunStatus === "error" ? "bg-red-400" : "bg-emerald-400"}`} />
                      <span className="min-w-0 truncate text-sm text-zinc-100">{entry.job.name}</span>
                      {!entry.job.enabled && <span className="text-[10px] text-zinc-500">(off)</span>}
                    </div>
                    <span className={`ml-3 shrink-0 text-xs ${entry.isFuture ? "text-blue-300" : "text-zinc-500"}`}>{formatTime(entry.time)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── All Cron Jobs list ─── */
function CronJobsList({ jobs, onEdit, onRun, onCreateTask }: { jobs: CronJob[]; onEdit: (job: CronJob) => void; onRun: (id: string) => void; onCreateTask: (job: CronJob) => void }) {
  if (jobs.length === 0) {
    return <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">No cron jobs configured.</div>;
  }
  return (
    <div className="space-y-2">
      {jobs.map((job) => <CronJobCard key={job.id} job={job} onEdit={() => onEdit(job)} onRun={() => onRun(job.id)} onCreateTask={() => onCreateTask(job)} />)}
    </div>
  );
}

/* ─── Main page ─── */
type TimelineTab = "activity" | "schedule" | "crons";

export function TimelinePage() {
  const events = useActivityStore((s) => s.events);
  const adapter = useAdapterStore((s) => s.adapter);
  const adapterConnected = useAdapterStore((s) => s.connected);
  const { jobs, loading, loadJobs, updateJob, runJob } = useCronStore();
  const openTaskCreate = useTaskCreateStore((s) => s.openTaskCreate);
  const [activeTab, setActiveTab] = useState<TimelineTab>("schedule");
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);

  const handleCreateTaskFromCron = (job: CronJob) => {
    const msg = getPayloadMessage(job.payload);
    openTaskCreate({
      title: `[Cron] ${job.name}`,
      notes: job.state.lastError ? `Last error: ${job.state.lastError}\n\nPrompt: ${msg.slice(0, 300)}` : msg.slice(0, 400),
      sessionKey: job.sessionKey || undefined,
      sourceLabel: `From cron: ${job.name}`,
    });
  };

  useEffect(() => {
    if (adapter.capabilities().crons) {
      void loadJobs();
    }
  }, [adapter, adapterConnected, loadJobs]);

  const activityGroups = buildActivityGroups(events);
  const enabledJobs = jobs.filter((j) => j.enabled);
  const cronsAvailable = adapter.capabilities().crons;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 xl:px-5">
      <div className="mb-3 shrink-0">
        <h1 className="text-lg font-semibold text-white">Timeline</h1>
        <p className="text-xs text-zinc-400">Activity log, cron schedule, and job management.</p>
      </div>

      <div className="mb-3 flex shrink-0 items-center gap-1 rounded-xl border border-white/5 bg-black/20 p-1">
        <TabButton label="Schedule" active={activeTab === "schedule"} count={enabledJobs.length} onClick={() => setActiveTab("schedule")} />
        <TabButton label="All Jobs" active={activeTab === "crons"} count={jobs.length} onClick={() => setActiveTab("crons")} />
        <TabButton label="Activity" active={activeTab === "activity"} count={events.length} onClick={() => setActiveTab("activity")} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {!cronsAvailable && activeTab !== "activity" && (
          <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">
            Cron jobs require OpenClaw gateway.
          </div>
        )}
        {loading && <div className="flex min-h-40 items-center justify-center text-sm text-zinc-500">Loading cron jobs...</div>}
        {!loading && cronsAvailable && activeTab === "schedule" && <CronSchedulePanel jobs={enabledJobs} onEdit={setEditingJob} onRun={runJob} />}
        {!loading && cronsAvailable && activeTab === "crons" && <CronJobsList jobs={jobs} onEdit={setEditingJob} onRun={runJob} onCreateTask={handleCreateTaskFromCron} />}
        {activeTab === "activity" && <ActivityTimeline groups={activityGroups} />}
      </div>

      {editingJob && cronsAvailable && <CronEditor job={editingJob} onClose={() => setEditingJob(null)} onSave={updateJob} />}
    </div>
  );
}
