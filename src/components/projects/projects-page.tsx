import { useEffect, useState, useMemo, useCallback } from "react";
import { useTaskStore } from "../../lib/stores/task-store-v2";
import { useTaskCreateStore } from "../../lib/stores/task-create-store";
import { useCronStore } from "../../lib/stores/cron-store";
import { useServerToken } from "../../lib/hooks/use-server-auth";
import { tasksForProject } from "../../lib/link-resolver";
import { TASK_STATUS_META } from "../../lib/task-types";
import { navigate } from "../../lib/use-hash-router";

/* ── Types ── */

type ContainerInfo = {
  name: string;
  service: string;
  status: string;
  memory: string;
  ports: string[];
};

type ServiceInfo = {
  name: string;
  kind: "process" | "docker";
  status: "running" | "stopped";
  port?: number;
  description?: string;
};

type Project = {
  name: string;
  dir: string;
  git: {
    branch: string;
    dirty: number;
    ahead: number;
    behind: number;
    lastCommitMsg: string;
    branches: number;
  };
  containers: ContainerInfo[];
  tasks: { id: string; title: string; status: string }[];
};

type UntrackedInfo = {
  containers: ContainerInfo[];
  ports: { port: number; bind: string; pid: number | null; process: string; cwd: string }[];
};

/* ── Small components ── */

function StatusBadge({ problems }: { problems: string[] }) {
  if (problems.length === 0) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">✓ Clean</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">⚠ {problems.length} issue{problems.length !== 1 ? "s" : ""}</span>;
}

function projectProblems(p: Project): string[] {
  const out: string[] = [];
  if (p.git.dirty > 0) out.push(`${p.git.dirty} dirty files`);
  if (p.git.behind > 0) out.push(`${p.git.behind} behind remote`);
  if (p.git.ahead > 0) out.push(`${p.git.ahead} unpushed`);
  return out;
}

function ContainerRow({ c }: { c: ContainerInfo }) {
  const up = c.status?.toLowerCase().includes("up");
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${up ? "bg-emerald-400" : "bg-red-400"}`} />
      <span className="font-medium text-zinc-200">{c.service || c.name}</span>
      <span className="text-zinc-500">{c.memory || ""}</span>
      {c.ports.length > 0 && <span className="text-zinc-500">{c.ports.join(", ")}</span>}
    </div>
  );
}

function ServicePanel({ service, name, onStart, onStop, loading: actionLoading }: {
  service: ServiceInfo;
  name: string;
  onStart: () => void;
  onStop: () => void;
  loading: boolean;
}) {
  const running = service.status === "running";
  return (
    <div className="mb-3">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">Service ({service.kind})</p>
      <div className="mt-1 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${running ? "bg-emerald-400" : "bg-zinc-600"}`} />
        <span className="text-xs text-zinc-200">{running ? "Running" : "Stopped"}</span>
        {service.port && running && (
          <a href={`http://localhost:${service.port}`} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
            :{service.port}
          </a>
        )}
        <button
          type="button"
          disabled={actionLoading}
          onClick={running ? onStop : onStart}
          className={`ml-auto rounded-lg px-2.5 py-1 text-xs font-medium ${
            running
              ? "bg-red-500/10 text-red-300 hover:bg-red-500/20"
              : "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
          } disabled:opacity-50`}
        >
          {actionLoading ? "..." : running ? "Stop" : "Start"}
        </button>
      </div>
    </div>
  );
}

/* ── Project card ── */

function ProjectCard({ project, expanded, onToggle, relatedTasks, relatedCrons, onCreateTask, service, onStartService, onStopService, serviceLoading }: {
  project: Project;
  expanded: boolean;
  onToggle: () => void;
  relatedTasks: { id: string; title: string; status: string }[];
  relatedCrons: { id: string; name: string }[];
  onCreateTask: () => void;
  service?: ServiceInfo;
  onStartService: () => void;
  onStopService: () => void;
  serviceLoading: boolean;
}) {
  const problems = projectProblems(project);
  const hasContainers = project.containers.length > 0;
  const isRunning = hasContainers || service?.status === "running";

  return (
    <div className={`rounded-lg border transition-colors ${problems.length > 0 ? "border-amber-500/15 bg-amber-500/[0.02]" : "border-white/6 bg-zinc-950/70"}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 p-4 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-lg">📦</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{project.name}</h3>
            <StatusBadge problems={problems} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" /></svg>
              <span className="font-medium text-zinc-200">{project.git.branch}</span>
            </span>
            <span>{project.git.branches} branch{project.git.branches !== 1 ? "es" : ""}</span>
            {project.git.ahead > 0 && <span className="text-blue-300">↑{project.git.ahead}</span>}
            {project.git.behind > 0 && <span className="text-amber-300">↓{project.git.behind}</span>}
            {project.git.dirty > 0 && <span className="text-amber-300">●{project.git.dirty} dirty</span>}
            {hasContainers && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {project.containers.length} container{project.containers.length !== 1 ? "s" : ""}
              </span>
            )}
            {service && (
              <span className={`inline-flex items-center gap-1 ${isRunning ? "text-emerald-400" : "text-zinc-500"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "bg-emerald-400" : "bg-zinc-600"}`} />
                {service.status}{service.port ? ` :${service.port}` : ""}
              </span>
            )}
          </div>
          {project.git.lastCommitMsg && (
            <p className="mt-1.5 text-xs leading-5 text-zinc-500">{project.git.lastCommitMsg}</p>
          )}
        </div>
        <span className={`mt-1 text-xs text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
      </button>

      {expanded && (
        <div className="border-t border-white/4 px-4 pb-4 pt-3">
          {/* Service controls */}
          {service && (
            <ServicePanel service={service} name={project.name} onStart={onStartService} onStop={onStopService} loading={serviceLoading} />
          )}

          {/* Containers */}
          {hasContainers && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Containers ({project.containers.length})</p>
              <div className="mt-1.5 space-y-1">
                {project.containers.map((c) => <ContainerRow key={c.name} c={c} />)}
              </div>
            </div>
          )}

          {/* Path */}
          <div className="mb-3">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Path</p>
            <p className="mt-0.5 font-mono text-xs text-zinc-300">{project.dir}</p>
          </div>

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

          <button type="button" onClick={onCreateTask} className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20">📌 Create Task for {project.name}</button>
        </div>
      )}
    </div>
  );
}

/* ── Untracked section ── */

function UntrackedSection({ untracked }: { untracked: UntrackedInfo }) {
  const hasOrphans = untracked.containers.length > 0;
  const hasPorts = untracked.ports.length > 0;
  if (!hasOrphans && !hasPorts) return null;

  return (
    <div className="mt-4 rounded-lg border border-white/4 bg-zinc-950/50 p-4">
      <h2 className="mb-2 text-sm font-semibold text-zinc-300">Untracked</h2>
      <p className="mb-3 text-xs text-zinc-500">Resources not mapped to a known project.</p>

      {hasOrphans && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Orphan Containers ({untracked.containers.length})</p>
          <div className="mt-1.5 space-y-1">
            {untracked.containers.map((c) => <ContainerRow key={c.name} c={c} />)}
          </div>
        </div>
      )}

      {hasPorts && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Listening Ports ({untracked.ports.length})</p>
          <div className="mt-1.5 space-y-1">
            {untracked.ports.map((p) => (
              <div key={`${p.bind}:${p.port}:${p.pid}`} className="flex items-center gap-2 text-xs">
                <a href={`http://localhost:${p.port}`} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:underline">{p.bind}:{p.port}</a>
                <span className="text-zinc-500">{p.pid ? `PID ${p.pid}` : ""} {p.process || ""}</span>
                {p.cwd && <span className="truncate text-zinc-600">{p.cwd}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main page ── */

export function ProjectsPage() {
  const serverToken = useServerToken();
  const allTasks = useTaskStore((s) => s.tasks);
  const cronJobs = useCronStore((s) => s.jobs);
  const openTaskCreate = useTaskCreateStore((s) => s.openTaskCreate);

  const [projects, setProjects] = useState<Project[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [untracked, setUntracked] = useState<UntrackedInfo>({ containers: [], ports: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "running" | "dirty" | "clean">("all");
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const headers = useMemo(() => ({ Authorization: `Bearer ${serverToken}` }), [serverToken]);

  const loadData = useCallback(async () => {
    try {
      const [projRes, svcRes] = await Promise.all([
        fetch("/api/projects", { headers }).then((r) => r.json()),
        fetch("/api/services", { headers }).then((r) => r.json()),
      ]);
      setProjects(Array.isArray(projRes.projects) ? projRes.projects : []);
      setServices(Array.isArray(svcRes.services) ? svcRes.services : []);
      setUntracked({
        containers: Array.isArray(projRes.untracked?.containers) ? projRes.untracked.containers : [],
        ports: Array.isArray(projRes.untracked?.ports) ? projRes.untracked.ports : [],
      });
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [headers]);

  // Single load on mount
  useEffect(() => {
    void loadData();
  }, [loadData]);

  const serviceByName = useMemo(() => new Map(services.map((s) => [s.name, s])), [services]);

  const handleServiceAction = useCallback(async (name: string, action: "start" | "stop") => {
    setActionLoading((prev) => ({ ...prev, [name]: true }));
    try {
      await fetch(`/api/services/${encodeURIComponent(name)}/${action}`, { method: "POST", headers });
      await loadData();
    } finally {
      setActionLoading((prev) => ({ ...prev, [name]: false }));
    }
  }, [headers, loadData]);

  const toggle = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
  };

  const repoRelations = useMemo(() => {
    const map = new Map<string, { tasks: { id: string; title: string; status: string }[]; crons: { id: string; name: string }[] }>();
    for (const p of projects) {
      const tasks = tasksForProject(allTasks, p.name)
        .filter((t) => t.status !== "done")
        .map((t) => ({ id: t.id, title: t.title, status: t.status }));
      const lower = p.name.toLowerCase();
      const crons = cronJobs
        .filter((c) => c.name.toLowerCase().includes(lower) || (c.description || "").toLowerCase().includes(lower))
        .map((c) => ({ id: c.id, name: c.name }));
      map.set(p.dir, { tasks, crons });
    }
    return map;
  }, [projects, allTasks, cronJobs]);

  const isRunning = (p: Project) => p.containers.length > 0 || serviceByName.get(p.name)?.status === "running";

  const sorted = useMemo(() => [...projects].sort((a, b) => {
    // Running first
    const ar = isRunning(a) ? 1 : 0;
    const br = isRunning(b) ? 1 : 0;
    if (br !== ar) return br - ar;
    // Then issues
    const pa = projectProblems(a).length;
    const pb = projectProblems(b).length;
    if (pb !== pa) return pb - pa;
    return a.name.localeCompare(b.name);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projects, services]);

  const filtered = filter === "all" ? sorted
    : filter === "running" ? sorted.filter(isRunning)
    : filter === "dirty" ? sorted.filter((r) => projectProblems(r).length > 0)
    : sorted.filter((r) => projectProblems(r).length === 0);

  const runningCount = sorted.filter(isRunning).length;
  const dirtyCount = sorted.filter((r) => projectProblems(r).length > 0).length;
  const cleanCount = sorted.length - dirtyCount;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 xl:px-5">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Projects</h1>
          <p className="text-xs text-zinc-400">Repositories, containers, and services.</p>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); void loadData(); }}
          disabled={loading}
          className="rounded-lg border border-white/6 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/[0.08] disabled:opacity-50"
        >
          {loading ? "Loading..." : "↻ Refresh"}
        </button>
      </div>

      <div className="mb-3 flex shrink-0 items-center gap-1 rounded-lg border border-white/4 bg-surface-1 p-1">
        <FilterBtn label="All" count={sorted.length} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterBtn label="Running" count={runningCount} active={filter === "running"} onClick={() => setFilter("running")} />
        <FilterBtn label="Needs attention" count={dirtyCount} active={filter === "dirty"} onClick={() => setFilter("dirty")} />
        <FilterBtn label="Clean" count={cleanCount} active={filter === "clean"} onClick={() => setFilter("clean")} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {loading && projects.length === 0 && (
          <div className="flex min-h-40 items-center justify-center text-sm text-zinc-500">Scanning...</div>
        )}
        {error && (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-red-500/20 text-sm text-red-300">{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-white/4 text-sm text-zinc-500">No projects found.</div>
        )}
        {filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((p) => {
              const rels = repoRelations.get(p.dir) ?? { tasks: [], crons: [] };
              const svc = serviceByName.get(p.name);
              return (
                <ProjectCard
                  key={p.dir}
                  project={p}
                  expanded={expanded.has(p.dir)}
                  onToggle={() => toggle(p.dir)}
                  relatedTasks={rels.tasks}
                  relatedCrons={rels.crons}
                  onCreateTask={() => openTaskCreate({ title: `[${p.name}] `, repo: p.name, sourceLabel: `Project: ${p.name}` })}
                  service={svc}
                  onStartService={() => { void handleServiceAction(p.name, "start"); }}
                  onStopService={() => { void handleServiceAction(p.name, "stop"); }}
                  serviceLoading={!!actionLoading[p.name]}
                />
              );
            })}
          </div>
        )}

        <UntrackedSection untracked={untracked} />
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
