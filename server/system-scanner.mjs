/**
 * System Scanner — unified view of everything running on the machine.
 * Merges Docker containers, systemd services, bare processes, and listening ports.
 */

/**
 * System Scanner — unified view of everything running on the machine.
 * Merges Docker containers, systemd services, bare processes, and listening ports.
 *
 * Platform support:
 *   - Linux: full support (ss, /proc, systemctl, docker)
 *   - macOS: partial (lsof for ports, docker, no systemd, no /proc)
 *   - Windows: not supported
 *
 * All scanning functions degrade gracefully — if a data source is unavailable
 * (Docker not installed, systemd not present, etc.), that section returns empty.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";

// ── Port scanning ──────────────────────────────────────────────

function scanListeningPorts() {
  if (process.platform === "darwin") return scanListeningPortsMac();
  return scanListeningPortsLinux();
}

function scanListeningPortsMac() {
  let raw = "";
  try {
    raw = execSync("lsof -iTCP -sTCP:LISTEN -nP -F pcn 2>/dev/null", { encoding: "utf8", timeout: 5000 }).trim();
  } catch (e) {
    raw = typeof e?.stdout === "string" ? e.stdout.trim() : "";
  }
  if (!raw) return [];

  const results = [];
  const seen = new Set();
  let pid = null, process_name = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("p")) pid = parseInt(line.slice(1), 10) || null;
    else if (line.startsWith("c")) process_name = line.slice(1);
    else if (line.startsWith("n")) {
      const endpoint = parseEndpoint(line.slice(1));
      if (!endpoint) continue;
      const key = `${endpoint.bind}:${endpoint.port}:${pid || "none"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ port: endpoint.port, bind: endpoint.bind, pid, process: process_name, cwd: "" });
    }
  }
  return results;
}

function scanListeningPortsLinux() {
  let raw = "";
  try {
    raw = execSync("ss -tlnpH 2>/dev/null", { encoding: "utf8", timeout: 5000 }).trim();
  } catch (e) {
    raw = typeof e?.stdout === "string" ? e.stdout.trim() : "";
  }
  if (!raw) return [];

  const seen = new Set();
  const results = [];

  for (const line of raw.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;

    const local = parts[3];
    const endpoint = parseEndpoint(local);
    if (!endpoint) continue;

    const procMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    const processName = procMatch?.[1] || "";
    const pid = procMatch?.[2] ? parseInt(procMatch[2], 10) : null;
    const cwd = pid ? resolvePidCwd(pid) : "";

    const key = `${endpoint.bind}:${endpoint.port}:${pid || "none"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      port: endpoint.port,
      bind: endpoint.bind,
      pid,
      process: processName,
      cwd,
    });
  }

  return results;
}

function parseEndpoint(value) {
  if (typeof value !== "string" || !value) return null;
  const trimmed = value.trim();
  let match = trimmed.match(/^\[(.*)\]:(\d+)$/);
  if (match) return { bind: match[1], port: parseInt(match[2], 10) };
  match = trimmed.match(/^(.*):(\d+)$/);
  if (!match) return null;
  return { bind: match[1], port: parseInt(match[2], 10) };
}

function resolvePidCwd(pid) {
  try {
    const link = `/proc/${pid}/cwd`;
    if (!existsSync(link)) return "";
    return readlinkSync(link);
  } catch { return ""; }
}

// ── Docker containers ──────────────────────────────────────────

function scanContainers() {
  try {
    const psRaw = execSync(
      `docker ps -a --no-trunc --format '{"name":"{{.Names}}","status":"{{.Status}}","ports":"{{.Ports}}","image":"{{.Image}}","id":"{{.ID}}"}'`,
      { encoding: "utf8", timeout: 5000 }
    ).trim();
    if (!psRaw) return [];

    const containers = psRaw.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    // Batch inspect for labels
    const names = containers.map((c) => c.name);
    let labelMap = {};
    try {
      const inspectRaw = execSync(
        `docker inspect ${names.map((n) => `"${n}"`).join(" ")} --format '{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.service"}}' 2>/dev/null`,
        { encoding: "utf8", timeout: 10000 }
      ).trim();
      for (const line of inspectRaw.split("\n").filter(Boolean)) {
        const [rawName, project, workingDir, service] = line.split("|");
        const name = rawName.replace(/^\//, "");
        labelMap[name] = { project: project || "", workingDir: workingDir || "", service: service || "" };
      }
    } catch { /* best effort */ }

    // Get stats (memory, CPU)
    let statsMap = {};
    try {
      const statsRaw = execSync(
        `docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}' 2>/dev/null`,
        { encoding: "utf8", timeout: 15000 }
      ).trim();
      for (const line of statsRaw.split("\n").filter(Boolean)) {
        const [name, cpu, mem, net] = line.split("|");
        statsMap[name] = {
          cpu: cpu?.trim() || "0%",
          memory: mem ? mem.split(" / ")[0].trim() : "",
          memoryLimit: mem ? (mem.split(" / ")[1] || "").trim() : "",
          netIO: net?.trim() || "",
        };
      }
    } catch { /* stats unavailable */ }

    return containers.map((c) => {
      const labels = labelMap[c.name] || {};
      const stats = statsMap[c.name] || {};
      const running = c.status?.toLowerCase().includes("up");
      const healthy = c.status?.toLowerCase().includes("healthy");
      const ports = c.ports ? parsePorts(c.ports) : [];

      return {
        name: c.name,
        id: c.id?.slice(0, 12) || "",
        image: c.image,
        status: running ? (healthy ? "healthy" : "running") : "stopped",
        statusText: c.status,
        composeProject: labels.project || null,
        composeService: labels.service || null,
        composeDir: labels.workingDir || null,
        cpu: stats.cpu || "0%",
        memory: stats.memory || "",
        memoryLimit: stats.memoryLimit || "",
        netIO: stats.netIO || "",
        ports,
      };
    });
  } catch {
    return [];
  }
}

function parsePorts(portStr) {
  if (!portStr) return [];
  return portStr.split(",").map((p) => {
    const m = p.trim().match(/(?:(\d+\.\d+\.\d+\.\d+):)?(\d+)->(\d+)/);
    return m ? { bind: m[1] || "0.0.0.0", hostPort: parseInt(m[2], 10), containerPort: parseInt(m[3], 10) } : null;
  }).filter(Boolean);
}

// ── Systemd services ───────────────────────────────────────────

function scanSystemdServices() {
  try {
    const raw = execSync(
      "systemctl --user list-units --type=service --all --no-pager --no-legend 2>/dev/null",
      { encoding: "utf8", timeout: 5000 }
    ).trim();
    if (!raw) return [];

    const results = [];
    for (const line of raw.split("\n")) {
      const match = line.trim().match(/^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)/);
      if (!match) continue;
      const [, unit, load, active, sub, description] = match;
      const name = unit.replace(/\.service$/, "");

      // Get memory + PID
      let memory = "";
      let pid = null;
      try {
        const show = execSync(
          `systemctl --user show ${unit} --property=MainPID,MemoryCurrent 2>/dev/null`,
          { encoding: "utf8", timeout: 3000 }
        ).trim();
        for (const prop of show.split("\n")) {
          if (prop.startsWith("MainPID=")) pid = parseInt(prop.slice(8), 10) || null;
          if (prop.startsWith("MemoryCurrent=")) {
            const bytes = parseInt(prop.slice(14), 10);
            if (bytes > 0 && bytes < 2 ** 53) {
              memory = formatBytes(bytes);
            }
          }
        }
      } catch { /* best effort */ }

      results.push({
        name,
        unit,
        status: active === "active" ? sub : active, // "running", "dead", "failed", etc.
        active: active === "active",
        description: description.trim(),
        memory,
        pid: pid && pid > 0 ? pid : null,
      });
    }

    return results;
  } catch {
    return [];
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KiB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + "MiB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + "GiB";
}

// ── System resources ───────────────────────────────────────────

function scanResources() {
  const result = { cpu: { load1m: 0, load5m: 0, load15m: 0, cores: 1 }, memory: {}, disk: [], docker: {} };

  // CPU load — works on both Linux (/proc) and macOS (os.loadavg)
  try {
    if (existsSync("/proc/loadavg")) {
      const loadavg = readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/);
      result.cpu.load1m = parseFloat(loadavg[0]);
      result.cpu.load5m = parseFloat(loadavg[1]);
      result.cpu.load15m = parseFloat(loadavg[2]);
    } else {
      const [l1, l5, l15] = loadavg();
      result.cpu.load1m = l1; result.cpu.load5m = l5; result.cpu.load15m = l15;
    }
  } catch { /* ok */ }

  // CPU cores
  try {
    if (existsSync("/proc/cpuinfo")) {
      const cpuinfo = readFileSync("/proc/cpuinfo", "utf8");
      result.cpu.cores = (cpuinfo.match(/^processor\s/gm) || []).length || 1;
    } else {
      
      result.cpu.cores = cpus()?.length || 1;
    }
  } catch { /* ok */ }

  // Memory — Linux: /proc/meminfo, macOS: falls back to os.totalmem/freemem
  try {
    if (existsSync("/proc/meminfo")) {
      const meminfo = readFileSync("/proc/meminfo", "utf8");
      const extract = (key) => {
        const m = meminfo.match(new RegExp(`^${key}:\\s*(\\d+)`, "m"));
        return m ? parseInt(m[1], 10) * 1024 : 0; // kB → bytes
      };
      result.memory.total = extract("MemTotal");
      result.memory.free = extract("MemFree");
      result.memory.available = extract("MemAvailable");
      result.memory.buffers = extract("Buffers");
      result.memory.cached = extract("Cached");
      result.memory.used = result.memory.total - result.memory.available;
      result.memory.swapTotal = extract("SwapTotal");
      result.memory.swapFree = extract("SwapFree");
      result.memory.swapUsed = result.memory.swapTotal - result.memory.swapFree;
    } else {
      
      result.memory.total = totalmem() || 0;
      result.memory.free = freemem() || 0;
      result.memory.available = result.memory.free;
      result.memory.used = result.memory.total - result.memory.free;
      result.memory.swapTotal = 0;
      result.memory.swapFree = 0;
      result.memory.swapUsed = 0;
    }
  } catch { /* ok */ }

  // Disk — df syntax differs between Linux and macOS
  try {
    const isLinux = process.platform === "linux";
    const cmd = isLinux
      ? "df -B1 --output=target,size,used,avail,pcent / /home 2>/dev/null"
      : "df -b / 2>/dev/null";
    const df = execSync(cmd, { encoding: "utf8", timeout: 3000 }).trim();
    for (const line of df.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (isLinux) {
        const [mount, size, used, avail, percent] = parts;
        result.disk.push({ mount, total: parseInt(size, 10), used: parseInt(used, 10), available: parseInt(avail, 10), percent: (percent || "").replace("%", "") + "%" });
      } else if (parts.length >= 6) {
        // macOS: Filesystem 512-blocks Used Available Capacity iused ifree %iused Mounted
        const total = parseInt(parts[1], 10) * 512;
        const used = parseInt(parts[2], 10) * 512;
        const avail = parseInt(parts[3], 10) * 512;
        const mount = parts[parts.length - 1];
        const pct = total > 0 ? Math.round((used / total) * 100) : 0;
        result.disk.push({ mount, total, used, available: avail, percent: pct + "%" });
      }
    }
  } catch { /* ok */ }

  // Docker disk
  try {
    const ddf = execSync("docker system df --format '{{.Type}}|{{.Size}}|{{.Reclaimable}}' 2>/dev/null", {
      encoding: "utf8", timeout: 5000,
    }).trim();
    for (const line of ddf.split("\n").filter(Boolean)) {
      const [type, size, reclaimable] = line.split("|");
      result.docker[type?.trim().toLowerCase()] = { size: size?.trim(), reclaimable: reclaimable?.trim() };
    }
  } catch { /* ok */ }

  return result;
}

// ── Unified overview ───────────────────────────────────────────

/**
 * Build a unified process list: every "thing" running on the machine.
 * Merges ports, containers, and systemd services into one list.
 */
export function getSystemOverview() {
  const ports = scanListeningPorts();
  const containers = scanContainers();
  const services = scanSystemdServices();
  const resources = scanResources();

  // Build container lookup by name for port matching
  const containerByName = new Map();
  const containerByPort = new Map();
  for (const c of containers) {
    containerByName.set(c.name, c);
    for (const p of c.ports) {
      containerByPort.set(p.hostPort, c);
    }
  }

  // Build service lookup by PID
  const serviceByPid = new Map();
  for (const s of services) {
    if (s.pid) serviceByPid.set(s.pid, s);
  }

  // Classify each listening port
  const SYSTEM_PORTS = new Set([22, 53]);
  const classifiedPorts = ports.map((p) => {
    const container = containerByPort.get(p.port);
    const service = p.pid ? serviceByPid.get(p.pid) : null;
    const isSystem = SYSTEM_PORTS.has(p.port) || p.bind === "127.0.0.53%lo" || p.bind === "127.0.0.54";
    const isPublic = p.bind === "0.0.0.0" || p.bind === "::";

    return {
      ...p,
      kind: container ? "docker" : service ? "systemd" : isSystem ? "system" : "process",
      container: container?.name || null,
      service: service?.name || null,
      isPublic,
      isSystem,
    };
  });

  return {
    ports: classifiedPorts,
    containers,
    services,
    resources,
    summary: {
      totalContainers: containers.length,
      runningContainers: containers.filter((c) => c.status !== "stopped").length,
      totalServices: services.length,
      activeServices: services.filter((s) => s.active).length,
      listeningPorts: ports.length,
      publicPorts: classifiedPorts.filter((p) => p.isPublic && !p.isSystem).length,
    },
  };
}

// ── Input validation ───────────────────────────────────────────

/** Sanitize names to prevent command injection. Only allow alphanumeric, dash, underscore, dot. */
function sanitizeName(name) {
  if (typeof name !== "string" || !name) return null;
  // Docker container names: [a-zA-Z0-9][a-zA-Z0-9_.-]
  // Systemd unit names: [a-zA-Z0-9:._@-]
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/.test(name)) return null;
  if (name.length > 200) return null;
  return name;
}

function sanitizeTail(tail) {
  const n = parseInt(tail, 10);
  if (!Number.isFinite(n) || n < 1) return 200;
  return Math.min(n, 5000);
}

// ── Actions ────────────────────────────────────────────────────

/**
 * Get container logs.
 * @param {string} nameOrId - Container name or ID (sanitized)
 * @param {number} [tail=200] - Number of lines to return
 */
export function getContainerLogs(nameOrId, tail = 200) {
  const name = sanitizeName(nameOrId);
  if (!name) return { ok: false, logs: "", error: "Invalid container name" };
  const lines = sanitizeTail(tail);
  try {
    const logs = execSync(
      `docker logs --tail ${lines} --timestamps "${name}" 2>&1`,
      { encoding: "utf8", timeout: 10000, maxBuffer: 5 * 1024 * 1024 }
    );
    return { ok: true, logs };
  } catch (e) {
    return { ok: false, logs: "", error: e.message };
  }
}

/**
 * Get systemd service logs.
 * @param {string} name - Service name (sanitized, without .service suffix)
 * @param {number} [tail=200] - Number of lines to return
 */
export function getServiceLogs(name, tail = 200) {
  const safeName = sanitizeName(name);
  if (!safeName) return { ok: false, logs: "", error: "Invalid service name" };
  const lines = sanitizeTail(tail);
  try {
    const logs = execSync(
      `journalctl --user -u ${safeName}.service -n ${lines} --no-pager 2>&1`,
      { encoding: "utf8", timeout: 10000, maxBuffer: 5 * 1024 * 1024 }
    );
    return { ok: true, logs };
  } catch (e) {
    return { ok: false, logs: "", error: e.message };
  }
}

/**
 * Stop a Docker container.
 * @param {string} nameOrId - Container name or ID (sanitized)
 */
export function stopContainer(nameOrId) {
  const name = sanitizeName(nameOrId);
  if (!name) return { ok: false, message: "Invalid container name" };
  try {
    execSync(`docker stop "${name}"`, { encoding: "utf8", timeout: 30000 });
    return { ok: true, message: `Stopped ${name}` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * Restart a Docker container.
 * @param {string} nameOrId - Container name or ID (sanitized)
 */
export function restartContainer(nameOrId) {
  const name = sanitizeName(nameOrId);
  if (!name) return { ok: false, message: "Invalid container name" };
  try {
    execSync(`docker restart "${name}"`, { encoding: "utf8", timeout: 30000 });
    return { ok: true, message: `Restarted ${name}` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * Stop a systemd user service.
 * @param {string} name - Service name (sanitized, without .service suffix)
 */
export function stopSystemdService(name) {
  const safeName = sanitizeName(name);
  if (!safeName) return { ok: false, message: "Invalid service name" };
  try {
    execSync(`systemctl --user stop ${safeName}.service`, { encoding: "utf8", timeout: 10000 });
    return { ok: true, message: `Stopped ${safeName}` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * Restart a systemd user service.
 * @param {string} name - Service name (sanitized, without .service suffix)
 */
export function restartSystemdService(name) {
  const safeName = sanitizeName(name);
  if (!safeName) return { ok: false, message: "Invalid service name" };
  try {
    execSync(`systemctl --user restart ${safeName}.service`, { encoding: "utf8", timeout: 10000 });
    return { ok: true, message: `Restarted ${safeName}` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
