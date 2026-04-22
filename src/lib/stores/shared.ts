import type { StoreApi, UseBoundStore } from "zustand";
import type {
  AgentRun,
  AttachmentDraft,
  ChatMessage,
  Conversation,
  FileEntry,
  FilePreview,
  PendingSend,
  SessionsListEntry
} from "../types";

export type PanelMode = "tasks" | "agents" | "files";
export type MobileTab = "chat" | "tasks" | "agents" | "files";
export type FileMethodKind = "list" | "read" | "write";

export type MethodVariant = {
  method: string;
  params: (path: string, content?: string) => Record<string, unknown>;
};

export type ChatStoreState = {
  conversations: Conversation[];
  sessionsReady: boolean;
  selectedConversationKey: string | null;
  messagesByConversation: Record<string, ChatMessage[]>;
  // Timestamp (Date.now() ms) of the most recent session event observed per
  // sessionKey. The stall detector reads this to decide whether a streaming
  // conversation has gone silent for too long.
  lastEventAtBySession: Record<string, number>;
  queuedMessages: PendingSend[];
  loadingConversationKey: string | null;
  refreshSessions: () => Promise<void>;
  createConversation: () => Promise<string | null>;
  selectConversation: (key: string) => Promise<void>;
  renameConversation: (key: string, title: string) => Promise<void>;
  deleteConversation: (key: string) => Promise<void>;
  sendMessage: () => Promise<void>;
  cancelStream: (conversationKey?: string) => Promise<void>;
  flushQueuedMessages: () => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  hideMessage: (messageId: string) => void;
  addTaskFromMessage: (messageId: string) => Promise<void>;
  quickSend: (sessionKey: string, text: string) => Promise<void>;
};

export type FilesStoreState = {
  fileEntries: FileEntry[];
  filePreview: FilePreview | null;
  filesReady: boolean;
  filesFallback: boolean;
  methodsByKind: Partial<Record<FileMethodKind, MethodVariant>>;
  loadFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  setMethodVariant: (kind: FileMethodKind, method: MethodVariant) => void;
};

export type AgentsStoreState = {
  agents: AgentRun[];
  handleAgentEvent: (payload: unknown) => void;
  addPresenceBeacon: () => void;
};

export type UiStoreState = {
  currentPanel: PanelMode;
  mobileTab: MobileTab;
  mobileSidebarOpen: boolean;
  sidebarFilesMode: boolean;
  draft: string;
  // Per-session drafts, persisted to localStorage. The `draft` field above is
  // the currently-loaded draft (mirrors drafts[activeDraftKey]).
  drafts: Record<string, string>;
  activeDraftKey: string | null;
  attachments: AttachmentDraft[];
  conversationSearch: string;
  focusSearchVersion: number;
  setConversationSearch: (value: string) => void;
  setDraft: (value: string) => void;
  // Called by the app whenever the active chat session changes. Saves the
  // outgoing session's draft, loads the incoming one's, and leaves `draft`
  // mirroring the new key.
  setActiveDraftKey: (sessionKey: string | null) => void;
  addAttachments: (files: File[]) => Promise<void>;
  removeAttachment: (id: string) => void;
  setCurrentPanel: (panel: PanelMode) => void;
  setMobileTab: (tab: MobileTab) => void;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  toggleSidebarFilesMode: () => void;
  requestSearchFocus: () => void;
  closeOverlays: () => void;
};

export type AppStoreState = ChatStoreState &
  FilesStoreState &
  AgentsStoreState &
  UiStoreState;

export type BoundStore<T> = UseBoundStore<StoreApi<T>>;

const HIDDEN_MESSAGES_KEY = "agent-ui.hidden-messages.v1";

export const FILE_METHODS: Record<FileMethodKind, MethodVariant[]> = {
  list: [
    { method: "workspace.tree", params: (path) => ({ path }) },
    { method: "workspace.list", params: (path) => ({ path }) },
    { method: "files.list", params: (path) => ({ path }) },
    { method: "fs.list", params: (path) => ({ path }) }
  ],
  read: [
    { method: "workspace.read", params: (path) => ({ path }) },
    { method: "files.read", params: (path) => ({ path }) },
    { method: "files.get", params: (path) => ({ path }) },
    { method: "fs.read", params: (path) => ({ path }) }
  ],
  write: [
    { method: "workspace.write", params: (path, content) => ({ path, content }) },
    { method: "files.write", params: (path, content) => ({ path, content }) },
    { method: "files.set", params: (path, content) => ({ path, content }) },
    { method: "fs.write", params: (path, content) => ({ path, content }) }
  ]
};

export function nowIso() {
  return new Date().toISOString();
}

export function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeTime(value: string | number | null | undefined): string {
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return nowIso();
}

export function messageTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (Array.isArray(record.content)) {
    return record
      .content
      .flatMap((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const typed = part as Record<string, unknown>;
        return typeof typed.text === "string" ? typed.text : "";
      })
      .join("\n");
  }
  return "";
}

function extractLastMessageRole(value: unknown): "user" | "assistant" | "system" | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role.toLowerCase() : null;
  if (role === "user" || role === "assistant" || role === "system") return role;
  return null;
}

export function normalizeSession(entry: SessionsListEntry): Conversation {
  const title =
    entry.label?.trim() ||
    entry.title?.trim() ||
    entry.derivedTitle?.trim() ||
    entry.displayName?.trim() ||
    entry.key;

  return {
    key: entry.key,
    title,
    derivedTitle: entry.derivedTitle ?? null,
    preview: (messageTextFromUnknown(entry.lastMessage) || (typeof entry.lastMessagePreview === "string" ? entry.lastMessagePreview : "")).slice(0, 140),
    updatedAt: normalizeTime(entry.updatedAt),
    createdAt: normalizeTime(entry.createdAt ?? entry.updatedAt),
    isStreaming: Boolean(entry.activeRunId),
    runId: entry.activeRunId ?? null,
    kind: entry.kind ?? undefined,
    channel: entry.channel ?? null,
    model: entry.model ?? null,
    modelProvider: entry.modelProvider ?? null,
    thinkingLevel: entry.thinkingLevel ?? null,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    lastMessageRole: extractLastMessageRole(entry.lastMessage),
  };
}

// Sidebar preview is the last *assistant* text — tool calls, thinking blocks,
// images, and the user's own last message never belong here. If the message
// is non-text or not from the assistant, return "" and let the sidebar fall
// back to its own placeholders / streaming override.
export function buildPreview(message: ChatMessage | null | undefined): string {
  if (!message || message.role !== "assistant") return "";
  const text = message.parts
    .flatMap((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .trim();
  return text.slice(0, 140);
}

export function ensureConversation(list: Conversation[], key: string, fallbackTitle?: string) {
  if (list.some((item) => item.key === key)) {
    return list;
  }
  const now = nowIso();
  return [
    {
      key,
      title: fallbackTitle || "New Chat",
      preview: "",
      updatedAt: now,
      createdAt: now,
      isStreaming: false,
      runId: null
    },
    ...list
  ];
}

export function readHiddenMessages() {
  return safeJsonParse<string[]>(localStorage.getItem(HIDDEN_MESSAGES_KEY), []);
}

export function persistHiddenMessages(ids: string[]) {
  localStorage.setItem(HIDDEN_MESSAGES_KEY, JSON.stringify(ids));
}

export async function fileToDraft(file: File): Promise<AttachmentDraft> {
  const isImage = file.type.startsWith("image/");
  const dataUrl = isImage
    ? await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      })
    : null;
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    dataUrl
  };
}

export function extractMessageText(parts: ChatMessage["parts"]) {
  return parts
    .flatMap((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

export function normalizeFilePreview(path: string, response: unknown): FilePreview {
  if (!response || typeof response !== "object") {
    return { path, content: "No preview available.", mimeType: "text/plain" };
  }
  const record = response as Record<string, unknown>;
  const content =
    (typeof record.content === "string" && record.content) ||
    (typeof record.text === "string" && record.text) ||
    (typeof record.data === "string" && record.data) ||
    "No preview available.";
  const mimeType =
    (typeof record.mimeType === "string" && record.mimeType) ||
    (typeof record.type === "string" && record.type) ||
    "text/plain";
  return { path, content, mimeType };
}

export function applyConversationUpdate(
  conversations: Conversation[],
  key: string,
  patch: Partial<Conversation>
) {
  return conversations
    .flatMap((conversation) => (conversation.key === key ? { ...conversation, ...patch } : conversation))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function updateAgent(agents: AgentRun[], next: AgentRun) {
  const existing = agents.find((item) => item.id === next.id);
  if (!existing) {
    return [next, ...agents];
  }
  return agents
    .flatMap((item) => (item.id === next.id ? { ...item, ...next } : item))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function inferMimeType(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ["md", "txt", "json", "yaml", "yml", "toml", "sh", "mjs", "ts", "tsx", "js", "jsx", "css", "log"].includes(ext)
    ? "text/plain"
    : "application/octet-stream";
}
