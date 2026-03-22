/**
 * Project Merger — combines git repos, docker containers, tasks, and listening ports.
 * Groups by nearest git root and degrades gracefully when any data source fails.
 */

import { execSync } from "node:child_process";
import { existsSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { scanDocker } from "./docker-scanner.mjs";

const CACHE_TTL = 15_000;
let cache = { data: null, ts: 0 };

/**
 * @typedef {{
 *   name: string,
 *   dir: string,
 *   branch?: string,
 *   dirtyFiles?: number,
 *   ahead?: number,
 *   behind?: number,
 *   lastCommitMsg?: string,
 *   branches?: number
 * }} RepoInfo
 */

/**
 * @typedef {{ id: string, title: string, status: string, repo?: string }} TaskInfo
 */

/**
 * @param {{
 *   repos?: RepoInfo[],
 *   tasks?: TaskInfo[],
 *   force?: boolean
 * }} [input]
 * @returns {{
 *   projects: {
 *     name: string,
 *     dir: string,
 *     git: {
 *       branch: string,
 *       dirty: number,
 *       ahead: number,
 *       behind: number,
 *       lastCommitMsg: string,
 *       branches: number
 *     },
 *     containers: { name: string, service: string, status: string, memory: string, ports: string[] }[],
 *     tasks: { id: string, title: string, status: string }[]
 *   }[],
 *   untracked: {
 *     containers: { name: string, service: string, status: string, memory: string, ports: string[] }[],
 *     ports: { port: number, bind: string, pid: number | null, process: string, cwd: string }[]
 *   }
 * }}
 */
export function mergeProjects(input = {}) {
  const repos = Array.isArray(input.repos) ? input.repos : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const force = !!input.force;
  const now = Date.now();

  if (!force && cache.data && now - cache.ts < CACHE_TTL) {
    return cache.data;
  }

  const data = buildMergedProjects(repos, tasks);
  cache = { data, ts: now };
  return data;
}

function buildMergedProjects(repos, tasks) {
  const home = homedir();
  const findNearestGitRoot = createNearestRootFinder(home);
  const projectsByDir = new Map();

  for (const repo of repos) {
    if (!repo || typeof repo.dir !== "string" || !repo.dir) continue;
    const dir = resolve(repo.dir);
    const name = typeof repo.name === "string" && repo.name ? repo.name : basename(dir);
    projectsByDir.set(dir, {
      name,
      dir,
      git: mapGit(repo),
      containers: [],
      tasks: tasksForProject(tasks, name),
    });
  }

  let dockerData = { projects: {}, orphans: [] };
  try {
    dockerData = scanDocker();
  } catch {
    // Docker unavailable — keep partial data.
  }

  const untrackedContainers = Array.isArray(dockerData.orphans) ? [...dockerData.orphans] : [];

  for (const dockerProject of Object.values(dockerData.projects || {})) {
    const containers = Array.isArray(dockerProject?.containers) ? dockerProject.containers : [];
    const root = findNearestGitRoot(dockerProject?.dir || "");
    if (!root) {
      untrackedContainers.push(...containers);
      continue;
    }

    if (!projectsByDir.has(root)) {
      projectsByDir.set(root, {
        name: basename(root),
        dir: root,
        git: emptyGit(),
        containers: [],
        tasks: tasksForProject(tasks, basename(root)),
      });
    }

    const project = projectsByDir.get(root);
    project.containers.push(...containers);
  }

  let ports = [];
  try {
    ports = scanListeningPorts();
  } catch {
    // Port scan unavailable — continue without ports.
  }

  const untrackedPorts = [];
  for (const portInfo of ports) {
    if (!portInfo.cwd) {
      untrackedPorts.push(portInfo);
      continue;
    }
    const root = findNearestGitRoot(portInfo.cwd);
    if (!root || !projectsByDir.has(root)) {
      untrackedPorts.push(portInfo);
    }
  }

  const projects = [...projectsByDir.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    projects,
    untracked: {
      containers: untrackedContainers,
      ports: untrackedPorts,
    },
  };
}

function mapGit(repo) {
  return {
    branch: repo.branch || "HEAD",
    dirty: Number.isFinite(repo.dirtyFiles) ? repo.dirtyFiles : 0,
    ahead: Number.isFinite(repo.ahead) ? repo.ahead : 0,
    behind: Number.isFinite(repo.behind) ? repo.behind : 0,
    lastCommitMsg: repo.lastCommitMsg || "",
    branches: Number.isFinite(repo.branches) ? repo.branches : 0,
  };
}

function emptyGit() {
  return {
    branch: "HEAD",
    dirty: 0,
    ahead: 0,
    behind: 0,
    lastCommitMsg: "",
    branches: 0,
  };
}

function tasksForProject(tasks, repoName) {
  return tasks
    .filter((task) => task && task.repo === repoName)
    .map((task) => ({ id: task.id, title: task.title, status: task.status }));
}

function createNearestRootFinder(homeDir) {
  const home = resolve(homeDir);
  const cacheByDir = new Map();
  return (startDir) => {
    if (typeof startDir !== "string" || !startDir) return null;

    const start = resolve(startDir);
    if (cacheByDir.has(start)) return cacheByDir.get(start);

    const underHome = start === home || start.startsWith(home + "/");
    let current = start;
    while (true) {
      if (existsSync(join(current, ".git"))) {
        cacheByDir.set(start, current);
        return current;
      }

      if (underHome && current === home) {
        cacheByDir.set(start, null);
        return null;
      }

      const parent = dirname(current);
      if (parent === current) {
        cacheByDir.set(start, null);
        return null;
      }
      current = parent;
    }
  };
}

function scanListeningPorts() {
  const platform = process.platform;
  if (platform === "linux") return scanPortsLinux();
  if (platform === "darwin") return scanPortsMac();
  return [];
}

function scanPortsLinux() {
  let raw = "";
  try {
    raw = execSync("ss -tlnpH 2>/dev/null", { encoding: "utf8", timeout: 5000 }).trim();
  } catch (error) {
    raw = typeof error?.stdout === "string" ? error.stdout.trim() : "";
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
    const cwd = pid ? resolvePidCwdLinux(pid) : "";

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

function scanPortsMac() {
  let raw = "";
  try {
    raw = execSync("lsof -iTCP -sTCP:LISTEN -nP", { encoding: "utf8", timeout: 5000 }).trim();
  } catch (error) {
    raw = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  }
  if (!raw) return [];

  const seen = new Set();
  const results = [];
  const lines = raw.split("\n");

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const header = line.trim().split(/\s+/);
    if (header.length < 2) continue;

    const processName = header[0];
    const pid = parseInt(header[1], 10);
    if (!Number.isFinite(pid)) continue;

    const tcpMatch = line.match(/TCP\s+(.+)\s+\(LISTEN\)$/);
    if (!tcpMatch) continue;
    const endpoint = parseEndpoint(tcpMatch[1]);
    if (!endpoint) continue;

    const cwd = resolvePidCwdMac(pid);
    const key = `${endpoint.bind}:${endpoint.port}:${pid}`;
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

function resolvePidCwdLinux(pid) {
  try {
    const link = `/proc/${pid}/cwd`;
    if (!existsSync(link)) return "";
    return readlinkSync(link);
  } catch {
    return "";
  }
}

function resolvePidCwdMac(pid) {
  try {
    const raw = execSync(`lsof -a -p ${pid} -d cwd -Fn`, { encoding: "utf8", timeout: 2000 }).trim();
    for (const line of raw.split("\n")) {
      if (line.startsWith("n")) {
        return line.slice(1).trim();
      }
    }
  } catch {
    // Missing permissions / process exited — keep unknown cwd.
  }
  return "";
}

function parseEndpoint(value) {
  if (typeof value !== "string" || !value) return null;
  const trimmed = value.trim();

  let match = trimmed.match(/^\[(.*)\]:(\d+)$/);
  if (match) {
    return { bind: match[1], port: parseInt(match[2], 10) };
  }

  match = trimmed.match(/^(.*):(\d+)$/);
  if (!match) return null;
  return { bind: match[1], port: parseInt(match[2], 10) };
}

