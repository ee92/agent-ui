/**
 * Docker Scanner — discovers containers grouped by compose project.
 * Returns compose projects with their containers, ports, memory, and working dirs.
 * Graceful degradation: if Docker is unavailable, returns empty result.
 */

import { execSync } from "node:child_process";

let cache = { data: null, ts: 0 };
const CACHE_TTL = 15_000;

/**
 * @returns {{ projects: Record<string, DockerProject>, orphans: DockerContainer[] }}
 */
export function scanDocker() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) return cache.data;

  try {
    const result = scan();
    cache = { data: result, ts: now };
    return result;
  } catch {
    // Docker unavailable — daemon down, not installed, permission denied
    const empty = { projects: {}, orphans: [] };
    cache = { data: empty, ts: now };
    return empty;
  }
}

function scan() {
  // Get all running containers with labels and ports
  const psRaw = execSync(
    'docker ps --no-trunc --format \'{"name":"{{.Names}}","status":"{{.Status}}","ports":"{{.Ports}}"}\' 2>/dev/null',
    { encoding: "utf-8", timeout: 5000 }
  ).trim();

  if (!psRaw) return { projects: {}, orphans: [] };

  const containers = psRaw.split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  // Get labels and stats for each container
  const names = containers.map((c) => c.name);

  // Batch inspect for labels
  const inspectRaw = execSync(
    `docker inspect ${names.map((n) => `"${n}"`).join(" ")} --format '{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.service"}}' 2>/dev/null`,
    { encoding: "utf-8", timeout: 10000 }
  ).trim();

  const labelMap = {};
  for (const line of inspectRaw.split("\n").filter(Boolean)) {
    const [rawName, project, workingDir, service] = line.split("|");
    const name = rawName.replace(/^\//, "");
    labelMap[name] = { project: project || "", workingDir: workingDir || "", service: service || "" };
  }

  // Get memory stats (non-blocking, best-effort)
  let memMap = {};
  try {
    const statsRaw = execSync(
      'docker stats --no-stream --format \'{{.Name}}|{{.MemUsage}}\' 2>/dev/null',
      { encoding: "utf-8", timeout: 10000 }
    ).trim();
    for (const line of statsRaw.split("\n").filter(Boolean)) {
      const [name, mem] = line.split("|");
      memMap[name] = mem ? mem.split(" / ")[0].trim() : "";
    }
  } catch {
    // Stats unavailable — continue without memory info
  }

  // Group by compose project
  const projects = {};
  const orphans = [];

  for (const c of containers) {
    const labels = labelMap[c.name] || {};
    const container = {
      name: c.name,
      service: labels.service || c.name,
      status: c.status,
      memory: memMap[c.name] || "",
      ports: c.ports ? parsePorts(c.ports) : [],
    };

    if (labels.project) {
      if (!projects[labels.project]) {
        projects[labels.project] = {
          name: labels.project,
          dir: labels.workingDir || "",
          containers: [],
        };
      }
      projects[labels.project].containers.push(container);
    } else {
      orphans.push(container);
    }
  }

  return { projects, orphans };
}

/**
 * Parse Docker's port string format into clean array.
 * "127.0.0.1:3345->80/tcp, 127.0.0.1:3344->3333/tcp" → ["3345->80", "3344->3333"]
 */
function parsePorts(portStr) {
  if (!portStr) return [];
  return portStr.split(",").map((p) => {
    const m = p.trim().match(/:(\d+)->(\d+)/);
    return m ? `${m[1]}->${m[2]}` : null;
  }).filter(Boolean);
}
