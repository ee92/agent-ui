// Fixture-driven test for the Claude-Code raw event pipeline.
//
// Drives canned `session.*` events through the chat store and asserts the
// resulting conversation/message state. Exercises the happy-path turn
// (start → delta → stop → completed), usage, compact_boundary, error folding,
// remap, and 1M-model window detection.

import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore, __dispatchSessionEventForTest } from "./chat-store";

function raw(event: string, payload: Record<string, unknown>, runId: string | null = "run-1") {
  __dispatchSessionEventForTest({ type: "raw", sessionKey: "c1", event, runId, payload });
}

function seedConversation() {
  useChatStore.setState({
    conversations: [{
      key: "c1", title: "Chat", preview: "",
      updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      isStreaming: false, runId: null,
    }],
    sessionsReady: true,
    selectedConversationKey: "c1",
    messagesByConversation: { c1: [] },
    queuedMessages: [],
    loadingConversationKey: null,
  });
}

describe("handleClaudeRawEvent", () => {
  beforeEach(() => {
    localStorage.clear();
    seedConversation();
  });

  it("session.init hydrates the 1M context window for opus[1m]", () => {
    raw("session.init", { model: "claude-opus-4-7[1m]" }, null);
    const conv = useChatStore.getState().conversations.find((c) => c.key === "c1");
    expect(conv?.contextModel).toBe("claude-opus-4-7[1m]");
    expect(conv?.contextWindow).toBe(1_000_000);
  });

  it("session.init uses 200k window for non-1M models", () => {
    raw("session.init", { model: "claude-sonnet-4-5" }, null);
    const conv = useChatStore.getState().conversations.find((c) => c.key === "c1");
    expect(conv?.contextWindow).toBe(200_000);
  });

  it("streams a turn: message.start → block.start → delta → stop → completed", () => {
    raw("session.message.start", { messageId: "m1", role: "assistant", ts: new Date().toISOString() });
    let msgs = useChatStore.getState().messagesByConversation.c1;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].pending).toBe(true);

    raw("session.block.start", { messageId: "m1", index: 0, block: { type: "text", text: "" } });
    raw("session.block.delta", { messageId: "m1", index: 0, delta: { type: "text_delta", text: "Hello " } });
    raw("session.block.delta", { messageId: "m1", index: 0, delta: { type: "text_delta", text: "world" } });

    msgs = useChatStore.getState().messagesByConversation.c1;
    const textPart = msgs[0].parts.find((p) => p.type === "text");
    expect(textPart).toBeDefined();
    if (textPart?.type === "text") expect(textPart.text).toBe("Hello world");

    raw("session.block.stop", { messageId: "m1", index: 0 });
    raw("session.message.stop", { messageId: "m1" });
    raw("session.completed", { durationMs: 500, totalCostUsd: 0.002 });

    msgs = useChatStore.getState().messagesByConversation.c1;
    expect(msgs[0].pending).toBe(false);
    const conv = useChatStore.getState().conversations.find((c) => c.key === "c1");
    expect(conv?.isStreaming).toBe(false);
  });

  it("streams a thinking block: delta accumulates onto the part's text", () => {
    raw("session.message.start", { messageId: "m2", role: "assistant", ts: new Date().toISOString() });
    raw("session.block.start", { messageId: "m2", index: 0, block: { type: "thinking" } });
    raw("session.block.delta", { messageId: "m2", index: 0, delta: { type: "thinking_delta", thinking: "Let me " } });
    raw("session.block.delta", { messageId: "m2", index: 0, delta: { type: "thinking_delta", thinking: "think." } });
    raw("session.block.stop", { messageId: "m2", index: 0 });

    const msgs = useChatStore.getState().messagesByConversation.c1;
    const thinking = msgs[0].parts.find((p) => p.type === "thinking");
    expect(thinking?.type).toBe("thinking");
    if (thinking?.type === "thinking") {
      expect(thinking.text).toBe("Let me think.");
      expect(thinking.complete).toBe(true);
    }
  });

  it("session.usage updates context token fields", () => {
    raw("session.usage", {
      messageId: "m1",
      model: "claude-sonnet-4-5",
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 200,
      cacheReadTokens: 300,
    });
    const conv = useChatStore.getState().conversations.find((c) => c.key === "c1");
    expect(conv?.contextTokens).toBe(600); // 100 + 200 + 300
    expect(conv?.contextInputTokens).toBe(100);
    expect(conv?.contextOutputTokens).toBe(50);
    expect(conv?.contextCacheCreationTokens).toBe(200);
    expect(conv?.contextCacheReadTokens).toBe(300);
  });

  it("session.usage doesn't clobber a [1m]-tagged model set by session.init", () => {
    raw("session.init", { model: "claude-opus-4-7[1m]" }, null);
    raw("session.usage", {
      messageId: "m1",
      model: "claude-opus-4-7",
      inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0,
    });
    const conv = useChatStore.getState().conversations.find((c) => c.key === "c1");
    expect(conv?.contextModel).toBe("claude-opus-4-7[1m]");
    expect(conv?.contextWindow).toBe(1_000_000);
  });

  it("session.compact_boundary drops contextTokens to postTokens immediately", () => {
    raw("session.usage", {
      messageId: "m1",
      inputTokens: 50_000, outputTokens: 1_000,
      cacheCreationTokens: 150_000, cacheReadTokens: 0,
    });
    let conv = useChatStore.getState().conversations.find((c) => c.key === "c1");
    expect(conv?.contextTokens).toBe(200_000);

    raw("session.compact_boundary", {
      trigger: "auto", preTokens: 200_000, postTokens: 7_000, durationMs: 12_000,
    });
    conv = useChatStore.getState().conversations.find((c) => c.key === "c1");
    expect(conv?.contextTokens).toBe(7_000);
  });

  it("session.error folds error text into the pending assistant stub", () => {
    raw("session.message.start", { messageId: "m3", role: "assistant", ts: new Date().toISOString() });
    raw("session.block.start", { messageId: "m3", index: 0, block: { type: "text", text: "" } });
    raw("session.block.delta", { messageId: "m3", index: 0, delta: { type: "text_delta", text: "partial" } });
    raw("session.error", { code: "rate_limit", message: "Too many requests" });

    const msgs = useChatStore.getState().messagesByConversation.c1;
    expect(msgs[0].pending).toBe(false);
    expect(msgs[0].error).toBe("rate_limit: Too many requests");
    const text = msgs[0].parts.find((p) => p.type === "text");
    if (text?.type === "text") {
      expect(text.text).toContain("partial");
      expect(text.text).toContain("[rate_limit] Too many requests");
    }
  });

  it("remap moves messages from local key to canonical key", () => {
    useChatStore.setState({
      messagesByConversation: {
        "local-key": [{
          id: "m0", role: "assistant", parts: [{ type: "text", text: "hi" }],
          createdAt: new Date().toISOString(), pending: true, runId: "run-1",
        }],
      },
      conversations: [{
        key: "local-key", title: "Local", preview: "",
        updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
        isStreaming: true, runId: "run-1",
      }],
      selectedConversationKey: "local-key",
    });
    __dispatchSessionEventForTest({ type: "remap", fromSessionKey: "local-key", toSessionKey: "canonical-key" });

    const state = useChatStore.getState();
    expect(state.messagesByConversation["local-key"]).toBeUndefined();
    expect(state.messagesByConversation["canonical-key"]).toHaveLength(1);
    expect(state.conversations.find((c) => c.key === "canonical-key")).toBeDefined();
    expect(state.selectedConversationKey).toBe("canonical-key");
  });
});
