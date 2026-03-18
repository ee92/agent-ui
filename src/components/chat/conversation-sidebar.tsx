import { useDeferredValue, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentRun, Conversation } from "../../lib/types";
import { useAdapterStore } from "../../lib/adapters";
import { formatAbsolute, formatRelative, groupConversations } from "../../lib/ui-utils";
import { FolderIcon, PlusIcon } from "../ui/icons";
import { IconButton } from "../ui/icon-button";
import { LoadingSkeleton } from "../ui/loading-skeleton";

type FilterChannel = string | null;

/** Which filter tab is active */
type FilterTab = "chats" | "all" | "groups" | "cron" | "agents";

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  discord: "Discord",
  webchat: "Web",
  signal: "Signal",
  whatsapp: "WhatsApp",
  slack: "Slack",
  irc: "IRC",
};

const KIND_PILL_LABELS: Record<string, string> = {
  cron: "Cron",
  group: "Group",
  global: "Global",
  agent: "Agent",
};

const KIND_PILL_COLORS: Record<string, string> = {
  cron: "bg-amber-500/15 text-amber-400",
  group: "bg-purple-500/15 text-purple-400",
  global: "bg-emerald-500/15 text-emerald-400",
  agent: "bg-cyan-500/15 text-cyan-400",
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

function KindPill({ kind }: { kind: string }) {
  const label = KIND_PILL_LABELS[kind];
  if (!label) return null;
  const colorClass = KIND_PILL_COLORS[kind] || "bg-white/[0.06] text-zinc-400";
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

function EllipsisIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

/** Check if a conversation matches a filter tab */
function matchesTab(conversation: Conversation, tab: FilterTab): boolean {
  const kind = conversation.kind || "unknown";
  switch (tab) {
    case "all":
      return true;
    case "chats":
      // Direct + unknown (exclude cron and agent)
      return kind !== "cron" && kind !== "agent";
    case "groups":
      return kind === "group" || kind === "global";
    case "cron":
      return kind === "cron";
    case "agents":
      return kind === "agent";
  }
}

/** Count conversations per tab */
function countByTab(conversations: Conversation[], tab: FilterTab): number {
  return conversations.filter((c) => matchesTab(c, tab)).length;
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
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [filterChannel, setFilterChannel] = useState<FilterChannel>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>("chats");
  const adapter = useAdapterStore((state) => state.adapter);
  const adapterType = useAdapterStore((state) => state.config.type);
  const setAdapterType = useAdapterStore((state) => state.setAdapterType);
  const revealTimerRef = useRef<number | null>(null);
  const longPressKeyRef = useRef<string | null>(null);

  const availableChannels = useMemo(() => {
    const channels = new Map<string, number>();
    for (const c of conversations) {
      const ch = c.channel || "unknown";
      channels.set(ch, (channels.get(ch) || 0) + 1);
    }
    return channels;
  }, [conversations]);

  // Count per tab for badges
  const tabCounts = useMemo(() => ({
    all: conversations.length,
    chats: countByTab(conversations, "chats"),
    groups: countByTab(conversations, "groups"),
    cron: countByTab(conversations, "cron"),
    agents: countByTab(conversations, "agents"),
  }), [conversations]);

  const filtered = useDeferredValue(
    conversations.filter((conversation) => {
      // Tab filter
      if (!matchesTab(conversation, activeTab)) return false;
      // Channel filter
      if (filterChannel && (conversation.channel || "unknown") !== filterChannel) return false;
      // Search
      const query = search.trim().toLowerCase();
      if (!query) return true;
      return (
        conversation.title.toLowerCase().includes(query) || conversation.preview.toLowerCase().includes(query)
      );
    })
  );
  const grouped = useMemo(() => groupConversations(filtered), [filtered]);
  const capabilities = adapter.capabilities();

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

  const commitRename = useCallback(() => {
    if (!editingKey) {
      return;
    }
    onRename(editingKey, titleDraft);
    setEditingKey(null);
  }, [editingKey, titleDraft, onRename]);

  const startRevealTimer = (key: string, target: HTMLElement) => {
    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
    }
    revealTimerRef.current = window.setTimeout(() => {
      longPressKeyRef.current = key;
      const rect = target.getBoundingClientRect();
      setMenuPos({ top: rect.top + 40, left: Math.max(8, rect.right - 148) });
      setMenuKey(key);
    }, 420);
  };

  const clearRevealTimer = () => {
    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  };

  const TABS: { key: FilterTab; label: string }[] = [
    { key: "chats", label: "Chats" },
    { key: "groups", label: "Groups" },
    { key: "cron", label: "Cron" },
    { key: "agents", label: "Agents" },
    { key: "all", label: "All" },
  ];

  return (
    <aside className="flex h-full min-w-0 flex-col overflow-hidden rounded-[1.75rem] bg-white/[0.03] p-3 backdrop-blur-xl xl:rounded-[2rem] xl:border xl:border-white/8 xl:p-4">
      <div className="mb-4 hidden items-center justify-between gap-3 xl:flex">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">OpenClaw</p>
          <h1 className="text-lg font-semibold text-white">Workspace</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Adapter type"
            value={adapterType}
            onChange={(event) => {
              void setAdapterType(event.target.value as "openclaw" | "claude-code" | "local");
            }}
            className="h-9 rounded-xl border border-white/10 bg-black/30 px-2 text-xs text-zinc-300 outline-none hover:border-white/20"
          >
            <option value="openclaw">OpenClaw</option>
            <option value="claude-code">Claude Code</option>
            <option value="local">Local</option>
          </select>
          <IconButton label="Browse files" onClick={onToggleFilesMode}>
            <FolderIcon />
          </IconButton>
          <IconButton label="New chat" onClick={onNewChat}>
            <PlusIcon />
          </IconButton>
        </div>
      </div>
      <>
        {/* Search */}
        <div className="mb-2">
          <input
            data-conversation-search="true"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search conversations"
            className="h-10 w-full rounded-2xl bg-black/20 px-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-blue-500/40"
          />
        </div>

        {/* Always-visible filter tabs */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {TABS.map((tab) => {
            const count = tabCounts[tab.key];
            // Hide tabs with 0 items (except "chats" and "all" which are always visible)
            if (count === 0 && tab.key !== "chats" && tab.key !== "all") return null;
            return (
              <FilterChip
                key={tab.key}
                label={tab.label}
                active={activeTab === tab.key}
                count={tab.key !== "all" && tab.key !== "chats" ? count : undefined}
                onClick={() => setActiveTab(tab.key)}
              />
            );
          })}
          {/* Channel filter chips — show if multiple channels */}
          {availableChannels.size > 1 ? (
            <>
              <span className="mx-1 h-4 w-px bg-white/10" />
              {[...availableChannels.entries()].map(([ch, count]) => (
                <FilterChip
                  key={ch}
                  label={CHANNEL_LABELS[ch] || ch}
                  active={filterChannel === ch}
                  count={count}
                  onClick={() => setFilterChannel(filterChannel === ch ? null : ch)}
                />
              ))}
            </>
          ) : null}
        </div>

        <div className="scroll-soft min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto pr-1">
          {!ready ? <LoadingSkeleton rows={5} /> : null}
          {ready
            ? Object.entries(grouped).map(([label, items]) =>
                items.length > 0 ? (
                  <section key={label} className="space-y-2">
                    <p className="px-2 text-[11px] uppercase tracking-[0.26em] text-zinc-500">{label}</p>
                    <div className="space-y-1">
                      {items.map((conversation) => {
                        const isMenuOpen = menuKey === conversation.key;
                        const isEditing = editingKey === conversation.key;
                        const isSelected = selectedConversationKey === conversation.key;
                        const kind = conversation.kind || "unknown";

                        return (
                          <div
                            key={conversation.key}
                            className={`group/conv relative w-full min-w-0 overflow-visible rounded-2xl transition ${
                              isSelected
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
                                if (isEditing) return;
                                onSelect(conversation.key);
                              }}
                              onTouchStart={(e) => startRevealTimer(conversation.key, e.currentTarget)}
                              onTouchEnd={clearRevealTimer}
                              onTouchMove={clearRevealTimer}
                              className="w-full min-w-0 px-3 py-3 text-left"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    {(isSelected || conversation.isStreaming) ? (
                                      <span className={`h-2 w-2 shrink-0 rounded-full ${conversation.isStreaming ? "animate-pulse bg-blue-400" : "bg-blue-300/80"}`} />
                                    ) : null}
                                    {isEditing ? (
                                      <input
                                        autoFocus
                                        value={titleDraft}
                                        onClick={(event) => event.stopPropagation()}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onBlur={commitRename}
                                        onChange={(event) => setTitleDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                          event.stopPropagation();
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
                                      <span className="truncate text-sm font-semibold text-white sm:text-base">
                                        {conversation.title}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 line-clamp-1 text-xs text-zinc-500 sm:text-sm">
                                    {(conversation.preview.split("\n").find((line) => line.trim()) || "No messages yet").trim()}
                                  </p>
                                </div>
                                {/* Timestamp — hidden when menu trigger visible on hover (desktop) */}
                                <span className="shrink-0 pt-0.5 text-[11px] font-medium text-zinc-500 xl:group-hover/conv:hidden">
                                  {formatRelative(conversation.updatedAt)}
                                </span>
                                {/* ⋯ menu trigger — only on desktop hover */}
                                <button
                                  ref={(el) => { if (el && isMenuOpen) el.dataset.menuAnchor = conversation.key; }}
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (isMenuOpen) {
                                      setMenuKey(null);
                                    } else {
                                      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                                      setMenuPos({ top: rect.bottom + 4, left: rect.right - 140 });
                                      setMenuKey(conversation.key);
                                    }
                                  }}
                                  className={`hidden shrink-0 rounded-lg p-1 text-zinc-500 transition hover:bg-white/10 hover:text-zinc-300 xl:group-hover/conv:block ${isMenuOpen ? "xl:!block bg-white/10 text-zinc-300" : ""}`}
                                >
                                  <EllipsisIcon />
                                </button>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className="truncate text-[11px] text-zinc-600">{formatAbsolute(conversation.updatedAt)}</span>
                                  {/* Kind pill */}
                                  <KindPill kind={kind} />
                                  {/* Channel pill */}
                                  {conversation.channel ? (
                                    <span className="shrink-0 rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
                                      {CHANNEL_LABELS[conversation.channel] || conversation.channel}
                                    </span>
                                  ) : null}
                                </div>
                                {/* Mobile hint */}
                                <span className="text-[11px] text-zinc-600 xl:hidden">
                                  Hold for options
                                </span>
                              </div>
                            </button>

                            {/* Dropdown menu — rendered via portal so it's not clipped by overflow:hidden parents */}
                            {isMenuOpen
                              ? createPortal(
                                  <>
                                    {/* Invisible backdrop — captures clicks to close menu */}
                                    <div
                                      className="fixed inset-0 z-[9998]"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        event.preventDefault();
                                        setMenuKey(null);
                                      }}
                                    />
                                    <div
                                      className="fixed z-[9999] min-w-[140px] rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-xl shadow-black/40"
                                      style={{ top: menuPos.top, left: menuPos.left }}
                                    >
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setEditingKey(conversation.key);
                                          setTitleDraft(conversation.title);
                                          setMenuKey(null);
                                        }}
                                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-zinc-300 hover:bg-white/[0.06]"
                                      >
                                        <PencilIcon />
                                        Rename
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          onDelete(conversation.key);
                                          setMenuKey(null);
                                        }}
                                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-rose-300 hover:bg-rose-500/10"
                                      >
                                        <TrashIcon />
                                        Delete
                                      </button>
                                    </div>
                                  </>,
                                  document.body,
                                )
                              : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null
              )
            : null}
          {ready && filtered.length === 0 ? (
            <div className="rounded-2xl bg-black/10 px-3 py-4 text-sm text-zinc-500">
              {conversations.length === 0
                ? "No conversations yet. Start a new chat to create your first session."
                : "No conversations match the current filter."}
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
              {!capabilities.agents ? (
                <div className="rounded-2xl border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
                  Agent monitoring requires OpenClaw gateway.
                </div>
              ) : null}
              {capabilities.agents && agents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/8 px-3 py-4 text-sm text-zinc-500">
                  Active runs will appear here.
                </div>
              ) : null}
              {capabilities.agents && agents.slice(0, 8).map((agent) => (
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
