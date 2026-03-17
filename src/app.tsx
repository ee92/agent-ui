import { useEffect, useRef } from "react";
import { TaskContextCard } from "./components/tasks/task-context-card";
import { ChatComposer } from "./components/chat/chat-composer";
import { ConversationSidebar } from "./components/chat/conversation-sidebar";
import { MessageCard } from "./components/chat/message-card";
import { FileBrowser } from "./components/files/file-browser";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { IconButton } from "./components/ui/icon-button";
import { MenuIcon, PlusIcon } from "./components/ui/icons";
import { LoadingSkeleton } from "./components/ui/loading-skeleton";
import { OfflineBanner } from "./components/ui/offline-banner";
import { SystemFlow } from "./components/flow/system-flow";
import { TimelinePage } from "./components/timeline/timeline-page";
import { ProjectsPage } from "./components/projects/projects-page";
import { StatusPulse } from "./components/workflow/status-pulse";
import { TaskCreateModalGlobal } from "./components/workflow/task-create-modal";
import { useTaskCreateStore } from "./lib/stores/task-create-store";
import { WorkflowDashboard } from "./components/workflow/workflow-dashboard";
import {
  useAgentsStore,
  useChatStore,
  useFilesStore,
  useGatewayStore,
  useUiStore
} from "./lib/store";
import { useAdapterStore } from "./lib/adapters";
import { useActivityStore } from "./lib/stores/activity-store";
import { processGatewayEvent, recordConnectionActivity } from "./lib/stores/process-gateway-event";
import { useBlockedCount, useReviewCount, useTaskStore } from "./lib/stores/task-store-v2";
import { extractText } from "./lib/ui-utils";
import { useHashRouter, navigate } from "./lib/use-hash-router";

/* ─── Nav link helper ─── */
function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className={`text-xs transition-colors ${active ? "text-white font-medium" : "text-zinc-400 hover:text-white"}`}
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
      className={`flex-1 py-2.5 text-center text-xs font-medium transition-colors ${
        active ? "border-b-2 border-blue-400 text-white" : "text-zinc-500"
      }`}
    >
      {label}
    </button>
  );
}

/* ─── Chat view (unchanged) ─── */
function ChatView({
  title,
  sessionKey,
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
}: {
  title: string;
  sessionKey: string | null;
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
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastMessage = messages[messages.length - 1];

  // Find linked task for this session
  const linkedTask = tasks.find((t) => {
    const sk = sessionKey;
    if (!sk) return false;
    if (t.sessionKey === sk) return true;
    const keys = (t as typeof t & { sessionKeys?: string[] }).sessionKeys;
    return keys?.includes(sk) ?? false;
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastMessage?.id, lastMessage?.pending, loading, messages.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4 xl:px-6">
        <div className="flex-1" />
        {loading && <LoadingSkeleton rows={4} className="h-24 rounded-3xl" />}
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
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-white/5 bg-canvas px-3 pb-2 pt-2 xl:px-6 xl:pb-3">
        <ChatComposer
          draft={draft}
          attachments={attachments}
          tasks={tasks}
          agents={agents}
          onDraftChange={onDraftChange}
          onSend={onSend}
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

  const connectionState = useGatewayStore((s) => s.connectionState);
  const connectionDetail = useGatewayStore((s) => s.connectionDetail);
  const lastGatewayEvent = useGatewayStore((s) => s.lastGatewayEvent);
  const gatewayEventVersion = useGatewayStore((s) => s.gatewayEventVersion);
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

  // When route changes to a chat, select that conversation
  useEffect(() => {
    if (chatSessionKey) {
      void selectConversation(chatSessionKey);
    }
  }, [chatSessionKey, selectConversation]);

  // Startup effects
  useEffect(() => { void connectAdapter(); }, [connectAdapter]);
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const readyForInitialLoad =
      (adapterType === "openclaw" && connectionState === "connected") ||
      (adapterType !== "openclaw" && adapterConnected);
    if (readyForInitialLoad) {
      void refreshSessions();
      void loadFiles();
      if (queuedMessages.length > 0) void flushQueuedMessages();
    }
  }, [adapterConnected, adapterType, connectionState, flushQueuedMessages, loadFiles, queuedMessages.length, refreshSessions]);

  useEffect(() => {
    if (adapterType === "openclaw") {
      processGatewayEvent({ lastGatewayEvent });
    }
  }, [adapterType, gatewayEventVersion, lastGatewayEvent]);
  useEffect(() => {
    if (adapterType === "openclaw") {
      recordConnectionActivity(connectionState, connectionDetail);
    }
  }, [adapterType, connectionDetail, connectionState]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); requestSearchFocus(); closeMobileSidebar(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); void createConversation(); }
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        const routes = ["#/", "#/flow", "#/files", "#/timeline", "#/projects"];
        navigate(routes[parseInt(e.key, 10) - 1]);
      }
      if (e.key === "Escape") {
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
    : currentPage === "flow" ? "System Flow"
    : currentPage === "timeline" ? "Timeline"
    : currentPage === "chat" ? selectedTitle
    : "Dashboard";

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
      onNewChat={() => void createConversation()}
      onToggleFilesMode={() => navigate("#/files")}
    />
  );

  return (
    <div className="h-[100dvh] overflow-hidden bg-canvas text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.12),transparent_24%)]" />

      <div className="relative flex h-full">
        {/* Desktop sidebar */}
        <div className="hidden w-[360px] shrink-0 border-r border-white/5 xl:block">
          <div className="h-full overflow-y-auto p-3">{sidebar}</div>
        </div>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile header */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/5 px-4 py-2 xl:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <IconButton label="Open sidebar" onClick={toggleMobileSidebar}><MenuIcon /></IconButton>
              <p className="truncate text-base font-semibold text-white">{pageTitle}</p>
            </div>
            <IconButton label="New chat" onClick={() => void createConversation()}><PlusIcon /></IconButton>
          </div>

          <OfflineBanner
            visible={adapterType === "openclaw" ? connectionState !== "connected" : !adapterConnected}
            detail={adapterType === "openclaw" ? connectionDetail : `${adapterType} adapter`}
          />

          {/* Mobile bottom tab bar */}
          <div className="fixed bottom-0 left-0 right-0 z-20 flex border-t border-white/5 bg-canvas xl:hidden">
            <MobileTabLink href="#/" label="Home" active={currentPage === "dashboard"} />
            <MobileTabLink href="#/files" label="Files" active={currentPage === "files"} />
            <MobileTabLink href="#/timeline" label="Timeline" active={currentPage === "timeline"} />
            <MobileTabLink href="#/projects" label="Projects" active={currentPage === "projects"} />
          </div>

          {/* Desktop top navigation */}
          <div className="hidden shrink-0 items-center justify-between gap-3 border-b border-white/5 px-4 py-2 xl:flex">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <StatusPulse connectionState={connectionState} blockedCount={blockedCount} reviewCount={reviewCount} agents={agents} />
                <span className="text-xs font-medium text-zinc-300">OpenClaw</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <NavLink href="#/" label="Dashboard" active={currentPage === "dashboard"} />
              <NavLink href="#/flow" label="Flow" active={currentPage === "flow"} />
              <NavLink href="#/files" label="Files" active={currentPage === "files"} />
              <NavLink href="#/timeline" label="Timeline" active={currentPage === "timeline"} />
              <NavLink href="#/projects" label="Projects" active={currentPage === "projects"} />
            </div>
            <button type="button" onClick={() => void refreshSessions()} className="text-xs text-zinc-400 hover:text-white">
              Refresh
            </button>
          </div>

          {/* Main view area */}
          <div className="flex min-h-0 flex-1 flex-col pb-12 xl:pb-0">
            {currentPage === "flow" ? (
              <ErrorBoundary label="System Flow">
                <SystemFlow
                  conversations={conversations}
                  agents={agents}
                  onOpenSession={openSession}
                  onQuickSend={quickSend}
                />
              </ErrorBoundary>
            ) : currentPage === "files" ? (
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

      {/* Mobile sidebar overlay */}
      <div
        className={`fixed inset-0 z-30 bg-black/60 transition xl:hidden ${mobileSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={closeMobileSidebar}
      >
        <div className="h-full w-full max-w-[340px] overflow-hidden border-r border-white/5 bg-canvas" onClick={(e) => e.stopPropagation()}>
          <div className="h-full overflow-y-auto p-3">{sidebar}</div>
        </div>
      </div>

      {/* Task creation modal (global — triggered from chat, timeline, dashboard) */}
      <TaskCreateModalGlobal />
    </div>
  );
}
