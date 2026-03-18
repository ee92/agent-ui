import type {
  BackendAdapter,
  CronAdapter,
  FileEntry,
  Message,
  SessionAdapter,
  SessionEvent,
  SessionInfo,
  SlashCommandSuggestion,
} from "./types";
import { HttpCronAdapter } from "./cron-http";

type ClaudeEventEnvelope = {
  type?: string;
  event?: string;
  sessionKey?: string;
  runId?: string;
  payload?: Record<string, unknown>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMessage(raw: unknown): Message {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    id: typeof source.id === "string" ? source.id : crypto.randomUUID(),
    role:
      source.role === "user" || source.role === "assistant" || source.role === "system"
        ? source.role
        : "assistant",
    content: typeof source.content === "string" ? source.content : "",
    timestamp: typeof source.timestamp === "string" ? source.timestamp : nowIso(),
    thinking: typeof source.thinking === "string" ? source.thinking : undefined,
  };
}

export class ClaudeCodeAdapter implements BackendAdapter {
  readonly type = "claude-code" as const;
  readonly sessions: SessionAdapter;
  readonly crons: CronAdapter;
  readonly files: {
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<void>;
    list: (path: string) => Promise<FileEntry[]>;
    search: (query: string) => Promise<FileEntry[]>;
    exists: (path: string) => Promise<boolean>;
    delete: (path: string) => Promise<void>;
  };

  private connected = false;
  private token = "";
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private readonly eventSubscribers = new Set<(event: SessionEvent) => void>();
  private readonly remappedSessionKeys = new Map<string, string>();

  constructor(private readonly workspace: string = ".") {
    this.sessions = {
      send: (sessionKey, message, options) => this.sendMessage(sessionKey, message, options),
      history: (sessionKey) => this.history(sessionKey),
      list: () => this.listSessions(),
      create: (key) => this.createSession(key),
      rename: (sessionKey, title) => this.renameSession(sessionKey, title),
      delete: (sessionKey) => this.deleteSession(sessionKey),
      subscribe: (callback) => this.subscribe(callback),
    };

    this.files = {
      read: (path) => this.readFile(path),
      write: (path, content) => this.writeFile(path, content),
      list: (path) => this.listFiles(path),
      search: (query) => this.searchFiles(query),
      exists: (path) => this.exists(path),
      delete: (path) => this.deletePath(path),
    };
    this.crons = new HttpCronAdapter((input, init) => this.request(input, init));
  }

  async connect(): Promise<void> {
    const res = await fetch("/api/config");
    if (!res.ok) {
      throw new Error("Failed to load API config");
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) {
      throw new Error("Missing auth token");
    }
    this.token = data.token;
    this.connected = true;
    this.ensureWs();
  }

  disconnect(): void {
    this.connected = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  capabilities() {
    return { crons: true, agents: false, realtime: true };
  }

  slashCommands(): SlashCommandSuggestion[] {
    return [
      { label: "/compact", insert: "/compact", meta: "Compact conversation" },
      { label: "/review", insert: "/review", meta: "Code review" },
      { label: "/cost", insert: "/cost", meta: "Show costs" },
      { label: "/init", insert: "/init", meta: "Initialize project" },
    ];
  }

  private async request<T>(input: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) {
      await this.connect();
    }

    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${this.token}`);
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

  private ensureWs() {
    if (!this.connected || this.ws || this.eventSubscribers.size === 0) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/claude-code/events?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", sessionKey: "*" }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      let parsed: ClaudeEventEnvelope;
      try {
        parsed = JSON.parse(event.data) as ClaudeEventEnvelope;
      } catch {
        return;
      }
      this.handleServerEvent(parsed);
    };

    ws.onclose = () => {
      this.ws = null;
      if (!this.connected || this.eventSubscribers.size === 0) {
        return;
      }
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.ensureWs();
      }, 1000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private emit(event: SessionEvent) {
    for (const callback of this.eventSubscribers) {
      callback(event);
    }
  }

  private handleServerEvent(event: ClaudeEventEnvelope) {
    if (event.type !== "event" || typeof event.event !== "string" || typeof event.sessionKey !== "string") {
      return;
    }
    if (event.event === "session.remap") {
      const fromSessionKey =
        typeof event.payload?.fromSessionKey === "string" ? event.payload.fromSessionKey : null;
      const toSessionKey = typeof event.payload?.toSessionKey === "string" ? event.payload.toSessionKey : null;
      if (fromSessionKey && toSessionKey) {
        this.remappedSessionKeys.set(toSessionKey, fromSessionKey);
        this.emit({ type: "updated", sessionKey: fromSessionKey });
      }
      return;
    }

    const mappedSessionKey = this.remappedSessionKeys.get(event.sessionKey) || event.sessionKey;

    if (event.event === "session.streaming") {
      const isStreaming = Boolean(event.payload?.isStreaming);
      this.emit({ type: "streaming", sessionKey: mappedSessionKey, isStreaming });
      return;
    }

    if (event.event === "session.delta") {
      // Delta updates the streaming message — emit as "updated" so the store
      // refreshes from the server rather than appending a duplicate message.
      // The actual content is shown via the streaming indicator / pending message.
      this.emit({ type: "updated", sessionKey: mappedSessionKey });
      return;
    }

    if (event.event === "session.message") {
      // Final message — emit once so the store picks it up
      this.emit({
        type: "message",
        sessionKey: mappedSessionKey,
        message: normalizeMessage(event.payload?.message),
      });
      return;
    }

    this.emit({ type: "updated", sessionKey: mappedSessionKey });
  }

  private subscribe(callback: (event: SessionEvent) => void): () => void {
    this.eventSubscribers.add(callback);
    this.ensureWs();
    return () => {
      this.eventSubscribers.delete(callback);
      if (this.eventSubscribers.size === 0 && this.ws) {
        this.ws.close();
      }
    };
  }

  private async sendMessage(sessionKey: string, message: string, options?: { cwd?: string }): Promise<Message> {
    const data = await this.request<{ runId: string }>(`/api/claude-code/sessions/${encodeURIComponent(sessionKey)}/messages`, {
      method: "POST",
      body: JSON.stringify({ message, cwd: options?.cwd ?? this.workspace }),
    });

    return {
      id: data.runId,
      role: "assistant",
      content: "",
      timestamp: nowIso(),
    };
  }

  private async history(sessionKey: string): Promise<Message[]> {
    const data = await this.request<{ messages?: unknown[] }>(
      `/api/claude-code/sessions/${encodeURIComponent(sessionKey)}/history`
    );
    const messages = Array.isArray(data.messages) ? data.messages : [];
    return messages.map((message) => normalizeMessage(message));
  }

  private async listSessions(): Promise<SessionInfo[]> {
    const data = await this.request<{ sessions?: unknown[] }>("/api/claude-code/sessions");
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    return sessions.map((entry) => {
      const source = entry as Record<string, unknown>;
      return {
        key: typeof source.key === "string" ? source.key : crypto.randomUUID(),
        title: typeof source.title === "string" ? source.title : "New Chat",
        preview: typeof source.preview === "string" ? source.preview : "",
        updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : nowIso(),
        createdAt: typeof source.createdAt === "string" ? source.createdAt : nowIso(),
        isStreaming: Boolean(source.isStreaming),
        runId: typeof source.runId === "string" ? source.runId : null,
      };
    });
  }

  private async createSession(key?: string): Promise<SessionInfo> {
    const data = await this.request<{ session?: SessionInfo }>("/api/claude-code/sessions", {
      method: "POST",
      body: JSON.stringify({ key }),
    });

    if (!data.session) {
      throw new Error("Missing session in create response");
    }

    return data.session;
  }

  private async renameSession(sessionKey: string, title: string): Promise<void> {
    await this.request(`/api/claude-code/sessions/${encodeURIComponent(sessionKey)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }

  private async deleteSession(sessionKey: string): Promise<void> {
    await this.request(`/api/claude-code/sessions/${encodeURIComponent(sessionKey)}`, {
      method: "DELETE",
    });
  }

  private async readFile(path: string): Promise<string> {
    const data = await this.request<{ content?: string }>(`/api/files/read?path=${encodeURIComponent(path)}`);
    return data.content ?? "";
  }

  private async writeFile(path: string, content: string): Promise<void> {
    await this.request("/api/files/write", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    });
  }

  private async listFiles(path: string): Promise<FileEntry[]> {
    const data = await this.request<{
      entries?: Array<{
        name?: unknown;
        path?: unknown;
        type?: unknown;
        size?: unknown;
        mtime?: unknown;
      }>;
    }>(`/api/files/list?path=${encodeURIComponent(path)}`);

    const entries = Array.isArray(data.entries) ? data.entries : [];
    return entries.map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "",
      path: typeof entry.path === "string" ? entry.path : "",
      isDirectory: entry.type === "directory",
      size: typeof entry.size === "number" ? entry.size : undefined,
      modifiedAt:
        typeof entry.mtime === "number"
          ? new Date(entry.mtime).toISOString()
          : typeof entry.mtime === "string"
            ? entry.mtime
            : undefined,
    }));
  }

  private async exists(path: string): Promise<boolean> {
    const data = await this.request<{ exists?: boolean }>(`/api/files/exists?path=${encodeURIComponent(path)}`);
    return Boolean(data.exists);
  }

  private async searchFiles(query: string): Promise<FileEntry[]> {
    const data = await this.request<{
      results?: Array<{
        name?: unknown;
        path?: unknown;
        type?: unknown;
        size?: unknown;
      }>;
    }>(`/api/files/search?q=${encodeURIComponent(query)}`);
    const results = Array.isArray(data.results) ? data.results : [];
    return results.map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "",
      path: typeof entry.path === "string" ? entry.path : "",
      isDirectory: entry.type === "directory",
      size: typeof entry.size === "number" ? entry.size : undefined,
    }));
  }

  private async deletePath(path: string): Promise<void> {
    await this.request("/api/files/delete", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  }
}
