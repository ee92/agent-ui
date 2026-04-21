import { create } from "zustand";
import type { ChatMessage, Conversation, MessageContentPart } from "../types";
import { getBackendAdapter } from "../adapters";
import type { SessionEvent } from "../adapters/types";
import { navigate } from "../use-hash-router";
import { useSessionFlowStore } from "./session-flow-store";
import { useTaskStore } from "./task-store-v2";
import { useUiStore } from "./ui-store";
import {
  applyConversationUpdate,
  buildPreview,
  ensureConversation,
  extractMessageText,
  messageTextFromUnknown,
  normalizeSession,
  nowIso,
  persistHiddenMessages,
  readHiddenMessages,
  type ChatStoreState
} from "./shared";

const hiddenMessageIds = readHiddenMessages();
const SELECTED_KEY = "openclaw-ui-selected-conversation";
let unsubscribeSessionEvents: (() => void) | null = null;
let activeSessionAdapterType: string | null = null;

function saveSelectedKey(key: string | null) {
  if (key) localStorage.setItem(SELECTED_KEY, key);
  else localStorage.removeItem(SELECTED_KEY);
}

function loadSelectedKey(): string | null {
  return localStorage.getItem(SELECTED_KEY);
}

type SetFn = (next: Partial<ChatStoreState> | ((state: ChatStoreState) => Partial<ChatStoreState>)) => void;
type GetFn = () => ChatStoreState;

type PendingSearchResult = {
  messages: ChatMessage[];
  messageIndex: number;
  message: ChatMessage;
  parentPart?: Extract<MessageContentPart, { type: "tool_use" }>;
};

function findToolUseAnywhere(
  messages: ChatMessage[],
  predicate: (part: Extract<MessageContentPart, { type: "tool_use" }>) => boolean
): Extract<MessageContentPart, { type: "tool_use" }> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const hit = searchParts(messages[i].parts, predicate);
    if (hit) return hit;
  }
  return null;
}

function searchParts(
  parts: MessageContentPart[] | undefined,
  predicate: (part: Extract<MessageContentPart, { type: "tool_use" }>) => boolean
): Extract<MessageContentPart, { type: "tool_use" }> | null {
  if (!parts) return null;
  for (const part of parts) {
    if (part.type === "tool_use") {
      if (predicate(part)) return part;
      const nested = searchParts(part.subAgentParts, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

function findMessageByMessageId(
  messages: ChatMessage[],
  messageId: string
): { message: ChatMessage; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].id === messageId) return { message: messages[i], index: i };
  }
  return null;
}

function findPendingAssistantStub(
  messages: ChatMessage[]
): { message: ChatMessage; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.pending) return { message: m, index: i };
  }
  return null;
}

function updateMessagesForConversation(
  set: SetFn,
  get: GetFn,
  sessionKey: string,
  updater: (messages: ChatMessage[]) => ChatMessage[]
) {
  const current = get().messagesByConversation[sessionKey] ?? [];
  const next = updater([...current]);
  set({
    messagesByConversation: {
      ...get().messagesByConversation,
      [sessionKey]: next,
    },
  });
}

function ensurePartForBlock(
  message: ChatMessage,
  index: number,
  block: { type?: string; id?: string; name?: string; input?: unknown }
): { message: ChatMessage; partKey: string } {
  const partKey = `b-${index}`;
  const indexMap = { ...(message.blockIndexById ?? {}) };
  indexMap[index] = partKey;

  let newPart: MessageContentPart | null = null;
  if (block.type === "text") {
    newPart = { type: "text", text: "" };
  } else if (block.type === "thinking") {
    newPart = { type: "thinking", text: "", complete: false };
  } else if (block.type === "tool_use") {
    newPart = {
      type: "tool_use",
      id: typeof block.id === "string" ? block.id : `tool-${Math.random().toString(36).slice(2, 10)}`,
      name: typeof block.name === "string" ? block.name : "unknown",
      input: "",
      inputComplete: false,
    };
  }

  const parts = newPart ? [...message.parts, newPart] : message.parts;
  return { message: { ...message, parts, blockIndexById: indexMap }, partKey };
}

function updatePartAtBlockIndex(
  message: ChatMessage,
  index: number,
  mutator: (part: MessageContentPart) => MessageContentPart
): ChatMessage {
  const key = message.blockIndexById?.[index];
  if (!key) return message;
  // Map key "b-<n>" to position = length-ish; we actually track by order of appending.
  // Find the part whose position matches by scanning: index in parts is (total parts - 1) when added.
  // Simpler: find the last N-th part recorded. Since we only ever add at end per content_block_start,
  // `key` -> part is the last one whose position corresponds. We'll store partKey on parts via a map.
  // Alternative: we re-derive by counting content_blocks. Easiest: scan parts by `key` stored inline.
  // We use index in parts array matching insertion order — the Nth content block started is the Nth
  // non-text-or-image streaming part. But for simplicity: we maintain partKey → partIndex via blockIndexById.
  // blockIndexById maps SDK index → partKey; we can instead make it map SDK index → parts-array index.
  const partsIndex = Number(key.slice(2));
  const partPos = findPartPosByBlockOrder(message, partsIndex);
  if (partPos < 0) return message;
  const updated = mutator(message.parts[partPos]);
  if (updated === message.parts[partPos]) return message;
  const nextParts = message.parts.slice();
  nextParts[partPos] = updated;
  return { ...message, parts: nextParts };
}

function findPartPosByBlockOrder(message: ChatMessage, blockOrder: number): number {
  let count = -1;
  for (let i = 0; i < message.parts.length; i++) {
    const p = message.parts[i];
    if (p.type === "text" || p.type === "thinking" || p.type === "tool_use") {
      count++;
      if (count === blockOrder) return i;
    }
  }
  return -1;
}

function handleClaudeRawEvent(
  eventName: string,
  payload: Record<string, unknown>,
  sessionKey: string,
  runId: string | null,
  set: SetFn,
  get: GetFn
) {
  const now = nowIso();

  if (eventName === "session.message.start") {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    const parentToolUseId = typeof payload.parentToolUseId === "string" ? payload.parentToolUseId : null;
    if (!messageId) return;

    if (parentToolUseId) {
      // Route into parent tool_use.subAgentParts as a new synthetic sub-message.
      // Represent sub-agent blocks in a single flat array by parent (order preserved).
      updateMessagesForConversation(set, get, sessionKey, (msgs) => {
        const parent = findToolUseAnywhere(msgs, (p) => p.id === parentToolUseId);
        if (!parent) return msgs;
        // Tag parent with placeholder indicating a new sub-agent message began.
        // We don't create a separate ChatMessage; blocks accumulate directly in subAgentParts.
        // Ensure array exists.
        return msgs.map((m) => ({
          ...m,
          parts: mutateToolUseInParts(m.parts, parentToolUseId, (tool) => ({
            ...tool,
            subAgentParts: tool.subAgentParts ?? [],
          })),
        }));
      });
      return;
    }

    updateMessagesForConversation(set, get, sessionKey, (msgs) => {
      const existing = findMessageByMessageId(msgs, messageId);
      if (existing) return msgs;
      const pending = findPendingAssistantStub(msgs);
      if (pending) {
        msgs[pending.index] = {
          ...pending.message,
          id: messageId,
          parts: [],
          blockIndexById: {},
          pending: true,
          runId: runId ?? pending.message.runId ?? null,
        };
        return msgs;
      }
      msgs.push({
        id: messageId,
        role: "assistant",
        parts: [],
        createdAt: now,
        pending: true,
        blockIndexById: {},
        runId,
      });
      return msgs;
    });
    return;
  }

  if (eventName === "session.block.start") {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    const parentToolUseId = typeof payload.parentToolUseId === "string" ? payload.parentToolUseId : null;
    const index = typeof payload.index === "number" ? payload.index : null;
    const block = (payload.block ?? {}) as { type?: string; id?: string; name?: string; input?: unknown };
    if (index === null) return;

    if (parentToolUseId) {
      updateMessagesForConversation(set, get, sessionKey, (msgs) =>
        msgs.map((m) => ({
          ...m,
          parts: mutateToolUseInParts(m.parts, parentToolUseId, (tool) => {
            const parts = tool.subAgentParts ?? [];
            const newPart = makePartForBlock(block);
            return {
              ...tool,
              subAgentParts: newPart ? [...parts, newPart] : parts,
              _subBlockIndex: undefined, // unused
            } as typeof tool;
          }),
        }))
      );
      return;
    }

    if (!messageId) return;
    updateMessagesForConversation(set, get, sessionKey, (msgs) => {
      const hit = findMessageByMessageId(msgs, messageId);
      if (!hit) return msgs;
      const { message: updated } = ensurePartForBlock(hit.message, index, block);
      msgs[hit.index] = updated;
      return msgs;
    });
    return;
  }

  if (eventName === "session.block.delta") {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    const index = typeof payload.index === "number" ? payload.index : null;
    const delta = payload.delta as { type?: string; text?: string; thinking?: string; partial_json?: string } | null;
    if (index === null || !delta) return;

    if (messageId) {
      updateMessagesForConversation(set, get, sessionKey, (msgs) => {
        const hit = findMessageByMessageId(msgs, messageId);
        if (hit) {
          const updated = updatePartAtBlockIndex(hit.message, index, (part) => applyDeltaToPart(part, delta));
          msgs[hit.index] = updated;
          return msgs;
        }
        // Fall back: maybe this delta is for a sub-agent. Try applying to every tool_use's subAgentParts at the last index.
        return msgs.map((m) => ({
          ...m,
          parts: applyDeltaToSubAgentPartsDeep(m.parts, delta),
        }));
      });
      return;
    }

    // No messageId — best-effort: apply to most recent sub-agent part.
    updateMessagesForConversation(set, get, sessionKey, (msgs) =>
      msgs.map((m) => ({
        ...m,
        parts: applyDeltaToSubAgentPartsDeep(m.parts, delta),
      }))
    );
    return;
  }

  if (eventName === "session.block.stop") {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    const index = typeof payload.index === "number" ? payload.index : null;
    if (index === null) return;

    if (messageId) {
      updateMessagesForConversation(set, get, sessionKey, (msgs) => {
        const hit = findMessageByMessageId(msgs, messageId);
        if (!hit) return msgs;
        const updated = updatePartAtBlockIndex(hit.message, index, finalizePart);
        msgs[hit.index] = updated;
        return msgs;
      });
    }
    return;
  }

  if (eventName === "session.message.stop") {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    if (!messageId) return;
    updateMessagesForConversation(set, get, sessionKey, (msgs) => {
      const hit = findMessageByMessageId(msgs, messageId);
      if (!hit) return msgs;
      msgs[hit.index] = { ...hit.message, pending: false };
      return msgs;
    });

    // Update conversation preview using combined text parts.
    const msgs = get().messagesByConversation[sessionKey] ?? [];
    const m = msgs.find((x) => x.id === messageId);
    if (m) {
      set({
        conversations: applyConversationUpdate(
          ensureConversation(get().conversations, sessionKey),
          sessionKey,
          {
            preview: buildPreview(m.parts),
            updatedAt: now,
          }
        ),
      });
    }
    return;
  }

  if (eventName === "session.tool_result") {
    const toolUseId = typeof payload.toolUseId === "string" ? payload.toolUseId : null;
    if (!toolUseId) return;
    const isError = Boolean(payload.isError);
    const content = Array.isArray(payload.content)
      ? (payload.content as Array<{ type?: string; text?: string }>).filter(
          (c): c is { type: "text"; text: string } => !!c && c.type === "text" && typeof c.text === "string"
        )
      : [];

    updateMessagesForConversation(set, get, sessionKey, (msgs) =>
      msgs.map((m) => ({
        ...m,
        parts: mutateToolUseInParts(m.parts, toolUseId, (tool) => ({
          ...tool,
          result: { isError, content },
        })),
      }))
    );
    return;
  }

  if (eventName === "session.completed") {
    const turnCost = typeof payload.totalCostUsd === "number" ? payload.totalCostUsd : 0;
    const existing = get().conversations.find((c) => c.key === sessionKey)?.totalCostUsd ?? 0;
    set({
      conversations: applyConversationUpdate(
        ensureConversation(get().conversations, sessionKey),
        sessionKey,
        {
          isStreaming: false,
          runId: null,
          statusText: null,
          updatedAt: now,
          totalCostUsd: turnCost > 0 ? existing + turnCost : existing,
        }
      ),
    });
    // Safety: any still-pending assistant messages get finalized.
    updateMessagesForConversation(set, get, sessionKey, (msgs) =>
      msgs.map((m) => (m.role === "assistant" && m.pending ? { ...m, pending: false } : m))
    );
    return;
  }

  if (eventName === "session.error") {
    const code = typeof payload.code === "string" ? payload.code : "error";
    const message = typeof payload.message === "string" ? payload.message : "Unknown error";
    updateMessagesForConversation(set, get, sessionKey, (msgs) => {
      const pending = findPendingAssistantStub(msgs);
      if (!pending) return msgs;
      const existingText = pending.message.parts.find((p) => p.type === "text") as
        | Extract<MessageContentPart, { type: "text" }>
        | undefined;
      const errorText = existingText?.text
        ? `${existingText.text}\n\n[${code}] ${message}`
        : `[${code}] ${message}`;
      const newParts: MessageContentPart[] = existingText
        ? pending.message.parts.map((p) =>
            p === existingText ? ({ type: "text", text: errorText } as const) : p
          )
        : [{ type: "text", text: errorText } as const, ...pending.message.parts];
      msgs[pending.index] = { ...pending.message, parts: newParts, pending: false, error: `${code}: ${message}` };
      return msgs;
    });
    set({
      conversations: applyConversationUpdate(
        ensureConversation(get().conversations, sessionKey),
        sessionKey,
        { isStreaming: false, runId: null, statusText: null, updatedAt: now }
      ),
    });
    return;
  }

  if (
    eventName === "session.subagent.started" ||
    eventName === "session.subagent.progress" ||
    eventName === "session.subagent.notification" ||
    eventName === "session.subagent.updated"
  ) {
    // Optional UI hint — not rendered in MVP. Ignored for now.
    return;
  }

  if (eventName === "session.message_error") {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    const errCode = typeof payload.error === "string" ? payload.error : "unknown";
    const stopReason = typeof payload.stopReason === "string" ? payload.stopReason : null;
    if (!messageId) return;
    updateMessagesForConversation(set, get, sessionKey, (msgs) => {
      const hit = findMessageByMessageId(msgs, messageId);
      if (!hit) return msgs;
      const label = stopReason ? `${errCode}: ${stopReason}` : errCode;
      msgs[hit.index] = { ...hit.message, error: label };
      return msgs;
    });
    return;
  }

  if (eventName === "session.usage") {
    const usageModel = typeof payload.model === "string" ? payload.model : null;
    const inputTokens = typeof payload.inputTokens === "number" ? payload.inputTokens : 0;
    const outputTokens = typeof payload.outputTokens === "number" ? payload.outputTokens : 0;
    const cacheCreation = typeof payload.cacheCreationTokens === "number" ? payload.cacheCreationTokens : 0;
    const cacheRead = typeof payload.cacheReadTokens === "number" ? payload.cacheReadTokens : 0;
    const contextTokens = inputTokens + cacheCreation + cacheRead;

    // Decide whether to update model/window. The API response strips the 1M
    // tag (e.g. "claude-opus-4-7" instead of "claude-opus-4-7[1m]"), so if
    // init already set a tagged model for the same family, we must NOT
    // overwrite it with the API's truncated form. Only overwrite if the
    // usage model is a genuinely different family/version.
    const existing = get().conversations.find((c) => c.key === sessionKey);
    const priorModel = existing?.contextModel ?? null;
    const stripTag = (s: string) => s.replace(/\[[^\]]*\]$/, "").toLowerCase();
    const sameFamily = usageModel && priorModel && stripTag(usageModel) === stripTag(priorModel);
    const shouldUpdateModel = !priorModel || (usageModel && !sameFamily);

    const patch: Partial<Conversation> = {
      contextTokens,
      contextInputTokens: inputTokens,
      contextCacheReadTokens: cacheRead,
      contextCacheCreationTokens: cacheCreation,
      contextOutputTokens: outputTokens,
    };
    if (shouldUpdateModel && usageModel) {
      const is1M = /\[?1m\]?|-1m\b/i.test(usageModel);
      patch.contextModel = usageModel;
      patch.contextWindow = is1M ? 1_000_000 : 200_000;
    } else if (!priorModel && usageModel) {
      // Fallback when no init has fired (e.g. resume hydration path)
      patch.contextModel = usageModel;
      patch.contextWindow = 200_000;
    }
    set({
      conversations: applyConversationUpdate(
        ensureConversation(get().conversations, sessionKey),
        sessionKey,
        patch
      ),
    });
    return;
  }

  if (eventName === "session.api_retry") {
    const attempt = typeof payload.attempt === "number" ? payload.attempt : 0;
    const maxRetries = typeof payload.maxRetries === "number" ? payload.maxRetries : 0;
    const delayMs = typeof payload.retryDelayMs === "number" ? payload.retryDelayMs : 0;
    const delaySec = Math.max(1, Math.round(delayMs / 1000));
    const statusText = `Rate-limited or transient error — retrying in ${delaySec}s (attempt ${attempt}/${maxRetries})`;
    set({
      conversations: applyConversationUpdate(
        ensureConversation(get().conversations, sessionKey),
        sessionKey,
        { statusText }
      ),
    });
    return;
  }

  if (eventName === "session.init") {
    // Init's `model` carries the CLI's effective model ID including 1M tag,
    // e.g. "claude-opus-4-7[1m]". Assistant-turn model strings from the API
    // don't include the tag, so init is the only authoritative source here.
    const model = typeof payload.model === "string" ? payload.model : null;
    if (model) {
      const is1M = /\[?1m\]?|-1m\b/i.test(model);
      const contextWindow = is1M ? 1_000_000 : 200_000;
      set({
        conversations: applyConversationUpdate(
          ensureConversation(get().conversations, sessionKey),
          sessionKey,
          { contextModel: model, contextWindow }
        ),
      });
    }
    return;
  }

  if (
    eventName === "session.status" ||
    eventName === "session.notification" ||
    eventName === "session.memory_recall" ||
    eventName === "session.mirror_error" ||
    eventName === "session.compact_boundary"
  ) {
    // Forwarded for future UI rendering; silently dropped for now.
    return;
  }
}

function makePartForBlock(block: { type?: string; id?: string; name?: string }): MessageContentPart | null {
  if (block.type === "text") return { type: "text", text: "" };
  if (block.type === "thinking") return { type: "thinking", text: "", complete: false };
  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: typeof block.id === "string" ? block.id : `tool-${Math.random().toString(36).slice(2, 10)}`,
      name: typeof block.name === "string" ? block.name : "unknown",
      input: "",
      inputComplete: false,
    };
  }
  return null;
}

function applyDeltaToPart(
  part: MessageContentPart,
  delta: { type?: string; text?: string; thinking?: string; partial_json?: string }
): MessageContentPart {
  if (part.type === "text" && delta.type === "text_delta" && typeof delta.text === "string") {
    return { ...part, text: part.text + delta.text };
  }
  if (part.type === "thinking" && delta.type === "thinking_delta" && typeof delta.thinking === "string") {
    return { ...part, text: part.text + delta.thinking };
  }
  if (part.type === "tool_use" && delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
    const current = typeof part.input === "string" ? part.input : "";
    return { ...part, input: current + delta.partial_json };
  }
  return part;
}

function finalizePart(part: MessageContentPart): MessageContentPart {
  if (part.type === "thinking") return { ...part, complete: true };
  if (part.type === "tool_use") {
    const raw = typeof part.input === "string" ? part.input : "";
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      return { ...part, input: parsed, inputComplete: true };
    } catch {
      return { ...part, inputComplete: false };
    }
  }
  return part;
}

function mutateToolUseInParts(
  parts: MessageContentPart[],
  toolUseId: string,
  mutator: (tool: Extract<MessageContentPart, { type: "tool_use" }>) => Extract<MessageContentPart, { type: "tool_use" }>
): MessageContentPart[] {
  let changed = false;
  const next = parts.map((p) => {
    if (p.type !== "tool_use") return p;
    if (p.id === toolUseId) {
      changed = true;
      return mutator(p);
    }
    const subParts = p.subAgentParts ? mutateToolUseInParts(p.subAgentParts, toolUseId, mutator) : p.subAgentParts;
    if (subParts !== p.subAgentParts) {
      changed = true;
      return { ...p, subAgentParts: subParts };
    }
    return p;
  });
  return changed ? next : parts;
}

function applyDeltaToSubAgentPartsDeep(
  parts: MessageContentPart[],
  delta: { type?: string; text?: string; thinking?: string; partial_json?: string }
): MessageContentPart[] {
  return parts.map((p) => {
    if (p.type !== "tool_use" || !p.subAgentParts || p.subAgentParts.length === 0) return p;
    const last = p.subAgentParts[p.subAgentParts.length - 1];
    const updatedLast = applyDeltaToPart(last, delta);
    if (updatedLast === last) {
      // recurse
      const nested = applyDeltaToSubAgentPartsDeep(p.subAgentParts, delta);
      return nested === p.subAgentParts ? p : { ...p, subAgentParts: nested };
    }
    const nextSub = p.subAgentParts.slice();
    nextSub[nextSub.length - 1] = updatedLast;
    return { ...p, subAgentParts: nextSub };
  });
}

// PendingSearchResult unused — kept for clarity of intent.
void (null as unknown as PendingSearchResult);

function applyRemap(
  fromSessionKey: string,
  toSessionKey: string,
  set: (next: Partial<ChatStoreState> | ((state: ChatStoreState) => Partial<ChatStoreState>)) => void,
  get: () => ChatStoreState
) {
  if (!fromSessionKey || !toSessionKey || fromSessionKey === toSessionKey) return;
  const state = get();
  const existsFrom = state.conversations.some((c) => c.key === fromSessionKey);
  const existsTo = state.conversations.some((c) => c.key === toSessionKey);

  const conversations = state.conversations.flatMap((c) => {
    if (c.key === fromSessionKey) {
      if (existsTo) return []; // drop the duplicate — will merge onto the existing toSessionKey
      return { ...c, key: toSessionKey };
    }
    return c;
  });

  const messagesByConversation = { ...state.messagesByConversation };
  if (existsFrom) {
    const fromMsgs = messagesByConversation[fromSessionKey] ?? [];
    const toMsgs = messagesByConversation[toSessionKey] ?? [];
    messagesByConversation[toSessionKey] = existsTo && toMsgs.length > fromMsgs.length ? toMsgs : fromMsgs;
    delete messagesByConversation[fromSessionKey];
  }

  const selectedWasFrom = state.selectedConversationKey === fromSessionKey;
  const nextSelected = selectedWasFrom ? toSessionKey : state.selectedConversationKey;

  set({ conversations, messagesByConversation, selectedConversationKey: nextSelected });

  if (selectedWasFrom) {
    saveSelectedKey(toSessionKey);
    if (typeof window !== "undefined") {
      const current = window.location.hash;
      const expected = `#/chat/${encodeURIComponent(toSessionKey)}`;
      if (current !== expected) navigate(expected);
    }
  }
}

function applySessionEventToChatStore(
  event: SessionEvent,
  set: (next: Partial<ChatStoreState> | ((state: ChatStoreState) => Partial<ChatStoreState>)) => void,
  get: () => ChatStoreState
) {
  if (event.type === "streaming") {
    set({
      conversations: applyConversationUpdate(ensureConversation(get().conversations, event.sessionKey), event.sessionKey, {
        isStreaming: event.isStreaming,
        updatedAt: nowIso(),
      }),
    });
    return;
  }

  if (event.type === "updated") {
    return;
  }

  if (event.type === "remap") {
    applyRemap(event.fromSessionKey, event.toSessionKey, set, get);
    return;
  }

  if (event.type === "raw") {
    handleClaudeRawEvent(event.event, event.payload, event.sessionKey, event.runId ?? null, set, get);
    return;
  }

  const currentMessages = [...(get().messagesByConversation[event.sessionKey] ?? [])];
  const pendingAssistantIndex = [...currentMessages]
    .reverse()
    .findIndex((message) => message.role === "assistant" && message.pending);
  const targetIndex = pendingAssistantIndex === -1 ? -1 : currentMessages.length - 1 - pendingAssistantIndex;

  const nextMessage: ChatMessage = {
    id: event.message.id,
    role: event.message.role,
    parts: [{ type: "text", text: event.message.content }],
    createdAt: event.message.timestamp,
    pending: false,
    runId: event.message.id,
  };

  if (event.message.role === "assistant" && targetIndex >= 0) {
    currentMessages[targetIndex] = { ...currentMessages[targetIndex], ...nextMessage, pending: false };
  } else {
    currentMessages.push(nextMessage);
  }

  set({
    messagesByConversation: { ...get().messagesByConversation, [event.sessionKey]: currentMessages },
    conversations: applyConversationUpdate(ensureConversation(get().conversations, event.sessionKey), event.sessionKey, {
      preview: buildPreview(nextMessage.parts),
      updatedAt: nowIso(),
      isStreaming: false,
      runId: null,
    }),
  });
}

function ensureSessionSubscription(
  set: (next: Partial<ChatStoreState> | ((state: ChatStoreState) => Partial<ChatStoreState>)) => void,
  get: () => ChatStoreState
) {
  const adapter = getBackendAdapter();
  if (activeSessionAdapterType === adapter.type) {
    return;
  }
  unsubscribeSessionEvents?.();
  unsubscribeSessionEvents = null;
  activeSessionAdapterType = adapter.type;
  if (adapter.sessions.subscribe) {
    unsubscribeSessionEvents = adapter.sessions.subscribe((event) => {
      applySessionEventToChatStore(event, set, get);
    });
  }
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  conversations: [],
  sessionsReady: false,
  selectedConversationKey: null,
  messagesByConversation: {},
  queuedMessages: [],
  loadingConversationKey: null,
  refreshSessions: async () => {
    const adapter = getBackendAdapter();
    ensureSessionSubscription(set, get);
    if (!adapter.isConnected()) {
      set({ sessionsReady: true });
      return;
    }
    try {
      const sessions = (await adapter.sessions.list()).map((session) =>
        normalizeSession({
          key: session.key,
          label: session.title,
          lastMessagePreview: session.preview,
          updatedAt: session.updatedAt,
          createdAt: session.createdAt,
          activeRunId: session.runId,
        })
      );
      const selectedConversationKey = get().selectedConversationKey ?? loadSelectedKey() ?? null;
      saveSelectedKey(selectedConversationKey);
      set({ conversations: sessions, selectedConversationKey, sessionsReady: true });

      // Seed session flow timeline with conversation data
      useSessionFlowStore.getState().seedFromConversations(
        sessions.map((s) => ({
          key: s.key,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
          isStreaming: s.isStreaming,
          runId: s.runId,
        }))
      );
      if (selectedConversationKey) {
        await get().selectConversation(selectedConversationKey);
      }
    } catch (error) {
      set({ sessionsReady: true });
    }
  },
  createConversation: async () => {
    const rawKey = "new";
    const state = get();
    const draftExists = state.conversations.some((c) => c.key === rawKey);
    if (!draftExists) {
      const now = nowIso();
      const localConversation = {
        key: rawKey,
        title: "New Chat",
        preview: "",
        updatedAt: now,
        createdAt: now,
        isStreaming: false,
        runId: null
      };
      set({
        conversations: [localConversation, ...state.conversations],
        selectedConversationKey: rawKey,
        messagesByConversation: { ...state.messagesByConversation, [rawKey]: [] }
      });
    } else {
      set({ selectedConversationKey: rawKey });
    }
    saveSelectedKey(rawKey);
    useUiStore.getState().closeMobileSidebar();
    if (typeof window !== "undefined") {
      navigate(`#/chat/${encodeURIComponent(rawKey)}`);
    }
    return rawKey;
  },
  selectConversation: async (key) => {
    saveSelectedKey(key);
    const adapter = getBackendAdapter();
    // Look up task title for the sidebar
    const taskTitle = useTaskStore.getState().tasks.find((t: { sessionKey?: string | null; sessionKeys?: string[] }) =>
      t.sessionKey === key || t.sessionKeys?.includes(key)
    )?.title;
    set({
      selectedConversationKey: key,
      loadingConversationKey: key,
      conversations: ensureConversation(get().conversations, key, taskTitle || undefined)
    });
    useUiStore.getState().closeMobileSidebar();
    // Keys without `::` are local drafts — no transcript on disk to fetch.
    const isLocalDraft = !key.includes("::");
    if (!adapter.isConnected() || isLocalDraft || get().messagesByConversation[key]) {
      if (isLocalDraft && !get().messagesByConversation[key]) {
        set({ messagesByConversation: { ...get().messagesByConversation, [key]: [] } });
      }
      set({ loadingConversationKey: null });
      return;
    }
    try {
      const rawMessages = await adapter.sessions.history(key);
      const messages = rawMessages
        .map((message) => {
          // Prefer structured `parts` (Claude Code transcript parser returns
          // tool_use / thinking / text parts directly). Fall back to wrapping
          // `content` as a single text part for legacy / other adapters.
          let parts: ChatMessage["parts"];
          if (message.parts && message.parts.length > 0) {
            parts = message.parts;
          } else if (message.content && message.content.trim()) {
            parts = [{ type: "text" as const, text: message.content }];
          } else {
            parts = [];
          }
          return {
            id: message.id,
            role: message.role,
            parts,
            createdAt: message.timestamp,
            pending: false,
            hidden: hiddenMessageIds.includes(message.id),
            runId: message.id,
          };
        })
        // Drop ghost messages that have no renderable parts — this was the
        // root cause of empty bubbles on resume.
        .filter((m) => m.parts.length > 0);
      set({
        messagesByConversation: { ...get().messagesByConversation, [key]: messages },
        loadingConversationKey: null
      });

      // Seed session flow timeline with message history
      if (messages.length > 0) {
        useSessionFlowStore.getState().seedFromHistory(
          key,
          messages.map((m) => ({ role: m.role, createdAt: m.createdAt }))
        );
      }
    } catch {
      set({
        messagesByConversation: { ...get().messagesByConversation, [key]: [] },
        loadingConversationKey: null
      });
    }
  },
  renameConversation: async (key, title) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    const previous = get().conversations;
    set({
      conversations: applyConversationUpdate(previous, key, {
        title: trimmed,
        updatedAt: nowIso()
      })
    });
    const adapter = getBackendAdapter();
    if (!adapter.isConnected()) {
      return;
    }
    try {
      await adapter.sessions.rename(key, trimmed);
    } catch {
      set({ conversations: previous });
    }
  },
  deleteConversation: async (key) => {
    const adapter = getBackendAdapter();
    if (adapter.isConnected()) {
      try {
        await adapter.sessions.delete(key);
      } catch {
        // Preserve local delete even if gateway rejects it.
      }
    }
    const nextConversations = get().conversations.filter((conversation) => conversation.key !== key);
    const nextMessages = { ...get().messagesByConversation };
    delete nextMessages[key];
    set({
      conversations: nextConversations,
      messagesByConversation: nextMessages,
      selectedConversationKey:
        get().selectedConversationKey === key ? nextConversations[0]?.key ?? null : get().selectedConversationKey
    });
  },
  sendMessage: async () => {
    const ui = useUiStore.getState();
    const adapter = getBackendAdapter();
    const selectedKey = get().selectedConversationKey ?? (await get().createConversation());
    if (!selectedKey) {
      return;
    }
    let text = ui.draft.trim();

    // Inject task context on first message to a task-linked session
    const existingMessages = get().messagesByConversation[selectedKey] ?? [];
    const hasUserMessages = existingMessages.some((m) => m.role === "user");
    if (!hasUserMessages && text) {
      const linkedTask = useTaskStore.getState().tasks.find(
        (t) => t.sessionKey === selectedKey || t.sessionKeys?.includes(selectedKey)
      );
      if (linkedTask) {
        const lines = [
          `[Task context — you are working on task ${linkedTask.id}: "${linkedTask.title}"]`,
          `[Status: ${linkedTask.status}]`,
        ];
        if (linkedTask.notes?.trim()) {
          lines.push(`[Notes: ${linkedTask.notes.trim()}]`);
        }
        if (linkedTask.sessionKeys && linkedTask.sessionKeys.length > 0) {
          lines.push(`[Previous sessions: ${linkedTask.sessionKeys.join(", ")} — check transcripts in ~/.openclaw/agents/main/sessions/ for prior work]`);
        }
        lines.push(`[Use "task note ${linkedTask.id} ..." to log progress, "task review ${linkedTask.id} ..." when done]`, "---");
        text = lines.join("\n") + "\n" + text;
      }
    }
    const displayText = ui.draft.trim();
    const attachments = ui.attachments;
    if (!text && attachments.length === 0) {
      return;
    }
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        ...(displayText ? [{ type: "text", text: displayText } as const] : []),
        ...attachments.flatMap((attachment) =>
          attachment.dataUrl
            ? ({ type: "image", url: attachment.dataUrl, alt: attachment.name } as const)
            : ({ type: "attachment", name: attachment.name, mimeType: attachment.mimeType } as const)
        )
      ],
      createdAt: nowIso(),
      pending: !adapter.isConnected()
    };
    const assistantStub: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [{ type: "text", text: "" }],
      createdAt: nowIso(),
      pending: true,
      runId: userMessage.id
    };
    useUiStore.setState({ draft: "", attachments: [] });
    set({
      messagesByConversation: {
        ...get().messagesByConversation,
        [selectedKey]: [...(get().messagesByConversation[selectedKey] ?? []), userMessage, assistantStub]
      },
      conversations: applyConversationUpdate(ensureConversation(get().conversations, selectedKey), selectedKey, {
        preview: buildPreview(userMessage.parts),
        updatedAt: nowIso(),
        isStreaming: true,
        runId: userMessage.id
      })
    });
    if (!adapter.isConnected()) {
      set({
        queuedMessages: [...get().queuedMessages, { conversationKey: selectedKey, text, attachments }]
      });
      return;
    }
    try {
      const response = await adapter.sessions.send(selectedKey, text, { cwd: undefined });
      const responseText = response.content.trim();
      if (responseText) {
        set({
          messagesByConversation: {
            ...get().messagesByConversation,
            [selectedKey]: (get().messagesByConversation[selectedKey] ?? []).flatMap((message) =>
              message.id === assistantStub.id
                ? {
                    ...message,
                    runId: response.id,
                    pending: false,
                    parts: [{ type: "text", text: response.content }],
                  }
                : message
            ),
          },
          conversations: applyConversationUpdate(get().conversations, selectedKey, {
            runId: null,
            isStreaming: false,
            preview: response.content.slice(0, 140),
          }),
        });
      } else {
        set({
          messagesByConversation: {
            ...get().messagesByConversation,
            [selectedKey]: (get().messagesByConversation[selectedKey] ?? []).flatMap((message) =>
              message.id === assistantStub.id ? { ...message, runId: response.id } : message
            ),
          },
          conversations: applyConversationUpdate(get().conversations, selectedKey, { runId: response.id, isStreaming: true }),
        });
      }
    } catch (error) {
      set({
        messagesByConversation: {
          ...get().messagesByConversation,
          [selectedKey]: (get().messagesByConversation[selectedKey] ?? []).flatMap((message) =>
            message.id === assistantStub.id
              ? {
                  ...message,
                  pending: false,
                  error: String(error),
                  parts: [{ type: "text", text: `Error: ${String(error)}` }]
                }
              : message
          )
        },
        conversations: applyConversationUpdate(get().conversations, selectedKey, {
          isStreaming: false,
          runId: null
        })
      });
    }
  },
  cancelStream: async (conversationKey) => {
    const adapter = getBackendAdapter();
    const key = conversationKey ?? get().selectedConversationKey;
    if (!key) return;
    const conversation = get().conversations.find((c) => c.key === key);
    const runId = conversation?.runId;
    if (!runId || !adapter.sessions.cancelRun) return;
    try {
      await adapter.sessions.cancelRun(runId);
    } catch {
      // Surface failure via UI later if needed; for now silent — session.error will arrive anyway.
    }
  },
  flushQueuedMessages: async () => {
    const queued = [...get().queuedMessages];
    if (queued.length === 0) {
      return;
    }
    set({ queuedMessages: [] });
    for (const queuedMessage of queued) {
      useUiStore.setState({
        draft: queuedMessage.text,
        attachments: queuedMessage.attachments
      });
      set({ selectedConversationKey: queuedMessage.conversationKey });
      await get().sendMessage();
    }
  },
  retryMessage: async (messageId) => {
    const key = get().selectedConversationKey;
    if (!key) {
      return;
    }
    const target = (get().messagesByConversation[key] ?? []).find((message) => message.id === messageId);
    if (!target) {
      return;
    }
    useUiStore.setState({ draft: extractMessageText(target.parts) });
    await get().sendMessage();
  },
  hideMessage: (messageId) => {
    const key = get().selectedConversationKey;
    if (!key) {
      return;
    }
    const nextHidden = [...new Set([...readHiddenMessages(), messageId])];
    persistHiddenMessages(nextHidden);
    set({
      messagesByConversation: {
        ...get().messagesByConversation,
        [key]: (get().messagesByConversation[key] ?? []).flatMap((message) =>
          message.id === messageId ? { ...message, hidden: true } : message
        )
      }
    });
  },
  addTaskFromMessage: async (messageId) => {
    const key = get().selectedConversationKey;
    if (!key) {
      return;
    }
    const message = (get().messagesByConversation[key] ?? []).find((item) => item.id === messageId);
    if (!message) {
      return;
    }
    const text = extractMessageText(message.parts);
    const title = text.split("\n")[0]?.trim() || "New task";
    await useTaskStore.getState().add(title, null, { notes: text, sessionKey: key });
  },

  quickSend: async (sessionKey, text) => {
    const adapter = getBackendAdapter();
    if (!adapter.isConnected() || !text.trim()) return;
    try {
      await adapter.sessions.send(sessionKey, text.trim());
      // Refresh to pick up the new messages
      void get().refreshSessions();
    } catch (error) {
      console.error("quickSend failed:", error);
    }
  },
  handleChatEvent: (payload) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const data = payload as Record<string, unknown>;
    let sessionKey = typeof data.sessionKey === "string" ? data.sessionKey.replace(/^agent:[^:]+:/, "") : null;
    const runId = typeof data.runId === "string" ? data.runId : null;
    const state = typeof data.state === "string" ? data.state : null;
    if (!sessionKey || !state) {
      return;
    }
    // If no messages exist under the canonical key but a runId matches a pending
    // assistant stub in a different (local) conversation, remap that conversation
    // to the canonical key so responses land in the right place.
    if (runId && !(get().messagesByConversation[sessionKey]?.length)) {
      const allMessages = get().messagesByConversation;
      const allConversations = get().conversations;
      for (const [localKey, msgs] of Object.entries(allMessages)) {
        if (localKey === sessionKey) continue;
        const hasPendingRun = msgs.some((m) => m.runId === runId && m.pending);
        if (hasPendingRun) {
          // Remap: move messages from localKey to sessionKey and update conversation
          const updatedMessages = { ...allMessages, [sessionKey]: msgs };
          delete updatedMessages[localKey];
          const updatedConversations = allConversations.map((c) =>
            c.key === localKey ? { ...c, key: sessionKey } : c
          );
          const selectedKey = get().selectedConversationKey === localKey ? sessionKey : get().selectedConversationKey;
          set({
            messagesByConversation: updatedMessages,
            conversations: updatedConversations,
            selectedConversationKey: selectedKey
          });
          saveSelectedKey(selectedKey);
          break;
        }
      }
    }
    const currentMessages = [...(get().messagesByConversation[sessionKey] ?? [])];
    const lastAssistantIndex = [...currentMessages]
      .reverse()
      .findIndex((message) => message.role === "assistant" && message.pending);
    const targetIndex = lastAssistantIndex === -1 ? -1 : currentMessages.length - 1 - lastAssistantIndex;
    const existing = targetIndex >= 0 ? currentMessages[targetIndex] : null;
    const text = messageTextFromUnknown((data.message as Record<string, unknown> | undefined) ?? payload);
    const updateMessage = (pending: boolean, error?: string, textValue = text) => ({
      id: existing?.id ?? crypto.randomUUID(),
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: textValue }],
      createdAt: existing?.createdAt ?? nowIso(),
      pending,
      runId,
      error: error ?? existing?.error ?? null
    });
    if (state === "delta") {
      if (existing) {
        currentMessages[targetIndex] = updateMessage(true);
      } else {
        currentMessages.push(updateMessage(true));
      }
    }
    if (state === "final") {
      if (existing) {
        currentMessages[targetIndex] = updateMessage(false);
      } else {
        currentMessages.push(updateMessage(false));
      }
    }
    if (state === "error" || state === "aborted") {
      const messageText =
        state === "error"
          ? typeof data.errorMessage === "string"
            ? data.errorMessage
            : "Run failed."
          : "Generation stopped.";
      if (existing) {
        currentMessages[targetIndex] = updateMessage(
          false,
          state === "error" ? messageText : "Run aborted",
          messageText
        );
      }
    }
    set({
      messagesByConversation: {
        ...get().messagesByConversation,
        [sessionKey]: currentMessages
      },
      conversations: applyConversationUpdate(ensureConversation(get().conversations, sessionKey), sessionKey, {
        preview: buildPreview((currentMessages[currentMessages.length - 1] ?? existing)?.parts ?? []),
        updatedAt: nowIso(),
        isStreaming: state === "delta",
        runId: state === "delta" ? runId : null
      })
    });
  }
}));
