import { readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { homedir } from "node:os";
import { parseCodexTranscriptMetadata } from "./transcript-parser.mjs";

const CODEX_SESSIONS_ROOT = process.env.CODEX_SESSIONS_DIR || join(homedir(), ".codex", "sessions");

const cache = {
  files: new Map(),
  sessionsByKey: new Map(),
  sessionsSorted: [],
};

async function scanJsonlFiles(rootDir) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
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

  const { metadata } = await parseCodexTranscriptMetadata(transcriptPath);

  const sessionId = basename(transcriptPath, ".jsonl");
  const sessionKey = relative(CODEX_SESSIONS_ROOT, transcriptPath);

  const session = {
    key: sessionKey,
    sessionId,
    title: metadata.title || "New Chat",
    preview: metadata.preview || "",
    updatedAt: metadata.updatedAt,
    createdAt: metadata.createdAt,
    isStreaming: false,
    runId: null,
    transcriptPath,
    cwd: metadata.cwd || null,
    git: metadata.git || null,
    model: metadata.model || null,
  };

  cache.files.set(transcriptPath, { cacheKey: key, session });
  return session;
}

async function rebuildIndex() {
  let rootStat;
  try {
    rootStat = await stat(CODEX_SESSIONS_ROOT);
  } catch {
    cache.sessionsByKey.clear();
    cache.sessionsSorted = [];
    return;
  }

  const files = await scanJsonlFiles(CODEX_SESSIONS_ROOT);
  const nextByKey = new Map();

  for (const transcriptPath of files) {
    try {
      const session = await indexOneTranscript(transcriptPath);
      nextByKey.set(session.key, session);
    } catch {
      // Skip broken files
    }
  }

  cache.sessionsByKey = nextByKey;
  cache.sessionsSorted = [...nextByKey.values()].sort(sessionSort);

  for (const filePath of [...cache.files.keys()]) {
    if (!files.includes(filePath)) {
      cache.files.delete(filePath);
    }
  }
}

export async function refreshCodexIndex() {
  await rebuildIndex();
  return [...cache.sessionsSorted];
}

export async function listCodexSessions(options = {}) {
  await rebuildIndex();
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(options.limit, 500) : 100;
  const offset = Number.isFinite(options.cursor) && options.cursor >= 0 ? options.cursor : 0;

  const all = cache.sessionsSorted;
  const sessions = all.slice(offset, offset + limit);
  const nextCursor = offset + limit < all.length ? String(offset + limit) : null;

  return { sessions, nextCursor };
}

export async function getCodexSession(sessionKey) {
  await rebuildIndex();
  return cache.sessionsByKey.get(sessionKey) || null;
}
