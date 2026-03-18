import type { BackendAdapter, FileEntry, Message, SessionAdapter, SessionInfo } from "./types";

type NodeFsPromises = {
  readdir: (path: string, options?: unknown) => Promise<unknown[]>;
  readFile: (path: string, encoding: string) => Promise<string>;
  writeFile: (path: string, content: string, encoding?: string) => Promise<void>;
  rm: (path: string, options?: unknown) => Promise<void>;
  stat: (path: string) => Promise<{ size: number; mtime: Date; isDirectory: () => boolean }>;
  mkdir: (path: string, options?: unknown) => Promise<void>;
};

const LOCAL_FILES_PREFIX = "openclaw-ui-local-file:";

async function dynamicNodeImport(moduleName: string): Promise<any> {
  const importer = new Function("name", "return import(name)") as (name: string) => Promise<any>;
  return importer(moduleName);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

class LocalSessionAdapter implements SessionAdapter {
  private readonly sessions = new Map<string, SessionInfo>();
  private readonly messagesBySession = new Map<string, Message[]>();

  async send(sessionKey: string, message: string): Promise<Message> {
    if (!this.sessions.has(sessionKey)) {
      await this.create(sessionKey);
    }
    const list = this.messagesBySession.get(sessionKey) ?? [];
    const user: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: nowIso(),
    };
    const assistant: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "Local adapter: no agent connected.",
      timestamp: nowIso(),
    };
    this.messagesBySession.set(sessionKey, [...list, user, assistant]);

    const session = this.sessions.get(sessionKey);
    if (session) {
      this.sessions.set(sessionKey, {
        ...session,
        preview: assistant.content,
        updatedAt: assistant.timestamp,
      });
    }
    return assistant;
  }

  async history(sessionKey: string): Promise<Message[]> {
    return this.messagesBySession.get(sessionKey) ?? [];
  }

  async list(): Promise<SessionInfo[]> {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(key?: string): Promise<SessionInfo> {
    const sessionKey = key || `local-${crypto.randomUUID().slice(0, 8)}`;
    const now = nowIso();
    const session: SessionInfo = {
      key: sessionKey,
      title: "Local Session",
      preview: "",
      updatedAt: now,
      createdAt: now,
      isStreaming: false,
      runId: null,
    };
    this.sessions.set(sessionKey, session);
    if (!this.messagesBySession.has(sessionKey)) {
      this.messagesBySession.set(sessionKey, []);
    }
    return session;
  }

  async rename(sessionKey: string, title: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return;
    }
    this.sessions.set(sessionKey, { ...session, title, updatedAt: nowIso() });
  }

  async delete(sessionKey: string): Promise<void> {
    this.sessions.delete(sessionKey);
    this.messagesBySession.delete(sessionKey);
  }
}

class LocalFileAdapter {
  constructor(private readonly workspace: string) {}

  private resolvePath(path: string): string {
    if (!path) {
      return this.workspace;
    }
    if (path.startsWith("/")) {
      return path;
    }
    const base = this.workspace.endsWith("/") ? this.workspace.slice(0, -1) : this.workspace;
    return `${base}/${path}`.replace(/\/\/+/, "/");
  }

  async read(path: string): Promise<string> {
    if (isBrowser()) {
      return localStorage.getItem(`${LOCAL_FILES_PREFIX}${path}`) ?? "";
    }
    const fs = (await dynamicNodeImport("node:fs/promises")) as NodeFsPromises;
    return fs.readFile(this.resolvePath(path), "utf-8");
  }

  async write(path: string, content: string): Promise<void> {
    if (isBrowser()) {
      localStorage.setItem(`${LOCAL_FILES_PREFIX}${path}`, content);
      return;
    }
    const fs = (await dynamicNodeImport("node:fs/promises")) as NodeFsPromises;
    const pathModule = (await dynamicNodeImport("node:path")) as { dirname: (value: string) => string };
    const resolved = this.resolvePath(path);
    await fs.mkdir(pathModule.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
  }

  async list(path: string): Promise<FileEntry[]> {
    if (isBrowser()) {
      const prefix = `${LOCAL_FILES_PREFIX}${path ? `${path.replace(/\/$/, "")}/` : ""}`;
      const entries: FileEntry[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || !key.startsWith(prefix)) {
          continue;
        }
        const relative = key.slice(LOCAL_FILES_PREFIX.length);
        if (relative.includes("/")) {
          continue;
        }
        entries.push({
          name: relative,
          path: relative,
          isDirectory: false,
          size: (localStorage.getItem(key) ?? "").length,
        });
      }
      return entries;
    }

    const fs = (await dynamicNodeImport("node:fs/promises")) as NodeFsPromises;
    const pathModule = (await dynamicNodeImport("node:path")) as {
      basename: (value: string) => string;
      join: (...parts: string[]) => string;
    };
    const targetPath = this.resolvePath(path);
    const entries = (await fs.readdir(targetPath, { withFileTypes: true })) as Array<{
      name: string;
      isDirectory: () => boolean;
    }>;

    const output: FileEntry[] = [];
    for (const entry of entries) {
      const fullPath = pathModule.join(targetPath, entry.name);
      let size: number | undefined;
      let modifiedAt: string | undefined;
      try {
        const stats = await fs.stat(fullPath);
        size = stats.size;
        modifiedAt = stats.mtime.toISOString();
      } catch {
        // Keep partial metadata.
      }
      output.push({
        name: entry.name,
        path: path ? `${path.replace(/\/$/, "")}/${entry.name}` : entry.name,
        isDirectory: entry.isDirectory(),
        size,
        modifiedAt,
      });
    }
    return output.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
  }

  async exists(path: string): Promise<boolean> {
    if (isBrowser()) {
      return localStorage.getItem(`${LOCAL_FILES_PREFIX}${path}`) !== null;
    }
    const fs = (await dynamicNodeImport("node:fs/promises")) as NodeFsPromises;
    try {
      await fs.stat(this.resolvePath(path));
      return true;
    } catch {
      return false;
    }
  }

  async search(query: string): Promise<FileEntry[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }
    const baseEntries = await this.list("");
    return baseEntries.filter((entry) => entry.name.toLowerCase().includes(normalized));
  }

  async delete(path: string): Promise<void> {
    if (isBrowser()) {
      localStorage.removeItem(`${LOCAL_FILES_PREFIX}${path}`);
      return;
    }
    const fs = (await dynamicNodeImport("node:fs/promises")) as NodeFsPromises;
    await fs.rm(this.resolvePath(path), { recursive: true, force: true });
  }
}

export class LocalAdapter implements BackendAdapter {
  readonly type = "local" as const;
  readonly sessions = new LocalSessionAdapter();
  readonly files: {
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<void>;
    list: (path: string) => Promise<FileEntry[]>;
    search: (query: string) => Promise<FileEntry[]>;
    exists: (path: string) => Promise<boolean>;
    delete: (path: string) => Promise<void>;
  };

  private connected = false;

  constructor(workspace: string = ".") {
    const files = new LocalFileAdapter(workspace);
    this.files = {
      read: (path) => files.read(path),
      write: (path, content) => files.write(path, content),
      list: (path) => files.list(path),
      search: (query) => files.search(query),
      exists: (path) => files.exists(path),
      delete: (path) => files.delete(path),
    };
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  capabilities() {
    return { crons: false, agents: false, realtime: false };
  }
}
