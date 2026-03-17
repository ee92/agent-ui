/**
 * Backend adapter interface — abstracts OpenClaw gateway, Claude Code, or local-only modes.
 * All stores should use these interfaces instead of calling gateway directly.
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  thinking?: string;
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
  
  /** Subscribe to real-time updates (returns unsubscribe function) */
  subscribe?(callback: (event: SessionEvent) => void): () => void;
}

export type SessionEvent = 
  | { type: 'message'; sessionKey: string; message: Message }
  | { type: 'streaming'; sessionKey: string; isStreaming: boolean }
  | { type: 'updated'; sessionKey: string };

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
  
  /** Check if file/directory exists */
  exists(path: string): Promise<boolean>;
  
  /** Delete file or directory */
  delete(path: string): Promise<void>;
}

/**
 * Combined backend adapter
 */
export interface BackendAdapter {
  readonly type: 'openclaw' | 'claude-code' | 'local';
  readonly sessions: SessionAdapter;
  readonly files: FileAdapter;
  
  /** Initialize/connect the adapter */
  connect(): Promise<void>;
  
  /** Disconnect/cleanup */
  disconnect(): void;
  
  /** Connection state */
  isConnected(): boolean;
}
