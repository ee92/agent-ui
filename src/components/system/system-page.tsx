import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerToken } from "../../lib/hooks/use-server-auth";

/* ── Types ── */

type PortInfo = {
  port: number; bind: string; pid: number | null; process: string; cwd: string;
  kind: "docker" | "systemd" | "system" | "process";
  container: string | null; service: string | null;
  isPublic: boolean; isSystem: boolean;
};

type ContainerInfo = {
  name: string; id: string; image: string;
  status: "running" | "healthy" | "stopped"; statusText: string;
  composeProject: string | null; composeService: string | null;
  cpu: string; memory: string; memoryLimit: string; netIO: string;
  ports: { bind: string; hostPort: number; containerPort: number }[];
};

type ServiceInfo = {
  name: string; unit: string; status: string; active: boolean;
  description: string; memory: string; pid: number | null;
};

type ResourceInfo = {
  cpu: { load1m: number; load5m: number; load15m: number; cores: number };
  memory: { total: number; used: number; available: number; swapTotal: number; swapUsed: number };
  disk: { mount: string; total: number; used: number; available: number; percent: string }[];
  docker: Record<string, { size: string; reclaimable: string }>;
};

type SystemData = {
  ports: PortInfo[];
  containers: ContainerInfo[];
  services: ServiceInfo[];
  resources: ResourceInfo;
  summary: {
    totalContainers: number; runningContainers: number;
    totalServices: number; activeServices: number;
    listeningPorts: number; publicPorts: number;
  };
};

/* ── Helpers ── */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " GB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " TB";
}

function statusColor(status: string): string {
  if (status === "healthy") return "bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.3)]";
  if (status === "running" || status === "active") return "bg-emerald-400";
  if (status === "stopped" || status === "dead") return "bg-zinc-600";
  if (status === "failed") return "bg-red-400";
  return "bg-amber-400";
}

function statusText(status: string): string {
  if (status === "healthy") return "Healthy";
  if (status === "running") return "Up";
  if (status === "active") return "Active";
  if (status === "stopped" || status === "dead") return "Stopped";
  if (status === "failed") return "Failed";
  return status;
}

type Tab = "overview" | "containers" | "services" | "logs";

function TabButton({ label, active, count, onClick }: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200 ${
        active ? "bg-white/[0.08] text-white" : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
      }`}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${
          active ? "bg-indigo-500/20 text-indigo-300" : "bg-white/[0.05] text-zinc-600"
        }`}>{count}</span>
      )}
    </button>
  );
}

/* ── Resource Bar ── */

function ResourceBar({ label, used, total, unit }: { label: string; used: number; total: number; unit?: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color = pct > 90 ? "bg-red-400" : pct > 70 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="flex-1 min-w-[140px]">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">{label}</span>
        <span className="text-[12px] tabular-nums text-zinc-400">
          {unit ? `${formatBytes(used)} / ${formatBytes(total)}` : `${pct.toFixed(0)}%`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── Log Viewer ── */

function LogViewer({ name, kind, token, onClose }: { name: string; kind: "container" | "service"; token: string; onClose: () => void }) {
  const [logs, setLogs] = useState<string>("Loading...");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const endpoint = kind === "container"
      ? `/api/system/containers/${encodeURIComponent(name)}/logs?tail=300`
      : `/api/system/services/${encodeURIComponent(name)}/logs?tail=300`;
    fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => { setLogs(data.logs || data.error || "No logs"); setLoading(false); })
      .catch((e) => { setLogs(`Error: ${e.message}`); setLoading(false); });
  }, [name, kind, token]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-4xl flex-col rounded-xl border border-white/[0.08] bg-surface-0 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div>
            <h3 className="text-[14px] font-semibold text-zinc-100">{name}</h3>
            <p className="text-[11px] text-zinc-600">{kind === "container" ? "Container logs" : "Service logs"} · last 300 lines</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300">✕</button>
        </div>
        <div className="flex-1 overflow-auto scroll-soft p-4">
          <pre className={`whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.6] ${loading ? "text-zinc-600" : "text-zinc-300"}`}>
            {logs}
          </pre>
        </div>
      </div>
    </div>
  );
}

/* ── Confirm Dialog ── */

function ConfirmDialog({ title, message, onConfirm, onCancel, loading }: {
  title: string; message: string; onConfirm: () => void; onCancel: () => void; loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border border-white/[0.08] bg-surface-1 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[14px] font-semibold text-zinc-100">{title}</h3>
        <p className="mt-2 text-[13px] text-zinc-400">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={loading}
            className="rounded-lg px-3 py-1.5 text-[13px] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={loading}
            className="rounded-lg bg-red-500/15 px-3 py-1.5 text-[13px] font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-50">
            {loading ? "..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Overview Tab ── */

function OverviewTab({ data, token, onViewLogs }: { data: SystemData; token: string; onViewLogs: (name: string, kind: "container" | "service") => void }) {
  const [confirm, setConfirm] = useState<{ name: string; kind: "container" | "service"; action: "stop" | "restart" } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const handleAction = async () => {
    if (!confirm) return;
    setActionLoading(true);
    const endpoint = confirm.kind === "container"
      ? `/api/system/containers/${encodeURIComponent(confirm.name)}/${confirm.action}`
      : `/api/system/services/${encodeURIComponent(confirm.name)}/${confirm.action}`;
    await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    setActionLoading(false);
    setConfirm(null);
  };

  // Merge containers + services into unified process list
  const processes = useMemo(() => {
    const list: Array<{
      name: string; kind: "docker" | "systemd"; status: string;
      cpu: string; memory: string; ports: string[]; project: string | null;
      description: string;
    }> = [];

    for (const c of data.containers) {
      if (c.status === "stopped") continue;
      list.push({
        name: c.name,
        kind: "docker",
        status: c.status,
        cpu: c.cpu,
        memory: c.memory,
        ports: c.ports.map((p) => `:${p.hostPort}`),
        project: c.composeProject,
        description: c.image.split(":")[0],
      });
    }

    for (const s of data.services) {
      if (!s.active) continue;
      list.push({
        name: s.name,
        kind: "systemd",
        status: s.status,
        cpu: "",
        memory: s.memory,
        ports: [],
        project: null,
        description: s.description,
      });
    }

    return list.sort((a, b) => {
      // Sort by memory (highest first), then name
      const memA = parseFloat(a.memory) || 0;
      const memB = parseFloat(b.memory) || 0;
      return memB - memA || a.name.localeCompare(b.name);
    });
  }, [data]);

  const { resources } = data;

  return (
    <div className="space-y-4">
      {/* Resource summary */}
      <div className="flex flex-wrap gap-4 rounded-xl border border-white/[0.05] bg-surface-0 p-4">
        <ResourceBar label="CPU" used={resources.cpu.load1m} total={resources.cpu.cores} />
        <ResourceBar label="Memory" used={resources.memory.used} total={resources.memory.total} unit="bytes" />
        {resources.disk[0] && (
          <ResourceBar label={`Disk ${resources.disk[0].mount}`} used={resources.disk[0].used} total={resources.disk[0].total} unit="bytes" />
        )}
        {resources.memory.swapTotal > 0 && (
          <ResourceBar label="Swap" used={resources.memory.swapUsed} total={resources.memory.swapTotal} unit="bytes" />
        )}
      </div>

      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-[12px] text-zinc-400">
          <span className="font-medium text-zinc-200">{data.summary.runningContainers}</span> containers
        </span>
        <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-[12px] text-zinc-400">
          <span className="font-medium text-zinc-200">{data.summary.activeServices}</span> services
        </span>
        <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-[12px] text-zinc-400">
          <span className="font-medium text-zinc-200">{data.summary.listeningPorts}</span> ports
        </span>
        {data.summary.publicPorts > 0 && (
          <span className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-[12px] text-amber-400">
            <span className="font-medium">{data.summary.publicPorts}</span> public
          </span>
        )}
      </div>

      {/* Unified process table */}
      <div className="rounded-xl border border-white/[0.06] bg-surface-0 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-zinc-600">
              <th className="py-2 pl-3 font-medium">Process</th>
              <th className="py-2 font-medium">Type</th>
              <th className="py-2 font-medium">Ports</th>
              <th className="py-2 font-medium">CPU</th>
              <th className="py-2 font-medium">Memory</th>
              <th className="py-2 pr-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((p) => (
              <tr key={`${p.kind}-${p.name}`} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                <td className="py-2.5 pl-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusColor(p.status)}`} />
                    <span className="font-medium text-zinc-100">{p.name}</span>
                    {p.project && <span className="text-zinc-600">{p.project}</span>}
                  </div>
                </td>
                <td className="py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${p.kind === "docker" ? "bg-blue-500/10 text-blue-400" : "bg-violet-500/10 text-violet-400"}`}>
                    {p.kind === "docker" ? "Docker" : "Systemd"}
                  </span>
                </td>
                <td className="py-2.5">
                  {p.ports.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {p.ports.map((port) => (
                        <span key={port} className="font-mono text-zinc-400">{port}</span>
                      ))}
                    </div>
                  ) : <span className="text-zinc-700">—</span>}
                </td>
                <td className="py-2.5 tabular-nums text-zinc-400">{p.cpu || "—"}</td>
                <td className="py-2.5 tabular-nums text-zinc-400">{p.memory || "—"}</td>
                <td className="py-2.5 pr-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button"
                      onClick={() => onViewLogs(p.name, p.kind === "docker" ? "container" : "service")}
                      className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-300">
                      logs
                    </button>
                    <button type="button"
                      onClick={() => setConfirm({ name: p.name, kind: p.kind === "docker" ? "container" : "service", action: "restart" })}
                      className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-300">
                      restart
                    </button>
                    <button type="button"
                      onClick={() => setConfirm({ name: p.name, kind: p.kind === "docker" ? "container" : "service", action: "stop" })}
                      className="rounded px-1.5 py-0.5 text-[10px] text-red-400/60 transition hover:bg-red-500/10 hover:text-red-400">
                      stop
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Listening ports */}
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">Listening Ports</h3>
        <div className="rounded-xl border border-white/[0.06] bg-surface-0 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-zinc-600">
                <th className="py-2 pl-3 font-medium">Port</th>
                <th className="py-2 font-medium">Bind</th>
                <th className="py-2 font-medium">Process</th>
                <th className="py-2 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {data.ports
                .filter((p) => !p.isSystem)
                .sort((a, b) => a.port - b.port)
                .map((p) => (
                <tr key={`${p.bind}:${p.port}`} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="py-2 pl-3">
                    <span className="font-mono font-medium text-zinc-200">:{p.port}</span>
                  </td>
                  <td className="py-2">
                    {p.isPublic
                      ? <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">public</span>
                      : <span className="text-zinc-600">{p.bind}</span>}
                  </td>
                  <td className="py-2 text-zinc-400">
                    {p.container || p.service || p.process || "—"}
                  </td>
                  <td className="py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                      p.kind === "docker" ? "bg-blue-500/10 text-blue-400"
                      : p.kind === "systemd" ? "bg-violet-500/10 text-violet-400"
                      : "bg-white/[0.04] text-zinc-500"
                    }`}>{p.kind}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          title={`${confirm.action === "stop" ? "Stop" : "Restart"} ${confirm.name}?`}
          message={`This will ${confirm.action} the ${confirm.kind}.`}
          onConfirm={handleAction}
          onCancel={() => setConfirm(null)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

/* ── Containers Tab ── */

function ContainersTab({ data, token, onViewLogs }: { data: SystemData; token: string; onViewLogs: (name: string, kind: "container" | "service") => void }) {
  const [confirm, setConfirm] = useState<{ name: string; action: "stop" | "restart" } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const handleAction = async () => {
    if (!confirm) return;
    setActionLoading(true);
    await fetch(`/api/system/containers/${encodeURIComponent(confirm.name)}/${confirm.action}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    });
    setActionLoading(false);
    setConfirm(null);
  };

  const sorted = [...data.containers].sort((a, b) => {
    if (a.status === "stopped" && b.status !== "stopped") return 1;
    if (a.status !== "stopped" && b.status === "stopped") return -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      <div className="rounded-xl border border-white/[0.06] bg-surface-0 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-zinc-600">
              <th className="py-2 pl-3 font-medium">Container</th>
              <th className="py-2 font-medium">Image</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">CPU</th>
              <th className="py-2 font-medium">Memory</th>
              <th className="py-2 font-medium">Ports</th>
              <th className="py-2 pr-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.name} className={`border-b border-white/[0.03] hover:bg-white/[0.02] ${c.status === "stopped" ? "opacity-50" : ""}`}>
                <td className="py-2.5 pl-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusColor(c.status)}`} />
                    <span className="font-medium text-zinc-100">{c.name}</span>
                    {c.composeProject && <span className="text-zinc-600">{c.composeProject}</span>}
                    {!c.composeProject && c.status !== "stopped" && (
                      <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-400">orphan</span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 max-w-[140px] truncate text-zinc-500">{c.image.split(":")[0]}</td>
                <td className="py-2.5">
                  <span className={`text-[11px] ${c.status === "healthy" ? "text-emerald-400" : c.status === "running" ? "text-zinc-300" : "text-zinc-600"}`}>
                    {statusText(c.status)}
                  </span>
                </td>
                <td className="py-2.5 tabular-nums text-zinc-400">{c.cpu || "—"}</td>
                <td className="py-2.5 tabular-nums text-zinc-400">{c.memory || "—"}</td>
                <td className="py-2.5">
                  {c.ports.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {c.ports.map((p) => (
                        <span key={`${p.hostPort}-${p.containerPort}`} className="font-mono text-zinc-400">:{p.hostPort}</span>
                      ))}
                    </div>
                  ) : <span className="text-zinc-700">—</span>}
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => onViewLogs(c.name, "container")}
                      className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300">logs</button>
                    {c.status !== "stopped" && (
                      <>
                        <button type="button" onClick={() => setConfirm({ name: c.name, action: "restart" })}
                          className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300">restart</button>
                        <button type="button" onClick={() => setConfirm({ name: c.name, action: "stop" })}
                          className="rounded px-1.5 py-0.5 text-[10px] text-red-400/60 hover:bg-red-500/10 hover:text-red-400">stop</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirm && (
        <ConfirmDialog
          title={`${confirm.action === "stop" ? "Stop" : "Restart"} ${confirm.name}?`}
          message={`This will ${confirm.action} the container.`}
          onConfirm={handleAction}
          onCancel={() => setConfirm(null)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

/* ── Services Tab ── */

function ServicesTab({ data, token, onViewLogs }: { data: SystemData; token: string; onViewLogs: (name: string, kind: "container" | "service") => void }) {
  const [confirm, setConfirm] = useState<{ name: string; action: "stop" | "restart" } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const handleAction = async () => {
    if (!confirm) return;
    setActionLoading(true);
    await fetch(`/api/system/services/${encodeURIComponent(confirm.name)}/${confirm.action}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    });
    setActionLoading(false);
    setConfirm(null);
  };

  const sorted = [...data.services].sort((a, b) => {
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      <div className="rounded-xl border border-white/[0.06] bg-surface-0 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-zinc-600">
              <th className="py-2 pl-3 font-medium">Service</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Memory</th>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 pr-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.name} className={`border-b border-white/[0.03] hover:bg-white/[0.02] ${!s.active ? "opacity-50" : ""}`}>
                <td className="py-2.5 pl-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusColor(s.status)}`} />
                    <span className="font-medium text-zinc-100">{s.name}</span>
                  </div>
                </td>
                <td className="py-2.5">
                  <span className={`text-[11px] ${s.active ? "text-emerald-400" : s.status === "failed" ? "text-red-400" : "text-zinc-600"}`}>
                    {statusText(s.status)}
                  </span>
                </td>
                <td className="py-2.5 tabular-nums text-zinc-400">{s.memory || "—"}</td>
                <td className="py-2.5 text-zinc-500 max-w-[200px] truncate">{s.description}</td>
                <td className="py-2.5 pr-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button type="button" onClick={() => onViewLogs(s.name, "service")}
                      className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300">logs</button>
                    {s.active && (
                      <>
                        <button type="button" onClick={() => setConfirm({ name: s.name, action: "restart" })}
                          className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300">restart</button>
                        <button type="button" onClick={() => setConfirm({ name: s.name, action: "stop" })}
                          className="rounded px-1.5 py-0.5 text-[10px] text-red-400/60 hover:bg-red-500/10 hover:text-red-400">stop</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirm && (
        <ConfirmDialog
          title={`${confirm.action === "stop" ? "Stop" : "Restart"} ${confirm.name}?`}
          message={`This will ${confirm.action} the systemd service.`}
          onConfirm={handleAction}
          onCancel={() => setConfirm(null)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

/* ── Main Page ── */

export function SystemPage() {
  const serverToken = useServerToken();
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [logTarget, setLogTarget] = useState<{ name: string; kind: "container" | "service" } | null>(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${serverToken}` }), [serverToken]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/system/overview", { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Auto-refresh every 15s
  useEffect(() => {
    const interval = setInterval(() => { void loadData(); }, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-3 xl:px-5">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">System</h1>
          <p className="mt-0.5 text-[12px] text-zinc-600">
            {data ? `${data.summary.runningContainers} containers · ${data.summary.activeServices} services · ${data.summary.listeningPorts} ports` : "Loading…"}
          </p>
        </div>
        <button type="button" onClick={() => { setLoading(true); void loadData(); }} disabled={loading}
          className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[12px] text-zinc-500 transition hover:border-white/[0.1] hover:bg-white/[0.06] hover:text-zinc-300 disabled:opacity-50">
          {loading && data ? "…" : loading ? "Loading" : "Refresh"}
        </button>
      </div>

      <div className="mb-3 flex shrink-0 items-center gap-0.5 rounded-xl border border-white/[0.05] bg-surface-0 p-1">
        <TabButton label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
        <TabButton label="Containers" active={activeTab === "containers"} count={data?.summary.runningContainers} onClick={() => setActiveTab("containers")} />
        <TabButton label="Services" active={activeTab === "services"} count={data?.summary.activeServices} onClick={() => setActiveTab("services")} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-soft pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {loading && !data && (
          <div className="flex min-h-40 items-center justify-center text-[13px] text-zinc-600">Scanning system…</div>
        )}
        {error && !data && (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-red-500/20 text-[13px] text-red-300">{error}</div>
        )}
        {data && activeTab === "overview" && (
          <OverviewTab data={data} token={serverToken} onViewLogs={(name, kind) => setLogTarget({ name, kind })} />
        )}
        {data && activeTab === "containers" && (
          <ContainersTab data={data} token={serverToken} onViewLogs={(name, kind) => setLogTarget({ name, kind })} />
        )}
        {data && activeTab === "services" && (
          <ServicesTab data={data} token={serverToken} onViewLogs={(name, kind) => setLogTarget({ name, kind })} />
        )}
      </div>

      {logTarget && (
        <LogViewer name={logTarget.name} kind={logTarget.kind} token={serverToken} onClose={() => setLogTarget(null)} />
      )}
    </div>
  );
}
