import { beforeEach, describe, expect, it } from "vitest";
import type { BackendAdapter } from "../adapters/types";
import { useChatStore } from "./chat-store";
import { useUiStore } from "./ui-store";
import { useAdapterStore } from "../adapters";

const mockAdapter: BackendAdapter = {
  type: "local",
  sessions: {
    send: async () => ({ id: "run-1", role: "assistant", content: "OK", timestamp: new Date().toISOString() }),
    history: async () => [],
    list: async () => [],
    create: async () => ({
      key: "c1",
      title: "Chat",
      preview: "",
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      isStreaming: false,
      runId: null,
    }),
    rename: async () => undefined,
    delete: async () => undefined,
  },
  files: {
    read: async () => "",
    write: async () => undefined,
    list: async () => [],
    exists: async () => false,
    delete: async () => undefined,
  },
  connect: async () => undefined,
  disconnect: () => undefined,
  isConnected: () => true,
  capabilities: () => ({ crons: false, agents: false, realtime: false }),
};

describe("chat store", () => {
  beforeEach(() => {
    localStorage.clear();
    useAdapterStore.setState({
      config: { type: "local", gatewayUrl: "ws://localhost", gatewayToken: "token", workspace: "." },
      adapter: mockAdapter,
      connected: true,
    });
    useChatStore.setState({
      conversations: [{ key: "c1", title: "Chat", preview: "", updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), isStreaming: false, runId: null }],
      sessionsReady: true,
      selectedConversationKey: "c1",
      messagesByConversation: { c1: [] },
      queuedMessages: [],
      loadingConversationKey: null
    });
    useUiStore.setState({
      draft: "Ship it",
      attachments: [],
      currentPanel: "tasks",
      mobileTab: "chat",
      mobileSidebarOpen: false,
      sidebarFilesMode: false,
      conversationSearch: "",
      focusSearchVersion: 0
    });
  });

  it("sends a message and appends user and assistant placeholder messages", async () => {
    await useChatStore.getState().sendMessage();

    const messages = useChatStore.getState().messagesByConversation.c1;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    expect(useUiStore.getState().draft).toBe("");
  });
});
