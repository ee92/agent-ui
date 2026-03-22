/**
 * Process Manager — start/stop/logs for dev servers.
 *
 * Supports two service kinds:
 *   1. Bare processes: spawned from apps.json cmd, tracked by PID
 *   2. Docker Compose: lifecycle via docker-compose CLI
 *
 * State persisted in ~/.agent-ui/state.json.
 * Logs written to ~/.agent-ui/logs/<name>.log.
 */

import { execSync, spawn } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
  statSync, openSync, createWriteStream,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createConnection } from "node:net";
import { scanDocker } from "./docker-scanner.mjs";

const DATA_DIR = join(homedir(), ".agent-ui");
const LOGS_DIR = join(DATA_DIR, "logs");
const STATE_FILE = join(DATA_DIR, "state.json");
const MAX_LOG_BYTES = 1024 * 1024; // 1 MB
const MAX_LOG_TAIL = 200;
const STOP_GRACE_MS = 5000;

// Ensure dirs exist
mkdirSync(LOGS_DIR, { recursive: true });

// ── Apps registry ──

/** @returns {Record<string, { port: number, dir: string, cmd: string, description?: string }>} */
function loadApps() {
  const paths = [
    process.env.AGENT_UI_APPS,
    join(DATA_DIR, "apps.json"),
    join(homedir(), ".openclaw", "workspace", "dev-proxy", "apps.json"),
  ].filter(Boolean);

  for (const p of paths) {
    try {
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
    } catch { /* skip malformed */ }
  }
  return {};
}

// ── State file ──

/** @returns {Record<string, { pid: number, startedAt: string, port: number }>} */
function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch { /* corrupted — start fresh */ }
  return {};
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Reconcile state with reality on startup */
function recoverState() {
  const state = loadState();
  let changed = false;
  for (const [name, entry] of Object.entries(state)) {
    if (!pidAlive(entry.pid)) {
      delete state[name];
      changed = true;
    }
  }
  if (changed) saveState(state);
  return state;
}

// Run recovery once on import
recoverState();

// ── Port check ──

function isPortInUse(port) {
  return new Promise((res) => {
    const sock = createConnection({ port, host: "127.0.0.1" }, () => {
      sock.destroy();
      res(true);
    });
    sock.on("error", () => res(false));
    sock.setTimeout(500, () => { sock.destroy(); res(false); });
  });
}

// ── Log rotation ──

function rotateLogIfNeeded(logPath) {
  try {
    if (!existsSync(logPath)) return;
    const stat = statSync(logPath);
    if (stat.size < MAX_LOG_BYTES) return;
    const lines = readFileSync(logPath, "utf-8").split("\n");
    const trimmed = lines.slice(-500).join("\n");
    writeFileSync(logPath, trimmed);
  } catch { /* best effort */ }
}

// ── Docker Compose helpers ──

function findComposeFile(dir) {
  for (const name of ["docker-compose.yml", "docker-compose.yaml"]) {
    if (existsSync(join(dir, name))) return name;
  }
  return null;
}

function getDockerProjects() {
  try {
    const { projects } = scanDocker();
    return projects;
  } catch { return {}; }
}

// ── Public API ──

/**
 * List all services with their current status.
 * @returns {{ services: Array<{ name: string, kind: string, status: string, port?: number, dir?: string, description?: string }> }}
 */
export function listServices() {
  const apps = loadApps();
  const state = loadState();
  const dockerProjects = getDockerProjects();
  const services = [];

  // Bare-process services from apps.json
  for (const [name, app] of Object.entries(apps)) {
    const entry = state[name];
    const alive = entry ? pidAlive(entry.pid) : false;
    services.push({
      name,
      kind: "process",
      status: alive ? "running" : "stopped",
      port: app.port,
      dir: app.dir,
      description: app.description || "",
      pid: alive ? entry.pid : undefined,
    });
  }

  // Docker Compose projects (not already in apps.json)
  for (const [projectName, project] of Object.entries(dockerProjects)) {
    if (apps[projectName]) continue; // already listed as bare process
    const running = project.containers?.some((c) =>
      c.status?.toLowerCase().includes("up")
    );
    services.push({
      name: projectName,
      kind: "docker",
      status: running ? "running" : "stopped",
      dir: project.dir || "",
      description: `Docker Compose (${project.containers?.length || 0} containers)`,
    });
  }

  return { services };
}

/**
 * Start a service by name.
 * @param {string} name
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function startService(name) {
  const apps = loadApps();
  const app = apps[name];

  if (app) return startBareProcess(name, app);
  return startDockerProject(name);
}

/**
 * Stop a service by name.
 * @param {string} name
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function stopService(name) {
  const apps = loadApps();
  const app = apps[name];

  if (app) return stopBareProcess(name);
  return stopDockerProject(name);
}

/**
 * Get logs for a service.
 * @param {string} name
 * @returns {{ ok: boolean, logs?: string, message?: string }}
 */
export function getServiceLogs(name) {
  const apps = loadApps();
  const app = apps[name];

  if (app) return getBareProcessLogs(name);
  return getDockerLogs(name);
}

// ── Bare process lifecycle ──

async function startBareProcess(name, app) {
  const state = loadState();

  // Already running?
  if (state[name] && pidAlive(state[name].pid)) {
    return { ok: false, message: `${name} is already running (PID ${state[name].pid})` };
  }

  // Validate directory
  if (!app.dir || !existsSync(app.dir)) {
    return { ok: false, message: `Directory not found: ${app.dir}` };
  }

  // Validate command
  if (!app.cmd) {
    return { ok: false, message: `No cmd defined for ${name}` };
  }

  // Port conflict check
  if (app.port && await isPortInUse(app.port)) {
    return { ok: false, message: `Port ${app.port} is already in use` };
  }

  // Prepare log file
  const logPath = join(LOGS_DIR, `${name}.log`);
  rotateLogIfNeeded(logPath);
  const logFd = openSync(logPath, "a");

  // Spawn detached
  const child = spawn("sh", ["-c", app.cmd], {
    cwd: resolve(app.dir),
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, PORT: String(app.port || "") },
  });

  child.unref();

  // Track state
  state[name] = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    port: app.port,
  };
  saveState(state);

  return { ok: true, message: `Started ${name} (PID ${child.pid}) on port ${app.port}` };
}

async function stopBareProcess(name) {
  const state = loadState();
  const entry = state[name];

  if (!entry || !pidAlive(entry.pid)) {
    delete state[name];
    saveState(state);
    return { ok: true, message: `${name} is not running` };
  }

  // SIGTERM first
  try { process.kill(entry.pid, "SIGTERM"); } catch { /* already dead */ }

  // Wait for graceful shutdown
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline && pidAlive(entry.pid)) {
    await new Promise((r) => setTimeout(r, 200));
  }

  // SIGKILL if still alive
  if (pidAlive(entry.pid)) {
    try { process.kill(entry.pid, "SIGKILL"); } catch { /* ok */ }
  }

  delete state[name];
  saveState(state);
  return { ok: true, message: `Stopped ${name}` };
}

function getBareProcessLogs(name) {
  const logPath = join(LOGS_DIR, `${name}.log`);
  if (!existsSync(logPath)) {
    return { ok: true, logs: "" };
  }
  try {
    const content = readFileSync(logPath, "utf-8");
    const lines = content.split("\n");
    const tail = lines.slice(-MAX_LOG_TAIL).join("\n");
    return { ok: true, logs: tail };
  } catch (err) {
    return { ok: false, message: `Failed to read logs: ${err.message}` };
  }
}

// ── Docker Compose lifecycle ──

async function startDockerProject(name) {
  const projects = getDockerProjects();
  const project = projects[name];
  const dir = project?.dir;

  if (!dir || !existsSync(dir)) {
    return { ok: false, message: `Unknown service or directory not found: ${name}` };
  }

  const composeFile = findComposeFile(dir);
  if (!composeFile) {
    return { ok: false, message: `No docker-compose.yml found in ${dir}` };
  }

  try {
    execSync(`docker-compose -f ${composeFile} up -d`, {
      cwd: dir, encoding: "utf-8", timeout: 60000,
    });
    return { ok: true, message: `Started Docker Compose project: ${name}` };
  } catch (err) {
    return { ok: false, message: `Failed to start ${name}: ${err.message}` };
  }
}

async function stopDockerProject(name) {
  const projects = getDockerProjects();
  const project = projects[name];
  const dir = project?.dir;

  if (!dir || !existsSync(dir)) {
    return { ok: false, message: `Unknown service or directory not found: ${name}` };
  }

  const composeFile = findComposeFile(dir);
  if (!composeFile) {
    return { ok: false, message: `No docker-compose.yml found in ${dir}` };
  }

  try {
    execSync(`docker-compose -f ${composeFile} down`, {
      cwd: dir, encoding: "utf-8", timeout: 60000,
    });
    return { ok: true, message: `Stopped Docker Compose project: ${name}` };
  } catch (err) {
    return { ok: false, message: `Failed to stop ${name}: ${err.message}` };
  }
}

function getDockerLogs(name) {
  const projects = getDockerProjects();
  const project = projects[name];
  const dir = project?.dir;

  if (!dir || !existsSync(dir)) {
    return { ok: false, message: `Unknown service: ${name}` };
  }

  const composeFile = findComposeFile(dir);
  if (!composeFile) {
    return { ok: false, message: `No docker-compose.yml in ${dir}` };
  }

  try {
    const logs = execSync(`docker-compose -f ${composeFile} logs --tail 50 --no-color`, {
      cwd: dir, encoding: "utf-8", timeout: 10000,
    });
    return { ok: true, logs };
  } catch (err) {
    return { ok: false, message: `Failed to get logs: ${err.message}` };
  }
}
