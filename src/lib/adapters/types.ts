/**
 * Backend adapter interface — wraps Claude Code, Codex, or local-only modes
 * behind a uniform session/file/cron surface. In practice the event
 * vocabulary (`session.*`) is driven by Claude Code; other adapters
 * synthesize the shape they need.
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  thinking?: string;
  /**
   * Structured content parts. When present (Claude Code history path), the
   * store uses these directly so tool_use / thinking blocks render as cards
   * rather than being collapsed into the flat `content` string.
   */
  parts?: import('../types').MessageContentPart[];
}

export interface SessionInfo {
  key: string;
  title: string;
  preview: string;
  updatedAt: string;
  createdAt: string;
  isStreaming: boolean;
  runId: string | null;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

export type SlashCommandSuggestion = {
  label: string;
  insert: string;
  meta: string;
};

/**
 * Session adapter — handles chat/agent communication
 */
export interface SessionAdapter {
  /** Send a message to a session, returns the response */
  send(sessionKey: string, message: string, options?: { cwd?: string }): Promise<Message>;

  /** Get message history for a session */
  history(sessionKey: string): Promise<Message[]>;

  /** List all sessions */
  list(): Promise<SessionInfo[]>;

  /** Create a new session */
  create(key?: string): Promise<SessionInfo>;

  /** Rename a session */
  rename(sessionKey: string, title: string): Promise<void>;

  /** Delete a session */
  delete(sessionKey: string): Promise<void>;

  /** Cancel an in-flight run */
  cancelRun?(runId: string): Promise<void>;

  /** Subscribe to real-time updates (returns unsubscribe function) */
  subscribe?(callback: (event: SessionEvent) => void): () => void;
}

export type SessionEvent =
  | { type: 'streaming'; sessionKey: string; isStreaming: boolean }
  | { type: 'updated'; sessionKey: string }
  | { type: 'remap'; fromSessionKey: string; toSessionKey: string }
  | { type: 'raw'; sessionKey: string; event: string; runId?: string | null; payload: Record<string, unknown> };

/**
 * File adapter — handles workspace file operations
 */
export interface FileAdapter {
  /** Read file contents */
  read(path: string): Promise<string>;
  
  /** Write file contents */
  write(path: string, content: string): Promise<void>;
  
  /** List directory contents */
  list(path: string): Promise<FileEntry[]>;

  /** Search files by name/path */
  search?(query: string): Promise<FileEntry[]>;
  
  /** Check if file/directory exists */
  exists(path: string): Promise<boolean>;
  
  /** Delete file or directory */
  delete(path: string): Promise<void>;
}

/**
 * Combined backend adapter
 */
export interface BackendAdapter {
  readonly type: 'claude-code' | 'codex' | 'local';
  readonly sessions: SessionAdapter;
  readonly files: FileAdapter;
  readonly crons?: CronAdapter;
  
  /** Initialize/connect the adapter */
  connect(): Promise<void>;
  
  /** Disconnect/cleanup */
  disconnect(): void;
  
  /** Connection state */
  isConnected(): boolean;

  /** Runtime feature flags supported by this backend */
  capabilities(): { crons: boolean; agents: boolean; realtime: boolean };

  /** Optional command suggestions used by the chat composer */
  slashCommands?(): SlashCommandSuggestion[];
}

export type CronJob = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: "at"; at: string } | { kind: "every"; everyMs: number; anchorMs?: number } | { kind: "cron"; expr: string; tz?: string; staggerMs?: number };
  sessionTarget: "main" | "isolated";
  wakeMode: "next-heartbeat" | "now";
  payload:
    | { kind: "systemEvent"; text: string }
    | { kind: "agentTurn"; message: string; model?: string; thinking?: string; deliver?: boolean; channel?: string; to?: string };
  delivery?: { mode: "none" | "announce" | "webhook"; channel?: string; to?: string; bestEffort?: boolean };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: "ok" | "error" | "skipped";
    lastError?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
  };
  sessionKey?: string;
  agentId?: string;
};

export type CronRunEntry = {
  ts: number;
  jobId: string;
  status?: string;
  error?: string;
  summary?: string;
  durationMs?: number;
  nextRunAtMs?: number;
  jobName?: string;
};

export interface CronAdapter {
  list(): Promise<CronJob[]>;
  runs(jobId?: string): Promise<CronRunEntry[]>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  remove(id: string): Promise<void>;
  run(id: string): Promise<void>;
}
