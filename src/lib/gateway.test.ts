import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayClient } from "./gateway";

type ListenerMap = Record<string, Array<(event?: { data?: string; code?: number; reason?: string }) => void>>;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;

  readyState = 0;
  listeners: ListenerMap = {};
  sent: string[] = [];

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event?: { data?: string; code?: number; reason?: string }) => void) {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
  }

  emit(type: string, event?: { data?: string; code?: number; reason?: string }) {
    if (type === "open") {
      this.readyState = MockWebSocket.OPEN;
    }
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }
}

describe("GatewayClient", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  it("connects and completes the connect handshake", async () => {
    const states: string[] = [];
    const client = new GatewayClient({
      url: "ws://localhost",
      token: "token",
      onConnectionState: (state) => states.push(state),
      onEvent: vi.fn()
    });

    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.emit("open");
    const connectFrame = JSON.parse(socket.sent[0]) as { id: string };
    socket.emit("message", {
      data: JSON.stringify({ type: "res", id: connectFrame.id, ok: true, result: {} })
    });
    await vi.runAllTimersAsync();

    expect(states).toEqual(["connecting", "connected"]);
    expect(client.isConnected()).toBe(true);
  });

  it("sends requests and resolves responses", async () => {
    const client = new GatewayClient({
      url: "ws://localhost",
      token: "token",
      onConnectionState: vi.fn(),
      onEvent: vi.fn()
    });

    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.emit("open");
    const connectFrame = JSON.parse(socket.sent[0]) as { id: string };
    socket.emit("message", {
      data: JSON.stringify({ type: "res", id: connectFrame.id, ok: true, result: {} })
    });

    const request = client.request<{ ok: boolean }>("files.list", { path: "" });
    const requestFrame = JSON.parse(socket.sent[1]) as { id: string; method: string };
    expect(requestFrame.method).toBe("files.list");
    socket.emit("message", {
      data: JSON.stringify({ type: "res", id: requestFrame.id, ok: true, result: { ok: true } })
    });

    await expect(request).resolves.toEqual({ ok: true });
  });

  it("forwards events", async () => {
    const onEvent = vi.fn();
    const client = new GatewayClient({
      url: "ws://localhost",
      token: "token",
      onConnectionState: vi.fn(),
      onEvent
    });

    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.emit("open");
    const connectFrame = JSON.parse(socket.sent[0]) as { id: string };
    socket.emit("message", {
      data: JSON.stringify({ type: "res", id: connectFrame.id, ok: true, result: {} })
    });
    socket.emit("message", {
      data: JSON.stringify({ type: "evt", event: "chat", data: { sessionKey: "c1" } })
    });

    expect(onEvent).toHaveBeenCalledWith({ event: "chat", data: { sessionKey: "c1" } });
  });

  it("schedules reconnects when the socket closes unexpectedly", async () => {
    const states: string[] = [];
    const client = new GatewayClient({
      url: "ws://localhost",
      token: "token",
      onConnectionState: (state) => states.push(state),
      onEvent: vi.fn()
    });

    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.emit("close", { code: 1006, reason: "boom" });
    await vi.advanceTimersByTimeAsync(1500);

    expect(states).toContain("reconnecting");
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
  });
});
