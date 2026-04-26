import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
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
    emit(state, "session.init", {
      slashCommands: Array.isArray(msg.slash_commands) ? msg.slash_commands : [],
      mcpServers: Array.isArray(msg.mcp_servers) ? msg.mcp_servers : [],
      tools: Array.isArray(msg.tools) ? msg.tools : [],
      skills: Array.isArray(msg.skills) ? msg.skills : [],
      agents: Array.isArray(msg.agents) ? msg.agents : [],
      model: typeof msg.model === "string" ? msg.model : undefined,
      cwd: typeof msg.cwd === "string" ? msg.cwd : undefined,
    });
    return;
  }

  if (msg.type === "system" && msg.subtype === "compact_boundary") {
    emit(state, "session.compact_boundary", {
      trigger: msg.compact_metadata?.trigger,
      preTokens: msg.compact_metadata?.pre_tokens,
      postTokens: msg.compact_metadata?.post_tokens,
      durationMs: msg.compact_metadata?.duration_ms,
    });
    return;
  }

  if (msg.type === "system" && msg.subtype === "local_command_output") {
    // Slash commands like /context, /cost emit their output as a single system message
    // with a content string. Synthesize stream_event frames so the client renders it
    // as a normal assistant text message (matches the transcript-parser result on reload).
    const text = typeof msg.content === "string" ? msg.content : "";
    const messageId = typeof msg.uuid === "string" ? msg.uuid : randomUUID();
    state.currentMessageIds.push(messageId);
    emit(state, "session.message.start", {
      messageId,
      parentToolUseId,
      role: "assistant",
      ts: nowIso(),
    });
    emit(state, "session.block.start", {
      messageId,
      parentToolUseId,
      index: 0,
      block: { type: "text", text: "" },
    });
    if (text) {
      emit(state, "session.block.delta", {
        messageId,
        index: 0,
        delta: { type: "text_delta", text },
      });
    }
    emit(state, "session.block.stop", { messageId, index: 0 });
    state.currentMessageIds.pop();
    emit(state, "session.message.stop", { messageId });
    return;
  }

  if (msg.type === "system") {
    const sub = msg.subtype;
    if (sub === "task_started" || sub === "task_progress" || sub === "task_notification" || sub === "task_updated") {
      emit(state, `session.subagent.${sub.replace("task_", "")}`, {
        parentToolUseId,
        payload: msg,
      });
      return;
    }
    if (sub === "api_retry") {
      emit(state, "session.api_retry", {
        attempt: msg.attempt,
        maxRetries: msg.max_retries,
        retryDelayMs: msg.retry_delay_ms,
        errorStatus: msg.error_status,
        error: msg.error,
      });
      return;
    }
    if (sub === "status") {
      emit(state, "session.status", {
        status: msg.status,
        permissionMode: msg.permissionMode,
        compactResult: msg.compact_result,
        compactError: msg.compact_error,
      });
      return;
    }
    if (sub === "notification") {
      emit(state, "session.notification", {
        key: msg.key,
        text: msg.text,
        priority: msg.priority,
        color: msg.color,
        timeoutMs: msg.timeout_ms,
      });
      return;
    }
    if (sub === "memory_recall") {
      emit(state, "session.memory_recall", {
        mode: msg.mode,
        memories: Array.isArray(msg.memories) ? msg.memories : [],
      });
      return;
    }
    if (sub === "mirror_error") {
      // Surfaces transcript-mirror write failures — batch dropped, data loss.
      console.error("[sdk-runner] mirror_error:", msg.error, msg.key);
      emit(state, "session.mirror_error", {
        error: typeof msg.error === "string" ? msg.error : String(msg.error),
        key: msg.key,
      });
      return;
    }
    return;
  }

  if (msg.type === "stream_event") {
    const ev = msg.event;
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "message_start") {
      const messageId = ev.message?.id;
      state.currentMessageIds.push(messageId);
      if (messageId) state.streamedMessageIds.add(messageId);
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
    const messageId = msg.message?.id;
    if (messageId && msg.error) {
      // Model turn failed (rate_limit, billing_error, max_output_tokens, ...).
      // Surface it so the UI can annotate the message.
      emit(state, "session.message_error", {
        messageId,
        parentToolUseId,
        error: msg.error,
        stopReason: msg.message?.stop_reason,
      });
    }
    // Forward usage so the UI can render a context progress bar (CLI-style).
    // Emit for every assistant turn — also for the synthesized path below,
    // since whole-turn messages still carry usage even when stream_event did not.
    const usage = msg.message?.usage;
    if (usage && typeof usage === "object") {
      emit(state, "session.usage", {
        messageId,
        model: typeof msg.message?.model === "string" ? msg.message.model : undefined,
        inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
        outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
        cacheCreationTokens: typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0,
        cacheReadTokens: typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0,
      });
    }
    // Usually stream_event already delivered blocks and this is a whole-turn checkpoint.
    // But some SDK paths (e.g. /context, /cost local commands) skip stream_event entirely
    // and deliver the full content only here. Synthesize frames in that case.
    if (!messageId || state.streamedMessageIds.has(messageId)) return;
    state.streamedMessageIds.add(messageId);
    const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
    emit(state, "session.message.start", {
      messageId,
      parentToolUseId,
      role: "assistant",
      ts: nowIso(),
    });
    content.forEach((block, index) => {
      if (!block || typeof block !== "object") return;
      emit(state, "session.block.start", {
        messageId,
        parentToolUseId,
        index,
        block,
      });
      if (block.type === "text" && typeof block.text === "string" && block.text) {
        emit(state, "session.block.delta", {
          messageId,
          index,
          delta: { type: "text_delta", text: block.text },
        });
      } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
        emit(state, "session.block.delta", {
          messageId,
          index,
          delta: { type: "thinking_delta", thinking: block.thinking },
        });
      } else if (block.type === "tool_use" && block.input && typeof block.input === "object") {
        emit(state, "session.block.delta", {
          messageId,
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        });
      }
      emit(state, "session.block.stop", { messageId, index });
    });
    emit(state, "session.message.stop", { messageId });
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
  // Resumes keep the session's original cwd (baked into the key at creation).
  // Fresh chats use whatever the caller supplied.
  const resolvedCwd = resolvePath(sessionKeyInfo.cwd || options.cwd || process.cwd());

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
    streamedMessageIds: new Set(),
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
      // Default to Opus in 1M-context mode — matches Claude Code CLI default.
      // Override via CLAUDE_UI_MODEL (e.g. "sonnet", "opus", "haiku", or any
      // CLI alias including [1m] suffix). /model <alias> slash command from
      // the UI still works to switch mid-session without restart.
      const defaultModel = process.env.CLAUDE_UI_MODEL || "opus[1m]";
      const q = query({
        prompt: message,
        options: {
          resume: resumeSessionId,
          cwd: resolvedCwd,
          includePartialMessages: true,
          permissionMode: "bypassPermissions",
          model: defaultModel,
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

// Model the runner uses for new/resumed turns. Matches the default set inside
// `startRun` so callers (e.g. /history) can tell the UI what window to expect
// before a live `session.init` arrives — the API response strips the `[1m]`
// suffix so without this hint, hydration can't distinguish 1M from 200k.
//
// LIMITATION — single-model assumption: this reads a process-wide env var,
// so if a user runs two concurrent sessions with different models (not
// currently surfaced in the UI, but possible if CLAUDE_UI_MODEL changes
// between starts), both get reported as the same tagged model on hydration.
// The live `session.init` event still carries per-session truth, so the UI
// self-corrects on the first turn. If per-session model selection becomes a
// feature, this needs to move from env-var-at-boot to a session→model map
// threaded through startRun and persisted alongside the transcript.
export function getConfiguredModel() {
  return process.env.CLAUDE_UI_MODEL || "opus[1m]";
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

// Returns the runId of an in-flight run for the given sessionKey, or null.
// Used by /history so the client can repopulate isStreaming + runId after a
// page reload mid-stream — without this the Stop button vanishes on refresh
// even though the backend is still generating. Only "running" state counts;
// completed/aborted/errored runs linger in activeRuns for status lookups.
export function getActiveRunIdForSession(sessionKey) {
  if (!sessionKey) return null;
  for (const state of activeRuns.values()) {
    if (state.sessionKey === sessionKey && state.status === "running" && !state.finished) {
      return state.runId;
    }
  }
  return null;
}
