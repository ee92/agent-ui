import { useEffect, useState, useMemo } from "react";
import { useTaskStore } from "../../lib/stores/task-store-v2";
import { useTaskCreateStore } from "../../lib/stores/task-create-store";
import { useCronStore } from "../../lib/stores/cron-store";
import { useServerToken } from "../../lib/hooks/use-server-auth";
import { tasksForProject } from "../../lib/link-resolver";
import { TASK_STATUS_META } from "../../lib/task-types";
import { navigate } from "../../lib/use-hash-router";

type Repo = {
  name: string;
  dir: string;
  branch: string;
  dirtyFiles: number;
  ahead: number;
  behind: number;
  lastCommitMsg: string;
  lastCommitAgeHours: number | null;
  branches: number;
  branchNames: string[];
  stashes: number;
  diskUsage: string;
  problems: string[];
  hasUpstream: boolean;
};

function formatAge(hours: number | null) {
  if (hours === null) return "unknown";
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function StatusBadge({ problems }: { problems: string[] }) {
  if (problems.length === 0) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">✓ Clean</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">⚠ {problems.length} issue{problems.length !== 1 ? "s" : ""}</span>;
}

function RepoCard({ repo, expanded, onToggle, relatedTasks, relatedCrons, onCreateTask }: {
  repo: Repo;
  expanded: boolean;
  onToggle: () => void;
  relatedTasks: { id: string; title: string; status: string }[];
  relatedCrons: { id: string; name: string }[];
  onCreateTask: () => void;
}) {
  return (
    <div className={`rounded-xl border transition-colors ${repo.problems.length > 0 ? "border-amber-500/15 bg-amber-500/[0.02]" : "border-white/6 bg-zinc-950/70"}`}>
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
            <StatusBadge problems={repo.problems} />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
            {/* Branch */}
            <span className="inline-flex items-center gap-1">
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" /></svg>
              <span className="font-medium text-zinc-200">{repo.branch}</span>
            </span>

            {/* Branches count */}
            <span>{repo.branches} branch{repo.branches !== 1 ? "es" : ""}</span>

            {/* Size */}
            <span>{repo.diskUsage}</span>

            {/* Last commit */}
            <span>{formatAge(repo.lastCommitAgeHours)}</span>

            {/* Ahead/behind */}
            {repo.ahead > 0 && <span className="text-blue-300">↑{repo.ahead}</span>}
            {repo.behind > 0 && <span className="text-amber-300">↓{repo.behind}</span>}
            {repo.dirtyFiles > 0 && <span className="text-amber-300">●{repo.dirtyFiles} dirty</span>}
            {repo.stashes > 0 && <span className="text-zinc-500">📦{repo.stashes} stash</span>}
          </div>

          {/* Last commit message */}
          {repo.lastCommitMsg && (
            <p className="mt-1.5 text-xs leading-5 text-zinc-500">{repo.lastCommitMsg}</p>
          )}
        </div>

        {/* Expand indicator */}
        <span className={`mt-1 text-xs text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/5 px-4 pb-4 pt-3">
          {/* Path */}
          <div className="mb-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Path</p>
            <p className="mt-0.5 font-mono text-xs text-zinc-300">{repo.dir}</p>
          </div>

          {/* Problems */}
          {repo.problems.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Issues</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {repo.problems.map((p) => (
                  <span key={p} className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">{p}</span>
                ))}
              </div>
            </div>
          )}

          {/* Branches */}
          <div className="mb-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Branches ({repo.branches})</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {repo.branchNames.map((b) => (
                <span
                  key={b}
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    b === repo.branch
                      ? "bg-blue-500/15 font-medium text-blue-300"
                      : "bg-white/[0.04] text-zinc-400"
                  }`}
                >
                  {b}
                </span>
              ))}
              {repo.branches > repo.branchNames.length && (
                <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-xs text-zinc-500">
                  +{repo.branches - repo.branchNames.length} more
                </span>
              )}
            </div>
          </div>

          {/* Related tasks */}
          {relatedTasks.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Linked Tasks ({relatedTasks.length})</p>
              <div className="mt-1.5 space-y-1">
                {relatedTasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/20 px-3 py-1.5">
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
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Cron Jobs ({relatedCrons.length})</p>
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

export function ProjectsPage() {
  const serverToken = useServerToken();
  const allTasks = useTaskStore((s) => s.tasks);
  const cronJobs = useCronStore((s) => s.jobs);
  const openTaskCreate = useTaskCreateStore((s) => s.openTaskCreate);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "dirty" | "clean">("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/repos", { headers: { Authorization: `Bearer ${serverToken}` } })
      .then((r) => { if (!r.ok) throw new Error("Failed to load repos"); return r.json(); })
      .then((data: { repos: Repo[] }) => {
        if (!cancelled) {
          // Sort: dirty first, then by last commit age
          const sorted = data.repos.sort((a, b) => {
            if (a.problems.length !== b.problems.length) return b.problems.length - a.problems.length;
            return (a.lastCommitAgeHours ?? 9999) - (b.lastCommitAgeHours ?? 9999);
          });
          setRepos(sorted);
          setLoading(false);
        }
      })
      .catch((e) => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [serverToken]);

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
    for (const repo of repos) {
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
  }, [repos, allTasks, cronJobs]);

  const filtered = filter === "all" ? repos : filter === "dirty" ? repos.filter((r) => r.problems.length > 0) : repos.filter((r) => r.problems.length === 0);
  const dirtyCount = repos.filter((r) => r.problems.length > 0).length;
  const cleanCount = repos.length - dirtyCount;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 xl:px-5">
      <div className="mb-3 shrink-0">
        <h1 className="text-lg font-semibold text-white">Projects</h1>
        <p className="text-xs text-zinc-400">Local git repositories, branches, and health status.</p>
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex shrink-0 items-center gap-1 rounded-xl border border-white/5 bg-black/20 p-1">
        <FilterBtn label="All" count={repos.length} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterBtn label="Needs attention" count={dirtyCount} active={filter === "dirty"} onClick={() => setFilter("dirty")} />
        <FilterBtn label="Clean" count={cleanCount} active={filter === "clean"} onClick={() => setFilter("clean")} />
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {loading && (
          <div className="flex min-h-40 items-center justify-center text-sm text-zinc-500">
            Scanning repositories...
          </div>
        )}
        {error && (
          <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-red-500/20 text-sm text-red-300">
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-zinc-500">
            No repositories found.
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="space-y-2">
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
                />
              );
            })}
          </div>
        )}
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
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${
          active ? "bg-blue-500/20 text-blue-300" : "bg-white/[0.06] text-zinc-500"
        }`}>{count}</span>
      )}
    </button>
  );
}
