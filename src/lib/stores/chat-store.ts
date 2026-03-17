import { create } from "zustand";
import type { ChatMessage } from "../types";
import { getBackendAdapter } from "../adapters";
import type { SessionEvent } from "../adapters/types";
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
    const adapter = getBackendAdapter();
    const rawKey = `web-${crypto.randomUUID().slice(0, 8)}`;
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
    if (!adapter.isConnected()) {
      set({
        conversations: [localConversation, ...get().conversations],
        selectedConversationKey: rawKey,
        messagesByConversation: { ...get().messagesByConversation, [rawKey]: [] }
      });
      useUiStore.getState().closeMobileSidebar();
      return rawKey;
    }
    try {
      const created = await adapter.sessions.create(rawKey);
      const key = created.key || rawKey;
      set({
        conversations: [
          { ...localConversation, key, title: created.title || "New Chat" },
          ...get().conversations.filter((conversation) => conversation.key !== key)
        ],
        selectedConversationKey: key,
        messagesByConversation: { ...get().messagesByConversation, [key]: [] }
      });
      useUiStore.getState().closeMobileSidebar();
      return key;
    } catch {
      set({
        conversations: [localConversation, ...get().conversations],
        selectedConversationKey: rawKey,
        messagesByConversation: { ...get().messagesByConversation, [rawKey]: [] }
      });
      return rawKey;
    }
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
    if (!adapter.isConnected() || get().messagesByConversation[key]) {
      set({ loadingConversationKey: null });
      return;
    }
    try {
      const messages = (await adapter.sessions.history(key)).map((message) => ({
        id: message.id,
        role: message.role,
        parts: [{ type: "text" as const, text: message.content }],
        createdAt: message.timestamp,
        pending: false,
        hidden: hiddenMessageIds.includes(message.id),
        runId: message.id,
      }));
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
