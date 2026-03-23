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

function isRunning(p: Project, svc?: ServiceInfo) {
  return p.containers.length > 0 || svc?.status === "running";
}

/* ── Unified Project Row ── */

function ProjectRow({ project, expanded, onToggle, relatedTasks, relatedCrons, onCreateTask, service, onStop, actionLoading, unmatchedService }: {
  project?: Project;
  expanded: boolean;
  onToggle: () => void;
  relatedTasks: { id: string; title: string; status: string }[];
  relatedCrons: { id: string; name: string }[];
  onCreateTask: () => void;
  service?: ServiceInfo;
  onStop: (name: string) => void;
  actionLoading: boolean;
  unmatchedService?: ServiceInfo;
}) {
  const p = project;
  const svc = unmatchedService || service;
  const running = p ? isRunning(p, service) : !!unmatchedService;

  // For unmatched services (no project)
  if (!p && unmatchedService) {
    return (
      <tr className="border-b border-white/[0.03] hover:bg-white/[0.02]">
        <td className="py-2.5 pl-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.3)]" />
            <span className="font-medium text-zinc-100">{unmatchedService.name}</span>
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-600">{unmatchedService.kind}</span>
          </div>
        </td>
        <td className="py-2.5 text-zinc-600">—</td>
        <td className="py-2.5">
          {unmatchedService.port ? (
            <a href={`http://localhost:${unmatchedService.port}`} target="_blank" rel="noreferrer"
              className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-blue-400 hover:bg-blue-500/20">
              :{unmatchedService.port}
            </a>
          ) : <span className="text-zinc-700">—</span>}
        </td>
        <td className="py-2.5 text-zinc-600">{unmatchedService.description || "—"}</td>
        <td className="py-2.5 pr-3 text-right">
          <button type="button" disabled={actionLoading} onClick={() => onStop(unmatchedService.name)}
            className="rounded px-2 py-0.5 text-zinc-600 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50">
            {actionLoading ? "…" : "⏹"}
          </button>
        </td>
      </tr>
    );
  }

  if (!p) return null;

  const problems = gitProblems(p);
  const ports = p.containers.flatMap((c) => c.ports).filter(Boolean);
  const allPorts = [...ports];
  if (service?.port && !ports.some((pt) => pt.startsWith(String(service.port)))) {
    allPorts.push(`:${service.port}`);
  }
  const totalMem = p.containers.map((c) => c.memory).filter(Boolean);

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-white/[0.03] transition hover:bg-white/[0.02] ${running ? "bg-white/[0.01]" : ""}`}
      >
        {/* Name */}
        <td className="py-2.5 pl-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${running ? "bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.3)]" : "bg-zinc-700"}`} />
            <span className="font-medium text-zinc-100">{p.name}</span>
            {running && p.containers.length > 0 && (
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                {p.containers.length === 1 ? "1 container" : `${p.containers.length} containers`}
              </span>
            )}
          </div>
        </td>

        {/* Branch + git status */}
        <td className="py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-zinc-400">{p.git.branch}</span>
            {problems.length > 0 && (
              <span className="text-amber-400">{problems.join("  ")}</span>
            )}
          </div>
        </td>

        {/* Ports */}
        <td className="py-2.5">
          {allPorts.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {allPorts.map((port) => {
                const hostPort = port.startsWith(":") ? port.slice(1) : port.split("->")[0];
                return (
                  <a key={port} href={`http://localhost:${hostPort}`} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-blue-400 hover:bg-blue-500/20">
                    :{hostPort}
                  </a>
                );
              })}
            </div>
          ) : (
            <span className="text-zinc-700">—</span>
          )}
        </td>

        {/* Memory */}
        <td className="py-2.5 text-zinc-600">
          {totalMem.length > 0 ? totalMem.join(" + ") : "—"}
        </td>

        {/* Actions */}
        <td className="py-2.5 pr-3 text-right">
          {running ? (
            <button
              type="button"
              disabled={actionLoading}
              onClick={(e) => { e.stopPropagation(); onStop(p.name); }}
              className="rounded px-2 py-0.5 text-zinc-600 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
            >
              {actionLoading ? "…" : "⏹"}
            </button>
          ) : (
            <span className={`inline-block transition-transform ${expanded ? "rotate-90" : ""} text-zinc-600`}>›</span>
          )}
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={5} className="border-b border-white/[0.03] bg-white/[0.015] px-3 pb-3 pt-2">
            <div className="grid grid-cols-2 gap-4 text-xs">
              {/* Left: containers + path */}
              <div>
                {p.containers.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Containers</p>
                    <div className="space-y-0.5">
                      {p.containers.map((c) => (
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
                <p className="mt-0.5 font-mono text-zinc-500">{p.dir}</p>
                {p.git.lastCommitMsg && (
                  <>
                    <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Last commit</p>
                    <p className="mt-0.5 truncate text-zinc-500">{p.git.lastCommitMsg}</p>
                  </>
                )}
              </div>

              {/* Right: tasks + crons + actions */}
              <div>
                {relatedTasks.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Tasks ({relatedTasks.length})</p>
                    <div className="space-y-1">
                      {relatedTasks.map((t) => (
                        <div key={t.id} className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${TASK_STATUS_META[t.status as keyof typeof TASK_STATUS_META]?.dot || "bg-zinc-500"}`} />
                          <span className="truncate text-zinc-300">{t.title}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{TASK_STATUS_META[t.status as keyof typeof TASK_STATUS_META]?.label || t.status}</span>
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
        <div className="mt-2 rounded-lg border border-white/[0.06] bg-zinc-950/50 p-3 text-xs">
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
  const [claimedCompose, setClaimedCompose] = useState<Set<string>>(new Set());
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
      // Compose project names that are already claimed by a git repo
      // (e.g. "server" compose project is inside swap.win git repo)
      setClaimedCompose(new Set(Array.isArray(projRes.claimedComposeProjects) ? projRes.claimedComposeProjects : []));
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

  // Services not matched to any project.
  // Exclude services whose name matches a project OR a claimed compose project
  // (e.g. "server" compose project is already shown under swap.win's containers).
  const unmatchedServices = useMemo(() =>
    [...services.values()].filter(
      (s) => s.status === "running"
        && !projects.some((p) => p.name === s.name)
        && !claimedCompose.has(s.name),
    ),
  [services, projects, claimedCompose]);

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

  // Sort: running first, then by problems, then alpha
  const sorted = useMemo(() => [...projects].sort((a, b) => {
    const ar = isRunning(a, serviceByName.get(a.name)) ? 1 : 0;
    const br = isRunning(b, serviceByName.get(b.name)) ? 1 : 0;
    if (br !== ar) return br - ar;
    return gitProblems(b).length - gitProblems(a).length || a.name.localeCompare(b.name);
  }), [projects, serviceByName]);

  const runningCount = sorted.filter((p) => isRunning(p, serviceByName.get(p.name))).length + unmatchedServices.length;
  const dirtyCount = sorted.filter((r) => gitProblems(r).length > 0).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 xl:px-5">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">Projects</h1>
          <p className="mt-0.5 text-[12px] text-zinc-600">
            {sorted.length} repos · {runningCount} running{dirtyCount > 0 ? ` · ${dirtyCount} dirty` : ""}
          </p>
        </div>
        <button type="button" onClick={() => { setLoading(true); void loadData(); }} disabled={loading}
          className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[12px] text-zinc-500 transition hover:border-white/[0.1] hover:bg-white/[0.06] hover:text-zinc-300 disabled:opacity-50">
          {loading && projects.length > 0 ? "…" : loading ? "Loading" : "Refresh"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-soft pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {loading && projects.length === 0 && (
          <div className="flex min-h-40 items-center justify-center text-[13px] text-zinc-600">Scanning…</div>
        )}
        {error && (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-red-500/20 text-[13px] text-red-300">{error}</div>
        )}

        {(projects.length > 0 || unmatchedServices.length > 0) && (
          <>
            <div className="rounded-xl border border-white/[0.06] bg-surface-0 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-zinc-600">
                    <th className="py-2 pl-3 font-medium">Project</th>
                    <th className="py-2 font-medium">Branch</th>
                    <th className="py-2 font-medium">Ports</th>
                    <th className="py-2 font-medium">Memory</th>
                    <th className="py-2 pr-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {/* Unmatched services first (running but no project) */}
                  {unmatchedServices.map((s) => (
                    <ProjectRow
                      key={`svc-${s.name}`}
                      expanded={false}
                      onToggle={() => {}}
                      relatedTasks={[]}
                      relatedCrons={[]}
                      onCreateTask={() => {}}
                      onStop={(name) => { void handleAction(name, "stop"); }}
                      actionLoading={!!actionLoading[s.name]}
                      unmatchedService={s}
                    />
                  ))}
                  {/* All projects */}
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
                        onStop={(name) => { void handleAction(name, "stop"); }}
                        actionLoading={!!actionLoading[p.name]}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>

            <UntrackedSection untracked={untracked} />
          </>
        )}
      </div>
    </div>
  );
}
