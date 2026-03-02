import { create } from "zustand";
import type { ChatMessage, SessionsListEntry } from "../types";
import { useGatewayStore } from "./gateway-store";
import { useTaskStore } from "./task-store-v2";
import { useUiStore } from "./ui-store";
import {
  applyConversationUpdate,
  buildPreview,
  ensureConversation,
  extractMessageText,
  messageTextFromUnknown,
  normalizeHistoryMessage,
  normalizeSession,
  nowIso,
  persistHiddenMessages,
  readHiddenMessages,
  type ChatStoreState
} from "./shared";

const hiddenMessageIds = readHiddenMessages();
const SELECTED_KEY = "openclaw-ui-selected-conversation";

function saveSelectedKey(key: string | null) {
  if (key) localStorage.setItem(SELECTED_KEY, key);
  else localStorage.removeItem(SELECTED_KEY);
}

function loadSelectedKey(): string | null {
  return localStorage.getItem(SELECTED_KEY);
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  conversations: [],
  sessionsReady: false,
  selectedConversationKey: null,
  messagesByConversation: {},
  queuedMessages: [],
  loadingConversationKey: null,
  refreshSessions: async () => {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) {
      set({ sessionsReady: true });
      return;
    }
    try {
      const response = await client.request<{ sessions?: SessionsListEntry[] }>("sessions.list", {
        limit: 50,
        includeDerivedTitles: true,
        includeLastMessage: true
      });
      const sessions = Array.isArray(response.sessions) ? response.sessions.flatMap(normalizeSession) : [];
      const selectedConversationKey = get().selectedConversationKey ?? loadSelectedKey() ?? sessions[0]?.key ?? null;
      saveSelectedKey(selectedConversationKey);
      set({ conversations: sessions, selectedConversationKey, sessionsReady: true });
      if (selectedConversationKey) {
        await get().selectConversation(selectedConversationKey);
      }
    } catch (error) {
      useGatewayStore.setState({ connectionDetail: String(error) });
      set({ sessionsReady: true });
    }
  },
  createConversation: async () => {
    const client = useGatewayStore.getState().gatewayClient;
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
    if (!client || !client.isConnected()) {
      set({
        conversations: [localConversation, ...get().conversations],
        selectedConversationKey: rawKey,
        messagesByConversation: { ...get().messagesByConversation, [rawKey]: [] }
      });
      useUiStore.getState().closeMobileSidebar();
      return rawKey;
    }
    try {
      const response = await client.request<{ key?: string; entry?: { label?: string } }>("sessions.patch", {
        key: rawKey,
        label: "New Chat"
      });
      const key = (typeof response.key === "string" && response.key) || rawKey;
      set({
        conversations: [
          { ...localConversation, key, title: response.entry?.label || "New Chat" },
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
    const client = useGatewayStore.getState().gatewayClient;
    set({
      selectedConversationKey: key,
      loadingConversationKey: key,
      conversations: ensureConversation(get().conversations, key)
    });
    useUiStore.getState().closeMobileSidebar();
    if (!client || !client.isConnected() || get().messagesByConversation[key]) {
      set({ loadingConversationKey: null });
      return;
    }
    try {
      const response = await client.request<{ messages?: unknown[] }>("chat.history", {
        sessionKey: key,
        limit: 200
      });
      const messages = Array.isArray(response.messages)
        ? response.messages
            .flatMap(normalizeHistoryMessage)
            .filter((message): message is ChatMessage => message !== null)
            .flatMap((message) => (hiddenMessageIds.includes(message.id) ? { ...message, hidden: true } : message))
        : [];
      set({
        messagesByConversation: { ...get().messagesByConversation, [key]: messages },
        loadingConversationKey: null
      });
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
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) {
      return;
    }
    try {
      await client.request("sessions.patch", { key, label: trimmed });
    } catch {
      set({ conversations: previous });
    }
  },
  deleteConversation: async (key) => {
    const client = useGatewayStore.getState().gatewayClient;
    if (client && client.isConnected()) {
      try {
        await client.request("sessions.delete", { key });
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
    const client = useGatewayStore.getState().gatewayClient;
    const selectedKey = get().selectedConversationKey ?? (await get().createConversation());
    if (!selectedKey) {
      return;
    }
    const text = ui.draft.trim();
    const attachments = ui.attachments;
    if (!text && attachments.length === 0) {
      return;
    }
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        ...(text ? [{ type: "text", text } as const] : []),
        ...attachments.flatMap((attachment) =>
          attachment.dataUrl
            ? ({ type: "image", url: attachment.dataUrl, alt: attachment.name } as const)
            : ({ type: "attachment", name: attachment.name, mimeType: attachment.mimeType } as const)
        )
      ],
      createdAt: nowIso(),
      pending: !client || !client.isConnected()
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
    if (!client || !client.isConnected()) {
      set({
        queuedMessages: [...get().queuedMessages, { conversationKey: selectedKey, text, attachments }]
      });
      return;
    }
    try {
      const response = await client.request<{ runId?: string }>("chat.send", {
        sessionKey: selectedKey,
        message: text,
        idempotencyKey: userMessage.id,
        thinking: "low",
        timeoutMs: 300000,
        attachments: attachments
          .filter((attachment) => attachment.dataUrl)
          .flatMap((attachment) => ({
            type: "image",
            mimeType: attachment.mimeType,
            content: String(attachment.dataUrl).split(",")[1] ?? ""
          }))
      });
      const runId = response.runId ?? userMessage.id;
      set({
        messagesByConversation: {
          ...get().messagesByConversation,
          [selectedKey]: (get().messagesByConversation[selectedKey] ?? []).flatMap((message) =>
            message.id === assistantStub.id ? { ...message, runId } : message
          )
        },
        conversations: applyConversationUpdate(get().conversations, selectedKey, { runId, isStreaming: true })
      });
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
  handleChatEvent: (payload) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const data = payload as Record<string, unknown>;
    const sessionKey = typeof data.sessionKey === "string" ? data.sessionKey : null;
    const runId = typeof data.runId === "string" ? data.runId : null;
    const state = typeof data.state === "string" ? data.state : null;
    if (!sessionKey || !state) {
      return;
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
