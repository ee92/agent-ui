import { useDeferredValue, useEffect, useMemo, useState } from "react";
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

  const commitRename = () => {
    if (!editingKey) {
      return;
    }
    onRename(editingKey, titleDraft);
    setEditingKey(null);
  };

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
            className="mb-4 h-12 rounded-2xl border border-white/8 bg-black/20 px-4 text-base text-white outline-none placeholder:text-zinc-600 focus:border-blue-500/40 sm:h-11 sm:text-sm"
          />
          <div className="scroll-soft min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto pr-1">
            {!ready ? <LoadingSkeleton rows={5} /> : null}
            {ready
              ? Object.entries(grouped).map(([label, items]) =>
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
                                  className="h-8 w-full rounded-xl border border-white/8 bg-black/20 px-2 text-sm text-white outline-none"
                                />
                              ) : (
                                <span
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingKey(conversation.key);
                                    setTitleDraft(conversation.title);
                                  }}
                                  className="truncate text-base font-medium sm:text-sm"
                                >
                                  {conversation.title}
                                </span>
                              )}
                              <span className="text-[11px] text-zinc-500">{formatRelative(conversation.updatedAt)}</span>
                            </div>
                            <p className="line-clamp-2 text-sm text-zinc-500">
                              {conversation.preview || "No messages yet"}
                            </p>
                            <div className="mt-2 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {conversation.isStreaming ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-blue-300">
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                                    Live
                                  </span>
                                ) : null}
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
                )
              : null}
            {ready && conversations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
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
