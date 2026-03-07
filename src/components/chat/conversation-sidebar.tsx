import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun, Conversation } from "../../lib/types";
import { formatAbsolute, formatRelative, groupConversations } from "../../lib/ui-utils";
import { FolderIcon, PlusIcon } from "../ui/icons";
import { IconButton } from "../ui/icon-button";
import { LoadingSkeleton } from "../ui/loading-skeleton";

type FilterChannel = string | null; // null = all
type FilterKind = Conversation["kind"] | null; // null = all

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  discord: "Discord",
  webchat: "Web",
  signal: "Signal",
  whatsapp: "WhatsApp",
  slack: "Slack",
  irc: "IRC",
};

const KIND_LABELS: Record<string, string> = {
  direct: "Direct",
  group: "Group",
  global: "Global",
};

function FilterChip({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30"
          : "bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-300"
      }`}
    >
      {label}
      {typeof count === "number" && count > 0 ? (
        <span className="ml-1 text-[10px] opacity-60">{count}</span>
      ) : null}
    </button>
  );
}

export function ConversationSidebar({
  conversations,
  selectedConversationKey,
  search,
  ready,
  agents,
  focusSearchVersion,
  onSearch,
  onSelect,
  onDelete,
  onRename,
  onNewChat,
  onToggleFilesMode,
}: {
  conversations: Conversation[];
  selectedConversationKey: string | null;
  search: string;
  ready: boolean;
  agents: AgentRun[];
  focusSearchVersion: number;
  onSearch: (value: string) => void;
  onSelect: (key: string) => void;
  onDelete: (key: string) => void;
  onRename: (key: string, title: string) => void;
  onNewChat: () => void;
  onToggleFilesMode: () => void;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [actionsKey, setActionsKey] = useState<string | null>(null);
  const [filterChannel, setFilterChannel] = useState<FilterChannel>(null);
  const [filterKind, setFilterKind] = useState<FilterKind>(null);
  const [showFilters, setShowFilters] = useState(false);
  const revealTimerRef = useRef<number | null>(null);
  const longPressKeyRef = useRef<string | null>(null);

  // Derive available channels and kinds from data
  const availableChannels = useMemo(() => {
    const channels = new Map<string, number>();
    for (const c of conversations) {
      const ch = c.channel || "unknown";
      channels.set(ch, (channels.get(ch) || 0) + 1);
    }
    return channels;
  }, [conversations]);

  const availableKinds = useMemo(() => {
    const kinds = new Map<string, number>();
    for (const c of conversations) {
      const k = c.kind || "unknown";
      kinds.set(k, (kinds.get(k) || 0) + 1);
    }
    return kinds;
  }, [conversations]);

  const activeFilterCount = (filterChannel ? 1 : 0) + (filterKind ? 1 : 0);

  const filtered = useDeferredValue(
    conversations.filter((conversation) => {
      // Channel filter
      if (filterChannel && (conversation.channel || "unknown") !== filterChannel) {
        return false;
      }
      // Kind filter
      if (filterKind && (conversation.kind || "unknown") !== filterKind) {
        return false;
      }
      // Search filter
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
          <IconButton label="Browse files" onClick={onToggleFilesMode}>
            <FolderIcon />
          </IconButton>
          <IconButton label="New chat" onClick={onNewChat}>
            <PlusIcon />
          </IconButton>
        </div>
      </div>
      <>
          <div className="mb-3 flex items-center gap-2">
            <input
              data-conversation-search="true"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search conversations"
              className="h-10 min-w-0 flex-1 rounded-2xl bg-black/20 px-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-blue-500/40"
            />
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition ${
                showFilters || activeFilterCount > 0
                  ? "bg-blue-500/15 text-blue-300"
                  : "bg-black/20 text-zinc-500 hover:text-zinc-300"
              }`}
              title="Toggle filters"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1.5 3h13M4 8h8M6 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {activeFilterCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
          </div>
          {showFilters ? (
            <div className="mb-3 space-y-2 rounded-2xl bg-black/15 p-2.5">
              {/* Channel filters */}
              {availableChannels.size > 1 ? (
                <div>
                  <p className="mb-1.5 px-1 text-[10px] uppercase tracking-[0.2em] text-zinc-600">Channel</p>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip
                      label="All"
                      active={filterChannel === null}
                      onClick={() => setFilterChannel(null)}
                    />
                    {Array.from(availableChannels.entries())
                      .sort((a, b) => b[1] - a[1])
                      .map(([ch, count]) => (
                        <FilterChip
                          key={ch}
                          label={CHANNEL_LABELS[ch] || ch}
                          active={filterChannel === ch}
                          count={count}
                          onClick={() => setFilterChannel(filterChannel === ch ? null : ch)}
                        />
                      ))}
                  </div>
                </div>
              ) : null}
              {/* Kind filters */}
              {availableKinds.size > 1 ? (
                <div>
                  <p className="mb-1.5 px-1 text-[10px] uppercase tracking-[0.2em] text-zinc-600">Type</p>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip
                      label="All"
                      active={filterKind === null}
                      onClick={() => setFilterKind(null)}
                    />
                    {Array.from(availableKinds.entries())
                      .sort((a, b) => b[1] - a[1])
                      .map(([kind, count]) => (
                        <FilterChip
                          key={kind}
                          label={KIND_LABELS[kind] || kind}
                          active={filterKind === kind}
                          count={count}
                          onClick={() => setFilterKind(filterKind === kind ? null : (kind as FilterKind))}
                        />
                      ))}
                  </div>
                </div>
              ) : null}
              {/* Clear all filters */}
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={() => { setFilterChannel(null); setFilterKind(null); }}
                  className="mt-1 text-[11px] text-zinc-500 hover:text-zinc-300"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}
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
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className="truncate text-[11px] text-zinc-600">{formatAbsolute(conversation.updatedAt)}</span>
                                  {conversation.channel ? (
                                    <span className="shrink-0 rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
                                      {CHANNEL_LABELS[conversation.channel] || conversation.channel}
                                    </span>
                                  ) : null}
                                </div>
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
                    onClick={() => agent.sessionKey && onSelect(agent.sessionKey)}
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
    </aside>
  );
}
