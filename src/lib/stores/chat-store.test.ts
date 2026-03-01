import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chat-store";
import { useGatewayStore } from "./gateway-store";
import { useUiStore } from "./ui-store";

describe("chat store", () => {
  beforeEach(() => {
    localStorage.clear();
    useGatewayStore.setState({
      connectionState: "connected",
      connectionDetail: "",
      gatewayUrl: "ws://localhost",
      gatewayToken: "token",
      gatewayClient: {
        isConnected: () => true,
        request: async () => ({ runId: "run-1" }),
        connect: () => undefined,
        disconnect: () => undefined
      } as never,
      lastGatewayEvent: null,
      gatewayEventVersion: 0
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
