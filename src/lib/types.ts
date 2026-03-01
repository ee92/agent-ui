export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export type MessageRole = "user" | "assistant" | "system";

export type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image"; url: string; alt: string }
  | { type: "attachment"; name: string; mimeType: string };

export type ChatMessage = {
  id: string;
  role: MessageRole;
  parts: MessageContentPart[];
  createdAt: string;
  pending?: boolean;
  error?: string | null;
  hidden?: boolean;
  runId?: string | null;
};

export type Conversation = {
  key: string;
  title: string;
  derivedTitle?: string | null;
  preview: string;
  updatedAt: string;
  createdAt: string;
  isStreaming: boolean;
  runId?: string | null;
};

export type AgentStatus = "running" | "idle" | "waiting" | "error" | "done";

export type AgentRun = {
  id: string;
  label: string;
  status: AgentStatus;
  sessionKey: string | null;
  startedAt: string;
  updatedAt: string;
  summary?: string;
  transcript: string[];
};

export type FileEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  depth?: number;
  size?: number;
  childCount?: number;
  mtime?: string;
};

export type FilePreview = {
  path: string;
  content: string;
  mimeType: string;
};

export type AttachmentDraft = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string | null;
};

export type PendingSend = {
  conversationKey: string;
  text: string;
  attachments: AttachmentDraft[];
};

export type SessionsListEntry = {
  key: string;
  label?: string | null;
  displayName?: string | null;
  title?: string | null;
  derivedTitle?: string | null;
  updatedAt?: string | number | null;
  createdAt?: string | number | null;
  lastMessage?: unknown;
  activeRunId?: string | null;
};
