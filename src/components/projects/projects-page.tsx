import { useEffect, useMemo, useState } from "react";
import { useTaskStore } from "../../lib/stores/task-store-v2";
import { useTaskCreateStore } from "../../lib/stores/task-create-store";
import { useCronStore } from "../../lib/stores/cron-store";
import {
  useProjectStore,
  type ContainerInfo,
  type ProjectWithService,
  type UntrackedInfo,
} from "../../lib/stores/project-store";
import { useServerToken } from "../../lib/hooks/use-server-auth";
import { tasksForProject } from "../../lib/link-resolver";
import { TASK_STATUS_META } from "../../lib/task-types";
import { navigate } from "../../lib/use-hash-router";

function projectProblems(project: ProjectWithService): string[] {
  const out: string[] = [];
  if (project.git.dirty > 0) out.push(`${project.git.dirty} dirty file${project.git.dirty === 1 ? "" : "s"}`);
  if (project.git.behind > 0) out.push(`${project.git.behind} commit${project.git.behind === 1 ? "" : "s"} behind`);
  return out;
}

function StatusDot({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const cls = lower.includes("running") || lower.includes("up")
    ? "bg-[#22c55e]"
    : lower.includes("stopped") || lower.includes("down") || lower.includes("exit")
      ? "bg-[#ef4444]"
      : "bg-amber-400";
  return <span className={`h-2 w-2 rounded-full ${cls}`} aria-hidden />;
}

function StatusBadge({ issues }: { issues: string[] }) {
  if (issues.length === 0) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">✓ Clean</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">⚠ {issues.length} issue{issues.length !== 1 ? "s" : ""}</span>;
}

function ContainersPanel({ containers }: { containers: ContainerInfo[] }) {
  const [open, setOpen] = useState(false);
  if (containers.length === 0) return null;
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-white/6 bg-surface-1 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/[0.03]"
      >
        <span className="font-medium">Containers ({containers.length})</span>
        <span className={`text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {containers.map((container) => (
            <div key={container.name} className="rounded-lg border border-white/6 bg-zinc-950/70 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusDot status={container.status} />
                <span className="text-xs font-medium text-zinc-100">{container.service || container.name}</span>
                <span className="text-[11px] text-zinc-500">{container.status}</span>
                <span className="ml-auto text-[11px] text-zinc-400">{container.memory || "n/a"}</span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                Ports: {container.ports?.length ? container.ports.join(", ") : "none"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceControls({
  project,
  actionLoading,
  onStart,
  onStop,
}: {
  project: ProjectWithService;
  actionLoading: boolean;
  onStart: (name: string) => void;
  onStop: (name: string) => void;
}) {
  const service = project.service;
  if (!service) return null;
  const running = service.status === "running";
  return (
    <div className="mb-3 rounded-lg border border-white/6 bg-surface-1 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot status={service.status} />
        <p className="text-xs font-medium text-zinc-200">
          Dev Server <span className="text-zinc-400">({service.kind})</span>
        </p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${running ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
          {service.status}
        </span>
        <button
          type="button"
          disabled={actionLoading}
          onClick={() => {
            if (running) onStop(service.name);
            else onStart(service.name);
          }}
          className={`ml-auto rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            running
              ? "bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-60"
              : "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
          }`}
        >
          {actionLoading ? "Working..." : running ? "Stop" : "Start"}
        </button>
      </div>
      {typeof service.port === "number" && (
        <a
          href={`http://localhost:${service.port}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs text-sky-300 hover:text-sky-200"
        >
          localhost:{service.port}
        </a>
      )}
    </div>
  );
}

function RepoCard({ repo, expanded, onToggle, relatedTasks, relatedCrons, onCreateTask, actionLoading, onStartService, onStopService }: {
  repo: ProjectWithService;
  expanded: boolean;
  onToggle: () => void;
  relatedTasks: { id: string; title: string; status: string }[];
  relatedCrons: { id: string; name: string }[];
  onCreateTask: () => void;
  actionLoading: boolean;
  onStartService: (name: string) => void;
  onStopService: (name: string) => void;
}) {
  const issues = projectProblems(repo);

  return (
    <div className={`rounded-xl border transition-colors ${issues.length > 0 ? "border-amber-500/15 bg-amber-500/[0.02]" : "border-white/6 bg-zinc-950/70"}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        {/* Icon */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-lg">
          📦
        </div>

        {/* Main info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{repo.name}</h3>
            <StatusBadge issues={issues} />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
            {/* Branch */}
            <span className="inline-flex items-center gap-1">
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" /></svg>
              <span className="font-medium text-zinc-200">{repo.git.branch}</span>
            </span>

            {/* Branches count */}
            <span>{repo.git.branches} branch{repo.git.branches !== 1 ? "es" : ""}</span>

            {/* Ahead/behind */}
            {repo.git.ahead > 0 && <span className="text-blue-300">↑{repo.git.ahead}</span>}
            {repo.git.behind > 0 && <span className="text-amber-300">↓{repo.git.behind}</span>}
            {repo.git.dirty > 0 && <span className="text-amber-300">●{repo.git.dirty} dirty</span>}

            {/* Container and service badges */}
            {repo.containers?.length > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {repo.containers.length} container{repo.containers.length !== 1 ? "s" : ""}
              </span>
            )}
            {repo.service && (
              <span className={`inline-flex items-center gap-1 ${repo.service.status === "running" ? "text-emerald-400" : "text-zinc-500"}`}>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${repo.service.status === "running" ? "bg-emerald-400" : "bg-zinc-600"}`} />
                {repo.service.status === "running" ? "serving" : "stopped"}
                {repo.service.port ? ` :${repo.service.port}` : ""}
              </span>
            )}
          </div>

          {/* Last commit message */}
          {repo.git.lastCommitMsg && (
            <p className="mt-1.5 text-xs leading-5 text-zinc-500">{repo.git.lastCommitMsg}</p>
          )}
        </div>

        {/* Expand indicator */}
        <span className={`mt-1 text-xs text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/4 px-4 pb-4 pt-3">
          <ServiceControls
            project={repo}
            actionLoading={actionLoading}
            onStart={onStartService}
            onStop={onStopService}
          />
          <ContainersPanel containers={repo.containers} />

          {/* Path */}
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Path</p>
            <p className="mt-0.5 font-mono text-xs text-zinc-300">{repo.dir}</p>
          </div>

          {/* Problems */}
          {issues.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Issues</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {issues.map((p) => (
                  <span key={p} className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">{p}</span>
                ))}
              </div>
            </div>
          )}

          {/* Related tasks */}
          {relatedTasks.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Linked Tasks ({relatedTasks.length})</p>
              <div className="mt-1.5 space-y-1">
                {relatedTasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/4 bg-surface-1 px-3 py-1.5">
                    <span className={`h-2 w-2 rounded-full ${TASK_STATUS_META[t.status as keyof typeof TASK_STATUS_META]?.dot || "bg-zinc-500"}`} />
                    <span className="min-w-0 truncate text-xs text-zinc-200">{t.title}</span>
                    <span className="ml-auto text-[10px] text-zinc-500">{TASK_STATUS_META[t.status as keyof typeof TASK_STATUS_META]?.label || t.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Related cron jobs */}
          {relatedCrons.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Cron Jobs ({relatedCrons.length})</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {relatedCrons.map((c) => (
                  <button key={c.id} type="button" onClick={() => navigate("#/timeline")} className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-xs text-sky-300 hover:bg-sky-500/20">⏰ {c.name}</button>
                ))}
              </div>
            </div>
          )}

          {/* Quick action */}
          <button type="button" onClick={onCreateTask} className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20">📌 Create Task for {repo.name}</button>
        </div>
      )}
    </div>
  );
}

function UntrackedSection({ untracked }: { untracked: UntrackedInfo }) {
  return (
    <div className="mt-4 rounded-xl border border-white/6 bg-zinc-950/70 p-4">
      <h2 className="text-sm font-semibold text-white">Untracked</h2>
      <p className="mt-0.5 text-xs text-zinc-400">Resources not mapped to a known project.</p>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-white/6 bg-surface-1 p-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Orphan Containers ({untracked.containers.length})</p>
          {untracked.containers.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">None</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {untracked.containers.map((container) => (
                <div key={container.name} className="rounded-md border border-white/6 bg-zinc-950/70 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <StatusDot status={container.status} />
                    <span className="text-xs text-zinc-200">{container.service || container.name}</span>
                    <span className="ml-auto text-[11px] text-zinc-400">{container.memory || "n/a"}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-500">{container.ports?.length ? container.ports.join(", ") : "No published ports"}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-white/6 bg-surface-1 p-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Listening Ports ({untracked.ports.length})</p>
          {untracked.ports.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">None</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {untracked.ports.map((portInfo) => (
                <div key={`${portInfo.bind}:${portInfo.port}:${portInfo.pid ?? "none"}`} className="rounded-md border border-white/6 bg-zinc-950/70 px-2.5 py-2 text-xs text-zinc-300">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <a href={`http://localhost:${portInfo.port}`} target="_blank" rel="noreferrer" className="font-medium text-sky-300 hover:text-sky-200">
                      {portInfo.bind}:{portInfo.port}
                    </a>
                    <span className="text-zinc-500">PID {portInfo.pid ?? "n/a"}</span>
                    <span className="text-zinc-500">{portInfo.process || "unknown process"}</span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">{portInfo.cwd || "cwd unavailable"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const serverToken = useServerToken();
  const allTasks = useTaskStore((s) => s.tasks);
  const cronJobs = useCronStore((s) => s.jobs);
  const openTaskCreate = useTaskCreateStore((s) => s.openTaskCreate);
  const projects = useProjectStore((s) => s.projects);
  const untracked = useProjectStore((s) => s.untracked);
  const loading = useProjectStore((s) => s.loading);
  const error = useProjectStore((s) => s.error);
  const load = useProjectStore((s) => s.load);
  const startPolling = useProjectStore((s) => s.startPolling);
  const stopPolling = useProjectStore((s) => s.stopPolling);
  const startService = useProjectStore((s) => s.startService);
  const stopService = useProjectStore((s) => s.stopService);
  const actionLoadingByName = useProjectStore((s) => s.actionLoadingByName);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "running" | "dirty" | "clean">("all");

  useEffect(() => {
    void load(serverToken);
    startPolling(serverToken, 15_000);
    return () => {
      stopPolling();
    };
  }, [serverToken, load, startPolling, stopPolling]);

  const toggle = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
  };

  // Compute related entities per repo
  const repoRelations = useMemo(() => {
    const map = new Map<string, { tasks: { id: string; title: string; status: string }[]; crons: { id: string; name: string }[] }>();
    for (const repo of projects) {
      const tasks = tasksForProject(allTasks, repo.name)
        .filter((t) => t.status !== "done")
        .map((t) => ({ id: t.id, title: t.title, status: t.status }));
      const lower = repo.name.toLowerCase();
      const crons = cronJobs
        .filter((c) => c.name.toLowerCase().includes(lower) || (c.description || "").toLowerCase().includes(lower))
        .map((c) => ({ id: c.id, name: c.name }));
      map.set(repo.dir, { tasks, crons });
    }
    return map;
  }, [projects, allTasks, cronJobs]);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => {
      // Running services first
      const aRunning = (a.containers?.length > 0 || a.service?.status === "running") ? 1 : 0;
      const bRunning = (b.containers?.length > 0 || b.service?.status === "running") ? 1 : 0;
      if (bRunning !== aRunning) return bRunning - aRunning;
      // Then by issues
      const issuesDiff = projectProblems(b).length - projectProblems(a).length;
      if (issuesDiff !== 0) return issuesDiff;
      return a.name.localeCompare(b.name);
    }),
    [projects],
  );

  const isRunning = (r: ProjectWithService) => (r.containers?.length > 0 || r.service?.status === "running");
  const filtered = filter === "all"
    ? sortedProjects
    : filter === "running"
      ? sortedProjects.filter(isRunning)
      : filter === "dirty"
        ? sortedProjects.filter((r) => projectProblems(r).length > 0)
        : sortedProjects.filter((r) => projectProblems(r).length === 0);
  const runningCount = sortedProjects.filter(isRunning).length;
  const dirtyCount = sortedProjects.filter((r) => projectProblems(r).length > 0).length;
  const cleanCount = sortedProjects.length - dirtyCount;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 xl:px-5">
      <div className="mb-3 shrink-0">
        <h1 className="text-lg font-semibold text-white">Projects</h1>
        <p className="text-xs text-zinc-400">Local git repositories, containers, and service status.</p>
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex shrink-0 items-center gap-1 rounded-lg border border-white/4 bg-surface-1 p-1">
        <FilterBtn label="All" count={sortedProjects.length} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterBtn label="Running" count={runningCount} active={filter === "running"} onClick={() => setFilter("running")} />
        <FilterBtn label="Needs attention" count={dirtyCount} active={filter === "dirty"} onClick={() => setFilter("dirty")} />
        <FilterBtn label="Clean" count={cleanCount} active={filter === "clean"} onClick={() => setFilter("clean")} />
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {loading && (
          <div className="flex min-h-40 items-center justify-center text-sm text-zinc-500">
            Loading projects...
          </div>
        )}
        {error && (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-red-500/20 text-sm text-red-300">
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-white/4 text-sm text-zinc-500">
            No projects found.
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="space-y-2 pb-1">
            {filtered.map((repo) => {
              const rels = repoRelations.get(repo.dir) ?? { tasks: [], crons: [] };
              return (
                <RepoCard
                  key={repo.dir}
                  repo={repo}
                  expanded={expanded.has(repo.dir)}
                  onToggle={() => toggle(repo.dir)}
                  relatedTasks={rels.tasks}
                  relatedCrons={rels.crons}
                  onCreateTask={() => openTaskCreate({ title: `[${repo.name}] `, repo: repo.name, sourceLabel: `Project: ${repo.name}` })}
                  actionLoading={Boolean(actionLoadingByName[repo.service?.name || ""])}
                  onStartService={(name) => { void startService(name, serverToken); }}
                  onStopService={(name) => { void stopService(name, serverToken); }}
                />
              );
            })}
          </div>
        )}
        {!loading && !error && <UntrackedSection untracked={untracked} />}
      </div>
    </div>
  );
}

function FilterBtn({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
      }`}
    >
      {label}
      {count > 0 && (
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
          active ? "bg-blue-500/20 text-blue-300" : "bg-white/[0.06] text-zinc-500"
        }`}>{count}</span>
      )}
    </button>
  );
}
