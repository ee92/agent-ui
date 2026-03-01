import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun, Conversation, FileEntry } from "../../lib/types";
import { formatAbsolute, formatRelative, groupConversations } from "../../lib/ui-utils";
import { FolderIcon, PlusIcon } from "../ui/icons";
import { IconButton } from "../ui/icon-button";
import { LoadingSkeleton } from "../ui/loading-skeleton";

export function ConversationSidebar({
  conversations,
  selectedConversationKey,
  search,
  ready,
  filesMode,
  fileEntries,
  agents,
  focusSearchVersion,
  onSearch,
  onSelect,
  onDelete,
  onRename,
  onNewChat,
  onSelectAgent,
  onToggleFilesMode,
  onOpenFile
}: {
  conversations: Conversation[];
  selectedConversationKey: string | null;
  search: string;
  ready: boolean;
  filesMode: boolean;
  fileEntries: FileEntry[];
  agents: AgentRun[];
  focusSearchVersion: number;
  onSearch: (value: string) => void;
  onSelect: (key: string) => void;
  onDelete: (key: string) => void;
  onRename: (key: string, title: string) => void;
  onNewChat: () => void;
  onSelectAgent: (agent: AgentRun) => void;
  onToggleFilesMode: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [actionsKey, setActionsKey] = useState<string | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const longPressKeyRef = useRef<string | null>(null);
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
  const grouped = useMemo(() => groupConversations(filtered), [filtered]);

  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>("[data-conversation-search='true']");
    input?.focus();
    input?.select();
  }, [focusSearchVersion]);

  useEffect(() => () => {
    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
    }
  }, []);

  const commitRename = () => {
    if (!editingKey) {
      return;
    }
    onRename(editingKey, titleDraft);
    setEditingKey(null);
  };

  const startRevealTimer = (key: string) => {
    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
    }
    revealTimerRef.current = window.setTimeout(() => {
      longPressKeyRef.current = key;
      setActionsKey(key);
    }, 420);
  };

  const clearRevealTimer = () => {
    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  };

  return (
    <aside className="flex h-full min-w-0 flex-col overflow-hidden rounded-[1.75rem] bg-white/[0.03] p-3 backdrop-blur-xl xl:rounded-[2rem] xl:border xl:border-white/8 xl:p-4">
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
            <button type="button" onClick={onToggleFilesMode} className="rounded-full border border-white/8 px-3 py-1 text-xs text-zinc-300">
              Close
            </button>
          </div>
          <div className="scroll-soft min-h-0 space-y-1 overflow-x-hidden overflow-y-auto pr-1">
            {fileEntries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
                No files available yet.
              </div>
            ) : null}
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
            data-conversation-search="true"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search conversations"
            className="mb-3 h-10 rounded-2xl bg-black/20 px-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-blue-500/40"
          />
          <div className="scroll-soft min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto pr-1">
            {!ready ? <LoadingSkeleton rows={5} /> : null}
            {ready
              ? Object.entries(grouped).map(([label, items]) =>
                  items.length > 0 ? (
                    <section key={label} className="space-y-2">
                      <p className="px-2 text-[11px] uppercase tracking-[0.26em] text-zinc-500">{label}</p>
                      <div className="space-y-1">
                        {items.map((conversation) => (
                          <div
                            key={conversation.key}
                            className={`w-full min-w-0 overflow-hidden rounded-2xl transition ${
                              selectedConversationKey === conversation.key
                                ? "bg-blue-500/12 text-white"
                                : "text-zinc-300 hover:bg-white/[0.04]"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                if (longPressKeyRef.current === conversation.key) {
                                  longPressKeyRef.current = null;
                                  return;
                                }
                                onSelect(conversation.key);
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setActionsKey((current) => (current === conversation.key ? null : conversation.key));
                              }}
                              onTouchStart={() => startRevealTimer(conversation.key)}
                              onTouchEnd={clearRevealTimer}
                              onTouchMove={clearRevealTimer}
                              className="w-full min-w-0 px-3 py-3 text-left"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    {(selectedConversationKey === conversation.key || conversation.isStreaming) ? (
                                      <span className={`h-2 w-2 shrink-0 rounded-full ${conversation.isStreaming ? "animate-pulse bg-blue-400" : "bg-blue-300/80"}`} />
                                    ) : null}
                                    {editingKey === conversation.key ? (
                                      <input
                                        autoFocus
                                        value={titleDraft}
                                        onBlur={commitRename}
                                        onChange={(event) => setTitleDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            commitRename();
                                          }
                                          if (event.key === "Escape") {
                                            setEditingKey(null);
                                          }
                                        }}
                                        className="h-8 w-full rounded-xl bg-black/20 px-2 text-sm font-medium text-white outline-none"
                                      />
                                    ) : (
                                      <span
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setEditingKey(conversation.key);
                                          setTitleDraft(conversation.title);
                                        }}
                                        className="truncate text-sm font-semibold text-white sm:text-base"
                                      >
                                        {conversation.title}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 line-clamp-1 text-xs text-zinc-500 sm:text-sm">
                                    {(conversation.preview.split("\n").find((line) => line.trim()) || "No messages yet").trim()}
                                  </p>
                                </div>
                                <span className="shrink-0 pt-0.5 text-[11px] font-medium text-zinc-500">
                                  {formatRelative(conversation.updatedAt)}
                                </span>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <span className="truncate text-[11px] text-zinc-600">{formatAbsolute(conversation.updatedAt)}</span>
                                <span className="text-[11px] text-zinc-600">
                                  Hold to delete
                                </span>
                              </div>
                            </button>
                            <div
                              className={`grid transition-[grid-template-rows,opacity] duration-200 ${
                                actionsKey === conversation.key ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                              }`}
                            >
                              <div className="overflow-hidden">
                                <div className="flex items-center justify-end px-3 pb-3">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onDelete(conversation.key);
                                      setActionsKey(null);
                                    }}
                                    className="min-h-11 rounded-2xl bg-rose-500/12 px-3 text-sm font-medium text-rose-200"
                                  >
                                    Delete conversation
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null
                )
              : null}
            {ready && conversations.length === 0 ? (
              <div className="rounded-2xl bg-black/10 px-3 py-4 text-sm text-zinc-500">
                No conversations yet. Start a new chat to create your first session.
              </div>
            ) : null}
            <section className="space-y-2 pt-2">
              <div className="flex items-center justify-between px-2">
                <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Agents</p>
                <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-400">
                  {agents.filter((agent) => agent.status === "running" || agent.status === "waiting").length} active
                </span>
              </div>
              <div className="space-y-2">
                {agents.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
                    Active runs will appear here.
                  </div>
                ) : null}
                {agents.slice(0, 8).map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => onSelectAgent(agent)}
                    className="w-full min-w-0 rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-left text-base text-zinc-200 hover:border-white/12 sm:text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{agent.label}</span>
                      <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
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
