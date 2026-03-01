import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useAppStore } from "./lib/store";
import type {
  AgentRun,
  AttachmentDraft,
  ChatMessage,
  Conversation,
  FileEntry,
  Task,
  TaskStatus
} from "./lib/types";

type Suggestion = {
  label: string;
  insert: string;
  meta: string;
};

const TASK_COLUMNS: Array<{ status: TaskStatus; label: string; description: string }> = [
  { status: "queue", label: "Queue", description: "Things to do" },
  { status: "active", label: "Active", description: "In progress now" },
  { status: "done", label: "Done", description: "Completed recently" }
];

function formatRelative(timestamp: string) {
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

function formatAbsolute(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatFileSize(size?: number) {
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

function fileLabelFromPath(path: string) {
  if (!path) {
    return "Workspace";
  }
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) || "Workspace";
}

function fileBreadcrumbs(path: string) {
  const segments = path.split("/").filter(Boolean);
  return [
    { label: "Workspace", path: "" },
    ...segments.map((segment, index) => ({
      label: segment,
      path: segments.slice(0, index + 1).join("/")
    }))
  ];
}

function groupConversations(conversations: Conversation[]) {
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

function extractText(message: ChatMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

function IconButton({
  label,
  onClick,
  active,
  children
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition ${
        active
          ? "border-blue-500/50 bg-blue-500/15 text-blue-200"
          : "border-white/8 bg-white/[0.03] text-zinc-300 hover:border-white/14 hover:bg-white/[0.05]"
      }`}
    >
      {children}
    </button>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m4 12 15-8-3 8 3 8z" />
      <path d="M4 12h12" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 9h10v10H9z" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 6v6h-6" />
      <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6 18 20H6L5 6" />
    </svg>
  );
}

function RenderMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const result: Array<
      | { type: "code"; code: string }
      | { type: "list"; items: string[] }
      | { type: "heading"; text: string }
      | { type: "paragraph"; text: string }
    > = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      if (line.startsWith("```")) {
        const code: string[] = [];
        index += 1;
        while (index < lines.length && !lines[index].startsWith("```")) {
          code.push(lines[index]);
          index += 1;
        }
        index += 1;
        result.push({ type: "code", code: code.join("\n") });
        continue;
      }

      if (line.startsWith("- ") || line.startsWith("* ")) {
        const items: string[] = [];
        while (index < lines.length && (lines[index].startsWith("- ") || lines[index].startsWith("* "))) {
          items.push(lines[index].slice(2));
          index += 1;
        }
        result.push({ type: "list", items });
        continue;
      }

      if (line.startsWith("#")) {
        result.push({ type: "heading", text: line.replace(/^#+\s*/, "") });
        index += 1;
        continue;
      }

      const paragraph: string[] = [];
      while (index < lines.length && lines[index].trim() && !lines[index].startsWith("```")) {
        paragraph.push(lines[index]);
        index += 1;
      }
      result.push({ type: "paragraph", text: paragraph.join(" ") });
    }

    return result;
  }, [text]);

  return (
    <div className="space-y-3 text-[14px] leading-6 text-zinc-100">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <pre
              key={`${block.type}-${index}`}
              className="overflow-x-auto rounded-2xl border border-white/8 bg-black/40 px-4 py-3 text-[13px] text-sky-200"
            >
              <code>{block.code}</code>
            </pre>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={`${block.type}-${index}`} className="space-y-2 pl-5 text-zinc-100">
              {block.items.map((item) => (
                <li key={item} className="list-disc">
                  {item}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "heading") {
          return (
            <h4 key={`${block.type}-${index}`} className="text-sm font-semibold tracking-wide text-white">
              {block.text}
            </h4>
          );
        }

        return (
          <p key={`${block.type}-${index}`} className="text-zinc-100">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

function MessageCard({
  message,
  onCopy,
  onRetry,
  onHide,
  onTask
}: {
  message: ChatMessage;
  onCopy: () => void;
  onRetry: () => void;
  onHide: () => void;
  onTask: () => void;
}) {
  if (message.hidden) {
    return null;
  }

  const isUser = message.role === "user";
  const bubbleClass = isUser
    ? "bg-blue-500 text-white shadow-[0_20px_80px_rgba(59,130,246,0.22)]"
    : "bg-white/[0.04] text-zinc-100";

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`relative max-w-[92%] rounded-3xl px-4 py-3 md:max-w-[76%] ${bubbleClass}`}>
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/60">
          <span>{isUser ? "You" : "Assistant"}</span>
          <span className="text-white/30">{formatRelative(message.createdAt)}</span>
          {message.pending && <span className="text-blue-200/80">Streaming</span>}
          {message.error && <span className="text-rose-200/80">Issue</span>}
        </div>

        <div className="space-y-3">
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return <RenderMarkdown key={`${part.type}-${index}`} text={part.text || " "} />;
            }
            if (part.type === "image") {
              return (
                <img
                  key={`${part.type}-${index}`}
                  src={part.url}
                  alt={part.alt}
                  className="max-h-72 rounded-2xl border border-white/10 object-cover"
                />
              );
            }
            return (
              <div
                key={`${part.type}-${index}`}
                className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100"
              >
                {part.name}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-200 hover:bg-black/30"
          >
            <CopyIcon />
            Copy
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-200 hover:bg-black/30"
          >
            <RetryIcon />
            Retry
          </button>
          {!isUser && (
            <button
              type="button"
              onClick={onTask}
              className="rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-200 hover:bg-black/30"
            >
              Add to tasks
            </button>
          )}
          <button
            type="button"
            onClick={onHide}
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-zinc-200 hover:bg-black/30"
          >
            <TrashIcon />
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}

function ConversationSidebar({
  conversations,
  selectedConversationKey,
  search,
  onSearch,
  onSelect,
  onDelete,
  onNewChat,
  agents,
  onSelectAgent,
  filesMode,
  onToggleFilesMode,
  fileEntries,
  onOpenFile
}: {
  conversations: Conversation[];
  selectedConversationKey: string | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (key: string) => void;
  onDelete: (key: string) => void;
  onNewChat: () => void;
  agents: AgentRun[];
  onSelectAgent: (agent: AgentRun) => void;
  filesMode: boolean;
  onToggleFilesMode: () => void;
  fileEntries: FileEntry[];
  onOpenFile: (path: string) => void;
}) {
  const filtered = useDeferredValue(
    conversations.filter((conversation) => {
      const query = search.trim().toLowerCase();
      if (!query) {
        return true;
      }
      return (
        conversation.title.toLowerCase().includes(query) || conversation.preview.toLowerCase().includes(query)
      );
    })
  );
  const grouped = groupConversations(filtered);

  return (
    <aside className="flex h-full min-w-0 flex-col overflow-hidden rounded-[2rem] border border-white/8 bg-white/[0.03] p-4 backdrop-blur-xl">
      <div className="mb-4 hidden items-center justify-between gap-3 xl:flex">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">OpenClaw</p>
          <h1 className="text-lg font-semibold text-white">Workspace</h1>
        </div>
        <div className="flex gap-2">
          <IconButton label="Toggle files" onClick={onToggleFilesMode} active={filesMode}>
            <FolderIcon />
          </IconButton>
          <IconButton label="New chat" onClick={onNewChat}>
            <PlusIcon />
          </IconButton>
        </div>
      </div>

      {filesMode ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Files</p>
              <p className="text-xs text-zinc-500">Read-only browser</p>
            </div>
            <button
              type="button"
              onClick={onToggleFilesMode}
              className="rounded-full border border-white/8 px-3 py-1 text-xs text-zinc-300"
            >
              Close
            </button>
          </div>
          <div className="scroll-soft min-h-0 space-y-1 overflow-x-hidden overflow-y-auto pr-1">
            {fileEntries.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
                No file RPC exposed yet.
              </div>
            )}
            {fileEntries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => {
                  if (entry.type === "file") {
                    onOpenFile(entry.path);
                  }
                }}
                className="flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 text-left text-base text-zinc-300 hover:bg-white/[0.04] sm:py-2 sm:text-sm"
                style={{ paddingLeft: `${12 + (entry.depth ?? 0) * 12}px` }}
              >
                <span className="text-zinc-500">{entry.type === "directory" ? "📁" : "📄"}</span>
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search conversations"
            className="mb-4 h-12 rounded-2xl border border-white/8 bg-black/20 px-4 text-base text-white outline-none placeholder:text-zinc-600 focus:border-blue-500/40 sm:h-11 sm:text-sm"
          />

          <div className="scroll-soft min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto pr-1">
            {Object.entries(grouped).map(([label, items]) =>
              items.length > 0 ? (
                <section key={label} className="space-y-2">
                  <p className="px-2 text-[11px] uppercase tracking-[0.26em] text-zinc-500">{label}</p>
                  <div className="space-y-1">
                    {items.map((conversation) => (
                      <button
                        key={conversation.key}
                        type="button"
                        onClick={() => onSelect(conversation.key)}
                        className={`w-full min-w-0 rounded-2xl px-3 py-3 text-left transition ${
                          selectedConversationKey === conversation.key
                            ? "bg-blue-500/12 text-white"
                            : "text-zinc-300 hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="truncate text-base font-medium sm:text-sm">{conversation.title}</span>
                          <span className="text-[11px] text-zinc-500">{formatRelative(conversation.updatedAt)}</span>
                        </div>
                        <p className="line-clamp-2 text-sm text-zinc-500">
                          {conversation.preview || "No messages yet"}
                        </p>
                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {conversation.isStreaming && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-blue-300">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                                Live
                              </span>
                            )}
                            <span className="text-[11px] text-zinc-600">{formatAbsolute(conversation.updatedAt)}</span>
                          </div>
                          <span
                            onClick={(event) => {
                              event.stopPropagation();
                              onDelete(conversation.key);
                            }}
                            className="rounded-full px-2 py-1 text-[11px] text-zinc-500 hover:bg-black/20 hover:text-zinc-200"
                          >
                            Delete
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null
            )}

            <section className="space-y-2 pt-2">
              <div className="flex items-center justify-between px-2">
                <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Agents</p>
                <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-400">
                  {agents.filter((agent) => agent.status === "running" || agent.status === "waiting").length} active
                </span>
              </div>
              <div className="space-y-2">
                {agents.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
                    Active runs will appear here.
                  </div>
                )}
                {agents.slice(0, 8).map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => onSelectAgent(agent)}
                    className="w-full min-w-0 rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-left text-base text-zinc-200 hover:border-white/12 sm:text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{agent.label}</span>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${
                          agent.status === "running"
                            ? "bg-emerald-500/12 text-emerald-300"
                            : agent.status === "waiting"
                              ? "bg-amber-500/12 text-amber-300"
                              : agent.status === "error"
                                ? "bg-rose-500/12 text-rose-300"
                                : "bg-white/[0.04] text-zinc-400"
                        }`}
                      >
                        {agent.status}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{agent.summary || agent.transcript.at(-1)}</p>
                    <p className="mt-2 text-[11px] text-zinc-600">Updated {formatRelative(agent.updatedAt)} ago</p>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </aside>
  );
}

function ChatComposer({
  draft,
  attachments,
  onDraftChange,
  onSend,
  onAttach,
  onRemoveAttachment,
  tasks,
  agents
}: {
  draft: string;
  attachments: AttachmentDraft[];
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onAttach: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  tasks: Task[];
  agents: AgentRun[];
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [trigger, setTrigger] = useState<"#" | "@" | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) {
      return;
    }
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [draft]);

  const updateSuggestions = (value: string) => {
    const token = value.split(/\s+/).at(-1) ?? "";
    if (token.startsWith("#")) {
      const query = token.slice(1).toLowerCase();
      const items = tasks
        .filter((task) => task.title.toLowerCase().includes(query))
        .slice(0, 5)
        .map((task) => ({
          label: task.title,
          insert: `#${task.title.replace(/\s+/g, "-")}`,
          meta: task.status
        }));
      setSuggestions(items);
      setTrigger("#");
      return;
    }
    if (token.startsWith("@")) {
      const query = token.slice(1).toLowerCase();
      const items = agents
        .filter((agent) => agent.label.toLowerCase().includes(query))
        .slice(0, 5)
        .map((agent) => ({
          label: agent.label,
          insert: `@${agent.label.replace(/\s+/g, "-")}`,
          meta: agent.status
        }));
      setSuggestions(items);
      setTrigger("@");
      return;
    }
    setSuggestions([]);
    setTrigger(null);
  };

  const applySuggestion = (suggestion: Suggestion) => {
    const tokens = draft.split(/\s+/);
    tokens[tokens.length - 1] = suggestion.insert;
    const next = tokens.join(" ");
    onDraftChange(next.endsWith(" ") ? next : `${next} `);
    setSuggestions([]);
    setTrigger(null);
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    onDraftChange(value);
    updateSuggestions(value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="rounded-[2rem] border border-white/8 bg-white/[0.03] p-3 shadow-[0_-12px_80px_rgba(0,0,0,0.28)]">
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => onRemoveAttachment(attachment.id)}
              className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-sm text-zinc-200"
            >
              {attachment.name} ×
            </button>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="mb-3 rounded-2xl border border-white/8 bg-black/40 p-2">
          <div className="mb-2 px-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            {trigger === "#" ? "Task references" : "Agent mentions"}
          </div>
          <div className="space-y-1">
            {suggestions.map((suggestion) => (
              <button
                key={`${suggestion.insert}-${suggestion.meta}`}
                type="button"
                onClick={() => applySuggestion(suggestion)}
                className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/[0.04]"
              >
                <span>{suggestion.label}</span>
                <span className="text-xs text-zinc-500">{suggestion.meta}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (event.dataTransfer.files.length > 0) {
            onAttach(event.dataTransfer.files);
          }
        }}
        className="rounded-[1.25rem] border border-white/8 bg-black/20 p-2 xl:rounded-[1.5rem] xl:p-3"
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Message OpenClaw. Use # for tasks and @ for agents."
          className="w-full resize-none xl:min-h-[56px] bg-transparent text-base leading-6 text-white outline-none placeholder:text-zinc-600"
        />
        <div className="mt-2 flex items-center justify-between gap-2 xl:mt-3 xl:flex-col xl:gap-3 xl:sm:flex-row xl:sm:items-center xl:sm:justify-between">
          <div className="hidden flex-wrap items-center gap-2 text-sm text-zinc-500 xl:flex">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-full border border-white/8 px-3 py-2 text-sm text-zinc-300 hover:bg-white/[0.04]"
            >
              Attach
            </button>
            <span>Enter to send, Shift+Enter for newline</span>
          </div>
          <button
            type="button"
            onClick={onSend}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-400 xl:h-auto xl:w-auto xl:gap-2 xl:rounded-2xl xl:px-4 xl:py-2.5 xl:text-sm xl:font-medium xl:shadow-[0_20px_60px_rgba(59,130,246,0.28)]"
          >
            <SendIcon /><span className="hidden xl:inline">Send</span>
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) {
            onAttach(event.target.files);
          }
          event.target.value = "";
        }}
      />
    </div>
  );
}

function TaskBoard({
  tasks,
  activeTaskId,
  onAdd,
  onOpen,
  onUpdate,
  onMove,
  onStartChat
}: {
  tasks: Task[];
  activeTaskId: string | null;
  onAdd: (title: string) => void;
  onOpen: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onMove: (id: string, status: TaskStatus, index: number) => void;
  onStartChat: (task: Task) => void;
}) {
  const [draft, setDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const grouped = useMemo(
    () =>
      TASK_COLUMNS.map((column) => ({
        ...column,
        tasks: tasks.filter((task) => task.status === column.status)
      })),
    [tasks]
  );

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-hidden">
      <div className="rounded-[2rem] border border-white/8 bg-white/[0.03] p-4">
        <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Task Board</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.trim()) {
                onAdd(draft);
                setDraft("");
              }
            }}
            placeholder="Quick add a task"
            className="h-12 flex-1 rounded-2xl border border-white/8 bg-black/20 px-4 text-base text-white outline-none placeholder:text-zinc-600 focus:border-blue-500/40 sm:text-sm"
          />
          <button
            type="button"
            onClick={() => {
              if (draft.trim()) {
                onAdd(draft);
                setDraft("");
              }
            }}
            className="h-12 rounded-2xl bg-white/[0.05] px-4 text-base font-medium text-white hover:bg-white/[0.08] sm:text-sm"
          >
            Add
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-x-hidden overflow-y-auto pr-1 xl:grid-cols-3 xl:overflow-visible xl:pr-0">
        {grouped.map((column) => (
          <section
            key={column.status}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggingId) {
                onMove(draggingId, column.status, column.tasks.length);
                setDraggingId(null);
              }
            }}
            className="flex min-h-[220px] min-w-0 flex-col rounded-[2rem] border border-white/8 bg-white/[0.03] p-4 sm:min-h-[240px]"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">{column.label}</h3>
                <p className="text-xs text-zinc-500">{column.description}</p>
              </div>
              <span className="rounded-full bg-black/20 px-2 py-1 text-xs text-zinc-400">
                {column.tasks.length}
              </span>
            </div>

            <div className="scroll-soft flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1">
              {column.tasks.map((task, index) => {
                const isOpen = activeTaskId === task.id;
                return (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDraggingId(task.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.stopPropagation();
                      if (draggingId) {
                        onMove(draggingId, column.status, index);
                        setDraggingId(null);
                      }
                    }}
                    className="min-w-0 rounded-3xl border border-white/8 bg-black/20 p-3"
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(isOpen ? null : task.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="mb-2 flex items-center gap-2">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                task.priority === "high"
                                  ? "bg-rose-400"
                                  : task.priority === "medium"
                                    ? "bg-amber-400"
                                    : "bg-zinc-500"
                              }`}
                            />
                            <span className="break-words text-base font-medium text-white sm:text-sm">{task.title}</span>
                          </div>
                          <p className="text-sm text-zinc-500 sm:text-xs">{formatAbsolute(task.updatedAt)}</p>
                        </div>
                        <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                          {task.status}
                        </span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
                        <textarea
                          value={task.description}
                          onChange={(event) => onUpdate(task.id, { description: event.target.value })}
                          rows={4}
                          placeholder="Add context"
                          className="w-full rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-base text-zinc-100 outline-none sm:text-sm"
                        />
                        <input
                          value={task.tags.join(", ")}
                          onChange={(event) =>
                            onUpdate(task.id, {
                              tags: event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean)
                            })
                          }
                          placeholder="tags, comma separated"
                          className="h-11 w-full rounded-2xl border border-white/8 bg-black/20 px-3 text-base text-zinc-100 outline-none sm:text-sm"
                        />
                        <div className="flex flex-wrap gap-2">
                          {(["queue", "active", "done"] as TaskStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => onUpdate(task.id, { status })}
                              className={`rounded-full px-3 py-1.5 text-xs ${
                                task.status === status
                                  ? "bg-blue-500/14 text-blue-200"
                                  : "bg-white/[0.04] text-zinc-300"
                              }`}
                            >
                              {status}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onStartChat(task)}
                            className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-zinc-200"
                          >
                            Start chat
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function FileBrowser({
  entries,
  ready,
  fallback,
  preview,
  onOpen
}: {
  entries: FileEntry[];
  ready: boolean;
  fallback: boolean;
  preview: { path: string; content: string; mimeType: string } | null;
  onOpen: (path: string) => Promise<void>;
}) {
  const gatewayToken = useAppStore((state) => state.gatewayToken);
  const [currentPath, setCurrentPath] = useState("");
  const [cache, setCache] = useState<Record<string, FileEntry[]>>({ "": entries });
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [mobilePreviewPath, setMobilePreviewPath] = useState<string | null>(null);

  useEffect(() => {
    setCache({ "": entries });
    setCurrentPath("");
    setSearch("");
    setSearchResults([]);
    setLoadingDirectory(null);
    setOpeningPath(null);
    setMobilePreviewPath(null);
  }, [entries]);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setSearching(false);
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/files/search?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${gatewayToken}` }
        });
        if (!response.ok) {
          throw new Error("search failed");
        }
        const data = (await response.json()) as {
          query: string;
          results: Array<{ path: string; name: string; type: string; size?: number }>;
        };
        if (cancelled) {
          return;
        }
        setSearchResults(
          data.results.map((entry) => ({
            path: entry.path,
            name: entry.name,
            type: entry.type === "directory" ? "directory" : "file",
            depth: 0,
            size: entry.size
          }))
        );
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [gatewayToken, search]);

  useEffect(() => {
    if (preview?.path === openingPath) {
      setOpeningPath(null);
    }
  }, [openingPath, preview?.path]);

  const loadDirectory = async (path: string) => {
    if (cache[path]) {
      setCurrentPath(path);
      return;
    }

    setLoadingDirectory(path);
    try {
      const response = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${gatewayToken}` }
      });
      if (!response.ok) {
        throw new Error("list failed");
      }
      const data = (await response.json()) as {
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
      setCache((current) => ({
        ...current,
        [path]: data.entries.map((entry) => ({
          path: entry.path,
          name: entry.name,
          type: entry.type === "directory" ? "directory" : "file",
          depth: 0,
          size: entry.size,
          childCount: entry.childCount,
          mtime: typeof entry.mtime === "number" ? new Date(entry.mtime).toISOString() : entry.mtime
        }))
      }));
      setCurrentPath(path);
    } finally {
      setLoadingDirectory((current) => (current === path ? null : current));
    }
  };

  const openFile = async (path: string) => {
    setOpeningPath(path);
    setMobilePreviewPath(path);
    await onOpen(path);
  };

  const visibleEntries = search.trim().length >= 2 ? searchResults : cache[currentPath] ?? [];
  const breadcrumbs = fileBreadcrumbs(currentPath);
  const showingSearch = search.trim().length >= 2;

  const browserPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-[2rem] border border-white/8 bg-white/[0.03] p-3 sm:p-4">
      <div className="mb-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Workspace</p>
            <h3 className="mt-1 text-base font-semibold text-white sm:text-sm">Files</h3>
          </div>
          {(loadingDirectory || searching || openingPath) && (
            <span className="inline-flex h-7 items-center rounded-full border border-white/8 px-3 text-[11px] text-zinc-400">
              Loading
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-black/20 px-3">
          <span className="text-sm text-zinc-500">🔎</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search files"
            className="h-12 w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </div>

        {!showingSearch && (
          <div className="scroll-soft flex items-center gap-1 overflow-x-auto pb-1">
            {breadcrumbs.map((crumb, index) => (
              <button
                key={crumb.path || "root"}
                type="button"
                onClick={() => void loadDirectory(crumb.path)}
                className={`shrink-0 rounded-full px-3 py-2 text-xs ${
                  index === breadcrumbs.length - 1
                    ? "bg-white/[0.06] text-white"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                }`}
              >
                {crumb.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="scroll-soft min-h-[320px] flex-1 overflow-y-auto pr-1 xl:min-h-0">
        {!ready && !cache[""]?.length ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-3xl border border-white/8 bg-white/[0.03]" />
            ))}
          </div>
        ) : fallback && !cache[""]?.length ? (
          <div className="rounded-3xl border border-dashed border-white/8 px-4 py-6 text-sm text-zinc-500">
            Unable to load files right now.
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/8 px-4 py-6 text-sm text-zinc-500">
            {showingSearch ? "No matching files." : "This folder is empty."}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleEntries.map((entry) => {
              const isDirectory = entry.type === "directory";
              const meta = isDirectory
                ? `${typeof entry.childCount === "number" ? `${entry.childCount} item${entry.childCount === 1 ? "" : "s"}` : "Folder"}`
                : formatFileSize(entry.size);

              return (
                <button
                  key={`${showingSearch ? "search" : currentPath}:${entry.path}`}
                  type="button"
                  onClick={() => {
                    if (isDirectory) {
                      setSearch("");
                      void loadDirectory(entry.path);
                      return;
                    }
                    void openFile(entry.path);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 rounded-3xl px-3 py-3 text-left hover:bg-white/[0.04]"
                >
                  <span className="text-xl">{isDirectory ? "📁" : "📄"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-100">{entry.name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {showingSearch ? entry.path : meta}
                    </span>
                  </span>
                  {!showingSearch && !isDirectory && <span className="text-xs text-zinc-500">{meta}</span>}
                  {isDirectory && <span className="text-lg text-zinc-500">›</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const previewContent =
    preview && (preview.path === mobilePreviewPath || !mobilePreviewPath) ? (
      <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-zinc-200 sm:text-sm">
        {preview.content}
      </pre>
    ) : (
      <div className="flex h-full items-center justify-center px-4 text-sm text-zinc-500">
        {openingPath ? "Opening file..." : "Choose a file to inspect."}
      </div>
    );

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-hidden xl:grid xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className={`min-h-0 min-w-0 ${mobilePreviewPath ? "hidden xl:flex" : "flex"}`}>{browserPane}</div>

      <div className={`min-h-0 min-w-0 ${mobilePreviewPath ? "flex" : "hidden xl:flex"}`}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-[2rem] border border-white/8 bg-white/[0.03] p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setMobilePreviewPath(null);
                setOpeningPath(null);
              }}
              className="inline-flex h-10 items-center rounded-full border border-white/8 px-3 text-sm text-zinc-300 xl:hidden"
            >
              Back
            </button>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Preview</p>
              <h3 className="mt-1 truncate text-base font-semibold text-white sm:text-sm">
                {mobilePreviewPath ? fileLabelFromPath(mobilePreviewPath) : preview?.path || "Select a file"}
              </h3>
            </div>
          </div>
          <div className="scroll-soft min-h-[360px] flex-1 overflow-auto rounded-3xl border border-white/8 bg-black/30 xl:min-h-0">
            {previewContent}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentTranscript({
  agent,
  onOpenSession
}: {
  agent: AgentRun | null;
  onOpenSession: (key: string) => void;
}) {
  return (
    <div className="rounded-[2rem] border border-white/8 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Agent Transcript</p>
          <h3 className="mt-1 text-sm font-semibold text-white">{agent?.label || "No agent selected"}</h3>
        </div>
        {agent?.sessionKey && (
          <button
            type="button"
            onClick={() => onOpenSession(agent.sessionKey as string)}
            className="rounded-full border border-white/8 px-3 py-1 text-xs text-zinc-300"
          >
            Open chat
          </button>
        )}
      </div>
      <div className="scroll-soft max-h-[240px] space-y-2 overflow-y-auto pr-1">
        {agent ? (
          agent.transcript.map((entry, index) => (
            <div key={`${entry}-${index}`} className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-sm text-zinc-200">
              {entry}
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
            Click an active agent in the sidebar to inspect its recent lifecycle.
          </div>
        )}
      </div>
    </div>
  );
}

export function App() {
  const connectionState = useAppStore((state) => state.connectionState);
  const connectionDetail = useAppStore((state) => state.connectionDetail);
  const gatewayUrl = useAppStore((state) => state.gatewayUrl);
  const gatewayToken = useAppStore((state) => state.gatewayToken);
  const conversations = useAppStore((state) => state.conversations);
  const selectedConversationKey = useAppStore((state) => state.selectedConversationKey);
  const messagesByConversation = useAppStore((state) => state.messagesByConversation);
  const draft = useAppStore((state) => state.draft);
  const attachments = useAppStore((state) => state.attachments);
  const conversationSearch = useAppStore((state) => state.conversationSearch);
  const tasks = useAppStore((state) => state.tasks);
  const tasksFallback = useAppStore((state) => state.tasksFallback);
  const activeTaskId = useAppStore((state) => state.activeTaskId);
  const agents = useAppStore((state) => state.agents);
  const fileEntries = useAppStore((state) => state.fileEntries);
  const filePreview = useAppStore((state) => state.filePreview);
  const filesReady = useAppStore((state) => state.filesReady);
  const filesFallback = useAppStore((state) => state.filesFallback);
  const currentPanel = useAppStore((state) => state.currentPanel);
  const mobileTab = useAppStore((state) => state.mobileTab);
  const mobileSidebarOpen = useAppStore((state) => state.mobileSidebarOpen);
  const sidebarFilesMode = useAppStore((state) => state.sidebarFilesMode);

  const connect = useAppStore((state) => state.connect);
  const setGatewayConfig = useAppStore((state) => state.setGatewayConfig);
  const setConversationSearch = useAppStore((state) => state.setConversationSearch);
  const setDraft = useAppStore((state) => state.setDraft);
  const addAttachments = useAppStore((state) => state.addAttachments);
  const removeAttachment = useAppStore((state) => state.removeAttachment);
  const refreshSessions = useAppStore((state) => state.refreshSessions);
  const createConversation = useAppStore((state) => state.createConversation);
  const selectConversation = useAppStore((state) => state.selectConversation);
  const deleteConversation = useAppStore((state) => state.deleteConversation);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const retryMessage = useAppStore((state) => state.retryMessage);
  const hideMessage = useAppStore((state) => state.hideMessage);
  const addTask = useAppStore((state) => state.addTask);
  const updateTask = useAppStore((state) => state.updateTask);
  const moveTask = useAppStore((state) => state.moveTask);
  const setActiveTaskId = useAppStore((state) => state.setActiveTaskId);
  const addTaskFromMessage = useAppStore((state) => state.addTaskFromMessage);
  const openFile = useAppStore((state) => state.openFile);
  const setCurrentPanel = useAppStore((state) => state.setCurrentPanel);
  const setMobileTab = useAppStore((state) => state.setMobileTab);
  const toggleMobileSidebar = useAppStore((state) => state.toggleMobileSidebar);
  const toggleSidebarFilesMode = useAppStore((state) => state.toggleSidebarFilesMode);

  const [urlDraft, setUrlDraft] = useState(gatewayUrl);
  const [tokenDraft, setTokenDraft] = useState(gatewayToken);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const closeMobileSidebar = () => {
    if (mobileSidebarOpen) {
      toggleMobileSidebar();
    }
  };

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    setUrlDraft(gatewayUrl);
    setTokenDraft(gatewayToken);
  }, [gatewayToken, gatewayUrl]);

  const selectedMessages = selectedConversationKey ? messagesByConversation[selectedConversationKey] ?? [] : [];
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

  const composer = (
    <ChatComposer
      draft={draft}
      attachments={attachments}
      onDraftChange={setDraft}
      onSend={() => {
        void sendMessage();
      }}
      onAttach={(files) => {
        void addAttachments(Array.from(files));
      }}
      onRemoveAttachment={removeAttachment}
      tasks={tasks}
      agents={agents}
    />
  );

  const chatPane = (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="hidden xl:flex items-center justify-between gap-3 rounded-[2rem] border border-white/8 bg-white/[0.03] px-4 py-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Gateway</p>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  connectionState === "connected"
                    ? "bg-emerald-400"
                    : connectionState === "connecting" || connectionState === "reconnecting"
                      ? "bg-amber-400"
                      : "bg-rose-400"
                }`}
              />
              <span className="text-base font-medium text-white sm:text-sm">{connectionState}</span>
              {connectionDetail && <span className="text-xs text-zinc-500">{connectionDetail}</span>}
            </div>
          </div>
        </div>

        <div className="hidden items-center gap-2 xl:flex">
          <input
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            className="h-10 w-56 rounded-2xl border border-white/8 bg-black/20 px-3 text-sm text-zinc-100 outline-none"
          />
          <input
            value={tokenDraft}
            onChange={(event) => setTokenDraft(event.target.value)}
            className="h-10 w-64 rounded-2xl border border-white/8 bg-black/20 px-3 text-sm text-zinc-100 outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setGatewayConfig(urlDraft, tokenDraft);
              connect();
            }}
            className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200"
          >
            Reconnect
          </button>
          <button
            type="button"
            onClick={() => {
              void refreshSessions();
            }}
            className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200"
          >
            Refresh
          </button>
        </div>
      </div>

      <section className="flex min-h-0 flex-1 flex-col xl:rounded-[2rem] xl:border xl:border-white/8 xl:bg-white/[0.03] xl:p-4">
            <div className="mb-4 hidden items-center justify-between gap-3 xl:flex">
              <div>
                <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Chat</p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {conversations.find((conversation) => conversation.key === selectedConversationKey)?.title ||
                    "New Chat"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  void createConversation();
                }}
                className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-2 text-base text-zinc-200 sm:text-sm"
              >
                New Chat
              </button>
            </div>

            <div className="scroll-soft min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto pr-1">
              {selectedMessages.length === 0 && (
                <div className="flex h-full items-center justify-center rounded-[2rem] border border-dashed border-white/8 bg-black/10 p-8 text-center text-base text-zinc-500 sm:text-sm">
                  Start a chat, drop in a file, or reference a task with <span className="mx-1 text-zinc-300">#</span>
                  to prime the next run.
                </div>
              )}
              {selectedMessages.map((message) => (
                <MessageCard
                  key={message.id}
                  message={message}
                  onCopy={() => {
                    void navigator.clipboard.writeText(extractText(message));
                  }}
                  onRetry={() => {
                    void retryMessage(message.id);
                  }}
                  onHide={() => hideMessage(message.id)}
                  onTask={() => {
                    void addTaskFromMessage(message.id);
                    setCurrentPanel("tasks");
                  }}
                />
              ))}
            </div>
      </section>
    </div>
  );

  const sidePanel = (
    <div className="min-h-0 flex-1">
      {currentPanel === "tasks" ? (
        <TaskBoard
          tasks={tasks}
          activeTaskId={activeTaskId}
          onAdd={(title) => {
            void addTask(title);
          }}
          onOpen={setActiveTaskId}
          onUpdate={(id, patch) => {
            void updateTask(id, patch);
          }}
          onMove={(id, status, index) => {
            void moveTask(id, status, index);
          }}
          onStartChat={(task) => {
            void (async () => {
              const key = await createConversation();
              if (!key) {
                return;
              }
              await selectConversation(key);
              setDraft(`#${task.title.replace(/\s+/g, "-")}\n\n${task.description}`);
            })();
          }}
        />
      ) : (
        <FileBrowser
          entries={fileEntries}
          ready={filesReady}
          fallback={filesFallback}
          preview={filePreview}
          onOpen={openFile}
        />
      )}
    </div>
  );

  const desktopContent = (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col gap-4">
          {chatPane}
          {composer}
        </div>

        <div className="hidden min-h-0 xl:flex xl:flex-col xl:gap-4">
          <div className="flex items-center gap-2 rounded-[2rem] border border-white/8 bg-white/[0.03] p-2">
            <button
              type="button"
              onClick={() => setCurrentPanel("tasks")}
              className={`flex-1 rounded-2xl px-4 py-2 text-sm ${
                currentPanel === "tasks" ? "bg-blue-500/14 text-blue-200" : "text-zinc-300"
              }`}
            >
              Tasks
            </button>
            <button
              type="button"
              onClick={() => setCurrentPanel("files")}
              className={`flex-1 rounded-2xl px-4 py-2 text-sm ${
                currentPanel === "files" ? "bg-blue-500/14 text-blue-200" : "text-zinc-300"
              }`}
            >
              Files
            </button>
          </div>

          {sidePanel}

          <AgentTranscript
            agent={selectedAgent}
            onOpenSession={(key) => {
              void selectConversation(key);
            }}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-canvas text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.12),transparent_24%)]" />

      <div className="relative mx-auto flex h-[100dvh] max-w-[1800px] flex-col gap-3 overflow-hidden p-3 md:p-4 xl:min-h-[100dvh] xl:h-auto xl:flex-row xl:gap-4">
        <div className="hidden w-[300px] shrink-0 xl:block">
          <ConversationSidebar
            conversations={conversations}
            selectedConversationKey={selectedConversationKey}
            search={conversationSearch}
            onSearch={setConversationSearch}
            onSelect={(key) => {
              void selectConversation(key);
            }}
            onDelete={(key) => {
              void deleteConversation(key);
            }}
            onNewChat={() => {
              void createConversation();
            }}
            agents={agents}
            onSelectAgent={(agent) => setSelectedAgentId(agent.id)}
            filesMode={sidebarFilesMode}
            onToggleFilesMode={toggleSidebarFilesMode}
            fileEntries={fileEntries}
            onOpenFile={(path) => {
              void openFile(path);
            }}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden xl:gap-4">
          <div className="flex min-h-12 items-center justify-between gap-3 rounded-[1.5rem] border border-white/8 bg-white/[0.03] px-3 py-2 xl:hidden">
            <div className="flex items-center gap-2">
              <IconButton label="Open sidebar" onClick={toggleMobileSidebar}>
                <MenuIcon />
              </IconButton>
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">OpenClaw</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">Web UI</p>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      connectionState === "connected"
                        ? "bg-emerald-400"
                        : connectionState === "disconnected"
                          ? "bg-rose-400"
                          : "bg-amber-400"
                    }`}
                  />
                </div>
              </div>
            </div>
            <div className="flex shrink-0">
              <IconButton label="New chat" onClick={() => void createConversation()}>
                <PlusIcon />
              </IconButton>
            </div>
          </div>

          <div className="min-h-0 min-w-0 flex-1">
            <div className="hidden h-full xl:block">{desktopContent}</div>

            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden xl:hidden">
              {mobileTab === "chat" && (
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
                  {chatPane}
                  <div className="shrink-0">{composer}</div>
                </div>
              )}
              {mobileTab === "tasks" && (
                <div className="min-h-0 flex-1 overflow-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
                  <TaskBoard
                    tasks={tasks}
                    activeTaskId={activeTaskId}
                    onAdd={(title) => {
                      void addTask(title);
                    }}
                    onOpen={setActiveTaskId}
                    onUpdate={(id, patch) => {
                      void updateTask(id, patch);
                    }}
                    onMove={(id, status, index) => {
                      void moveTask(id, status, index);
                    }}
                    onStartChat={(task) => {
                      void (async () => {
                        const key = await createConversation();
                        if (!key) {
                          return;
                        }
                        await selectConversation(key);
                        setMobileTab("chat");
                        setDraft(`#${task.title.replace(/\s+/g, "-")}\n\n${task.description}`);
                      })();
                    }}
                  />
                </div>
              )}
              {mobileTab === "files" && (
                <div className="min-h-0 flex-1 overflow-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
                  <FileBrowser
                    entries={fileEntries}
                    ready={filesReady}
                    fallback={filesFallback}
                    preview={filePreview}
                    onOpen={openFile}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-30 bg-black/60 p-3 transition xl:hidden ${
          mobileSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={closeMobileSidebar}
      >
        <div className="h-full w-full max-w-[340px]" onClick={(event) => event.stopPropagation()}>
          <ConversationSidebar
            conversations={conversations}
            selectedConversationKey={selectedConversationKey}
            search={conversationSearch}
            onSearch={setConversationSearch}
            onSelect={(key) => {
              void selectConversation(key);
              closeMobileSidebar();
            }}
            onDelete={(key) => {
              void deleteConversation(key);
            }}
            onNewChat={() => {
              void createConversation();
              closeMobileSidebar();
            }}
            agents={agents}
            onSelectAgent={(agent) => {
              setSelectedAgentId(agent.id);
              if (agent.sessionKey) {
                void selectConversation(agent.sessionKey);
              }
              closeMobileSidebar();
            }}
            filesMode={sidebarFilesMode}
            onToggleFilesMode={toggleSidebarFilesMode}
            fileEntries={fileEntries}
            onOpenFile={(path) => {
              void openFile(path);
              closeMobileSidebar();
            }}
          />
        </div>
      </div>

      <nav className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 rounded-[2rem] border border-white/8 bg-black/60 p-2 backdrop-blur-xl md:inset-x-4 xl:hidden">
        <div className="grid grid-cols-3 gap-2">
          {(["chat", "tasks", "files"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              className={`min-h-11 rounded-2xl px-4 py-3 text-base font-medium capitalize ${
                mobileTab === tab ? "bg-blue-500/14 text-blue-200" : "text-zinc-400"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
