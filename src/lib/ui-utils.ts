import type { ChatMessage, Conversation, FileEntry } from "./types";

export function formatRelative(timestamp: string) {
  const ms = Date.now() - Date.parse(timestamp);
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function formatAbsolute(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function formatFileSize(size?: number) {
  if (typeof size !== "number" || Number.isNaN(size)) {
    return " ";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function fileLabelFromPath(path: string) {
  if (!path) {
    return "Workspace";
  }
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) || "Workspace";
}

export function fileBreadcrumbs(path: string) {
  const segments = path.split("/").filter(Boolean);
  return [
    { label: "Workspace", path: "" },
    ...segments.map((segment, index) => ({
      label: segment,
      path: segments.slice(0, index + 1).join("/")
    }))
  ];
}

export function groupConversations(conversations: Conversation[]) {
  const now = Date.now();
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const todayMs = startToday.getTime();
  const yesterdayMs = todayMs - 24 * 60 * 60 * 1000;
  const weekMs = todayMs - 7 * 24 * 60 * 60 * 1000;

  return {
    Today: conversations.filter((item) => Date.parse(item.updatedAt) >= todayMs),
    Yesterday: conversations.filter((item) => {
      const value = Date.parse(item.updatedAt);
      return value >= yesterdayMs && value < todayMs;
    }),
    "This Week": conversations.filter((item) => {
      const value = Date.parse(item.updatedAt);
      return value >= weekMs && value < yesterdayMs;
    }),
    Older: conversations.filter((item) => Date.parse(item.updatedAt) < weekMs || Number.isNaN(now))
  };
}

export function extractText(message: ChatMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

export function buildFileEntries(
  entries: Array<{
    path: string;
    name: string;
    type: string;
    size?: number;
    childCount?: number;
    mtime?: number | string;
  }>
): FileEntry[] {
  return entries.map((entry) => ({
    path: entry.path,
    name: entry.name,
    type: entry.type === "directory" ? "directory" : "file",
    depth: 0,
    size: entry.size,
    childCount: entry.childCount,
    mtime: typeof entry.mtime === "number" ? new Date(entry.mtime).toISOString() : entry.mtime
  }));
}
