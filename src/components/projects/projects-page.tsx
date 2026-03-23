import { useEffect, useState, useMemo, useCallback } from "react";
import { useTaskStore } from "../../lib/stores/task-store-v2";
import { useTaskCreateStore } from "../../lib/stores/task-create-store";
import { useCronStore } from "../../lib/stores/cron-store";
import { useServerToken } from "../../lib/hooks/use-server-auth";
import { tasksForProject } from "../../lib/link-resolver";
import { TASK_STATUS_META } from "../../lib/task-types";
import { navigate } from "../../lib/use-hash-router";

/* ── Types ── */

type ContainerInfo = { name: string; service: string; status: string; memory: string; ports: string[] };
type ServiceInfo = { name: string; kind: "process" | "docker"; status: "running" | "stopped"; port?: number; description?: string };
type Project = {
  name: string; dir: string;
  git: { branch: string; dirty: number; ahead: number; behind: number; lastCommitMsg: string; branches: number };
  containers: ContainerInfo[];
  tasks: { id: string; title: string; status: string }[];
};
type UntrackedInfo = {
  containers: ContainerInfo[];
  ports: { port: number; bind: string; pid: number | null; process: string; cwd: string }[];
};

/* ── Helpers ── */

function gitProblems(p: Project): string[] {
  const out: string[] = [];
  if (p.git.dirty > 0) out.push(`${p.git.dirty} dirty`);
  if (p.git.behind > 0) out.push(`↓${p.git.behind}`);
  if (p.git.ahead > 0) out.push(`↑${p.git.ahead}`);
  return out;
}

function isUp(status: string) { return status?.toLowerCase().includes("up"); }

/* ── Active Services Panel ── */

function ActiveServices({ projects, services, onStop, onStart, actionLoading }: {
  projects: Project[];
  services: Map<string, ServiceInfo>;
  onStop: (name: string) => void;
  onStart: (name: string) => void;
  actionLoading: Record<string, boolean>;
}) {
  const active = projects.filter((p) => p.containers.length > 0 || services.get(p.name)?.status === "running");

  // Also include services not matched to a project (bare process dev servers)
  const unmatchedServices = [...services.values()].filter(
    (s) => s.status === "running" && !projects.some((p) => p.name === s.name),
  );

  if (active.length === 0 && unmatchedServices.length === 0) return null;

  return (
    <div className="mb-4">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Active Services</h2>
      <div className="rounded-lg border border-white/6 bg-zinc-950/70 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/4 text-left text-[10px] uppercase tracking-wider text-zinc-600">
              <th className="py-2 pl-3 font-medium">Name</th>
              <th className="py-2 font-medium">Ports</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Memory</th>
              <th className="py-2 pr-3 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {active.map((p) => {
              const svc = services.get(p.name);
              const ports = p.containers.flatMap((c) => c.ports).filter(Boolean);
              const totalMem = p.containers.map((c) => c.memory).filter(Boolean).join(" + ");
              const containerCount = p.containers.length;
              const allUp = p.containers.every((c) => isUp(c.status));
              const loading = !!actionLoading[p.name];

              return (
                <tr key={p.dir} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="py-2.5 pl-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${allUp ? "bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.4)]" : "bg-amber-400"}`} />
                      <span className="font-medium text-zinc-100">{p.name}</span>
                      <span className="text-zinc-600">{containerCount} container{containerCount !== 1 ? "s" : ""}</span>
                    </div>
                  </td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {ports.map((port) => {
                        const hostPort = port.split("->")[0];
                        return (
                          <a key={port} href={`http://localhost:${hostPort}`} target="_blank" rel="noreferrer"
                            className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-blue-400 hover:bg-blue-500/20">
                            :{hostPort}
                          </a>
                        );
                      })}
                      {svc?.port && !ports.some((p) => p.startsWith(String(svc.port))) && (
                        <a href={`http://localhost:${svc.port}`} target="_blank" rel="noreferrer"
                          className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-blue-400 hover:bg-blue-500/20">
                          :{svc.port}
                        </a>
                      )}
                      {ports.length === 0 && !svc?.port && <span className="text-zinc-600">—</span>}
                    </div>
                  </td>
                  <td className="py-2.5">
                    <span className="text-emerald-400">{allUp ? "Up" : "Partial"}</span>
                  </td>
                  <td className="py-2.5 text-zinc-500">{totalMem || "—"}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => onStop(p.name)}
                      className="rounded px-2 py-1 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {loading ? "..." : "⏹"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {unmatchedServices.map((s) => (
              <tr key={s.name} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                <td className="py-2.5 pl-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.4)]" />
                    <span className="font-medium text-zinc-100">{s.name}</span>
                    <span className="text-zinc-600">{s.kind}</span>
                  </div>
                </td>
                <td className="py-2.5">
                  {s.port ? (
                    <a href={`http://localhost:${s.port}`} target="_blank" rel="noreferrer"
                      className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-blue-400 hover:bg-blue-500/20">
                      :{s.port}
                    </a>
                  ) : <span className="text-zinc-600">—</span>}
                </td>
                <td className="py-2.5"><span className="text-emerald-400">Up</span></td>
                <td className="py-2.5 text-zinc-500">{s.description || "—"}</td>
                <td className="py-2.5 pr-3 text-right">
                  <button type="button" disabled={!!actionLoading[s.name]} onClick={() => onStop(s.name)}
                    className="rounded px-2 py-1 text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                    {actionLoading[s.name] ? "..." : "⏹"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Project Row (compact, expandable) ── */

function ProjectRow({ project, expanded, onToggle, relatedTasks, relatedCrons, onCreateTask, service }: {
  project: Project;
  expanded: boolean;
  onToggle: () => void;
  relatedTasks: { id: string; title: string; status: string }[];
  relatedCrons: { id: string; name: string }[];
  onCreateTask: () => void;
  service?: ServiceInfo;
}) {
  const problems = gitProblems(project);
  const hasContainers = project.containers.length > 0;

  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer border-b border-white/[0.03] hover:bg-white/[0.02]">
        <td className="py-2 pl-3">
          <div className="flex items-center gap-2">
            {hasContainers || service?.status === "running"
              ? <span className="h-2 w-2 rounded-full bg-emerald-400" />
              : <span className="h-2 w-2 rounded-full bg-zinc-700" />}
            <span className="font-medium text-zinc-100">{project.name}</span>
          </div>
        </td>
        <td className="py-2">
          <span className="font-mono text-zinc-300">{project.git.branch}</span>
        </td>
        <td className="py-2">
          {problems.length > 0
            ? <span className="text-amber-400">{problems.join("  ")}</span>
            : <span className="text-emerald-500/60">✓</span>}
        </td>
        <td className="py-2 text-zinc-600">
          {hasContainers && <span>{project.containers.length} container{project.containers.length !== 1 ? "s" : ""}</span>}
        </td>
        <td className="py-2 pr-3 text-right text-zinc-600">
          <span className={`transition-transform inline-block ${expanded ? "rotate-90" : ""}`}>›</span>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={5} className="border-b border-white/[0.03] bg-white/[0.01] px-3 pb-3 pt-2">
            <div className="grid grid-cols-2 gap-4 text-xs">
              {/* Left column: containers + git */}
              <div>
                {hasContainers && (
                  <div className="mb-3">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Containers</p>
                    <div className="space-y-0.5">
                      {project.containers.map((c) => (
                        <div key={c.name} className="flex items-center gap-2 text-zinc-400">
                          <span className={`h-1.5 w-1.5 rounded-full ${isUp(c.status) ? "bg-emerald-400" : "bg-red-400"}`} />
                          <span className="text-zinc-200">{c.service || c.name}</span>
                          {c.ports.length > 0 && <span className="font-mono text-zinc-500">{c.ports.join(", ")}</span>}
                          <span className="ml-auto text-zinc-600">{c.memory}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">Path</p>
                <p className="mt-0.5 font-mono text-zinc-500">{project.dir}</p>
              </div>

              {/* Right column: tasks + actions */}
              <div>
                {relatedTasks.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Tasks ({relatedTasks.length})</p>
                    <div className="space-y-1">
                      {relatedTasks.map((t) => (
                        <div key={t.id} className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${TASK_STATUS_META[t.status as keyof typeof TASK_STATUS_META]?.dot || "bg-zinc-500"}`} />
                          <span className="truncate text-zinc-300">{t.title}</span>
                          <span className="ml-auto text-[10px] text-zinc-600">{TASK_STATUS_META[t.status as keyof typeof TASK_STATUS_META]?.label || t.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {relatedCrons.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Cron Jobs</p>
                    <div className="flex flex-wrap gap-1">
                      {relatedCrons.map((c) => (
                        <button key={c.id} type="button" onClick={() => navigate("#/timeline")} className="rounded bg-sky-500/10 px-2 py-0.5 text-sky-400 hover:bg-sky-500/20">⏰ {c.name}</button>
                      ))}
                    </div>
                  </div>
                )}
                <button type="button" onClick={onCreateTask} className="rounded bg-white/[0.04] px-2 py-1 text-zinc-400 hover:bg-white/[0.08]">+ Create Task</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Untracked ── */

function UntrackedSection({ untracked }: { untracked: UntrackedInfo }) {
  const [open, setOpen] = useState(false);
  const total = untracked.containers.length + untracked.ports.length;
  if (total === 0) return null;

  return (
    <div className="mt-4">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-600 hover:text-zinc-400">
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        Untracked ({total})
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-white/4 bg-zinc-950/50 p-3 text-xs">
          {untracked.containers.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Orphan Containers</p>
              {untracked.containers.map((c) => (
                <div key={c.name} className="flex items-center gap-2 text-zinc-500">
                  <span className={`h-1.5 w-1.5 rounded-full ${isUp(c.status) ? "bg-emerald-400" : "bg-zinc-600"}`} />
                  <span className="text-zinc-300">{c.service || c.name}</span>
                  <span>{c.memory}</span>
                  {c.ports.length > 0 && <span className="font-mono">{c.ports.join(", ")}</span>}
                </div>
              ))}
            </div>
          )}
          {untracked.ports.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Listening Ports</p>
              {untracked.ports.map((p) => (
                <div key={`${p.bind}:${p.port}:${p.pid}`} className="flex items-center gap-2 text-zinc-500">
                  <a href={`http://localhost:${p.port}`} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:underline">{p.bind}:{p.port}</a>
                  {p.pid && <span>PID {p.pid}</span>}
                  {p.process && <span>{p.process}</span>}
                  {p.cwd && <span className="truncate text-zinc-600">{p.cwd}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main ── */

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

  useEffect(() => { void loadData(); }, [loadData]);

  const serviceByName = useMemo(() => new Map(services.map((s) => [s.name, s])), [services]);

  const handleAction = useCallback(async (name: string, action: "start" | "stop") => {
    setActionLoading((prev) => ({ ...prev, [name]: true }));
    try {
      await fetch(`/api/services/${encodeURIComponent(name)}/${action}`, { method: "POST", headers });
      await loadData();
    } finally {
      setActionLoading((prev) => ({ ...prev, [name]: false }));
    }
  }, [headers, loadData]);

  const toggle = (dir: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(dir)) next.delete(dir); else next.add(dir);
    return next;
  });

  const repoRelations = useMemo(() => {
    const map = new Map<string, { tasks: { id: string; title: string; status: string }[]; crons: { id: string; name: string }[] }>();
    for (const p of projects) {
      const tasks = tasksForProject(allTasks, p.name).filter((t) => t.status !== "done").map((t) => ({ id: t.id, title: t.title, status: t.status }));
      const lower = p.name.toLowerCase();
      const crons = cronJobs.filter((c) => c.name.toLowerCase().includes(lower) || (c.description || "").toLowerCase().includes(lower)).map((c) => ({ id: c.id, name: c.name }));
      map.set(p.dir, { tasks, crons });
    }
    return map;
  }, [projects, allTasks, cronJobs]);

  const sorted = useMemo(() => [...projects].sort((a, b) => {
    const ar = (a.containers.length > 0 || serviceByName.get(a.name)?.status === "running") ? 1 : 0;
    const br = (b.containers.length > 0 || serviceByName.get(b.name)?.status === "running") ? 1 : 0;
    if (br !== ar) return br - ar;
    return gitProblems(b).length - gitProblems(a).length || a.name.localeCompare(b.name);
  }), [projects, serviceByName]);

  const dirtyCount = sorted.filter((r) => gitProblems(r).length > 0).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 xl:px-5">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Projects</h1>
          <p className="text-xs text-zinc-500">{sorted.length} projects · {dirtyCount > 0 ? `${dirtyCount} need attention` : "all clean"}</p>
        </div>
        <button type="button" onClick={() => { setLoading(true); void loadData(); }} disabled={loading}
          className="rounded-lg border border-white/6 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/[0.08] disabled:opacity-50">
          {loading && projects.length > 0 ? "Refreshing..." : loading ? "Loading..." : "↻ Refresh"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {loading && projects.length === 0 && (
          <div className="flex min-h-40 items-center justify-center text-sm text-zinc-500">Scanning...</div>
        )}
        {error && (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-red-500/20 text-sm text-red-300">{error}</div>
        )}

        {projects.length > 0 && (
          <>
            <ActiveServices
              projects={projects}
              services={serviceByName}
              onStop={(name) => { void handleAction(name, "stop"); }}
              onStart={(name) => { void handleAction(name, "start"); }}
              actionLoading={actionLoading}
            />

            <div>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">All Projects</h2>
              <div className="rounded-lg border border-white/6 bg-zinc-950/70 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/4 text-left text-[10px] uppercase tracking-wider text-zinc-600">
                      <th className="py-2 pl-3 font-medium">Project</th>
                      <th className="py-2 font-medium">Branch</th>
                      <th className="py-2 font-medium">Status</th>
                      <th className="py-2 font-medium">Infra</th>
                      <th className="py-2 pr-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((p) => {
                      const rels = repoRelations.get(p.dir) ?? { tasks: [], crons: [] };
                      return (
                        <ProjectRow
                          key={p.dir}
                          project={p}
                          expanded={expanded.has(p.dir)}
                          onToggle={() => toggle(p.dir)}
                          relatedTasks={rels.tasks}
                          relatedCrons={rels.crons}
                          onCreateTask={() => openTaskCreate({ title: `[${p.name}] `, repo: p.name, sourceLabel: `Project: ${p.name}` })}
                          service={serviceByName.get(p.name)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <UntrackedSection untracked={untracked} />
          </>
        )}
      </div>
    </div>
  );
}
