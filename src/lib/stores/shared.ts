import type { StoreApi, UseBoundStore } from "zustand";
import type { GatewayEvent } from "../gateway";
import type {
  AgentRun,
  AttachmentDraft,
  ChatMessage,
  ConnectionState,
  Conversation,
  FileEntry,
  FilePreview,
  PendingSend,
  SessionsListEntry,
  Task,
  TaskPriority,
  TaskStatus,
  TasksFile
} from "../types";

export type PanelMode = "tasks" | "files";
export type MobileTab = "chat" | "tasks" | "files";
export type FileMethodKind = "list" | "read" | "write";

export type MethodVariant = {
  method: string;
  params: (path: string, content?: string) => Record<string, unknown>;
};

export type GatewayStoreState = {
  connectionState: ConnectionState;
  connectionDetail: string;
  gatewayUrl: string;
  gatewayToken: string;
  gatewayClient: import("../gateway").GatewayClient | null;
  lastGatewayEvent: GatewayEvent | null;
  gatewayEventVersion: number;
  connect: () => void;
  disconnect: () => void;
  setGatewayConfig: (url: string, token: string) => void;
};

export type ChatStoreState = {
  conversations: Conversation[];
  sessionsReady: boolean;
  selectedConversationKey: string | null;
  messagesByConversation: Record<string, ChatMessage[]>;
  queuedMessages: PendingSend[];
  loadingConversationKey: string | null;
  refreshSessions: () => Promise<void>;
  createConversation: () => Promise<string | null>;
  selectConversation: (key: string) => Promise<void>;
  renameConversation: (key: string, title: string) => Promise<void>;
  deleteConversation: (key: string) => Promise<void>;
  sendMessage: () => Promise<void>;
  flushQueuedMessages: () => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  hideMessage: (messageId: string) => void;
  addTaskFromMessage: (messageId: string) => Promise<void>;
  handleChatEvent: (payload: unknown) => void;
};

export type TasksStoreState = {
  tasks: Task[];
  tasksReady: boolean;
  tasksFallback: boolean;
  activeTaskId: string | null;
  addTask: (title: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<Omit<Task, "id" | "createdAt">>) => Promise<void>;
  moveTask: (id: string, status: TaskStatus, index: number) => Promise<void>;
  setActiveTaskId: (id: string | null) => void;
  loadTasks: () => Promise<void>;
  createTaskFromMessage: (text: string) => Promise<void>;
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
  attachments: AttachmentDraft[];
  conversationSearch: string;
  focusSearchVersion: number;
  setConversationSearch: (value: string) => void;
  setDraft: (value: string) => void;
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

export type AppStoreState = GatewayStoreState &
  ChatStoreState &
  TasksStoreState &
  FilesStoreState &
  AgentsStoreState &
  UiStoreState;

export type BoundStore<T> = UseBoundStore<StoreApi<T>>;

const SETTINGS_KEY = "openclaw-ui-settings-v1";
const TASKS_FALLBACK_KEY = "openclaw-ui-tasks-v1";
const HIDDEN_MESSAGES_KEY = "openclaw-ui-hidden-messages-v1";

export const TASKS_PATH = "workspace/tasks.json";
export const DEFAULT_GATEWAY_URL =
  typeof window !== "undefined" && window.location.host
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://127.0.0.1:18789";
export const DEFAULT_GATEWAY_TOKEN = "openclaw";

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

export function persistSettings(url: string, token: string) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ url, token }));
}

export function getInitialSettings() {
  const stored = safeJsonParse<{ url?: string; token?: string }>(localStorage.getItem(SETTINGS_KEY), {});
  return {
    gatewayUrl: stored.url?.trim() || DEFAULT_GATEWAY_URL,
    gatewayToken: stored.token?.trim() || DEFAULT_GATEWAY_TOKEN
  };
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

export function normalizeSession(entry: SessionsListEntry): Conversation {
  const title =
    entry.label?.trim() ||
    entry.displayName?.trim() ||
    entry.title?.trim() ||
    entry.derivedTitle?.trim() ||
    "Untitled conversation";
  return {
    key: entry.key,
    title,
    derivedTitle: entry.derivedTitle ?? null,
    preview: messageTextFromUnknown(entry.lastMessage).slice(0, 140),
    updatedAt: normalizeTime(entry.updatedAt),
    createdAt: normalizeTime(entry.createdAt ?? entry.updatedAt),
    isStreaming: Boolean(entry.activeRunId),
    runId: entry.activeRunId ?? null
  };
}

export function normalizeHistoryMessage(message: unknown): ChatMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "assistant";
  const text = messageTextFromUnknown(record);
  if (!text && !Array.isArray(record.content)) {
    return null;
  }
  return {
    id: crypto.randomUUID(),
    role: role === "user" || role === "assistant" || role === "system" ? role : "assistant",
    parts: text ? [{ type: "text", text }] : [],
    createdAt: normalizeTime(
      typeof record.timestamp === "number" || typeof record.timestamp === "string"
        ? record.timestamp
        : null
    )
  };
}

export function buildPreview(parts: ChatMessage["parts"]) {
  return parts
    .flatMap((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type === "attachment") {
        return `[Attachment] ${part.name}`;
      }
      return "[Image]";
    })
    .join(" ")
    .trim()
    .slice(0, 140);
}

export function ensureConversation(list: Conversation[], key: string) {
  if (list.some((item) => item.key === key)) {
    return list;
  }
  const now = nowIso();
  return [
    {
      key,
      title: "Untitled conversation",
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

export function persistFallbackTasks(tasks: Task[]) {
  localStorage.setItem(
    TASKS_FALLBACK_KEY,
    JSON.stringify({ version: 1, tasks } satisfies TasksFile)
  );
}

export function readFallbackTasks() {
  return safeJsonParse<TasksFile>(localStorage.getItem(TASKS_FALLBACK_KEY), { version: 1, tasks: [] }).tasks;
}

export function serializeTasks(tasks: Task[]) {
  return JSON.stringify({ version: 1, tasks } satisfies TasksFile, null, 2);
}

export function sortTasks(tasks: Task[]) {
  const weight: Record<TaskStatus, number> = { queue: 0, active: 1, done: 2 };
  return [...tasks].sort((left, right) => {
    const statusDiff = weight[left.status] - weight[right.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

export function priorityFromText(text: string): TaskPriority {
  if (/urgent|critical|high/i.test(text)) {
    return "high";
  }
  if (/soon|follow|medium/i.test(text)) {
    return "medium";
  }
  return "low";
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

export async function requestFileMethod<T>(
  client: import("../gateway").GatewayClient,
  kind: FileMethodKind,
  path: string,
  content: string | undefined,
  known: MethodVariant | undefined
) {
  const variants = known ? [known] : FILE_METHODS[kind];
  let lastError: Error | null = null;
  for (const variant of variants) {
    try {
      const data = await client.request<T>(variant.method, variant.params(path, content));
      return { data, method: variant };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error(`No ${kind} method available`);
}

export function inferMimeType(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ["md", "txt", "json", "yaml", "yml", "toml", "sh", "mjs", "ts", "tsx", "js", "jsx", "css", "log"].includes(ext)
    ? "text/plain"
    : "application/octet-stream";
}
