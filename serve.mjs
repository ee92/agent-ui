import { createServer } from "node:http";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
  realpathSync,
  rmSync,
  renameSync,
} from "node:fs";
import { join, extname, relative, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { listSessions, getSession, refreshIndex } from "./server/claude/session-index.mjs";
import { parseTranscript } from "./server/claude/transcript-parser.mjs";
import { startRun, cancelRun, getRunStatus } from "./server/claude/standalone-runner.mjs";
import { createBroker } from "./server/claude/ws-broker.mjs";
import { validateTransition } from "./lib/task-guards.mjs";
import {
  createJob as createCronJob,
  getRuns as getCronRuns,
  listJobs as listCronJobs,
  removeJob as removeCronJob,
  runJobNow as runCronJobNow,
  startScheduler,
  updateJob as updateCronJob,
} from "./server/cron/scheduler.mjs";

const DIST = resolve(import.meta.dirname, "dist");
const PORT = 18789;
const CLAUDE_OVERRIDES_PATH = resolve(homedir(), ".openclaw", "claude-session-overrides.json");
const CLAUDE_TRASH_DIR = resolve(homedir(), ".openclaw", ".trash", "claude-sessions");

const broker = createBroker();

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function fileExists(path) {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function expandHome(path) {
  if (typeof path !== "string" || !path.trim()) {
    return "";
  }
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

function parseGatewayUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (!parsed.hostname || !parsed.port) {
      return null;
    }
    const port = Number(parsed.port);
    if (!Number.isFinite(port)) {
      return null;
    }
    return { host: parsed.hostname, port };
  } catch {
    return null;
  }
}

const LOCAL_CONFIG_PATH = resolve(process.cwd(), "mc.config.json");
const USER_CONFIG_PATH = resolve(homedir(), ".mc", "config.json");
const OPENCLAW_CONFIG_PATH = resolve(homedir(), ".openclaw", "openclaw.json");
const CLAUDE_DIR = resolve(homedir(), ".claude");
const CLAUDE_SETTINGS_PATH = resolve(CLAUDE_DIR, "settings.json");
const CLAUDE_CONFIG_PATH = resolve(CLAUDE_DIR, "config.json");

const MC_CONFIG_SOURCE_PATH = fileExists(LOCAL_CONFIG_PATH)
  ? LOCAL_CONFIG_PATH
  : fileExists(USER_CONFIG_PATH)
    ? USER_CONFIG_PATH
    : null;
const MC_CONFIG = MC_CONFIG_SOURCE_PATH ? readJson(MC_CONFIG_SOURCE_PATH) : {};
const OPENCLAW_CONFIG = fileExists(OPENCLAW_CONFIG_PATH) ? readJson(OPENCLAW_CONFIG_PATH) : {};
const CLAUDE_SETTINGS = fileExists(CLAUDE_SETTINGS_PATH) ? readJson(CLAUDE_SETTINGS_PATH) : {};
const CLAUDE_CONFIG = fileExists(CLAUDE_CONFIG_PATH) ? readJson(CLAUDE_CONFIG_PATH) : {};

const detectedAgent = (() => {
  if (MC_CONFIG?.agent && MC_CONFIG.agent !== "auto") {
    return MC_CONFIG.agent;
  }
  if (fileExists(OPENCLAW_CONFIG_PATH)) {
    return "openclaw";
  }
  if (fileExists(CLAUDE_DIR)) {
    return "claude-code";
  }
  return "local";
})();

const workspaceFromConfig =
  process.env.MC_WORKSPACE ||
  MC_CONFIG?.workspace ||
  OPENCLAW_CONFIG?.workspace ||
  (detectedAgent === "openclaw" ? resolve(homedir(), ".openclaw", "workspace") : process.cwd());
const WORKSPACE = resolve(expandHome(workspaceFromConfig));
const TASKS_PATH = join(WORKSPACE, "tasks.json");

const tokenFromOpenClaw =
  OPENCLAW_CONFIG?.gateway?.auth?.token ||
  OPENCLAW_CONFIG?.token ||
  OPENCLAW_CONFIG?.gatewayToken ||
  OPENCLAW_CONFIG?.authToken ||
  "";
const tokenFromClaude =
  CLAUDE_SETTINGS?.anthropicApiKey ||
  CLAUDE_CONFIG?.anthropicApiKey ||
  process.env.MC_ANTHROPIC_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  "";
const TOKEN =
  process.env.MC_TOKEN ||
  process.env.OPENCLAW_TOKEN ||
  (typeof MC_CONFIG?.token === "string" && MC_CONFIG.token !== "auto" ? MC_CONFIG.token : "") ||
  tokenFromOpenClaw ||
  tokenFromClaude ||
  randomUUID();

const gatewayFromUrl = parseGatewayUrl(process.env.MC_GATEWAY_URL || "");
const gatewayPortFromEnv = Number(process.env.MC_GATEWAY_PORT || "");
const gatewayConfigFromFile = MC_CONFIG?.gateway && typeof MC_CONFIG.gateway === "object" ? MC_CONFIG.gateway : {};
const defaultGatewayEnabled = detectedAgent === "openclaw";
const gatewayHost =
  gatewayFromUrl?.host ||
  gatewayConfigFromFile?.host ||
  "127.0.0.1";
const gatewayPort =
  gatewayFromUrl?.port ||
  (Number.isFinite(gatewayPortFromEnv) && gatewayPortFromEnv > 0 ? gatewayPortFromEnv : null) ||
  (Number.isFinite(Number(gatewayConfigFromFile?.port)) ? Number(gatewayConfigFromFile?.port) : null) ||
  18790;
const gatewayEnabled = process.env.MC_GATEWAY_URL
  ? true
  : process.env.MC_GATEWAY_PORT
    ? true
    : typeof gatewayConfigFromFile?.enabled === "boolean"
      ? gatewayConfigFromFile.enabled
      : defaultGatewayEnabled;
const GATEWAY = gatewayEnabled ? { host: gatewayHost, port: gatewayPort } : null;
const LOCAL_ORIGIN = GATEWAY ? `http://localhost:${GATEWAY.port}` : "";

function adapterCapabilities(agent) {
  if (agent === "openclaw") {
    return { crons: true, agents: true, realtime: true };
  }
  if (agent === "claude-code") {
    return { crons: true, agents: false, realtime: true };
  }
  return { crons: true, agents: false, realtime: false };
}

const MIME_MAP = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function listDir(dirPath) {
  const results = [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = join(dirPath, entry.name);
      try {
        const stat = statSync(fullPath);
        const relPath = relative(WORKSPACE, fullPath);
        const isDir = entry.isDirectory();
        const item = {
          path: relPath,
          name: entry.name,
          type: isDir ? "directory" : "file",
          mtime: stat.mtimeMs,
          ctime: stat.birthtimeMs,
        };
        if (!isDir) item.size = stat.size;
        if (isDir) {
          try {
            item.childCount = readdirSync(fullPath).filter((n) => !n.startsWith(".") && n !== "node_modules").length;
          } catch {
            item.childCount = 0;
          }
        }
        results.push(item);
      } catch {
        // Keep scanning.
      }
    }
  } catch {
    // Keep empty result.
  }
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return results;
}

function searchFiles(dir, query, maxResults = 50) {
  const results = [];
  const q = query.toLowerCase();
  function walk(d) {
    if (results.length >= maxResults) return;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (results.length >= maxResults) return;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = join(d, entry.name);
        const relPath = relative(WORKSPACE, fullPath);
        if (entry.name.toLowerCase().includes(q)) {
          const stat = statSync(fullPath);
          results.push({
            path: relPath,
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            size: entry.isDirectory() ? undefined : stat.size,
          });
        }
        if (entry.isDirectory()) walk(fullPath);
      }
    } catch {
      // Keep scanning.
    }
  }
  walk(dir);
  return results;
}

function checkAuth(req) {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function checkWsAuth(req, url) {
  if (checkAuth(req)) {
    return true;
  }
  return url.searchParams.get("token") === TOKEN;
}

function resolveWorkspacePath(inputPath = "") {
  const requested = resolve(WORKSPACE, inputPath);
  if (!requested.startsWith(WORKSPACE)) {
    return null;
  }
  try {
    const existing = existsSync(requested) ? realpathSync(requested) : requested;
    if (!existing.startsWith(WORKSPACE)) {
      return null;
    }
    return existing;
  } catch {
    return null;
  }
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        rejectBody(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch {
        rejectBody(new Error("invalid json"));
      }
    });
    req.on("error", rejectBody);
  });
}

function readTasksFile() {
  try {
    const raw = JSON.parse(readFileSync(TASKS_PATH, "utf8"));
    if (raw && raw.version === 2 && Array.isArray(raw.tasks)) {
      return raw;
    }
  } catch {
    // Fall through to empty format.
  }
  return { version: 2, tasks: [] };
}

function writeTasksFile(file) {
  mkdirSync(dirname(TASKS_PATH), { recursive: true });
  writeFileSync(TASKS_PATH, JSON.stringify(file, null, 2), "utf8");
}

function readOverrides() {
  try {
    const raw = readFileSync(CLAUDE_OVERRIDES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverrides(overrides) {
  mkdirSync(dirname(CLAUDE_OVERRIDES_PATH), { recursive: true });
  writeFileSync(CLAUDE_OVERRIDES_PATH, JSON.stringify(overrides, null, 2), "utf8");
}

function applySessionOverrides(session) {
  const overrides = readOverrides();
  const customTitle = overrides?.[session.key]?.title;
  if (typeof customTitle === "string" && customTitle.trim()) {
    return { ...session, title: customTitle.trim() };
  }
  return session;
}

function decodeSessionKeyFromPath(pathname, marker) {
  const suffix = pathname.slice(marker.length);
  const firstSegment = suffix.split("/")[0] || "";
  return decodeURIComponent(firstSegment);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/config") {
    return jsonResponse(res, {
      token: TOKEN,
      agent: detectedAgent,
      workspace: WORKSPACE,
      gateway: GATEWAY ? { host: GATEWAY.host, port: GATEWAY.port, enabled: true } : { enabled: false },
      capabilities: adapterCapabilities(detectedAgent),
      configSource: MC_CONFIG_SOURCE_PATH || "defaults",
    });
  }

  if (url.pathname === "/api/health") {
    return jsonResponse(res, {
      ok: true,
      gateway: GATEWAY ? `${GATEWAY.host}:${GATEWAY.port}` : "disabled",
      workspace: WORKSPACE,
      time: new Date().toISOString(),
    });
  }

  if (url.pathname === "/api/files/list") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const subpath = url.searchParams.get("path") || "";
    const dir = resolveWorkspacePath(subpath);
    if (!dir) return jsonResponse(res, { error: "invalid path" }, 400);
    return jsonResponse(res, { path: subpath, entries: listDir(dir) });
  }

  if (url.pathname === "/api/files/search") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const query = url.searchParams.get("q") || "";
    if (query.length < 2) return jsonResponse(res, { results: [] });
    return jsonResponse(res, { query, results: searchFiles(WORKSPACE, query) });
  }

  if (url.pathname === "/api/files/read") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const filePath = url.searchParams.get("path") || "";
    const fullPath = resolveWorkspacePath(filePath);
    if (!fullPath) return jsonResponse(res, { error: "invalid path" }, 400);
    if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) return jsonResponse(res, { error: "not found" }, 404);
    const stat = statSync(fullPath);
    if (stat.size > 2 * 1024 * 1024) return jsonResponse(res, { error: "file too large", size: stat.size }, 413);
    try {
      const content = readFileSync(fullPath, "utf-8");
      return jsonResponse(res, { path: filePath, content, size: stat.size });
    } catch {
      return jsonResponse(res, { error: "read error" }, 500);
    }
  }

  if (url.pathname === "/api/files/write" && req.method === "POST") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    try {
      const body = await parseJsonBody(req);
      const filePath = body.path;
      const content = body.content;
      if (!filePath || typeof content !== "string") return jsonResponse(res, { error: "missing path or content" }, 400);
      const fullPath = resolveWorkspacePath(filePath);
      if (!fullPath) return jsonResponse(res, { error: "invalid path" }, 400);
      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      mkdirSync(dir, { recursive: true });
      writeFileSync(fullPath, content, "utf-8");
      return jsonResponse(res, { ok: true, path: filePath });
    } catch (error) {
      return jsonResponse(res, { error: "write error", detail: error.message }, 500);
    }
  }

  if (url.pathname === "/api/files/delete" && req.method === "POST") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    try {
      const body = await parseJsonBody(req);
      const filePath = typeof body.path === "string" ? body.path : "";
      const fullPath = resolveWorkspacePath(filePath);
      if (!fullPath) return jsonResponse(res, { error: "invalid path" }, 400);
      rmSync(fullPath, { recursive: true, force: true });
      return jsonResponse(res, { ok: true, path: filePath });
    } catch (error) {
      return jsonResponse(res, { error: "delete error", detail: error.message }, 500);
    }
  }

  if (url.pathname === "/api/files/exists") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const filePath = url.searchParams.get("path") || "";
    const fullPath = resolveWorkspacePath(filePath);
    if (!fullPath) return jsonResponse(res, { error: "invalid path" }, 400);
    return jsonResponse(res, { exists: existsSync(fullPath), path: filePath });
  }

  if (url.pathname === "/api/claude-code/sessions" && req.method === "GET") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const limit = Number(url.searchParams.get("limit") || "100");
    const cursor = Number(url.searchParams.get("cursor") || "0");
    const listed = await listSessions({ limit, cursor });
    return jsonResponse(res, {
      sessions: listed.sessions.map(applySessionOverrides),
      nextCursor: listed.nextCursor,
    });
  }

  if (url.pathname === "/api/claude-code/sessions" && req.method === "POST") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    try {
      const body = await parseJsonBody(req);
      const requestedKey = typeof body.key === "string" && body.key.trim() ? body.key.trim() : `pending-${randomUUID()}`;
      const now = new Date().toISOString();
      return jsonResponse(res, {
        session: {
          key: requestedKey,
          title: "New Chat",
          preview: "",
          updatedAt: now,
          createdAt: now,
          isStreaming: false,
          runId: null,
        },
      });
    } catch (error) {
      return jsonResponse(res, { error: "create session error", detail: error.message }, 500);
    }
  }

  if (url.pathname.startsWith("/api/claude-code/sessions/") && url.pathname.endsWith("/history") && req.method === "GET") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);

    const marker = "/api/claude-code/sessions/";
    const sessionKeyPath = url.pathname.slice(marker.length, url.pathname.length - "/history".length);
    const sessionKey = decodeURIComponent(sessionKeyPath);

    const session = await getSession(sessionKey);
    if (!session) {
      return jsonResponse(res, { error: "not found" }, 404);
    }

    const limit = Number(url.searchParams.get("limit") || "500");
    const parsed = await parseTranscript(session.transcriptPath, { limit });

    return jsonResponse(res, {
      session: applySessionOverrides(session),
      messages: parsed.messages,
    });
  }

  if (url.pathname.startsWith("/api/claude-code/sessions/") && req.method === "PATCH") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const sessionKey = decodeSessionKeyFromPath(url.pathname, "/api/claude-code/sessions/");
    try {
      const body = await parseJsonBody(req);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        return jsonResponse(res, { error: "title required" }, 400);
      }
      const overrides = readOverrides();
      overrides[sessionKey] = { ...(overrides[sessionKey] || {}), title, updatedAt: new Date().toISOString() };
      writeOverrides(overrides);
      return jsonResponse(res, { ok: true });
    } catch (error) {
      return jsonResponse(res, { error: "rename error", detail: error.message }, 500);
    }
  }

  if (url.pathname.startsWith("/api/claude-code/sessions/") && req.method === "DELETE") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const sessionKey = decodeSessionKeyFromPath(url.pathname, "/api/claude-code/sessions/");
    const session = await getSession(sessionKey);
    if (!session) {
      return jsonResponse(res, { ok: true });
    }

    try {
      mkdirSync(CLAUDE_TRASH_DIR, { recursive: true });
      const destination = resolve(CLAUDE_TRASH_DIR, `${Date.now()}-${session.sessionId}.jsonl`);
      renameSync(session.transcriptPath, destination);

      const overrides = readOverrides();
      delete overrides[sessionKey];
      writeOverrides(overrides);

      await refreshIndex();
      return jsonResponse(res, { ok: true });
    } catch (error) {
      return jsonResponse(res, { error: "delete session error", detail: error.message }, 500);
    }
  }

  if (url.pathname.startsWith("/api/claude-code/sessions/") && url.pathname.endsWith("/messages") && req.method === "POST") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);

    const marker = "/api/claude-code/sessions/";
    const sessionKeyPath = url.pathname.slice(marker.length, url.pathname.length - "/messages".length);
    const sessionKey = decodeURIComponent(sessionKeyPath);

    try {
      const body = await parseJsonBody(req);
      const message = typeof body.message === "string" ? body.message : "";
      const cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : undefined;
      if (!message.trim()) {
        return jsonResponse(res, { error: "message required" }, 400);
      }

      const run = await startRun(sessionKey, message, {
        cwd,
        onEvent: (event) => broker.publish(event),
      });

      return jsonResponse(res, run, 202);
    } catch (error) {
      return jsonResponse(res, { error: "send error", detail: error.message }, 500);
    }
  }

  if (url.pathname.startsWith("/api/claude-code/runs/") && req.method === "GET") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const runId = decodeSessionKeyFromPath(url.pathname, "/api/claude-code/runs/");
    const status = getRunStatus(runId);
    if (!status) {
      return jsonResponse(res, { error: "not found" }, 404);
    }
    return jsonResponse(res, status);
  }

  if (url.pathname.startsWith("/api/claude-code/runs/") && url.pathname.endsWith("/cancel") && req.method === "POST") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const runId = decodeURIComponent(
      url.pathname.slice("/api/claude-code/runs/".length, url.pathname.length - "/cancel".length)
    );
    const cancelled = cancelRun(runId);
    if (!cancelled) {
      return jsonResponse(res, { error: "not found" }, 404);
    }
    return jsonResponse(res, { ok: true });
  }

  if (url.pathname === "/api/repos") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    try {
      const home = process.env.HOME;
      const run = (cmd, cwd) => {
        try {
          return execSync(cmd, { cwd, encoding: "utf8", timeout: 10000 }).trim();
        } catch (e) {
          // find exits non-zero on permission errors (macOS) but still has valid stdout
          return (typeof e.stdout === "string" ? e.stdout.trim() : "");
        }
      };
      const gitDirs = run(`find ${home} -maxdepth 4 -name ".git" -type d 2>/dev/null || true`);
      const repos = gitDirs
        ? gitDirs
            .split("\n")
            .filter(Boolean)
            .map((g) => {
              const dir = g.replace(/\/\.git$/, "");
              const name = dir.split("/").pop() || dir;
              const branch = run("git branch --show-current", dir) || run("git rev-parse --short HEAD", dir);
              const status = run("git status --porcelain", dir);
              const dirtyFiles = status ? status.split("\n").length : 0;
              const tracking = run("git rev-parse --abbrev-ref @{upstream} 2>/dev/null", dir);
              let ahead = 0;
              let behind = 0;
              if (tracking) {
                const ab = run("git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null", dir);
                if (ab) {
                  const [a, b] = ab.split(/\s+/).map(Number);
                  ahead = a || 0;
                  behind = b || 0;
                }
              }
              const lastMsg = run("git log -1 --format=%s 2>/dev/null", dir);
              const lastTs = run("git log -1 --format=%ct 2>/dev/null", dir);
              const lastCommitAge = lastTs ? Math.round((Date.now() / 1000 - parseInt(lastTs, 10)) / 3600) : null;
              const branches = run('git branch --format="%(refname:short)"', dir)
                .split("\n")
                .filter(Boolean);
              const stashList = run("git stash list", dir);
              const stashes = stashList ? stashList.split("\n").length : 0;
              const duRaw = run(`du -sh ${dir} 2>/dev/null`, dir);
              const diskUsage = duRaw ? duRaw.split("\t")[0] : "?";
              const problems = [];
              if (dirtyFiles > 0) problems.push(`${dirtyFiles} dirty files`);
              if (behind > 0) problems.push(`${behind} behind remote`);
              if (ahead > 0) problems.push(`${ahead} unpushed`);
              if (stashes > 0) problems.push(`${stashes} stashes`);
              if (!tracking) problems.push("no upstream");
              return {
                name,
                dir,
                branch,
                dirtyFiles,
                ahead,
                behind,
                lastCommitMsg: lastMsg,
                lastCommitAgeHours: lastCommitAge,
                branches: branches.length,
                branchNames: branches.slice(0, 20),
                stashes,
                diskUsage,
                problems,
                hasUpstream: !!tracking,
              };
            })
        : [];
      return jsonResponse(res, { repos });
    } catch (error) {
      return jsonResponse(res, { error: "scan failed", detail: error.message }, 500);
    }
  }

  if (url.pathname.startsWith("/api/tasks/") && req.method === "PATCH") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const taskId = decodeURIComponent(url.pathname.slice("/api/tasks/".length));

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== "object") {
        return jsonResponse(res, { error: "invalid patch payload" }, 400);
      }

      const file = readTasksFile();
      const index = file.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) {
        return jsonResponse(res, { error: "task not found" }, 404);
      }

      const current = file.tasks[index];
      if (typeof body.status === "string") {
        const transition = validateTransition(current, body.status);
        if (!transition.valid) {
          return jsonResponse(res, { error: transition.error || "invalid task status transition" }, 400);
        }
      }

      const next = {
        ...current,
        ...(body || {}),
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };

      if (typeof body.status === "string" && body.status !== current.status) {
        next.history = [
          ...(Array.isArray(current.history) ? current.history : []),
          {
            from: current.status,
            to: body.status,
            at: next.updatedAt,
            by: "api",
          },
        ];
        next.completedAt = body.status === "done" ? next.updatedAt : null;
      }

      file.tasks[index] = next;
      writeTasksFile(file);
      return jsonResponse(res, { task: next });
    } catch (error) {
      return jsonResponse(res, { error: "task update failed", detail: error.message }, 400);
    }
  }

  if (url.pathname === "/api/crons" && req.method === "GET") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    return jsonResponse(res, { jobs: listCronJobs() });
  }

  if (url.pathname === "/api/crons/runs" && req.method === "GET") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const jobId = url.searchParams.get("jobId") || undefined;
    return jsonResponse(res, { runs: getCronRuns(jobId) });
  }

  if (url.pathname === "/api/crons" && req.method === "POST") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    try {
      const body = await parseJsonBody(req);
      const job = createCronJob(body);
      return jsonResponse(res, { job }, 201);
    } catch (error) {
      return jsonResponse(res, { error: "invalid cron job", detail: error.message }, 400);
    }
  }

  if (url.pathname.startsWith("/api/crons/") && url.pathname.endsWith("/run") && req.method === "POST") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const id = decodeURIComponent(url.pathname.slice("/api/crons/".length, url.pathname.length - "/run".length));
    try {
      await runCronJobNow(id);
      return jsonResponse(res, { ok: true });
    } catch (error) {
      const status = error instanceof Error && error.message === "Job not found" ? 404 : 400;
      return jsonResponse(res, { error: "run failed", detail: error.message }, status);
    }
  }

  if (url.pathname.startsWith("/api/crons/") && req.method === "PATCH") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const id = decodeURIComponent(url.pathname.slice("/api/crons/".length));
    try {
      const body = await parseJsonBody(req);
      const job = updateCronJob(id, body);
      return jsonResponse(res, { job });
    } catch (error) {
      const status = error instanceof Error && error.message === "Job not found" ? 404 : 400;
      return jsonResponse(res, { error: "update failed", detail: error.message }, status);
    }
  }

  if (url.pathname.startsWith("/api/crons/") && req.method === "DELETE") {
    if (!checkAuth(req)) return jsonResponse(res, { error: "unauthorized" }, 401);
    const id = decodeURIComponent(url.pathname.slice("/api/crons/".length));
    try {
      removeCronJob(id);
      return jsonResponse(res, { ok: true });
    } catch (error) {
      const status = error instanceof Error && error.message === "Job not found" ? 404 : 400;
      return jsonResponse(res, { error: "delete failed", detail: error.message }, status);
    }
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  let filePath = resolve(DIST, url.pathname === "/" ? "index.html" : url.pathname.split("?")[0].replace(/^\/+/, ""));
  if (!filePath.startsWith(DIST) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = resolve(DIST, "index.html");
  }
  const ext = extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_MAP[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  res.end(readFileSync(filePath));
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/ws/claude-code/")) {
    if (!checkWsAuth(req, url)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    broker.addClient({ req, socket, head });
    return;
  }

  if (!GATEWAY) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const upstream = createConnection(GATEWAY, () => {
    upstream.write(`GET ${req.url} HTTP/1.1\r\n`);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const value = req.rawHeaders[i + 1];
      if (name.toLowerCase() === "origin") upstream.write(`Origin: ${LOCAL_ORIGIN}\r\n`);
      else if (name.toLowerCase() === "host") upstream.write(`Host: localhost:${GATEWAY.port}\r\n`);
      else upstream.write(`${name}: ${value}\r\n`);
    }
    upstream.write("\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

startScheduler();
server.listen(PORT, "127.0.0.1", () => console.log(`UI serving on http://127.0.0.1:${PORT}`));
