import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { parseSessionKey, refreshIndex, encodeCwd } from "./session-index.mjs";
import { resolveAnthropicApiKey } from "./auth.mjs";

const activeRuns = new Map();

function nowIso() {
  return new Date().toISOString();
}

function emit(state, event, payload = {}) {
  if (typeof state.onEvent !== "function") return;
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
  if (state.finished) return;
  state.finished = true;
  state.status = outcome;
  state.completedAt = nowIso();
  activeRuns.set(state.runId, state);
}

function handleSdkMessage(msg, state) {
  const parentToolUseId = msg.parent_tool_use_id ?? null;

  if (msg.type === "system" && msg.subtype === "init") {
    const sid = msg.session_id;
    if (sid && !state.sessionIdSeen) {
      state.sessionIdSeen = true;
      const canonical = `${encodeCwd(state.cwd)}::${sid}`;
      if (state.sessionKey !== canonical) {
        emit(state, "session.remap", {
          fromSessionKey: state.sessionKey,
          toSessionKey: canonical,
        });
        state.sessionKey = canonical;
      }
    }
    return;
  }

  if (msg.type === "system") {
    // task_started, task_progress, task_notification — forward as subagent hints
    const sub = msg.subtype;
    if (sub === "task_started" || sub === "task_progress" || sub === "task_notification") {
      emit(state, `session.subagent.${sub.replace("task_", "")}`, {
        parentToolUseId,
        payload: msg,
      });
    }
    return;
  }

  if (msg.type === "stream_event") {
    const ev = msg.event;
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "message_start") {
      const messageId = ev.message?.id;
      state.currentMessageIds.push(messageId);
      emit(state, "session.message.start", {
        messageId,
        parentToolUseId,
        role: "assistant",
        ts: nowIso(),
      });
      return;
    }
    if (ev.type === "content_block_start") {
      const messageId = state.currentMessageIds.at(-1);
      emit(state, "session.block.start", {
        messageId,
        parentToolUseId,
        index: ev.index,
        block: ev.content_block,
      });
      return;
    }
    if (ev.type === "content_block_delta") {
      const messageId = state.currentMessageIds.at(-1);
      emit(state, "session.block.delta", {
        messageId,
        index: ev.index,
        delta: ev.delta,
      });
      return;
    }
    if (ev.type === "content_block_stop") {
      const messageId = state.currentMessageIds.at(-1);
      emit(state, "session.block.stop", { messageId, index: ev.index });
      return;
    }
    if (ev.type === "message_stop") {
      const messageId = state.currentMessageIds.pop();
      emit(state, "session.message.stop", { messageId });
      return;
    }
    return;
  }

  if (msg.type === "user") {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block && typeof block === "object" && block.type === "tool_result") {
        let outContent;
        if (typeof block.content === "string") {
          outContent = [{ type: "text", text: block.content }];
        } else if (Array.isArray(block.content)) {
          outContent = block.content
            .filter((c) => c && typeof c === "object" && c.type === "text" && typeof c.text === "string")
            .map((c) => ({ type: "text", text: c.text }));
        } else {
          outContent = [];
        }
        emit(state, "session.tool_result", {
          messageId: msg.uuid ?? null,
          toolUseId: block.tool_use_id,
          isError: Boolean(block.is_error),
          content: outContent,
        });
      }
    }
    return;
  }

  if (msg.type === "assistant") {
    // Whole-turn checkpoint — stream_event already delivered blocks; nothing extra to emit.
    return;
  }

  if (msg.type === "result") {
    emit(state, "session.completed", {
      durationMs: typeof msg.duration_ms === "number" ? msg.duration_ms : undefined,
      usage: msg.usage,
      totalCostUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
      subtype: msg.subtype,
    });
    return;
  }

  // rate_limit_event, stream_event (other), and any unknown — ignore
}

function mapErrorCode(err) {
  const msg = typeof err?.message === "string" ? err.message : String(err);
  if (/binary not found|command not found|spawn claude ENOENT/i.test(msg)) return "cli_missing";
  if (/authentication|unauthoriz|invalid.*token|api key/i.test(msg)) return "auth_error";
  if (/aborted by user|AbortError/i.test(msg)) return "aborted";
  return "sdk_error";
}

function friendlyErrorMessage(code, rawMessage) {
  if (code === "cli_missing") {
    return "Claude Code not installed. Run: npm i -g @anthropic-ai/claude-code";
  }
  if (code === "auth_error") {
    return "Not logged in. Run `claude login` in a terminal.";
  }
  if (code === "aborted") return "Run cancelled";
  if (code === "timeout") return "Run timed out";
  return rawMessage || "Unexpected error";
}

export async function startRun(sessionKey, message, options = {}) {
  const runId = randomUUID();
  const sessionKeyInfo = parseSessionKey(sessionKey || "");
  const hasRealSession = String(sessionKey || "").includes("::");
  const resumeSessionId = hasRealSession ? sessionKeyInfo.sessionId : undefined;
  const resolvedCwd = options.cwd || sessionKeyInfo.cwd || process.cwd();

  const rawKey = await resolveAnthropicApiKey();
  const apiKey = rawKey.startsWith("sk-ant-api") ? rawKey : "";
  const env = { ...process.env };
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  else delete env.ANTHROPIC_API_KEY;

  const controller = new AbortController();
  const state = {
    runId,
    sessionKey: sessionKey || "",
    status: "running",
    startedAt: nowIso(),
    completedAt: null,
    cwd: resolvedCwd,
    error: null,
    onEvent: options.onEvent,
    controller,
    finished: false,
    sessionIdSeen: hasRealSession,
    currentMessageIds: [],
  };
  activeRuns.set(runId, state);

  emit(state, "session.streaming", { isStreaming: true });

  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5 * 60_000;
  const timeoutHandle = setTimeout(() => {
    if (!state.finished) {
      state.error = "timeout";
      controller.abort();
    }
  }, timeoutMs);

  (async () => {
    try {
      const q = query({
        prompt: message,
        options: {
          resume: resumeSessionId,
          cwd: resolvedCwd,
          includePartialMessages: true,
          permissionMode: "bypassPermissions",
          env,
          abortController: controller,
        },
      });
      for await (const msg of q) {
        handleSdkMessage(msg, state);
      }
      finalizeRun(state, "completed");
      await refreshIndex().catch(() => {});
    } catch (err) {
      if (state.error === "timeout") {
        finalizeRun(state, "error");
        emit(state, "session.error", {
          code: "timeout",
          message: friendlyErrorMessage("timeout"),
          detail: err?.stack || undefined,
        });
      } else if (controller.signal.aborted) {
        finalizeRun(state, "aborted");
        emit(state, "session.error", {
          code: "aborted",
          message: friendlyErrorMessage("aborted"),
        });
      } else {
        const code = mapErrorCode(err);
        finalizeRun(state, "error");
        emit(state, "session.error", {
          code,
          message: friendlyErrorMessage(code, err?.message),
          detail: err?.stack || undefined,
        });
      }
    } finally {
      clearTimeout(timeoutHandle);
      emit(state, "session.streaming", { isStreaming: false });
    }
  })();

  return {
    runId,
    sessionKey: state.sessionKey,
    acceptedAt: state.startedAt,
  };
}

export function cancelRun(runId) {
  const state = activeRuns.get(runId);
  if (!state) return false;
  if (state.finished) return true;
  state.status = "aborted";
  state.controller.abort();
  return true;
}

export function getRunStatus(runId) {
  const state = activeRuns.get(runId);
  if (!state) return null;
  return {
    runId: state.runId,
    sessionKey: state.sessionKey,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    error: state.error,
    cwd: state.cwd,
  };
}
