import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSession, refreshIndex, parseSessionKey } from "./session-index.mjs";

const AUTH_PROFILE_PATH = join(homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json");

const activeRuns = new Map();

function nowIso() {
  return new Date().toISOString();
}

async function resolveAnthropicApiKey() {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return process.env.ANTHROPIC_API_KEY.trim();
  }

  try {
    const raw = await readFile(AUTH_PROFILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const profile = parsed?.profiles?.["anthropic:manual"];
    // Support both formats: .token (direct key) and .headers.authorization (Bearer key)
    const authValue = profile?.token || profile?.headers?.authorization;
    if (typeof authValue === "string" && authValue.trim()) {
      return authValue.replace(/^Bearer\s+/i, "").trim();
    }
  } catch {
    // Keep fallback behavior.
  }

  return "";
}

function extractText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.delta === "string") {
    return value.delta;
  }
  if (typeof value.completion === "string") {
    return value.completion;
  }
  if (typeof value.output_text === "string") {
    return value.output_text;
  }
  if (typeof value.content === "string") {
    return value.content;
  }
  if (Array.isArray(value.content)) {
    return value.content
      .map((block) => (block && typeof block === "object" && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (value.delta && typeof value.delta === "object" && typeof value.delta.text === "string") {
    return value.delta.text;
  }
  if (value.message && typeof value.message === "object") {
    return extractText(value.message);
  }
  return "";
}

function extractSessionId(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (typeof payload.session_id === "string") {
    return payload.session_id;
  }
  if (typeof payload.sessionId === "string") {
    return payload.sessionId;
  }
  if (payload.session && typeof payload.session === "object" && typeof payload.session.id === "string") {
    return payload.session.id;
  }
  return null;
}

function emit(state, event, payload = {}) {
  if (typeof state.onEvent !== "function") {
    return;
  }
  state.onEvent({
    type: "event",
    event,
    sessionKey: state.sessionKey,
    runId: state.runId,
    ts: nowIso(),
    payload,
  });
}

function finalizeRun(state, outcome) {
  if (state.finished) {
    return;
  }
  state.finished = true;
  state.status = outcome;
  state.completedAt = nowIso();
  activeRuns.set(state.runId, state);
}

export async function startRun(sessionKey, message, options = {}) {
  const runId = randomUUID();
  const messageId = randomUUID();

  let targetSession = null;
  if (sessionKey && !sessionKey.startsWith("pending-")) {
    targetSession = await getSession(sessionKey);
  }

  const sessionKeyInfo = parseSessionKey(sessionKey || "");
  const canResume = Boolean(targetSession?.sessionId) || String(sessionKey || "").includes("::");
  const resumeSessionId = canResume ? targetSession?.sessionId || sessionKeyInfo.sessionId : "";
  const resolvedCwd = options.cwd || targetSession?.cwd || sessionKeyInfo.cwd || process.cwd();

  const apiKey = await resolveAnthropicApiKey();

  const args = ["--print", "--verbose", "--output-format", "stream-json"];
  if (resumeSessionId && !String(sessionKey || "").startsWith("pending-")) {
    args.push("--resume", resumeSessionId);
  }
  args.push(message);

  const child = spawn("claude", args, {
    cwd: resolvedCwd,
    env: {
      ...process.env,
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const state = {
    runId,
    sessionKey,
    status: "running",
    startedAt: nowIso(),
    completedAt: null,
    message,
    cwd: resolvedCwd,
    pid: child.pid,
    error: null,
    messageId,
    accumulated: "",
    stderr: "",
    child,
    onEvent: options.onEvent,
    finished: false,
  };

  activeRuns.set(runId, state);

  emit(state, "session.streaming", { isStreaming: true });

  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5 * 60_000;
  const timeoutHandle = setTimeout(() => {
    if (!state.finished) {
      state.error = "timeout";
      state.child.kill("SIGINT");
    }
  }, timeoutMs);

  const consumeStdout = (buffer) => {
    const line = String(buffer).trim();
    if (!line) {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }

    const streamText = extractText(payload.delta || payload);
    if (streamText) {
      state.accumulated += streamText;
      emit(state, "session.delta", {
        messageId: state.messageId,
        role: "assistant",
        delta: streamText,
        accumulated: state.accumulated,
      });
    }

    const discoveredSessionId = extractSessionId(payload);
    if (discoveredSessionId && !String(state.sessionKey || "").includes("::")) {
      const remapped = `${encodeURIComponent(state.cwd)}::${discoveredSessionId}`;
      emit(state, "session.remap", {
        fromSessionKey: state.sessionKey,
        toSessionKey: remapped,
      });
      state.sessionKey = remapped;
    }

    const finalText = extractText(payload.result || payload.message || payload.final || "");
    if (finalText && finalText.length > state.accumulated.length) {
      state.accumulated = finalText;
    }
  };

  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    let marker = stdoutBuffer.indexOf("\n");
    while (marker >= 0) {
      const line = stdoutBuffer.slice(0, marker);
      stdoutBuffer = stdoutBuffer.slice(marker + 1);
      consumeStdout(line);
      marker = stdoutBuffer.indexOf("\n");
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    state.stderr += text;
    if (state.stderr.length > 4000) {
      state.stderr = state.stderr.slice(-4000);
    }
  });

  child.on("error", (error) => {
    clearTimeout(timeoutHandle);
    state.error = error.message;
    finalizeRun(state, "error");
    emit(state, "session.error", {
      code: "spawn_error",
      message: error.message,
      stderr: state.stderr,
    });
    emit(state, "session.streaming", { isStreaming: false });
  });

  child.on("close", async (code, signal) => {
    clearTimeout(timeoutHandle);
    if (stdoutBuffer.trim()) {
      consumeStdout(stdoutBuffer);
    }

    if (state.status === "aborted" || signal === "SIGINT") {
      finalizeRun(state, "aborted");
      emit(state, "session.error", {
        code: "aborted",
        message: "Run cancelled",
        stderr: state.stderr,
      });
      emit(state, "session.streaming", { isStreaming: false });
      return;
    }

    if (code === 0) {
      finalizeRun(state, "completed");
      emit(state, "session.message", {
        message: {
          id: state.messageId,
          role: "assistant",
          content: state.accumulated,
          timestamp: nowIso(),
          thinking: null,
        },
      });
      emit(state, "session.completed", {});
      emit(state, "session.streaming", { isStreaming: false });
      await refreshIndex();
      return;
    }

    state.error = `exit_${code}`;
    finalizeRun(state, "error");
    emit(state, "session.error", {
      code: "cli_error",
      message: `Claude CLI exited with code ${code}`,
      stderr: state.stderr,
    });
    emit(state, "session.streaming", { isStreaming: false });
  });

  return {
    runId,
    sessionKey: state.sessionKey,
    acceptedAt: state.startedAt,
  };
}

export function cancelRun(runId) {
  const state = activeRuns.get(runId);
  if (!state) {
    return false;
  }
  if (state.finished) {
    return true;
  }
  state.status = "aborted";
  state.child.kill("SIGINT");
  return true;
}

export function getRunStatus(runId) {
  const state = activeRuns.get(runId);
  if (!state) {
    return null;
  }

  return {
    runId: state.runId,
    sessionKey: state.sessionKey,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    pid: state.pid,
    error: state.error,
    cwd: state.cwd,
  };
}
