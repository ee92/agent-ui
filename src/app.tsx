import { useCallback, useEffect, useRef, useState } from "react";
import { TaskContextCard } from "./components/tasks/task-context-card";
import { ChatComposer } from "./components/chat/chat-composer";
import { ContextBar } from "./components/chat/context-bar";
import { ConversationSidebar } from "./components/chat/conversation-sidebar";
import {
  downloadMarkdown,
  messagesToMarkdown,
  slugForFilename,
} from "./lib/export-markdown";
import { MessageCard } from "./components/chat/message-card";
import { TurnStatusLine } from "./components/chat/turn-status-line";
import { FileBrowser } from "./components/files/file-browser";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { IconButton } from "./components/ui/icon-button";
import { MenuIcon, PlusIcon } from "./components/ui/icons";
import { LoadingSkeleton } from "./components/ui/loading-skeleton";
import { OfflineBanner } from "./components/ui/offline-banner";
import { TimelinePage } from "./components/timeline/timeline-page";
import { ProjectsPage } from "./components/projects/projects-page";
import { SystemPage } from "./components/system/system-page";
import { StatusPulse } from "./components/workflow/status-pulse";
import { TaskCreateModalGlobal } from "./components/workflow/task-create-modal";
import { useTaskCreateStore } from "./lib/stores/task-create-store";
import { WorkflowDashboard } from "./components/workflow/workflow-dashboard";
import {
  useAppStore,
  useAgentsStore,
  useChatStore,
  useFilesStore,
  useUiStore
} from "./lib/store";
import { useAdapterStore } from "./lib/adapters";
import { useActivityStore } from "./lib/stores/activity-store";
import { useBlockedCount, useReviewCount, useTaskStore } from "./lib/stores/task-store-v2";
import { extractText } from "./lib/ui-utils";
import { useHashRouter, navigate } from "./lib/use-hash-router";

/* ─── Nav link helper ─── */
function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className={`relative rounded-md px-2.5 py-1.5 text-[13px] transition-all duration-200 ${
        active
          ? "font-medium text-white bg-white/[0.07]"
          : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]"
      }`}
    >
      {label}
    </button>
  );
}

function MobileTabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className={`flex-1 py-2.5 text-center text-[13px] font-medium transition-colors ${
        active ? "text-white" : "text-zinc-600"
      }`}
    >
      {active && <span className="absolute inset-x-3 -top-px h-[2px] rounded-full bg-indigo-400" />}
      <span className="relative">{label}</span>
    </button>
  );
}

/* ─── Chat view (unchanged) ─── */
function ChatView({
  title,
  sessionKey,
  conversation,
  loading,
  messages,
  draft,
  attachments,
  tasks,
  agents,
  onNewChat,
  onRetry,
  onHide,
  onTask,
  onDraftChange,
  onSend,
  onAttach,
  onRemoveAttachment,
  isStreaming,
  onCancel,
}: {
  title: string;
  sessionKey: string | null;
  conversation: ReturnType<typeof useChatStore.getState>["conversations"][number] | undefined;
  loading: boolean;
  messages: ReturnType<typeof useChatStore.getState>["messagesByConversation"][string];
  draft: string;
  attachments: ReturnType<typeof useUiStore.getState>["attachments"];
  tasks: ReturnType<typeof useTaskStore.getState>["tasks"];
  agents: ReturnType<typeof useAgentsStore.getState>["agents"];
  onNewChat: () => void;
  onRetry: (id: string) => void;
  onHide: (id: string) => void;
  onTask: (text: string) => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onAttach: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  isStreaming: boolean;
  onCancel: () => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Wraps all message children — a stable element whose height grows when
  // tokens stream into an existing bubble or a tool card expands. We observe
  // this with a ResizeObserver so in-place content growth (not just new
  // messages) keeps the bottom pinned.
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Track whether the scroll container is pinned near the bottom. Auto-scroll
  // only fires when this is true, so incoming messages don't yank the user
  // back down while they're reading earlier context.
  const [isAtBottom, setIsAtBottom] = useState(true);
  // Latest `isAtBottom` read synchronously from async observers (rAF, RO).
  // Must be updated *inline* with the measurement — a useEffect-based mirror
  // lags one render behind, which causes a race: if the user scrolls up and
  // content grows in the same frame, the RO sees a stale `true` and yanks
  // them back down.
  const isAtBottomRef = useRef(true);
  const lastMessage = messages[messages.length - 1];

  // Find linked task for this session
  const linkedTask = tasks.find((t) => {
    const sk = sessionKey;
    if (!sk) return false;
    if (t.sessionKey === sk) return true;
    const keys = (t as typeof t & { sessionKeys?: string[] }).sessionKeys;
    return keys?.includes(sk) ?? false;
  });

  // Watch the scroll container to know whether we're at the bottom. A very
  // small tolerance (4px) because any larger threshold means a casual
  // wheel/touch scroll that lands within the threshold gets treated as
  // "still pinned" and the ResizeObserver yanks the user back down on the
  // next content growth. 4px is enough to forgive sub-pixel rounding from
  // the clamp but not enough to swallow real user intent.
  //
  // Measurement runs synchronously on every scroll event and writes the ref
  // immediately — any async throttle creates a race where the ResizeObserver
  // reads a stale `true` and re-pins.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const measure = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = dist < 4;
      isAtBottomRef.current = atBottom;
      setIsAtBottom((prev) => (prev === atBottom ? prev : atBottom));
    };
    el.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => el.removeEventListener("scroll", measure);
  }, []);

  // User-scroll intent: wheel / touchmove / keyboard arrow = "I want to
  // leave the bottom." Flip the ref to false *immediately* so the next
  // ResizeObserver growth event (which can fire in the same frame as the
  // user's scroll) doesn't re-pin before the scroll event has had a chance
  // to update the ref. Without this, a casual wheel scroll of a few pixels
  // while the page is streaming feels jittery because the user's scroll
  // races the RO callback and the rAF pin used to always win.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const markManual = () => { isAtBottomRef.current = false; };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") {
        markManual();
      }
    };
    el.addEventListener("wheel", markManual, { passive: true });
    el.addEventListener("touchmove", markManual, { passive: true });
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", markManual);
      el.removeEventListener("touchmove", markManual);
      el.removeEventListener("keydown", onKey);
    };
  }, []);

  // In-place content growth (tokens streaming into a bubble, tool card
  // expanding, image loading) doesn't move scrollTop but does grow scrollHeight,
  // which pushes the old "bottom" offscreen. Observe the content wrapper and
  // re-pin whenever its size changes — but only when the user is already
  // pinned, so scrolling up to read is not disturbed. Direct scrollTop
  // assignment instead of scrollIntoView — no browser variance, no smooth-
  // scroll interception, no endRef offset math.
  //
  // No rAF pin loop — the RO fires before paint, so there's no gap frame.
  // An rAF loop makes casual user scroll impossible to escape.
  useEffect(() => {
    const target = contentRef.current;
    const el = scrollContainerRef.current;
    if (!target || !el) return;
    const ro = new ResizeObserver(() => {
      if (!isAtBottomRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, []);

  // On session switch: reset to the bottom and jump (no smooth animation —
  // we want the new session to open pre-scrolled, not animate there).
  useEffect(() => {
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [sessionKey]);

  // New content auto-scrolls only if the user is already pinned to the bottom.
  useEffect(() => {
    if (!isAtBottom) return;
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastMessage?.id, lastMessage?.pending, loading, messages.length, isAtBottom]);

  const scrollToBottom = useCallback(() => {
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  const showScrollFab = !isAtBottom && messages.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* pb-4 here (not on the scroll container) gives a fixed 16px cushion
          between the last message and the composer's top border. Because the
          padding is on the *wrapper*, the scroll container itself has no
          bottom padding — so the pin lands exactly at the last message, with
          no scroll-reachable dead space below it. */}
      <div className="relative flex min-h-0 flex-1 flex-col pb-4">
        <div
          ref={scrollContainerRef}
          className="flex min-h-0 flex-1 flex-col scroll-soft overflow-y-auto px-3 xl:px-6"
        >
          {/* ResizeObserver target — wraps everything that can grow. Must have
              no layout effect of its own; purely a handle for RO. */}
          <div ref={contentRef} className="flex min-h-full flex-col">
            <div className="flex-1" />
            {loading && <LoadingSkeleton rows={4} className="h-24 rounded-lg" />}
            {!loading && messages.length === 0 && linkedTask && (
              <TaskContextCard task={linkedTask} />
            )}
            {!loading && messages.length === 0 && !linkedTask && (
              <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
                <p className="text-lg font-medium text-white">Start something new</p>
                <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-400">
                  Send a message to get started.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className="mb-4">
                <MessageCard
                  message={message}
                  onCopy={() => void navigator.clipboard.writeText(extractText(message))}
                  onRetry={() => onRetry(message.id)}
                  onHide={() => onHide(message.id)}
                  onTask={(text) => onTask(text)}
                />
              </div>
            ))}
            <TurnStatusLine
              sessionKey={sessionKey}
              onStop={onCancel}
              onRetry={() => {
                // Stall-retry: cancel the stream, then re-send the last user
                // message if we can find one. Keeps the flow identical to the
                // per-message Retry menu action so the backend path is shared.
                onCancel();
                for (let i = messages.length - 1; i >= 0; i--) {
                  if (messages[i].role === "user") {
                    onRetry(messages[i].id);
                    return;
                  }
                }
              }}
            />
            <div ref={endRef} />
          </div>
        </div>
        {showScrollFab && (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
            className="absolute bottom-3 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-zinc-900/90 text-zinc-200 shadow-lg backdrop-blur transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-white/[0.06] bg-canvas px-2 pb-1 pt-1 xl:px-6 xl:pb-3 xl:pt-2">
        <ContextBar conversation={conversation} />
        <ChatComposer
          draft={draft}
          attachments={attachments}
          tasks={tasks}
          agents={agents}
          isStreaming={isStreaming}
          onDraftChange={onDraftChange}
          onSend={onSend}
          onCancel={onCancel}
          onAttach={onAttach}
          onRemoveAttachment={onRemoveAttachment}
        />
      </div>
    </div>
  );
}

/* ─── Main App ─── */
export function App() {
  const { route } = useHashRouter();

  const adapterType = useAdapterStore((s) => s.config.type);
  const adapterConnected = useAdapterStore((s) => s.connected);
  const connectAdapter = useAdapterStore((s) => s.connect);

  const conversations = useChatStore((s) => s.conversations);
  const sessionsReady = useChatStore((s) => s.sessionsReady);
  const messagesByConversation = useChatStore((s) => s.messagesByConversation);
  const queuedMessages = useChatStore((s) => s.queuedMessages);
  const loadingConversationKey = useChatStore((s) => s.loadingConversationKey);
  const refreshSessions = useChatStore((s) => s.refreshSessions);
  const createConversation = useChatStore((s) => s.createConversation);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancelStream = useChatStore((s) => s.cancelStream);
  const flushQueuedMessages = useChatStore((s) => s.flushQueuedMessages);
  const retryMessage = useChatStore((s) => s.retryMessage);
  const hideMessage = useChatStore((s) => s.hideMessage);
  const quickSend = useChatStore((s) => s.quickSend);

  const tasks = useTaskStore((s) => s.tasks);
  const activities = useActivityStore((s) => s.events);
  const fileEntries = useFilesStore((s) => s.fileEntries);
  const filePreview = useFilesStore((s) => s.filePreview);
  const filesReady = useFilesStore((s) => s.filesReady);
  const filesFallback = useFilesStore((s) => s.filesFallback);
  const loadFiles = useFilesStore((s) => s.loadFiles);
  const openFile = useFilesStore((s) => s.openFile);
  const agents = useAgentsStore((s) => s.agents);
  const blockedCount = useBlockedCount();
  const reviewCount = useReviewCount();

  const mobileSidebarOpen = useUiStore((s) => s.mobileSidebarOpen);
  const draft = useUiStore((s) => s.draft);
  const attachments = useUiStore((s) => s.attachments);
  const conversationSearch = useUiStore((s) => s.conversationSearch);
  const focusSearchVersion = useUiStore((s) => s.focusSearchVersion);
  const setConversationSearch = useUiStore((s) => s.setConversationSearch);
  const setDraft = useUiStore((s) => s.setDraft);
  const setActiveDraftKey = useUiStore((s) => s.setActiveDraftKey);
  const addAttachments = useUiStore((s) => s.addAttachments);
  const removeAttachment = useUiStore((s) => s.removeAttachment);
  const toggleMobileSidebar = useUiStore((s) => s.toggleMobileSidebar);
  const closeMobileSidebar = useUiStore((s) => s.closeMobileSidebar);
  const requestSearchFocus = useUiStore((s) => s.requestSearchFocus);
  const closeOverlays = useUiStore((s) => s.closeOverlays);

  const openTaskCreate = useTaskCreateStore((s) => s.openTaskCreate);

  // Derive current page and chat key from route
  const currentPage = route.page;
  const chatSessionKey = currentPage === "chat" ? route.sessionKey : null;

  // When route changes to a chat, select that conversation. Gate on
  // `adapterConnected` so a mid-stream page refresh — which paints before the
  // WS finishes connecting — still fetches /history once the adapter is up.
  // Without this, selectConversation() early-returns on `!adapter.isConnected()`
  // and the chat area stays empty until the user clicks the sidebar again.
  useEffect(() => {
    if (chatSessionKey && adapterConnected) {
      void selectConversation(chatSessionKey);
    }
  }, [chatSessionKey, adapterConnected, selectConversation]);

  // Swap the composer draft in/out per session so each conversation keeps its
  // own WIP text across switches and reloads.
  useEffect(() => {
    setActiveDraftKey(chatSessionKey);
  }, [chatSessionKey, setActiveDraftKey]);

  // Startup effects
  useEffect(() => { void connectAdapter(); }, [connectAdapter]);
  useEffect(() => {
    if (!adapterConnected) return; // Wait for adapter to connect first
    let cancelled = false;
    const initTasks = async () => {
      const store = useTaskStore.getState();
      await store.load();
      if (!cancelled) store.startPolling();
    };
    void initTasks();
    return () => {
      cancelled = true;
      useTaskStore.getState().stopPolling();
    };
  }, [adapterConnected]);

  useEffect(() => {
    if (adapterConnected) {
      void refreshSessions();
      void loadFiles();
      if (queuedMessages.length > 0) void flushQueuedMessages();
    }
  }, [adapterConnected, flushQueuedMessages, loadFiles, queuedMessages.length, refreshSessions]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); requestSearchFocus(); closeMobileSidebar(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); void createConversation(); }
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "6") {
        e.preventDefault();
        const routes = ["#/", "#/files", "#/timeline", "#/projects", "#/system"];
        navigate(routes[parseInt(e.key, 10) - 1]);
      }
      if (e.key === "Escape") {
        // Priority: if the mobile drawer is open, Escape just closes it —
        // don't also navigate away from the current page.
        if (useUiStore.getState().mobileSidebarOpen) {
          closeMobileSidebar();
          return;
        }
        if (currentPage === "chat") navigate("#/");
        closeOverlays();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileSidebar, closeOverlays, createConversation, requestSearchFocus, currentPage]);

  const selectedMessages = chatSessionKey ? messagesByConversation[chatSessionKey] ?? [] : [];
  const selectedTitle = (() => {
    if (!chatSessionKey) return "";
    const convTitle = conversations.find((c) => c.key === chatSessionKey)?.title;
    const taskTitle = tasks.find((t) => {
      if (t.sessionKey === chatSessionKey) return true;
      const keys = (t as typeof t & { sessionKeys?: string[] }).sessionKeys;
      return keys?.includes(chatSessionKey) ?? false;
    })?.title;
    // Prefer task title over generic conversation titles
    if (taskTitle && (!convTitle || convTitle === "New Chat" || convTitle === "Untitled conversation" || convTitle === chatSessionKey)) {
      return taskTitle;
    }
    return convTitle || taskTitle || "Chat";
  })();

  const openSession = (key: string) => {
    const title = conversations.find((c) => c.key === key)?.title ?? key;
    useActivityStore.getState().push("session_start", `Session opened: ${title}`, { sessionKey: key });
    navigate(`#/chat/${encodeURIComponent(key)}`);
    closeMobileSidebar();
  };

  const pageTitle =
    currentPage === "files" ? "Files"
    : currentPage === "timeline" ? "Timeline"
    : currentPage === "system" ? "System"
    : currentPage === "chat" ? selectedTitle
    : "Dashboard";

  const exportConversation = useCallback(
    async (key: string) => {
      const conv = conversations.find((c) => c.key === key);
      const title = conv?.title || "Conversation";
      let messages = messagesByConversation[key];
      // Hydrate from disk if the user hasn't opened this session yet — export
      // shouldn't force them to open it first, which is disruptive on mobile.
      if (!messages || messages.length === 0) {
        try {
          const adapter = useAdapterStore.getState().adapter;
          const raw = await adapter.sessions.history(key);
          messages = raw.map((m, i) => ({
            id: m.id || `line-${i}`,
            role: m.role,
            parts:
              m.parts && m.parts.length > 0
                ? m.parts
                : m.content && m.content.trim()
                  ? [{ type: "text" as const, text: m.content }]
                  : [],
            createdAt: m.timestamp || new Date().toISOString(),
          }));
        } catch (err) {
          console.error("[export] history fetch failed", err);
          // Fall through to whatever we have (possibly empty).
          messages = messages || [];
        }
      }
      const markdown = messagesToMarkdown(title, messages);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadMarkdown(`${slugForFilename(title)}-${stamp}.md`, markdown);
    },
    [conversations, messagesByConversation]
  );

  const sidebar = (
    <ConversationSidebar
      conversations={conversations}
      selectedConversationKey={chatSessionKey}
      search={conversationSearch}
      ready={sessionsReady}
      agents={agents}
      focusSearchVersion={focusSearchVersion}
      onSearch={setConversationSearch}
      onSelect={openSession}
      onDelete={(key) => void deleteConversation(key)}
      onRename={(key, title) => void renameConversation(key, title)}
      onExport={(key) => void exportConversation(key)}
      onNewChat={() => void createConversation()}
      onToggleFilesMode={() => navigate("#/files")}
    />
  );

  return (
    <div className="h-[100dvh] overflow-hidden bg-canvas text-white">


      <div className="relative flex h-full">
        {/* Desktop sidebar */}
        <div className="hidden w-[340px] shrink-0 border-r border-white/[0.06] xl:block">
          <div className="h-full scroll-soft overflow-y-auto p-3">{sidebar}</div>
        </div>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile header — pt safe-area so title clears the notch when viewport-fit=cover is active */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] xl:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <IconButton label="Open sidebar" onClick={toggleMobileSidebar}><MenuIcon /></IconButton>
              <p className="truncate text-base font-semibold text-white">{pageTitle}</p>
            </div>
            <IconButton label="New chat" onClick={() => void createConversation()}><PlusIcon /></IconButton>
          </div>

          <OfflineBanner
            visible={!adapterConnected}
            detail={`${adapterType} adapter`}
          />

          {/* Mobile bottom tab bar — pb safe-area keeps the labels above the home indicator */}
          <div className="fixed bottom-0 left-0 right-0 z-20 flex border-t border-white/[0.06] bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg xl:hidden">
            <MobileTabLink href="#/" label="Home" active={currentPage === "dashboard"} />
            <MobileTabLink href="#/files" label="Files" active={currentPage === "files"} />
            <MobileTabLink href="#/timeline" label="Timeline" active={currentPage === "timeline"} />
            <MobileTabLink href="#/projects" label="Projects" active={currentPage === "projects"} />
            <MobileTabLink href="#/system" label="System" active={currentPage === "system"} />
          </div>

          {/* Desktop top navigation */}
          <div className="hidden shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-0 xl:flex">
            <div className="flex items-center gap-1">
              <div className="mr-3 flex items-center gap-1.5">
                <StatusPulse connectionState={adapterConnected ? "connected" : "disconnected"} blockedCount={blockedCount} reviewCount={reviewCount} agents={agents} />
                <span className="text-[13px] font-semibold tracking-tight text-zinc-200">
                  {adapterType === "claude-code" ? "Claude Code" : adapterType === "codex" ? "Codex" : "Local"}
                </span>
              </div>
              <div className="flex items-center gap-0.5 py-2">
                <NavLink href="#/" label="Dashboard" active={currentPage === "dashboard"} />
                <NavLink href="#/files" label="Files" active={currentPage === "files"} />
                <NavLink href="#/timeline" label="Timeline" active={currentPage === "timeline"} />
                <NavLink href="#/projects" label="Projects" active={currentPage === "projects"} />
                <NavLink href="#/system" label="System" active={currentPage === "system"} />
              </div>
            </div>
            <button type="button" onClick={() => void refreshSessions()} className="rounded-md px-2.5 py-1.5 text-[13px] text-zinc-500 transition-all hover:bg-white/[0.04] hover:text-zinc-300">
              Refresh
            </button>
          </div>

          {/* Main view area — reserve space for the fixed tab bar + iOS home-indicator safe area */}
          <div className="flex min-h-0 flex-1 flex-col pb-[calc(3rem+env(safe-area-inset-bottom))] xl:pb-0">
            {currentPage === "files" ? (
              <ErrorBoundary label="Files">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 xl:p-5">
                  <FileBrowser entries={fileEntries} ready={filesReady} fallback={filesFallback} preview={filePreview} onOpen={openFile} />
                </div>
              </ErrorBoundary>
            ) : currentPage === "timeline" ? (
              <ErrorBoundary label="Timeline">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                  <TimelinePage />
                </div>
              </ErrorBoundary>
            ) : currentPage === "system" ? (
              <ErrorBoundary label="System">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                  <SystemPage />
                </div>
              </ErrorBoundary>
            ) : currentPage === "projects" ? (
              <ErrorBoundary label="Projects">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                  <ProjectsPage />
                </div>
              </ErrorBoundary>
            ) : currentPage === "chat" && chatSessionKey ? (
              <ErrorBoundary label="Chat">
                <ChatView
                  title={selectedTitle}
                  sessionKey={chatSessionKey}
                  conversation={conversations.find((c) => c.key === chatSessionKey)}
                  loading={loadingConversationKey === chatSessionKey}
                  messages={selectedMessages}
                  draft={draft}
                  attachments={attachments}
                  tasks={tasks}
                  agents={agents}
                  onNewChat={() => void createConversation()}
                  onRetry={(id) => void retryMessage(id)}
                  onHide={hideMessage}
                  onTask={(text) => {
                    const lines = text.split("\n").filter((l) => l.trim());
                    const title = (lines[0] || "").replace(/^#+\s*/, "").slice(0, 120);
                    const notes = lines.slice(1).join("\n").slice(0, 500);
                    openTaskCreate({
                      title,
                      notes,
                      sessionKey: chatSessionKey || undefined,
                      sourceLabel: `From conversation: ${selectedTitle}`,
                    });
                  }}
                  onDraftChange={setDraft}
                  onSend={() => void sendMessage()}
                  onAttach={(incoming) => void addAttachments(Array.from(incoming))}
                  onRemoveAttachment={removeAttachment}
                  isStreaming={Boolean(conversations.find((c) => c.key === chatSessionKey)?.isStreaming)}
                  onCancel={() => void cancelStream()}
                />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary label="Dashboard">
                <WorkflowDashboard
                  conversations={conversations}
                  agents={agents}
                  tasks={tasks}
                  activities={activities}
                  onOpenSession={openSession}
                  onQuickSend={quickSend}
                />
              </ErrorBoundary>
            )}
          </div>
        </div>
      </div>

      {/* Mobile sidebar drawer — backdrop fades, panel slides in from the left */}
      <div
        aria-hidden={!mobileSidebarOpen}
        className={`fixed inset-0 z-30 bg-black/60 transition-opacity duration-200 ease-out xl:hidden ${mobileSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={closeMobileSidebar}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation sidebar"
          className={`h-full w-full max-w-[340px] overflow-hidden border-r border-white/[0.06] bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-200 ease-out will-change-transform ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="h-full scroll-soft overflow-y-auto p-3">{sidebar}</div>
        </div>
      </div>

      {/* Task creation modal (global — triggered from chat, timeline, dashboard) */}
      <TaskCreateModalGlobal />
    </div>
  );
}
