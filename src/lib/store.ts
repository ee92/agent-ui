import { create } from "zustand";
import { GatewayClient, type GatewayEvent } from "./gateway";
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
} from "./types";

type PanelMode = "tasks" | "files";
type MobileTab = "chat" | "tasks" | "files";

type FileMethodKind = "list" | "read" | "write";

type MethodVariant = {
  method: string;
  params: (path: string, content?: string) => Record<string, unknown>;
};

type AppStore = {
  connectionState: ConnectionState;
  connectionDetail: string;
  gatewayUrl: string;
  gatewayToken: string;
  gatewayClient: GatewayClient | null;
  conversations: Conversation[];
  selectedConversationKey: string | null;
  messagesByConversation: Record<string, ChatMessage[]>;
  queuedMessages: PendingSend[];
  draft: string;
  attachments: AttachmentDraft[];
  conversationSearch: string;
  tasks: Task[];
  tasksReady: boolean;
  tasksFallback: boolean;
  activeTaskId: string | null;
  agents: AgentRun[];
  fileEntries: FileEntry[];
  filePreview: FilePreview | null;
  filesReady: boolean;
  filesFallback: boolean;
  currentPanel: PanelMode;
  mobileTab: MobileTab;
  mobileSidebarOpen: boolean;
  sidebarFilesMode: boolean;
  methodsByKind: Partial<Record<FileMethodKind, MethodVariant>>;
  connect: () => void;
  disconnect: () => void;
  setGatewayConfig: (url: string, token: string) => void;
  setConversationSearch: (value: string) => void;
  setDraft: (value: string) => void;
  addAttachments: (files: File[]) => Promise<void>;
  removeAttachment: (id: string) => void;
  refreshSessions: () => Promise<void>;
  createConversation: () => Promise<string | null>;
  selectConversation: (key: string) => Promise<void>;
  deleteConversation: (key: string) => Promise<void>;
  sendMessage: () => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  hideMessage: (messageId: string) => void;
  addTask: (title: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<Omit<Task, "id" | "createdAt">>) => Promise<void>;
  moveTask: (id: string, status: TaskStatus, index: number) => Promise<void>;
  setActiveTaskId: (id: string | null) => void;
  addTaskFromMessage: (messageId: string) => Promise<void>;
  loadTasks: () => Promise<void>;
  loadFiles: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  setCurrentPanel: (panel: PanelMode) => void;
  setMobileTab: (tab: MobileTab) => void;
  toggleMobileSidebar: () => void;
  toggleSidebarFilesMode: () => void;
};

const SETTINGS_KEY = "openclaw-ui-settings-v1";
const TASKS_FALLBACK_KEY = "openclaw-ui-tasks-v1";
const HIDDEN_MESSAGES_KEY = "openclaw-ui-hidden-messages-v1";

const DEFAULT_GATEWAY_URL = typeof window !== "undefined" && window.location.host ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}` : "ws://127.0.0.1:18789";
const DEFAULT_GATEWAY_TOKEN = "e1d47ce3c80c897bb9f6c969f077886d5e5fc0266a3916cf";
const TASKS_PATH = "workspace/tasks.json";

const FILE_METHODS: Record<FileMethodKind, MethodVariant[]> = {
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

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function persistSettings(url: string, token: string) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ url, token }));
}

function getInitialSettings() {
  const stored = safeJsonParse<{ url?: string; token?: string }>(
    localStorage.getItem(SETTINGS_KEY),
    {}
  );

  return {
    gatewayUrl: stored.url?.trim() || DEFAULT_GATEWAY_URL,
    gatewayToken: stored.token?.trim() || DEFAULT_GATEWAY_TOKEN
  };
}

function normalizeTime(value: string | number | null | undefined): string {
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

function messageTextFromUnknown(value: unknown): string {
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
    return record.content
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

function normalizeSession(entry: SessionsListEntry): Conversation {
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

function normalizeHistoryMessage(message: unknown): ChatMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const record = message as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "assistant";
  const text = messageTextFromUnknown(record);

  if (!text && !Array.isArray(record.content)) {
    return null;
  }

  const createdAt = normalizeTime(
    typeof record.timestamp === "number" || typeof record.timestamp === "string"
      ? record.timestamp
      : null
  );

  return {
    id: crypto.randomUUID(),
    role: role === "user" || role === "assistant" || role === "system" ? role : "assistant",
    parts: text ? [{ type: "text", text }] : [],
    createdAt
  };
}

function buildPreview(parts: ChatMessage["parts"]): string {
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

function ensureConversation(list: Conversation[], key: string): Conversation[] {
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

function readHiddenMessages(): string[] {
  return safeJsonParse<string[]>(localStorage.getItem(HIDDEN_MESSAGES_KEY), []);
}

function persistHiddenMessages(ids: string[]) {
  localStorage.setItem(HIDDEN_MESSAGES_KEY, JSON.stringify(ids));
}

function persistFallbackTasks(tasks: Task[]) {
  localStorage.setItem(
    TASKS_FALLBACK_KEY,
    JSON.stringify({
      version: 1,
      tasks
    } satisfies TasksFile)
  );
}

function readFallbackTasks(): Task[] {
  const parsed = safeJsonParse<TasksFile>(localStorage.getItem(TASKS_FALLBACK_KEY), {
    version: 1,
    tasks: []
  });
  return parsed.tasks;
}

function serializeTasks(tasks: Task[]) {
  return JSON.stringify(
    {
      version: 1,
      tasks
    } satisfies TasksFile,
    null,
    2
  );
}

function sortTasks(tasks: Task[]): Task[] {
  const weight: Record<TaskStatus, number> = { queue: 0, active: 1, done: 2 };
  return [...tasks].sort((left, right) => {
    const statusDiff = weight[left.status] - weight[right.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function priorityFromText(text: string): TaskPriority {
  if (/urgent|critical|high/i.test(text)) {
    return "high";
  }
  if (/soon|follow|medium/i.test(text)) {
    return "medium";
  }
  return "low";
}

async function fileToDraft(file: File): Promise<AttachmentDraft> {
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

function extractText(parts: ChatMessage["parts"]): string {
  return parts
    .flatMap((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

async function requestFileMethod<T>(
  client: GatewayClient,
  kind: FileMethodKind,
  path: string,
  content: string | undefined,
  known: MethodVariant | undefined
): Promise<{ data: T; method: MethodVariant }> {
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

function normalizeFileEntries(response: unknown): FileEntry[] {
  if (!response || typeof response !== "object") {
    return [];
  }

  const record = response as Record<string, unknown>;
  const source =
    (Array.isArray(record.entries) ? record.entries : null) ??
    (Array.isArray(record.files) ? record.files : null) ??
    (Array.isArray(record.children) ? record.children : null) ??
    [];

  return source
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const typed = entry as Record<string, unknown>;
      const path =
        (typeof typed.path === "string" && typed.path) ||
        (typeof typed.name === "string" && typed.name) ||
        "";
      if (!path) {
        return [];
      }
      const normalizedPath = path.replace(/^\.\//, "");
      const depth = normalizedPath.split("/").length - 1;
      const name = normalizedPath.split("/").pop() ?? normalizedPath;
      const rawType = typeof typed.type === "string" ? typed.type : "file";

      return {
        path: normalizedPath,
        name,
        type: rawType === "dir" || rawType === "directory" ? "directory" : "file",
        depth,
        size: typeof typed.size === "number" ? typed.size : undefined
      } as FileEntry;
    })
    
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    });
}

function normalizeFilePreview(path: string, response: unknown): FilePreview {
  if (!response || typeof response !== "object") {
    return {
      path,
      content: "No preview available.",
      mimeType: "text/plain"
    };
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

function applyConversationUpdate(
  conversations: Conversation[],
  key: string,
  patch: Partial<Conversation>
) {
  return conversations
    .flatMap((conversation) =>
      conversation.key === key ? { ...conversation, ...patch } : conversation
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function updateAgent(agent: AgentRun[], next: AgentRun): AgentRun[] {
  const existing = agent.find((item) => item.id === next.id);
  if (!existing) {
    return [next, ...agent];
  }
  return agent
    .flatMap((item) => (item.id === next.id ? { ...item, ...next } : item))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

const initialSettings = getInitialSettings();
const hiddenMessageIds = readHiddenMessages();

export const useAppStore = create<AppStore>((set, get) => ({
  connectionState: "disconnected",
  connectionDetail: "",
  gatewayUrl: initialSettings.gatewayUrl,
  gatewayToken: initialSettings.gatewayToken,
  gatewayClient: null,
  conversations: [],
  selectedConversationKey: null,
  messagesByConversation: {},
  queuedMessages: [],
  draft: "",
  attachments: [],
  conversationSearch: "",
  tasks: readFallbackTasks(),
  tasksReady: false,
  tasksFallback: true,
  activeTaskId: null,
  agents: [],
  fileEntries: [],
  filePreview: null,
  filesReady: false,
  filesFallback: false,
  currentPanel: "tasks",
  mobileTab: "chat",
  mobileSidebarOpen: false,
  sidebarFilesMode: false,
  methodsByKind: {},

  connect: () => {
    const current = get().gatewayClient;
    current?.disconnect();

    const client = new GatewayClient({
      url: get().gatewayUrl,
      token: get().gatewayToken,
      onConnectionState: (connectionState, detail) => {
        set({ connectionState, connectionDetail: detail ?? "" });
        if (connectionState === "connected") {
          void get().refreshSessions();
          void get().loadTasks();
          void get().loadFiles();

          const queued = [...get().queuedMessages];
          if (queued.length > 0) {
            set({ queuedMessages: [] });
            for (const queuedMessage of queued) {
              void (async () => {
                set({
                  selectedConversationKey: queuedMessage.conversationKey,
                  draft: queuedMessage.text,
                  attachments: queuedMessage.attachments
                });
                await get().sendMessage();
              })();
            }
          }
        }
      },
      onEvent: (event) => {
        handleGatewayEvent(event, set, get);
      }
    });

    set({ gatewayClient: client });
    client.connect();
  },

  disconnect: () => {
    get().gatewayClient?.disconnect();
    set({
      gatewayClient: null,
      connectionState: "disconnected",
      connectionDetail: ""
    });
  },

  setGatewayConfig: (url, token) => {
    persistSettings(url, token);
    set({ gatewayUrl: url, gatewayToken: token });
  },

  setConversationSearch: (value) => set({ conversationSearch: value }),

  setDraft: (value) => set({ draft: value }),

  addAttachments: async (files) => {
    const nextDrafts = await Promise.all(Array.from(files, (file) => fileToDraft(file)));
    set({ attachments: [...get().attachments, ...nextDrafts] });
  },

  removeAttachment: (id) => {
    set({ attachments: get().attachments.filter((attachment) => attachment.id !== id) });
  },

  refreshSessions: async () => {
    const client = get().gatewayClient;
    if (!client || !client.isConnected()) {
      return;
    }

    try {
      const response = await client.request<{ sessions?: SessionsListEntry[] }>("sessions.list", {
        limit: 50,
        includeDerivedTitles: true,
        includeLastMessage: true
      });

      const sessions = Array.isArray(response.sessions) ? response.sessions.flatMap(normalizeSession) : [];
      const selectedConversationKey = get().selectedConversationKey ?? sessions[0]?.key ?? null;

      set({
        conversations: sessions,
        selectedConversationKey
      });

      if (selectedConversationKey) {
        await get().selectConversation(selectedConversationKey);
      }
    } catch (error) {
      set({
        connectionDetail: String(error)
      });
    }
  },

  createConversation: async () => {
    const client = get().gatewayClient;
    const rawKey = `web-${crypto.randomUUID().slice(0, 8)}`;
    const now = nowIso();

    if (!client || !client.isConnected()) {
      set({
        conversations: [
          {
            key: rawKey,
            title: "New Chat",
            preview: "",
            updatedAt: now,
            createdAt: now,
            isStreaming: false,
            runId: null
          },
          ...get().conversations
        ],
        selectedConversationKey: rawKey,
        messagesByConversation: {
          ...get().messagesByConversation,
          [rawKey]: []
        },
        mobileSidebarOpen: false
      });
      return rawKey;
    }

    try {
      const response = await client.request<{ key?: string; entry?: { label?: string } }>(
        "sessions.patch",
        {
          key: rawKey,
          label: "New Chat"
        }
      );

      const key = (typeof response.key === "string" && response.key) || rawKey;

      set({
        conversations: [
          {
            key,
            title: response.entry?.label || "New Chat",
            preview: "",
            updatedAt: now,
            createdAt: now,
            isStreaming: false,
            runId: null
          },
          ...get().conversations.filter((conversation) => conversation.key !== key)
        ],
        selectedConversationKey: key,
        messagesByConversation: {
          ...get().messagesByConversation,
          [key]: []
        },
        mobileSidebarOpen: false
      });

      return key;
    } catch {
      const now = nowIso();
      set({
        conversations: [
          {
            key: rawKey,
            title: "New Chat",
            preview: "",
            updatedAt: now,
            createdAt: now,
            isStreaming: false,
            runId: null
          },
          ...get().conversations
        ],
        selectedConversationKey: rawKey,
        messagesByConversation: {
          ...get().messagesByConversation,
          [rawKey]: []
        }
      });
      return rawKey;
    }
  },

  selectConversation: async (key) => {
    const client = get().gatewayClient;

    set({
      selectedConversationKey: key,
      mobileSidebarOpen: false,
      conversations: ensureConversation(get().conversations, key)
    });

    if (!client || !client.isConnected()) {
      return;
    }

    if (get().messagesByConversation[key]) {
      return;
    }

    try {
      const response = await client.request<{ messages?: unknown[] }>("chat.history", {
        sessionKey: key,
        limit: 200
      });

      const messages = Array.isArray(response.messages)
        ? response.messages
            .flatMap(normalizeHistoryMessage)
            .filter((message): message is ChatMessage => message !== null)
            .flatMap((message) =>
              hiddenMessageIds.includes(message.id) ? { ...message, hidden: true } : message
            )
        : [];

      set({
        messagesByConversation: {
          ...get().messagesByConversation,
          [key]: messages
        }
      });
    } catch {
      set({
        messagesByConversation: {
          ...get().messagesByConversation,
          [key]: []
        }
      });
    }
  },

  deleteConversation: async (key) => {
    const client = get().gatewayClient;

    if (client && client.isConnected()) {
      try {
        await client.request("sessions.delete", { key });
      } catch {
        // Keep local delete behavior even if the gateway rejects it.
      }
    }

    const nextConversations = get().conversations.filter((conversation) => conversation.key !== key);
    const nextMessages = { ...get().messagesByConversation };
    delete nextMessages[key];

    set({
      conversations: nextConversations,
      messagesByConversation: nextMessages,
      selectedConversationKey:
        get().selectedConversationKey === key ? nextConversations[0]?.key ?? null : get().selectedConversationKey
    });
  },

  sendMessage: async () => {
    const currentState = get();
    const client = currentState.gatewayClient;
    const selectedKey = currentState.selectedConversationKey ?? (await currentState.createConversation());

    if (!selectedKey) {
      return;
    }

    const text = currentState.draft.trim();
    const attachments = currentState.attachments;

    if (!text && attachments.length === 0) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        ...(text ? [{ type: "text", text } as const] : []),
        ...attachments.flatMap((attachment) =>
          attachment.dataUrl
            ? ({ type: "image", url: attachment.dataUrl, alt: attachment.name } as const)
            : ({ type: "attachment", name: attachment.name, mimeType: attachment.mimeType } as const)
        )
      ],
      createdAt: nowIso(),
      pending: !client || !client.isConnected()
    };

    const assistantStub: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [{ type: "text", text: "" }],
      createdAt: nowIso(),
      pending: true,
      runId: userMessage.id
    };

    set({
      draft: "",
      attachments: [],
      messagesByConversation: {
        ...currentState.messagesByConversation,
        [selectedKey]: [...(currentState.messagesByConversation[selectedKey] ?? []), userMessage, assistantStub]
      },
      conversations: applyConversationUpdate(
        ensureConversation(currentState.conversations, selectedKey),
        selectedKey,
        {
          preview: buildPreview(userMessage.parts),
          updatedAt: nowIso(),
          isStreaming: true,
          runId: userMessage.id
        }
      )
    });

    if (!client || !client.isConnected()) {
      set({
        queuedMessages: [...get().queuedMessages, { conversationKey: selectedKey, text, attachments }]
      });
      return;
    }

    try {
      const response = await client.request<{ runId?: string; status?: string }>("chat.send", {
        sessionKey: selectedKey,
        message: text,
        idempotencyKey: userMessage.id,
        thinking: "low",
        timeoutMs: 300000,
        attachments: attachments
          .filter((attachment) => attachment.dataUrl)
          .flatMap((attachment) => ({
            type: "image",
            mimeType: attachment.mimeType,
            content: String(attachment.dataUrl).split(",")[1] ?? ""
          }))
      });

      const runId = response.runId ?? userMessage.id;
      set({
        messagesByConversation: {
          ...get().messagesByConversation,
          [selectedKey]: (get().messagesByConversation[selectedKey] ?? []).flatMap((message) =>
            message.id === assistantStub.id ? { ...message, runId } : message
          )
        },
        conversations: applyConversationUpdate(get().conversations, selectedKey, {
          runId,
          isStreaming: true
        })
      });
    } catch (error) {
      set({
        messagesByConversation: {
          ...get().messagesByConversation,
          [selectedKey]: (get().messagesByConversation[selectedKey] ?? []).flatMap((message) =>
            message.id === assistantStub.id
              ? {
                  ...message,
                  pending: false,
                  error: String(error),
                  parts: [{ type: "text", text: `Error: ${String(error)}` }]
                }
              : message
          )
        },
        conversations: applyConversationUpdate(get().conversations, selectedKey, {
          isStreaming: false,
          runId: null
        })
      });
    }
  },

  retryMessage: async (messageId) => {
    const key = get().selectedConversationKey;
    if (!key) {
      return;
    }
    const target = (get().messagesByConversation[key] ?? []).find((message) => message.id === messageId);
    if (!target) {
      return;
    }
    const text = extractText(target.parts);
    set({ draft: text });
    await get().sendMessage();
  },

  hideMessage: (messageId) => {
    const key = get().selectedConversationKey;
    if (!key) {
      return;
    }
    const nextHidden = [...new Set([...readHiddenMessages(), messageId])];
    persistHiddenMessages(nextHidden);

    set({
      messagesByConversation: {
        ...get().messagesByConversation,
        [key]: (get().messagesByConversation[key] ?? []).flatMap((message) =>
          message.id === messageId ? { ...message, hidden: true } : message
        )
      }
    });
  },

  addTask: async (title) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }

    const task: Task = {
      id: `t_${crypto.randomUUID().slice(0, 8)}`,
      title: trimmed,
      description: "",
      status: "queue",
      priority: priorityFromText(trimmed),
      tags: [],
      agentSession: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null
    };

    const nextTasks = sortTasks([task, ...get().tasks]);
    set({ tasks: nextTasks, activeTaskId: task.id });
    await saveTasksToGateway(set, get, nextTasks);
  },

  updateTask: async (id, patch) => {
    const nextTasks = sortTasks(
      get().tasks.flatMap((task) => {
        if (task.id !== id) {
          return task;
        }

        const nextStatus = patch.status ?? task.status;
        return {
          ...task,
          ...patch,
          status: nextStatus,
          updatedAt: nowIso(),
          completedAt:
            nextStatus === "done"
              ? task.completedAt ?? nowIso()
              : patch.completedAt === null
                ? null
                : task.completedAt
        };
      })
    );

    set({ tasks: nextTasks });
    await saveTasksToGateway(set, get, nextTasks);
  },

  moveTask: async (id, status, index) => {
    const current = [...get().tasks];
    const moving = current.find((task) => task.id === id);
    if (!moving) {
      return;
    }

    const remaining = current.filter((task) => task.id !== id);
    const updatedTask: Task = {
      ...moving,
      status,
      updatedAt: nowIso(),
      completedAt: status === "done" ? moving.completedAt ?? nowIso() : null
    };

    const group = remaining.filter((task) => task.status === status);
    const others = remaining.filter((task) => task.status !== status);
    const boundedIndex = Math.max(0, Math.min(index, group.length));
    group.splice(boundedIndex, 0, updatedTask);
    const nextTasks = sortTasks([...others, ...group]);

    set({ tasks: nextTasks });
    await saveTasksToGateway(set, get, nextTasks);
  },

  setActiveTaskId: (id) => set({ activeTaskId: id }),

  addTaskFromMessage: async (messageId) => {
    const key = get().selectedConversationKey;
    if (!key) {
      return;
    }
    const message = (get().messagesByConversation[key] ?? []).find((item) => item.id === messageId);
    if (!message) {
      return;
    }
    const text = extractText(message.parts);
    await get().addTask(text.split("\n")[0] || "New task");
    await get().updateTask(get().activeTaskId ?? "", {
      description: text
    });
  },

  loadTasks: async () => {
    const client = get().gatewayClient;

    if (!client || !client.isConnected()) {
      set({
        tasks: readFallbackTasks(),
        tasksReady: true,
        tasksFallback: true
      });
      return;
    }

    try {
      const { data, method } = await requestFileMethod<unknown>(
        client,
        "read",
        TASKS_PATH,
        undefined,
        get().methodsByKind.read
      );

      const parsed = normalizeFilePreview(TASKS_PATH, data);
      const payload = safeJsonParse<TasksFile>(parsed.content, { version: 1, tasks: [] });
      const filteredTasks = payload.tasks.filter((task) => {
        if (task.status !== "done" || !task.completedAt) {
          return true;
        }
        return Date.now() - Date.parse(task.completedAt) < 7 * 24 * 60 * 60 * 1000;
      });

      set({
        tasks: sortTasks(filteredTasks),
        tasksReady: true,
        tasksFallback: false,
        methodsByKind: {
          ...get().methodsByKind,
          read: method
        }
      });
    } catch {
      const fallback = readFallbackTasks();
      set({
        tasks: fallback,
        tasksReady: true,
        tasksFallback: true
      });
    }
  },

  loadFiles: async () => {
    try {
      const token = get().gatewayToken;
      const res = await fetch("/api/files/list?path=", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json() as {
        path: string;
        entries: Array<{
          path: string;
          name: string;
          type: string;
          size?: number;
          childCount?: number;
          mtime?: number | string;
        }>;
      };
      const entries: FileEntry[] = data.entries.map((entry) => ({
        path: entry.path,
        name: entry.name,
        type: entry.type === "directory" ? "directory" : "file",
        depth: 0,
        size: entry.size,
        childCount: entry.childCount,
        mtime: typeof entry.mtime === "number" ? new Date(entry.mtime).toISOString() : entry.mtime
      }));
      set({ fileEntries: entries, filePreview: null, filesReady: true, filesFallback: false });
    } catch {
      set({ fileEntries: [], filePreview: null, filesReady: true, filesFallback: true });
    }
  },

  openFile: async (filePath) => {
    try {
      const token = get().gatewayToken;
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json() as { path: string; content: string; size: number };
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = ["md","txt","json","yaml","yml","toml","sh","mjs","ts","tsx","js","jsx","css","log"].includes(ext) ? "text/plain" : "application/octet-stream";
      set({ filePreview: { path: filePath, content: data.content, mimeType } });
    } catch {
      set({ filePreview: { path: filePath, content: "Unable to read this file.", mimeType: "text/plain" } });
    }
  },

  setCurrentPanel: (panel) => set({ currentPanel: panel, sidebarFilesMode: panel === "files" }),
  setMobileTab: (tab) => set({ mobileTab: tab }),
  toggleMobileSidebar: () => set({ mobileSidebarOpen: !get().mobileSidebarOpen }),
  toggleSidebarFilesMode: () =>
    set({
      sidebarFilesMode: !get().sidebarFilesMode,
      currentPanel: !get().sidebarFilesMode ? "files" : get().currentPanel
    })
}));

async function saveTasksToGateway(
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore,
  tasks: Task[]
) {
  persistFallbackTasks(tasks);

  const client = get().gatewayClient;
  if (!client || !client.isConnected()) {
    set({ tasksFallback: true });
    return;
  }

  try {
    const { method } = await requestFileMethod<unknown>(
      client,
      "write",
      TASKS_PATH,
      serializeTasks(tasks),
      get().methodsByKind.write
    );

    set({
      tasksFallback: false,
      methodsByKind: {
        ...get().methodsByKind,
        write: method
      }
    });
  } catch {
    set({ tasksFallback: true });
  }
}

function handleGatewayEvent(
  event: GatewayEvent,
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore
) {
  if (event.event === "chat") {
    handleChatEvent(event.data, set, get);
    return;
  }

  if (event.event === "agent") {
    handleAgentEvent(event.data, set, get);
    return;
  }

  if (event.event === "presence") {
    const now = nowIso();
    set({
      agents: updateAgent(get().agents, {
        id: crypto.randomUUID(),
        label: "Gateway presence",
        status: "idle",
        sessionKey: null,
        startedAt: now,
        updatedAt: now,
        summary: "Presence update received.",
        transcript: ["Presence beacon"]
      })
    });
  }
}

function handleChatEvent(
  payload: unknown,
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore
) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const data = payload as Record<string, unknown>;
  const sessionKey = typeof data.sessionKey === "string" ? data.sessionKey : null;
  const runId = typeof data.runId === "string" ? data.runId : null;
  const state = typeof data.state === "string" ? data.state : null;

  if (!sessionKey || !state) {
    return;
  }

  const currentMessages = [...(get().messagesByConversation[sessionKey] ?? [])];
  const lastAssistantIndex = [...currentMessages]
    .reverse()
    .findIndex((message) => message.role === "assistant" && message.pending);
  const targetIndex =
    lastAssistantIndex === -1 ? -1 : currentMessages.length - 1 - lastAssistantIndex;
  const existing = targetIndex >= 0 ? currentMessages[targetIndex] : null;
  const text = messageTextFromUnknown((data.message as Record<string, unknown> | undefined) ?? payload);

  if (state === "delta") {
    if (existing) {
      currentMessages[targetIndex] = {
        ...existing,
        parts: [{ type: "text", text }],
        pending: true,
        runId
      };
    } else {
      currentMessages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text }],
        createdAt: nowIso(),
        pending: true,
        runId
      });
    }
  }

  if (state === "final") {
    if (existing) {
      currentMessages[targetIndex] = {
        ...existing,
        parts: [{ type: "text", text }],
        pending: false,
        runId
      };
    } else {
      currentMessages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text }],
        createdAt: nowIso(),
        pending: false,
        runId
      });
    }
  }

  if (state === "error" || state === "aborted") {
    if (existing) {
      currentMessages[targetIndex] = {
        ...existing,
        pending: false,
        error:
          state === "error"
            ? (typeof data.errorMessage === "string" ? data.errorMessage : "Run failed")
            : "Run aborted",
        parts: [
          {
            type: "text",
            text:
              state === "error"
                ? typeof data.errorMessage === "string"
                  ? data.errorMessage
                  : "Run failed."
                : "Generation stopped."
          }
        ]
      };
    }
  }

  set({
    messagesByConversation: {
      ...get().messagesByConversation,
      [sessionKey]: currentMessages
    },
    conversations: applyConversationUpdate(ensureConversation(get().conversations, sessionKey), sessionKey, {
      preview: buildPreview((currentMessages[currentMessages.length - 1] ?? existing)?.parts ?? []),
      updatedAt: nowIso(),
      isStreaming: state === "delta",
      runId: state === "delta" ? runId : null
    })
  });
}

function handleAgentEvent(
  payload: unknown,
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore
) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const event = payload as Record<string, unknown>;
  const id = typeof event.runId === "string" ? event.runId : crypto.randomUUID();
  const stream = typeof event.stream === "string" ? event.stream : "lifecycle";
  const data = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
  const phase = typeof data.phase === "string" ? data.phase : null;
  const label =
    (typeof data.tool === "string" && data.tool) ||
    (typeof data.text === "string" && data.text.slice(0, 32)) ||
    "Active agent";
  const transcriptEntry =
    (typeof data.text === "string" && data.text) ||
    (typeof data.tool === "string" && `Tool: ${data.tool}`) ||
    (phase ? `Lifecycle: ${phase}` : `Stream: ${stream}`);
  const existing = get().agents.find((agent) => agent.id === id);
  const startedAt = existing?.startedAt ?? nowIso();

  const status =
    stream === "error" || phase === "error"
      ? "error"
      : phase === "end"
        ? "done"
        : stream === "tool"
          ? "waiting"
          : "running";

  set({
    agents: updateAgent(get().agents, {
      id,
      label: existing?.label ?? label,
      status,
      sessionKey: typeof event.sessionKey === "string" ? event.sessionKey : existing?.sessionKey ?? null,
      startedAt,
      updatedAt: nowIso(),
      summary: phase === "end" ? "Completed recently." : existing?.summary,
      transcript: [...(existing?.transcript ?? []), transcriptEntry].slice(-12)
    })
  });
}
