import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { parseTranscriptMetadata } from "./transcript-parser.mjs";

const PROJECTS_ROOT = process.env.CLAUDE_PROJECTS_DIR || join(homedir(), ".claude", "projects");

const cache = {
  rootsMtime: 0,
  files: new Map(),
  sessionsByKey: new Map(),
  sessionsSorted: [],
};

function decodeCwd(encoded) {
  if (!encoded) {
    return "";
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function toSessionKey(cwd, sessionId) {
  return `${encodeURIComponent(cwd)}::${sessionId}`;
}

export function parseSessionKey(sessionKey) {
  if (typeof sessionKey !== "string" || !sessionKey.includes("::")) {
    return { cwd: null, sessionId: sessionKey };
  }
  const marker = sessionKey.lastIndexOf("::");
  const cwdPart = sessionKey.slice(0, marker);
  const sessionId = sessionKey.slice(marker + 2);
  return {
    cwd: decodeCwd(cwdPart),
    sessionId,
  };
}

async function scanJsonlFiles(rootDir) {
  const out = [];

  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return out;
}

function sessionSort(a, b) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

async function indexOneTranscript(transcriptPath) {
  const transcriptStat = await stat(transcriptPath);
  const key = `${transcriptPath}:${transcriptStat.mtimeMs}:${transcriptStat.size}`;
  const cached = cache.files.get(transcriptPath);
  if (cached && cached.cacheKey === key) {
    return cached.session;
  }

  const { metadata } = await parseTranscriptMetadata(transcriptPath);

  const sessionId = basename(transcriptPath, ".jsonl");
  const dirRel = relative(PROJECTS_ROOT, dirname(transcriptPath));
  const encodedCwd = dirRel.split(sep).join("/");
  const cwd = decodeCwd(encodedCwd);
  const session = {
    key: toSessionKey(cwd, sessionId),
    sessionId,
    title: metadata.title || "New Chat",
    preview: metadata.preview || "",
    updatedAt: metadata.updatedAt,
    createdAt: metadata.createdAt,
    isStreaming: false,
    runId: null,
    transcriptPath,
    cwd,
  };

  cache.files.set(transcriptPath, { cacheKey: key, session });
  return session;
}

async function rebuildIndex() {
  let rootStat;
  try {
    rootStat = await stat(PROJECTS_ROOT);
  } catch {
    cache.sessionsByKey.clear();
    cache.sessionsSorted = [];
    return;
  }

  const files = await scanJsonlFiles(PROJECTS_ROOT);
  const nextByKey = new Map();

  for (const transcriptPath of files) {
    try {
      const session = await indexOneTranscript(transcriptPath);
      nextByKey.set(session.key, session);
    } catch {
      // Keep indexing even if one file fails to parse.
    }
  }

  cache.rootsMtime = rootStat.mtimeMs;
  cache.sessionsByKey = nextByKey;
  cache.sessionsSorted = [...nextByKey.values()].sort(sessionSort);

  for (const filePath of [...cache.files.keys()]) {
    if (!files.includes(filePath)) {
      cache.files.delete(filePath);
    }
  }
}

export async function refreshIndex() {
  await rebuildIndex();
  return [...cache.sessionsSorted];
}

async function ensureIndexFresh() {
  await rebuildIndex();
}

export async function listSessions(options = {}) {
  await ensureIndexFresh();
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(options.limit, 500) : 100;
  const offset = Number.isFinite(options.cursor) && options.cursor >= 0 ? options.cursor : 0;

  const all = cache.sessionsSorted;
  const sessions = all.slice(offset, offset + limit);
  const nextCursor = offset + limit < all.length ? String(offset + limit) : null;

  return { sessions, nextCursor };
}

export async function getSession(sessionKey) {
  await ensureIndexFresh();
  return cache.sessionsByKey.get(sessionKey) || null;
}
