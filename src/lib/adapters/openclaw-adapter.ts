import { GatewayClient } from "../gateway";
import { useGatewayStore } from "../stores/gateway-store";
import { fetchServerToken, messageTextFromUnknown, normalizeTime } from "../stores/shared";
import { HttpCronAdapter } from "./cron-http";
import type {
  BackendAdapter,
  CronAdapter,
  CronJob,
  CronRunEntry,
  FileEntry,
  Message,
  SessionAdapter,
  SessionEvent,
  SessionInfo,
  SlashCommandSuggestion,
} from "./types";

function normalizeSessionKey(key: string): string {
  return key.replace(/^agent:[^:]+:/, "");
}

function toMessage(value: unknown): Message | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "assistant";
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return null;
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(),
    role,
    content: messageTextFromUnknown(record),
    timestamp: normalizeTime(
      (record.createdAt as string | number | null | undefined) ??
        (record.timestamp as string | number | null | undefined)
    ),
    thinking: typeof record.thinking === "string" ? record.thinking : undefined,
  };
}

function toSessionInfo(value: unknown): SessionInfo | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const key = typeof record.key === "string" ? normalizeSessionKey(record.key) : "";
  if (!key) {
    return null;
  }
  const label =
    typeof record.label === "string"
      ? record.label
      : typeof record.title === "string"
        ? record.title
        : typeof record.displayName === "string"
          ? record.displayName
          : "Untitled conversation";
  const lastMessagePreview =
    typeof record.lastMessagePreview === "string" ? record.lastMessagePreview : messageTextFromUnknown(record.lastMessage);

  return {
    key,
    title: label,
    preview: lastMessagePreview.slice(0, 140),
    updatedAt: normalizeTime(record.updatedAt as string | number | null | undefined),
    createdAt: normalizeTime(
      (record.createdAt as string | number | null | undefined) ??
        (record.updatedAt as string | number | null | undefined)
    ),
    isStreaming: Boolean(record.activeRunId),
    runId: typeof record.activeRunId === "string" ? record.activeRunId : null,
  };
}

class OpenClawSessionAdapter implements SessionAdapter {
  async send(sessionKey: string, message: string): Promise<Message> {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) {
      throw new Error("Gateway not connected");
    }
    const result = await client.request<{ runId?: string }>("chat.send", {
      sessionKey,
      message,
      thinking: "low",
      timeoutMs: 300000,
    });
    return {
      id: result.runId ?? crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };
  }

  async history(sessionKey: string): Promise<Message[]> {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) {
      return [];
    }
    const response = await client.request<{ messages?: unknown[] }>("chat.history", {
      sessionKey,
      limit: 200,
    });
    const messages = Array.isArray(response.messages) ? response.messages : [];
    return messages.flatMap((value) => {
      const message = toMessage(value);
      return message ? [message] : [];
    });
  }

  async list(): Promise<SessionInfo[]> {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) {
      return [];
    }
    const response = await client.request<{ sessions?: unknown[] }>("sessions.list", {
      limit: 50,
      includeDerivedTitles: true,
      includeLastMessage: true,
    });
    const sessions = Array.isArray(response.sessions) ? response.sessions : [];
    return sessions.flatMap((value) => {
      const session = toSessionInfo(value);
      return session ? [session] : [];
    });
  }

  async create(key?: string): Promise<SessionInfo> {
    const rawKey = key || `web-${crypto.randomUUID().slice(0, 8)}`;
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) {
      const now = new Date().toISOString();
      return {
        key: rawKey,
        title: "New Chat",
        preview: "",
        updatedAt: now,
        createdAt: now,
        isStreaming: false,
        runId: null,
      };
    }
    const response = await client.request<{ key?: string; entry?: { label?: string } }>("sessions.patch", {
      key: rawKey,
      label: "New Chat",
    });
    const now = new Date().toISOString();
    return {
      key: normalizeSessionKey((typeof response.key === "string" && response.key) || rawKey),
      title: response.entry?.label || "New Chat",
      preview: "",
      updatedAt: now,
      createdAt: now,
      isStreaming: false,
      runId: null,
    };
  }

  async rename(sessionKey: string, title: string): Promise<void> {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) {
      return;
    }
    await client.request("sessions.patch", { key: sessionKey, label: title });
  }

  async delete(sessionKey: string): Promise<void> {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) {
      return;
    }
    await client.request("sessions.delete", { key: sessionKey });
  }

  subscribe(callback: (event: SessionEvent) => void): () => void {
    return useGatewayStore.subscribe(
      (nextState, previousState) => {
        const event = nextState.lastGatewayEvent;
        if (event === previousState.lastGatewayEvent) {
          return;
        }
        if (!event || event.event !== "chat" || !event.data || typeof event.data !== "object") {
          return;
        }
        const payload = event.data as Record<string, unknown>;
        const key = typeof payload.sessionKey === "string" ? normalizeSessionKey(payload.sessionKey) : null;
        const chatState = typeof payload.state === "string" ? payload.state : null;
        if (!key || !chatState) {
          return;
        }
        if (chatState === "delta") {
          callback({ type: "streaming", sessionKey: key, isStreaming: true });
          callback({
            type: "message",
            sessionKey: key,
            message: {
              id: typeof payload.runId === "string" ? payload.runId : crypto.randomUUID(),
              role: "assistant",
              content: messageTextFromUnknown((payload.message as Record<string, unknown> | undefined) ?? payload),
              timestamp: new Date().toISOString(),
            },
          });
        }
        if (chatState === "final") {
          callback({
            type: "message",
            sessionKey: key,
            message: {
              id: typeof payload.runId === "string" ? payload.runId : crypto.randomUUID(),
              role: "assistant",
              content: messageTextFromUnknown((payload.message as Record<string, unknown> | undefined) ?? payload),
              timestamp: new Date().toISOString(),
            },
          });
          callback({ type: "streaming", sessionKey: key, isStreaming: false });
        }
        if (chatState === "error" || chatState === "aborted") {
          callback({ type: "streaming", sessionKey: key, isStreaming: false });
        }
      }
    );
  }
}

class OpenClawFileAdapter {
  private async authHeaders(): Promise<Record<string, string>> {
    const token = useGatewayStore.getState().gatewayToken;
    return { Authorization: `Bearer ${token}` };
  }

  async read(path: string): Promise<string> {
    const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to read file: ${path}`);
    }
    const data = (await res.json()) as { content?: string };
    return data.content ?? "";
  }

  async write(path: string, content: string): Promise<void> {
    const res = await fetch("/api/files/write", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await this.authHeaders()),
      },
      body: JSON.stringify({ path, content }),
    });
    if (!res.ok) {
      throw new Error(`Failed to write file: ${path}`);
    }
  }

  async list(path: string): Promise<FileEntry[]> {
    const res = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to list files: ${path}`);
    }
    const data = (await res.json()) as {
      entries?: Array<{
        path: string;
        name: string;
        type: string;
        size?: number;
        mtime?: number | string;
      }>;
    };
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return entries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      isDirectory: entry.type === "directory",
      size: entry.size,
      modifiedAt:
        typeof entry.mtime === "number"
          ? new Date(entry.mtime).toISOString()
          : typeof entry.mtime === "string"
            ? entry.mtime
            : undefined,
    }));
  }

  async search(query: string): Promise<FileEntry[]> {
    const res = await fetch(`/api/files/search?q=${encodeURIComponent(query)}`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to search files: ${query}`);
    }
    const data = (await res.json()) as {
      results?: Array<{ path?: string; name?: string; type?: string; size?: number }>;
    };
    const results = Array.isArray(data.results) ? data.results : [];
    return results.map((entry) => ({
      path: typeof entry.path === "string" ? entry.path : "",
      name: typeof entry.name === "string" ? entry.name : "",
      isDirectory: entry.type === "directory",
      size: typeof entry.size === "number" ? entry.size : undefined,
    }));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.read(path);
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    const res = await fetch("/api/files/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await this.authHeaders()),
      },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      throw new Error(`Failed to delete file: ${path}`);
    }
  }
}

class OpenClawCronAdapter implements CronAdapter {
  private readonly fallback = new HttpCronAdapter((input, init) => this.request(input, init));

  private get client() {
    const client = useGatewayStore.getState().gatewayClient;
    if (!client || !client.isConnected()) {
      return null;
    }
    return client;
  }

  private async request<T>(input: string, init: RequestInit = {}): Promise<T> {
    let token = useGatewayStore.getState().gatewayToken;
    if (!token || token === "openclaw") {
      const serverToken = await fetchServerToken();
      if (serverToken) {
        token = serverToken;
      }
    }

    const headers = new Headers(init.headers || {});
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(input, { ...init, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed: ${res.status}`);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  async list(): Promise<CronJob[]> {
    const client = this.client;
    if (!client) {
      return this.fallback.list();
    }
    const response = await client.request<{ jobs?: CronJob[] }>("cron.list", {
      includeDisabled: true,
      limit: 100,
      sortBy: "nextRunAtMs",
      sortDir: "asc",
    });
    return Array.isArray(response.jobs) ? response.jobs : [];
  }

  async runs(jobId?: string): Promise<CronRunEntry[]> {
    const client = this.client;
    if (!client) {
      return this.fallback.runs(jobId);
    }
    const params: Record<string, unknown> = { limit: 50, sortDir: "desc" };
    if (jobId) {
      params.jobId = jobId;
      params.scope = "job";
    }
    const response = await client.request<{ runs?: CronRunEntry[] }>("cron.runs", params);
    return Array.isArray(response.runs) ? response.runs : [];
  }

  async update(id: string, patch: Record<string, unknown>): Promise<void> {
    const client = this.client;
    if (!client) {
      await this.fallback.update(id, patch);
      return;
    }
    await client.request("cron.update", { id, patch });
  }

  async remove(id: string): Promise<void> {
    const client = this.client;
    if (!client) {
      await this.fallback.remove(id);
      return;
    }
    await client.request("cron.remove", { id });
  }

  async run(id: string): Promise<void> {
    const client = this.client;
    if (!client) {
      await this.fallback.run(id);
      return;
    }
    await client.request("cron.run", { id, mode: "force" });
  }
}

export class OpenClawAdapter implements BackendAdapter {
  readonly type = "openclaw" as const;
  readonly sessions = new OpenClawSessionAdapter();
  readonly files = new OpenClawFileAdapter();
  readonly crons = new OpenClawCronAdapter();

  constructor(
    private readonly gatewayUrl: string,
    private readonly gatewayToken: string
  ) {}

  async connect(): Promise<void> {
    const gateway = useGatewayStore.getState();
    let token = this.gatewayToken;
    // Auto-fetch server token if using default
    if (token === "openclaw" || !token) {
      const serverToken = await fetchServerToken();
      if (serverToken) {
        token = serverToken;
      }
    }
    gateway.setGatewayConfig(this.gatewayUrl, token);
    await gateway.connect();
    
    // Wait for WebSocket to actually connect (up to 5s)
    const maxWait = 5000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (this.isConnected()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  disconnect(): void {
    useGatewayStore.getState().disconnect();
  }

  isConnected(): boolean {
    return useGatewayStore.getState().gatewayClient?.isConnected() ?? false;
  }

  capabilities() {
    return { crons: true, agents: true, realtime: true };
  }

  slashCommands(): SlashCommandSuggestion[] {
    return [
      { label: "/tasks", insert: "/tasks", meta: "Show task board" },
      { label: "/status", insert: "/status", meta: "System status" },
      { label: "/cron", insert: "/cron", meta: "Cron jobs" },
      { label: "/repos", insert: "/repos", meta: "Repository overview" },
      { label: "/search", insert: "/search ", meta: "Search transcripts" },
      { label: "/cost", insert: "/cost", meta: "Usage and cost summary" },
    ];
  }
}

export function createGatewayClientAdapter(client: GatewayClient): BackendAdapter {
  // Maintains backwards compatibility if tests inject a client directly.
  useGatewayStore.setState({ gatewayClient: client, connectionState: "connected" });
  const state = useGatewayStore.getState();
  return new OpenClawAdapter(state.gatewayUrl, state.gatewayToken);
}
