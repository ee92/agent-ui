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
  SessionsListEntry
} from "../types";

export type PanelMode = "tasks" | "agents" | "files";
export type MobileTab = "chat" | "tasks" | "agents" | "files";
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
  quickSend: (sessionKey: string, text: string) => Promise<void>;
  handleChatEvent: (payload: unknown) => void;
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
  FilesStoreState &
  AgentsStoreState &
  UiStoreState;

export type BoundStore<T> = UseBoundStore<StoreApi<T>>;

const SETTINGS_KEY = "openclaw-ui-settings-v1";
const HIDDEN_MESSAGES_KEY = "openclaw-ui-hidden-messages-v1";
export const DEFAULT_GATEWAY_URL =
  typeof window !== "undefined" && window.location.host
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
    : "ws://127.0.0.1:18789";
export const DEFAULT_GATEWAY_TOKEN = "openclaw";

export async function fetchServerToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    return data.token?.trim() || null;
  } catch {
    return null;
  }
}

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

function cleanSessionTitle(raw: string): string {
  let t = raw.trim();
  // Strip "telegram:g-" prefixes
  t = t.replace(/^telegram:g-/, "").replace(/^agent:main:/, "");
  // Strip "[cron:uuid..." prefixes
  t = t.replace(/^\[cron:[a-f0-9-]+\.{3}$/, "");
  // Strip "System: [date] Cron: HEARTBEAT_OK..." noise
  if (/^System:\s*\[/.test(t) || /^HEARTBEAT/i.test(t)) return "";
  // Strip raw metadata titles (untrusted envelope headers used as derived titles)
  if (/^Sender \(untrusted/i.test(t) || /^Conversation info \(untrusted/i.test(t)) return "";
  // Strip "[timestamp] ..." prefixes from user messages used as titles
  if (/^\[(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{4}-/.test(t)) return "";
  // Strip "[Internal API Access]..." noise
  if (/^\[Internal API/i.test(t)) return "";
  // Strip "Pre-compaction memory flush..." noise
  if (/^Pre-compaction/i.test(t)) return "";
  // Strip "A scheduled reminder..." noise
  if (/^A scheduled reminder/i.test(t)) return "";
  // Clean up telegram session keys
  t = t.replace(/^telegram:(slash|group):/, "").replace(/:[0-9-]+(:topic:[0-9]+)?$/, "");
  // Capitalize first letter
  if (t.length > 0) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

function humanizeSessionKey(key: string): string {
  if (key.includes("cron:")) {
    const label = key.split(":").pop() || "Cron job";
    return "Cron: " + label.replace(/-/g, " ");
  }
  if (key.includes("telegram:group:")) return "Group chat";
  if (key.includes("telegram:slash:")) return "Telegram DM";
  if (key === "agent:main:main") return "Main session";
  return key.replace(/^agent:main:/, "").replace(/[-_]/g, " ");
}

function extractLastMessageRole(value: unknown): "user" | "assistant" | "system" | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role.toLowerCase() : null;
  if (role === "user" || role === "assistant" || role === "system") return role;
  return null;
}

/**
 * Strip the internal `agent:<id>:` prefix from session store keys so the UI
 * uses the same short key that tasks, chat.send, and chat.history expect.
 * The gateway resolves both forms, so using the short key everywhere is safe.
 */
function normalizeSessionKey(key: string): string {
  return key.replace(/^agent:[^:]+:/, "");
}

export function normalizeSession(entry: SessionsListEntry): Conversation {
  // Priority: explicit label > cleaned derivedTitle > cleaned displayName > humanized key
  const normalizedKey = normalizeSessionKey(entry.key);
  const candidates = [
    entry.label?.trim(),
    entry.title?.trim(),
    entry.derivedTitle ? cleanSessionTitle(entry.derivedTitle) : "",
    entry.displayName ? cleanSessionTitle(entry.displayName) : "",
  ].filter((s): s is string => Boolean(s && s.length > 2));
  
  const title = candidates[0] || humanizeSessionKey(entry.key);

  // Auto-detect kind from session key patterns when gateway doesn't provide it
  let kind = entry.kind ?? undefined;
  const keyLower = entry.key.toLowerCase();
  if (!kind || kind === "unknown" || kind === "direct") {
    if (keyLower.includes("cron:") || keyLower.includes("cron-")) {
      kind = "cron";
    } else if (keyLower.includes("subagent:") || keyLower.includes("agent:") && keyLower.includes(":subagent:")) {
      kind = "agent";
    }
  }

  return {
    key: normalizedKey,
    title,
    derivedTitle: entry.derivedTitle ?? null,
    preview: (messageTextFromUnknown(entry.lastMessage) || (typeof entry.lastMessagePreview === "string" ? entry.lastMessagePreview : "")).slice(0, 140),
    updatedAt: normalizeTime(entry.updatedAt),
    createdAt: normalizeTime(entry.createdAt ?? entry.updatedAt),
    isStreaming: Boolean(entry.activeRunId),
    runId: entry.activeRunId ?? null,
    kind,
    channel: entry.channel ?? null,
    model: entry.model ?? null,
    modelProvider: entry.modelProvider ?? null,
    thinkingLevel: entry.thinkingLevel ?? null,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    lastMessageRole: extractLastMessageRole(entry.lastMessage),
  };
}

export function normalizeHistoryMessage(message: unknown): ChatMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "assistant";
  const text = messageTextFromUnknown(record);
  const parts: ChatMessage["parts"] = [];
  // Extract image content parts if present
  if (Array.isArray(record.content)) {
    for (const part of record.content) {
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (p.type === "image" || p.type === "image_url") {
          const url =
            (typeof p.url === "string" && p.url) ||
            (typeof p.image_url === "object" && p.image_url && typeof (p.image_url as Record<string, unknown>).url === "string"
              ? (p.image_url as Record<string, unknown>).url as string
              : null) ||
            (typeof p.source === "object" && p.source && typeof (p.source as Record<string, unknown>).url === "string"
              ? (p.source as Record<string, unknown>).url as string
              : null);
          if (url) {
            parts.push({ type: "image", url, alt: typeof p.alt === "string" ? p.alt : "" });
          }
        }
      }
    }
  }
  // Extract media URL if present (from message tool sends)
  if (typeof record.media === "string" && record.media) {
    parts.push({ type: "image", url: record.media, alt: "" });
  }
  if (text) {
    parts.push({ type: "text", text });
  }
  if (parts.length === 0) {
    return null;
  }
  return {
    id: crypto.randomUUID(),
    role: role === "user" || role === "assistant" || role === "system" ? role : "assistant",
    parts,
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

export function ensureConversation(list: Conversation[], key: string, fallbackTitle?: string) {
  if (list.some((item) => item.key === key)) {
    return list;
  }
  const now = nowIso();
  return [
    {
      key,
      title: fallbackTitle || "Untitled conversation",
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
