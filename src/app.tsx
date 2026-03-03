import { useEffect, useRef, useState } from "react";
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
import { WorkflowDashboard } from "./components/workflow/workflow-dashboard";
import {
  useAgentsStore,
  useChatStore,
  useFilesStore,
  useGatewayStore,
  useUiStore
} from "./lib/store";
import { useActivityStore } from "./lib/stores/activity-store";
import { processGatewayEvent, recordConnectionActivity } from "./lib/stores/process-gateway-event";
import { useTaskStore } from "./lib/stores/task-store-v2";
import { extractText } from "./lib/ui-utils";

function ChatView({
  title,
  loading,
  messages,
  draft,
  attachments,
  tasks,
  agents,
  showHeader,
  onNewChat,
  onRetry,
  onHide,
  onDraftChange,
  onSend,
  onAttach,
  onRemoveAttachment,
  onBack,
}: {
  title: string;
  loading: boolean;
  messages: ReturnType<typeof useChatStore.getState>["messagesByConversation"][string];
  draft: string;
  attachments: ReturnType<typeof useUiStore.getState>["attachments"];
  tasks: ReturnType<typeof useTaskStore.getState>["tasks"];
  agents: ReturnType<typeof useAgentsStore.getState>["agents"];
  showHeader: boolean;
  onNewChat: () => void;
  onRetry: (id: string) => void;
  onHide: (id: string) => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onAttach: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  onBack?: () => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastMessage?.id, lastMessage?.pending, loading, messages.length]);

  return (
    <div className="flex h-full flex-col">
      {showHeader && (
        <div className="flex shrink-0 items-center gap-3 border-b border-white/5 px-4 py-2">
          {onBack && (
            <button type="button" onClick={onBack} className="text-sm text-zinc-400 hover:text-white">
              ← Back
            </button>
          )}
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onNewChat}
            className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/[0.08]"
          >
            New
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4 xl:px-6">
        <div className="flex-1" />
        {loading && <LoadingSkeleton rows={4} className="h-24 rounded-3xl" />}
        {!loading && messages.length === 0 && (
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
              onTask={() => {}}
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

export function App() {
  const connectionState = useGatewayStore((s) => s.connectionState);
  const connectionDetail = useGatewayStore((s) => s.connectionDetail);
  const lastGatewayEvent = useGatewayStore((s) => s.lastGatewayEvent);
  const gatewayEventVersion = useGatewayStore((s) => s.gatewayEventVersion);
  const connect = useGatewayStore((s) => s.connect);

  const conversations = useChatStore((s) => s.conversations);
  const sessionsReady = useChatStore((s) => s.sessionsReady);
  const selectedConversationKey = useChatStore((s) => s.selectedConversationKey);
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

  const mobileSidebarOpen = useUiStore((s) => s.mobileSidebarOpen);
  const sidebarFilesMode = useUiStore((s) => s.sidebarFilesMode);
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
  const toggleSidebarFilesMode = useUiStore((s) => s.toggleSidebarFilesMode);
  const requestSearchFocus = useUiStore((s) => s.requestSearchFocus);
  const closeOverlays = useUiStore((s) => s.closeOverlays);

  // Main view state
  const [mainView, setMainView] = useState<"home" | "files" | "flow" | null>("home");
  const showingChat = selectedConversationKey !== null && mainView === null;



  useEffect(() => { connect(); }, [connect]);
  useEffect(() => { void useTaskStore.getState().load(); }, []);

  useEffect(() => {
    if (connectionState === "connected") {
      void refreshSessions();
      void loadFiles();
      if (queuedMessages.length > 0) void flushQueuedMessages();
    }
  }, [connectionState, flushQueuedMessages, loadFiles, queuedMessages.length, refreshSessions]);

  useEffect(() => { processGatewayEvent({ lastGatewayEvent }); }, [gatewayEventVersion, lastGatewayEvent]);

  useEffect(() => {
    recordConnectionActivity(connectionState, connectionDetail);
  }, [connectionDetail, connectionState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); requestSearchFocus(); closeMobileSidebar(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); void createConversation(); }
      if (e.key === "Escape") {
        if (showingChat) {
          // Deselect → go back to the dashboard
          useChatStore.setState({ selectedConversationKey: null });
        }
        closeOverlays();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileSidebar, closeOverlays, createConversation, requestSearchFocus, showingChat]);

  const selectedMessages = selectedConversationKey ? messagesByConversation[selectedConversationKey] ?? [] : [];
  const selectedTitle = conversations.find((c) => c.key === selectedConversationKey)?.title || "New Chat";

  const goHome = () => {
    setMainView("home");
  };

  const openFiles = () => {
    setMainView("files");
  };

  const openFlow = () => {
    setMainView("flow");
  };

  const openSession = (key: string) => {
    setMainView(null);
    const title = conversations.find((conversation) => conversation.key === key)?.title ?? key;
    useActivityStore.getState().push("session_start", `Session opened: ${title}`, { sessionKey: key });
    void selectConversation(key);
    closeMobileSidebar();
  };

  const sidebar = (
    <ConversationSidebar
      conversations={conversations}
      selectedConversationKey={selectedConversationKey}
      search={conversationSearch}
      ready={sessionsReady}
      agents={agents}
      focusSearchVersion={focusSearchVersion}
      onSearch={setConversationSearch}
      onSelect={openSession}
      onDelete={(key) => void deleteConversation(key)}
      onRename={(key, title) => void renameConversation(key, title)}
      onNewChat={() => void createConversation()}
      onToggleFilesMode={openFiles}
    />
  );

  return (
    <div className="h-[100dvh] overflow-hidden bg-canvas text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.12),transparent_24%)]" />

      <div className="relative flex h-full">
        {/* Desktop sidebar */}
        <div className="hidden w-[300px] shrink-0 border-r border-white/5 xl:block">
          <div className="h-full overflow-y-auto p-3">{sidebar}</div>
        </div>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile header */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/5 px-4 py-2 xl:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <IconButton label="Open sidebar" onClick={toggleMobileSidebar}><MenuIcon /></IconButton>
              {(showingChat || mainView === "files" || mainView === "flow") ? (
                <button type="button" onClick={goHome} className="text-sm text-zinc-400 hover:text-white">←</button>
              ) : null}
              <p className="truncate text-base font-semibold text-white">
                {mainView === "files" ? "Files" : mainView === "flow" ? "System Flow" : showingChat ? selectedTitle : "Dashboard"}
              </p>
            </div>
            <IconButton label="New chat" onClick={() => void createConversation()}><PlusIcon /></IconButton>
          </div>

          <OfflineBanner visible={connectionState !== "connected"} detail={connectionDetail} />

          {/* Mobile tab bar: visible on home/flow views */}
          {(mainView === "home" || mainView === "flow") && (
            <div className="flex border-b border-white/5 xl:hidden">
              <button
                type="button"
                onClick={goHome}
                className={`flex-1 py-2.5 text-center text-xs font-medium transition-colors ${
                  mainView === "home"
                    ? "border-b-2 border-blue-400 text-white"
                    : "text-zinc-500"
                }`}
              >
                Dashboard
              </button>
              <button
                type="button"
                onClick={openFlow}
                className={`flex-1 py-2.5 text-center text-xs font-medium transition-colors ${
                  mainView === "flow"
                    ? "border-b-2 border-blue-400 text-white"
                    : "text-zinc-500"
                }`}
              >
                Flow
              </button>
            </div>
          )}

          {/* Desktop: connection indicator */}
          <div className="hidden shrink-0 items-center justify-between gap-3 border-b border-white/5 px-4 py-2 xl:flex">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${
                connectionState === "connected" ? "bg-emerald-400"
                : connectionState === "connecting" || connectionState === "reconnecting" ? "bg-amber-400"
                : "bg-rose-400"
              }`} />
              <span className="text-xs text-zinc-400">{connectionState}</span>
            </div>
            <div className="flex items-center gap-3">
              {(showingChat || mainView === "files" || mainView === "flow") && (
                <button type="button" onClick={goHome} className="text-xs text-zinc-400 hover:text-white">
                  ← Dashboard
                </button>
              )}
              <button
                type="button"
                onClick={openFlow}
                className={`text-xs transition-colors ${mainView === "flow" ? "text-white font-medium" : "text-zinc-400 hover:text-white"}`}
              >
                Flow
              </button>
              <button type="button" onClick={openFiles} className="text-xs text-zinc-400 hover:text-white">
                Files
              </button>
              <button type="button" onClick={() => void refreshSessions()} className="text-xs text-zinc-400 hover:text-white">
                Refresh
              </button>
            </div>
          </div>

          {/* Main view: dashboard, files, or chat */}
          <div className="flex min-h-0 flex-1 flex-col">
            {mainView === "flow" ? (
              <ErrorBoundary label="System Flow">
                <SystemFlow
                  conversations={conversations}
                  agents={agents}
                  onOpenSession={openSession}
                  onQuickSend={quickSend}
                />
              </ErrorBoundary>
            ) : mainView === "files" ? (
              <ErrorBoundary label="Files">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 xl:p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <button type="button" onClick={goHome} className="text-sm text-zinc-400 hover:text-white">← Back</button>
                    <h2 className="text-base font-semibold text-white">Files</h2>
                  </div>
                  <FileBrowser entries={fileEntries} ready={filesReady} fallback={filesFallback} preview={filePreview} onOpen={openFile} />
                </div>
              </ErrorBoundary>
            ) : showingChat ? (
              <ErrorBoundary label="Chat">
                <ChatView
                  title={selectedTitle}
                  loading={loadingConversationKey === selectedConversationKey}
                  messages={selectedMessages}
                  draft={draft}
                  attachments={attachments}
                  tasks={tasks}
                  agents={agents}
                  showHeader={false}
                  onNewChat={() => void createConversation()}
                  onRetry={(id) => void retryMessage(id)}
                  onHide={hideMessage}
                  onDraftChange={setDraft}
                  onSend={() => void sendMessage()}
                  onAttach={(incoming) => void addAttachments(Array.from(incoming))}
                  onRemoveAttachment={removeAttachment}
                  onBack={goHome}
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
    </div>
  );
}
