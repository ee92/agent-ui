import type {
  BackendAdapter,
  CronAdapter,
  FileEntry,
  Message,
  SessionAdapter,
  SessionInfo,
} from "./types";
import { HttpCronAdapter } from "./cron-http";

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

export class CodexAdapter implements BackendAdapter {
  readonly type = "codex" as const;
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

  constructor(private readonly workspace: string = ".") {
    this.sessions = {
      send: () => Promise.reject(new Error("Codex sessions are read-only")),
      history: (sessionKey) => this.history(sessionKey),
      list: () => this.listSessions(),
      create: () => Promise.reject(new Error("Codex sessions are read-only")),
      rename: () => Promise.reject(new Error("Codex sessions are read-only")),
      delete: () => Promise.reject(new Error("Codex sessions are read-only")),
    };

    this.files = {
      read: (path) => this.readFile(path),
      write: (path, content) => this.writeFile(path, content),
      list: (path) => this.listFiles(path),
      search: (query) => this.searchFiles(query),
      exists: (path) => this.fileExists(path),
      delete: (path) => this.deletePath(path),
    };

    this.crons = new HttpCronAdapter((input, init) => this.request(input, init));
  }

  async connect(): Promise<void> {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Failed to load API config");
    const data = (await res.json()) as { token?: string };
    this.token = data.token || "";
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  capabilities() {
    return { crons: true, agents: false, realtime: false };
  }

  private async request<T>(input: string, init: RequestInit = {}): Promise<T> {
    if (!this.connected) await this.connect();
    const headers = new Headers(init.headers || {});
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(input, { ...init, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed: ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async listSessions(): Promise<SessionInfo[]> {
    const data = await this.request<{ sessions?: unknown[] }>("/api/codex/sessions");
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    return sessions.map((entry) => {
      const source = entry as Record<string, unknown>;
      return {
        key: typeof source.key === "string" ? source.key : crypto.randomUUID(),
        title: typeof source.title === "string" ? source.title : "New Chat",
        preview: typeof source.preview === "string" ? source.preview : "",
        updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : nowIso(),
        createdAt: typeof source.createdAt === "string" ? source.createdAt : nowIso(),
        isStreaming: false,
        runId: null,
      };
    });
  }

  private async history(sessionKey: string): Promise<Message[]> {
    const data = await this.request<{ messages?: unknown[] }>(
      `/api/codex/sessions/${encodeURIComponent(sessionKey)}/history`
    );
    const messages = Array.isArray(data.messages) ? data.messages : [];
    return messages.map((message) => normalizeMessage(message));
  }

  // File operations — same endpoints as claude-code adapter
  private async readFile(path: string): Promise<string> {
    const data = await this.request<{ content?: string }>(`/api/files/read?path=${encodeURIComponent(path)}`);
    return data.content ?? "";
  }

  private async writeFile(path: string, content: string): Promise<void> {
    await this.request("/api/files/write", { method: "POST", body: JSON.stringify({ path, content }) });
  }

  private async listFiles(path: string): Promise<FileEntry[]> {
    const data = await this.request<{
      entries?: Array<{ name?: unknown; path?: unknown; type?: unknown; size?: unknown; mtime?: unknown }>;
    }>(`/api/files/list?path=${encodeURIComponent(path)}`);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return entries.map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "",
      path: typeof entry.path === "string" ? entry.path : "",
      isDirectory: entry.type === "directory",
      size: typeof entry.size === "number" ? entry.size : undefined,
      modifiedAt:
        typeof entry.mtime === "number" ? new Date(entry.mtime).toISOString()
        : typeof entry.mtime === "string" ? entry.mtime
        : undefined,
    }));
  }

  private async fileExists(path: string): Promise<boolean> {
    const data = await this.request<{ exists?: boolean }>(`/api/files/exists?path=${encodeURIComponent(path)}`);
    return Boolean(data.exists);
  }

  private async searchFiles(query: string): Promise<FileEntry[]> {
    const data = await this.request<{
      results?: Array<{ name?: unknown; path?: unknown; type?: unknown; size?: unknown }>;
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
    await this.request("/api/files/delete", { method: "POST", body: JSON.stringify({ path }) });
  }
}
