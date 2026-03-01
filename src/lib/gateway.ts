import type { ConnectionState } from "./types";

type RequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

type ResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  result?: unknown;
  payload?: unknown;
  error?: { code?: string; message?: string };
};

type EventFrame =
  | {
      type: "evt";
      event: string;
      data?: unknown;
    }
  | {
      type: "event";
      event: string;
      payload?: unknown;
    };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutId: number;
};

export type GatewayEvent = {
  event: string;
  data: unknown;
};

export type GatewayClientOptions = {
  url: string;
  token: string;
  onConnectionState: (state: ConnectionState, detail?: string) => void;
  onEvent: (event: GatewayEvent) => void;
};

const CONNECT_PROTOCOLS = [
  { minProtocol: 3, maxProtocol: 3 }
];

export class GatewayClient {
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private protocolIndex = 0;
  private status: ConnectionState = "disconnected";

  constructor(private readonly options: GatewayClientOptions) {}

  connect() {
    this.manuallyClosed = false;
    this.openSocket();
  }

  disconnect() {
    this.manuallyClosed = true;
    this.setState("disconnected");
    this.socket?.close();
    this.socket = null;
    this.rejectAll(new Error("gateway disconnected"));
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN && this.status === "connected";
  }

  async request<T>(method: string, params?: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Gateway not connected");
    }

    const id = crypto.randomUUID();
    const frame: RequestFrame = { type: "req", id, method, params };

    return await new Promise<T>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeoutId });
      this.socket?.send(JSON.stringify(frame));
    });
  }

  private openSocket() {
    const nextState = this.reconnectAttempt > 0 ? "reconnecting" : "connecting";
    this.setState(nextState);

    try {
      this.socket = new WebSocket(this.options.url);
    } catch (error) {
      this.scheduleReconnect(String(error));
      return;
    }

    this.socket.addEventListener("open", () => {
      void this.sendConnect();
    });

    this.socket.addEventListener("message", (event) => {
      this.handleRawMessage(String(event.data ?? ""));
    });

    this.socket.addEventListener("close", (event) => {
      const reason = event.reason || `closed (${event.code})`;
      this.socket = null;
      this.rejectAll(new Error(`Gateway closed: ${reason}`));
      if (!this.manuallyClosed) {
        this.scheduleReconnect(reason);
      }
    });

    this.socket.addEventListener("error", () => {
      if (!this.manuallyClosed) {
        this.setState("reconnecting", "socket error");
      }
    });
  }

  private async sendConnect() {
    const protocol = CONNECT_PROTOCOLS[this.protocolIndex] ?? CONNECT_PROTOCOLS[0];

    try {
      await this.request("connect", {
        ...protocol,
        auth: { token: this.options.token },
        client: {
          id: "webchat-ui",
          version: "1.0.0",
          platform: "web",
          mode: "webchat"
        },
        caps: ["tool-events"],
        scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.pairing"]
      });
      this.protocolIndex = 0;
      this.reconnectAttempt = 0;
      this.setState("connected");
    } catch (error) {
      const message = String(error);
      const canFallback = this.protocolIndex < CONNECT_PROTOCOLS.length - 1;
      if (canFallback && /protocol|handshake|connect/i.test(message)) {
        this.protocolIndex += 1;
        this.socket?.close();
        return;
      }
      this.scheduleReconnect(message);
    }
  }

  private handleRawMessage(raw: string) {
    let parsed: ResponseFrame | EventFrame;

    try {
      parsed = JSON.parse(raw) as ResponseFrame | EventFrame;
    } catch {
      return;
    }

    if (parsed.type === "res") {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }

      window.clearTimeout(pending.timeoutId);
      this.pending.delete(parsed.id);

      if (parsed.ok) {
        const payload = parsed.result ?? parsed.payload ?? {};
        pending.resolve(payload as unknown);
        return;
      }

      pending.reject(new Error(parsed.error?.message ?? "Gateway request failed"));
      return;
    }

    if (parsed.type === "evt" || parsed.type === "event") {
      this.options.onEvent({
        event: parsed.event,
        data: parsed.type === "evt" ? parsed.data : parsed.payload
      });
    }
  }

  private scheduleReconnect(detail: string) {
    if (this.manuallyClosed) {
      return;
    }

    this.reconnectAttempt += 1;
    const jitter = Math.floor(Math.random() * 400);
    const base = Math.min(1_000 * 2 ** (this.reconnectAttempt - 1), 30_000);
    const delay = base + jitter;
    this.setState("reconnecting", detail);
    window.setTimeout(() => this.openSocket(), delay);
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private setState(state: ConnectionState, detail?: string) {
    this.status = state;
    this.options.onConnectionState(state, detail);
  }
}
