import type { BackendAdapter, FileEntry, Message, SessionAdapter, SessionInfo } from "./types";

type NodeFsPromises = {
  readdir: (path: string, options?: unknown) => Promise<unknown[]>;
  readFile: (path: string, encoding: string) => Promise<string>;
  writeFile: (path: string, content: string, encoding?: string) => Promise<void>;
  rm: (path: string, options?: unknown) => Promise<void>;
  stat: (path: string) => Promise<{ size: number; mtime: Date; isDirectory: () => boolean }>;
  mkdir: (path: string, options?: unknown) => Promise<void>;
};

type ExecFileFn = (
  file: string,
  args: string[],
  options: { cwd?: string; timeout?: number; maxBuffer?: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void;

const CLAUDE_SESSIONS_KEY = "openclaw-ui-claude-sessions";

async function dynamicNodeImport(moduleName: string): Promise<any> {
  const importer = new Function("name", "return import(name)") as (name: string) => Promise<any>;
  return importer(moduleName);
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseClaudeStdout(stdout: string): { content: string; thinking?: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { content: "" };
  }

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as Record<string, unknown>;
      const content =
        typeof parsed.content === "string"
          ? parsed.content
          : typeof parsed.response === "string"
            ? parsed.response
            : typeof parsed.text === "string"
              ? parsed.text
              : "";
      if (content) {
        return {
          content,
          thinking: typeof parsed.thinking === "string" ? parsed.thinking : undefined,
        };
      }
    } catch {
      // Continue looking for valid JSON lines.
    }
  }

  return { content: trimmed };
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export class ClaudeCodeAdapter implements BackendAdapter {
  readonly type = "claude-code" as const;
  readonly sessions: SessionAdapter;
  readonly files: {
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<void>;
    list: (path: string) => Promise<FileEntry[]>;
    exists: (path: string) => Promise<boolean>;
    delete: (path: string) => Promise<void>;
  };

  private connected = false;
  private readonly messagesBySession: Record<string, Message[]> = {};

  constructor(private readonly workspace: string = ".") {
    this.sessions = {
      send: (sessionKey, message, options) => this.sendMessage(sessionKey, message, options),
      history: (sessionKey) => this.history(sessionKey),
      list: () => this.listSessions(),
      create: (key) => this.createSession(key),
      rename: (sessionKey, title) => this.renameSession(sessionKey, title),
      delete: (sessionKey) => this.deleteSession(sessionKey),
    };

    this.files = {
      read: (path) => this.readFile(path),
      write: (path, content) => this.writeFile(path, content),
      list: (path) => this.listFiles(path),
      exists: (path) => this.exists(path),
      delete: (path) => this.deletePath(path),
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

  private loadSessionTitles(): Record<string, string> {
    if (isBrowser()) {
      return safeParse<Record<string, string>>(localStorage.getItem(CLAUDE_SESSIONS_KEY), {});
    }
    return {};
  }

  private saveSessionTitles(entries: Record<string, string>) {
    if (isBrowser()) {
      localStorage.setItem(CLAUDE_SESSIONS_KEY, JSON.stringify(entries));
    }
  }

  private async sendMessage(sessionKey: string, message: string, options?: { cwd?: string }): Promise<Message> {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: nowIso(),
    };
    this.messagesBySession[sessionKey] = [...(this.messagesBySession[sessionKey] ?? []), userMessage];

    if (isBrowser()) {
      const browserReply: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Claude Code adapter is unavailable in browser runtime.",
        timestamp: nowIso(),
      };
      this.messagesBySession[sessionKey] = [...(this.messagesBySession[sessionKey] ?? []), browserReply];
      return browserReply;
    }

    const childProcess = (await dynamicNodeImport("node:child_process")) as { execFile: ExecFileFn };
    const args = ["--session", sessionKey, "--print", "--output-format", "json", message];
    const cwd = options?.cwd ?? this.workspace;

    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      childProcess.execFile(
        "claude",
        args,
        { cwd, timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdOut, stdErr) => {
          if (error) {
            reject(new Error(stdErr || error.message || "Failed to run claude CLI"));
            return;
          }
          resolve({ stdout: stdOut, stderr: stdErr });
        }
      );
    });

    if (stderr.trim()) {
      // Keep stderr as metadata in thinking for visibility without failing successful runs.
    }

    const parsed = parseClaudeStdout(stdout);
    const reply: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: parsed.content,
      timestamp: nowIso(),
      thinking: parsed.thinking,
    };
    this.messagesBySession[sessionKey] = [...(this.messagesBySession[sessionKey] ?? []), reply];
    return reply;
  }

  private async history(sessionKey: string): Promise<Message[]> {
    const cached = this.messagesBySession[sessionKey] ?? [];
    if (isBrowser()) {
      return cached;
    }

    try {
      const os = (await dynamicNodeImport("node:os")) as { homedir: () => string };
      const pathModule = (await dynamicNodeImport("node:path")) as { join: (...parts: string[]) => string };
      const fs = (await dynamicNodeImport("node:fs/promises")) as NodeFsPromises;
      const sessionDir = pathModule.join(os.homedir(), ".claude", "sessions", sessionKey);
      const files = (await fs.readdir(sessionDir)) as string[];

      const historyFiles = files
        .filter((name) => name.endsWith(".jsonl") || name.endsWith(".json"))
        .sort((a, b) => a.localeCompare(b));

      const loaded: Message[] = [];
      for (const fileName of historyFiles) {
        const fullPath = pathModule.join(sessionDir, fileName);
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const role = parsed.role;
            if (role !== "user" && role !== "assistant" && role !== "system") {
              continue;
            }
            const text =
              typeof parsed.content === "string"
                ? parsed.content
                : typeof parsed.text === "string"
                  ? parsed.text
                  : "";
            loaded.push({
              id: typeof parsed.id === "string" ? parsed.id : crypto.randomUUID(),
              role,
              content: text,
              timestamp:
                typeof parsed.timestamp === "string"
                  ? parsed.timestamp
                  : typeof parsed.createdAt === "string"
                    ? parsed.createdAt
                    : nowIso(),
              thinking: typeof parsed.thinking === "string" ? parsed.thinking : undefined,
            });
          } catch {
            // Ignore malformed history lines.
          }
        }
      }

      this.messagesBySession[sessionKey] = loaded.length > 0 ? loaded : cached;
      return this.messagesBySession[sessionKey] ?? [];
    } catch {
      return cached;
    }
  }

  private async listSessions(): Promise<SessionInfo[]> {
    const titles = this.loadSessionTitles();
    const keys = new Set<string>(Object.keys(titles));
    for (const key of Object.keys(this.messagesBySession)) {
      keys.add(key);
    }
    return [...keys].map((key) => {
      const messages = this.messagesBySession[key] ?? [];
      const last = messages[messages.length - 1];
      return {
        key,
        title: titles[key] || key,
        preview: last?.content?.slice(0, 140) ?? "",
        updatedAt: last?.timestamp ?? nowIso(),
        createdAt: messages[0]?.timestamp ?? nowIso(),
        isStreaming: false,
        runId: null,
      };
    });
  }

  private async createSession(key?: string): Promise<SessionInfo> {
    const sessionKey = key || `claude-${crypto.randomUUID().slice(0, 8)}`;
    const titles = this.loadSessionTitles();
    titles[sessionKey] = "New Chat";
    this.saveSessionTitles(titles);
    if (!this.messagesBySession[sessionKey]) {
      this.messagesBySession[sessionKey] = [];
    }
    const now = nowIso();
    return {
      key: sessionKey,
      title: "New Chat",
      preview: "",
      updatedAt: now,
      createdAt: now,
      isStreaming: false,
      runId: null,
    };
  }

  private async renameSession(sessionKey: string, title: string): Promise<void> {
    const titles = this.loadSessionTitles();
    titles[sessionKey] = title;
    this.saveSessionTitles(titles);
  }

  private async deleteSession(sessionKey: string): Promise<void> {
    delete this.messagesBySession[sessionKey];
    const titles = this.loadSessionTitles();
    delete titles[sessionKey];
    this.saveSessionTitles(titles);
  }

  private async readFile(path: string): Promise<string> {
    if (isBrowser()) {
      const key = `claude-file:${path}`;
      return localStorage.getItem(key) ?? "";
    }
    const fs = (await dynamicNodeImport("node:fs/promises")) as NodeFsPromises;
    return fs.readFile(this.resolvePath(path), "utf-8");
  }

  private async writeFile(path: string, content: string): Promise<void> {
    if (isBrowser()) {
      localStorage.setItem(`claude-file:${path}`, content);
      return;
    }
    const fs = (await dynamicNodeImport("node:fs/promises")) as NodeFsPromises;
    const pathModule = (await dynamicNodeImport("node:path")) as { dirname: (value: string) => string };
    const resolved = this.resolvePath(path);
    await fs.mkdir(pathModule.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
  }

  private async listFiles(path: string): Promise<FileEntry[]> {
    if (isBrowser()) {
      return [];
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

  private async exists(path: string): Promise<boolean> {
    if (isBrowser()) {
      return localStorage.getItem(`claude-file:${path}`) !== null;
    }
    const fs = (await dynamicNodeImport("node:fs/promises")) as NodeFsPromises;
    try {
      await fs.stat(this.resolvePath(path));
      return true;
    } catch {
      return false;
    }
  }

  private async deletePath(path: string): Promise<void> {
    if (isBrowser()) {
      localStorage.removeItem(`claude-file:${path}`);
      return;
    }
    const fs = (await dynamicNodeImport("node:fs/promises")) as NodeFsPromises;
    await fs.rm(this.resolvePath(path), { recursive: true, force: true });
  }
}
