import { useEffect, useRef, useState } from "react";
import { AgentTranscript } from "./components/agents/agent-transcript";
import { ChatComposer } from "./components/chat/chat-composer";
import { ConversationSidebar } from "./components/chat/conversation-sidebar";
import { MessageCard } from "./components/chat/message-card";
import { FileBrowser } from "./components/files/file-browser";
import { MobileNav } from "./components/layout/mobile-nav";
import { TaskList } from "./components/tasks/task-list";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { IconButton } from "./components/ui/icon-button";
import { MenuIcon, PlusIcon } from "./components/ui/icons";
import { LoadingSkeleton } from "./components/ui/loading-skeleton";
import { OfflineBanner } from "./components/ui/offline-banner";
import {
  useAgentsStore,
  useChatStore,
  useFilesStore,
  useGatewayStore,
  useUiStore
} from "./lib/store";
import { processGatewayEvent } from "./lib/stores/process-gateway-event";
import { useTaskStore, useVisibleTasks } from "./lib/stores/task-store-v2";
import { extractText } from "./lib/ui-utils";

/**
 * Chat view — messages scroll, composer always pinned at bottom.
 * Layout: flex column, messages flex-1 overflow-y-auto, composer at bottom.
 * Same pattern as ChatGPT/Claude/Gemini.
 */
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
  onTask,
  onDraftChange,
  onSend,
  onAttach,
  onRemoveAttachment,
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
  onTask: (id: string) => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onAttach: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastMessage?.id, lastMessage?.pending, loading, messages.length]);

  return (
    <div className="flex h-full flex-col">
      {/* Desktop header */}
      {showHeader ? (
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3 px-1">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Chat</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onNewChat}
            className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 hover:bg-white/[0.08]"
          >
            New Chat
          </button>
        </div>
      ) : null}

      {/* Scrollable message area — this is the key: flex-1 + overflow-y-auto */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-4 xl:px-4"
      >
        {/* Push messages to bottom when few */}
        <div className="flex-1" />

        {loading ? <LoadingSkeleton rows={4} className="h-24 rounded-3xl" /> : null}
        {!loading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
            <p className="text-lg font-medium text-white">Start something new</p>
            <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-400">
              Send a message, drop in a file, or reference a task with <span className="text-zinc-200">#</span>.
            </p>
          </div>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className="mb-4">
            <MessageCard
              message={message}
              onCopy={() => void navigator.clipboard.writeText(extractText(message))}
              onRetry={() => onRetry(message.id)}
              onHide={() => onHide(message.id)}
              onTask={() => onTask(message.id)}
            />
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Composer — always visible at bottom, never scrolls away */}
      <div className="shrink-0 border-t border-white/5 bg-canvas px-2 pb-2 pt-2 xl:px-4 xl:pb-3">
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
  const connectionState = useGatewayStore((state) => state.connectionState);
  const connectionDetail = useGatewayStore((state) => state.connectionDetail);
  const gatewayUrl = useGatewayStore((state) => state.gatewayUrl);
  const gatewayToken = useGatewayStore((state) => state.gatewayToken);
  const lastGatewayEvent = useGatewayStore((state) => state.lastGatewayEvent);
  const gatewayEventVersion = useGatewayStore((state) => state.gatewayEventVersion);
  const connect = useGatewayStore((state) => state.connect);
  const setGatewayConfig = useGatewayStore((state) => state.setGatewayConfig);

  const conversations = useChatStore((state) => state.conversations);
  const sessionsReady = useChatStore((state) => state.sessionsReady);
  const selectedConversationKey = useChatStore((state) => state.selectedConversationKey);
  const messagesByConversation = useChatStore((state) => state.messagesByConversation);
  const queuedMessages = useChatStore((state) => state.queuedMessages);
  const loadingConversationKey = useChatStore((state) => state.loadingConversationKey);
  const refreshSessions = useChatStore((state) => state.refreshSessions);
  const createConversation = useChatStore((state) => state.createConversation);
  const selectConversation = useChatStore((state) => state.selectConversation);
  const renameConversation = useChatStore((state) => state.renameConversation);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const flushQueuedMessages = useChatStore((state) => state.flushQueuedMessages);
  const retryMessage = useChatStore((state) => state.retryMessage);
  const hideMessage = useChatStore((state) => state.hideMessage);
  const addTaskFromMessage = useChatStore((state) => state.addTaskFromMessage);

  const tasks = useTaskStore((state) => state.tasks);
  const visibleTasks = useVisibleTasks();

  const fileEntries = useFilesStore((state) => state.fileEntries);
  const filePreview = useFilesStore((state) => state.filePreview);
  const filesReady = useFilesStore((state) => state.filesReady);
  const filesFallback = useFilesStore((state) => state.filesFallback);
  const loadFiles = useFilesStore((state) => state.loadFiles);
  const openFile = useFilesStore((state) => state.openFile);

  const agents = useAgentsStore((state) => state.agents);

  const currentPanel = useUiStore((state) => state.currentPanel);
  const mobileTab = useUiStore((state) => state.mobileTab);
  const mobileSidebarOpen = useUiStore((state) => state.mobileSidebarOpen);
  const sidebarFilesMode = useUiStore((state) => state.sidebarFilesMode);
  const draft = useUiStore((state) => state.draft);
  const attachments = useUiStore((state) => state.attachments);
  const conversationSearch = useUiStore((state) => state.conversationSearch);
  const focusSearchVersion = useUiStore((state) => state.focusSearchVersion);
  const setConversationSearch = useUiStore((state) => state.setConversationSearch);
  const setDraft = useUiStore((state) => state.setDraft);
  const addAttachments = useUiStore((state) => state.addAttachments);
  const removeAttachment = useUiStore((state) => state.removeAttachment);
  const setCurrentPanel = useUiStore((state) => state.setCurrentPanel);
  const setMobileTab = useUiStore((state) => state.setMobileTab);
  const toggleMobileSidebar = useUiStore((state) => state.toggleMobileSidebar);
  const closeMobileSidebar = useUiStore((state) => state.closeMobileSidebar);
  const toggleSidebarFilesMode = useUiStore((state) => state.toggleSidebarFilesMode);
  const requestSearchFocus = useUiStore((state) => state.requestSearchFocus);
  const closeOverlays = useUiStore((state) => state.closeOverlays);

  const [urlDraft, setUrlDraft] = useState(gatewayUrl);
  const [tokenDraft, setTokenDraft] = useState(gatewayToken);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => { connect(); }, [connect]);
  useEffect(() => { void useTaskStore.getState().load(); }, []);
  useEffect(() => { setUrlDraft(gatewayUrl); setTokenDraft(gatewayToken); }, [gatewayToken, gatewayUrl]);

  useEffect(() => {
    if (connectionState === "connected") {
      void refreshSessions();
      void loadFiles();
      if (queuedMessages.length > 0) void flushQueuedMessages();
    }
  }, [connectionState, flushQueuedMessages, loadFiles, queuedMessages.length, refreshSessions]);

  useEffect(() => { processGatewayEvent({ lastGatewayEvent }); }, [gatewayEventVersion, lastGatewayEvent]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); requestSearchFocus(); closeMobileSidebar(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") { event.preventDefault(); void createConversation(); }
      if (event.key === "Escape") closeOverlays();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileSidebar, closeOverlays, createConversation, requestSearchFocus]);

  const selectedMessages = selectedConversationKey ? messagesByConversation[selectedConversationKey] ?? [] : [];
  const selectedTitle = conversations.find((c) => c.key === selectedConversationKey)?.title || "New Chat";
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  const openTaskSession = (key: string, mobile = false) => {
    void selectConversation(key);
    if (mobile) setMobileTab("chat");
  };

  // Shared chat view props
  const chatViewProps = {
    title: selectedTitle,
    loading: loadingConversationKey === selectedConversationKey,
    messages: selectedMessages,
    draft,
    attachments,
    tasks,
    agents,
    onNewChat: () => void createConversation(),
    onRetry: (id: string) => void retryMessage(id),
    onHide: hideMessage,
    onDraftChange: setDraft,
    onSend: () => void sendMessage(),
    onAttach: (incoming: FileList) => void addAttachments(Array.from(incoming)),
    onRemoveAttachment: removeAttachment,
  };

  const sidebar = (
    <ConversationSidebar
      conversations={conversations}
      selectedConversationKey={selectedConversationKey}
      search={conversationSearch}
      ready={sessionsReady}
      filesMode={sidebarFilesMode}
      fileEntries={fileEntries}
      agents={agents}
      focusSearchVersion={focusSearchVersion}
      onSearch={setConversationSearch}
      onSelect={(key) => void selectConversation(key)}
      onDelete={(key) => void deleteConversation(key)}
      onRename={(key, title) => void renameConversation(key, title)}
      onNewChat={() => void createConversation()}
      onSelectAgent={(agent) => setSelectedAgentId(agent.id)}
      onToggleFilesMode={toggleSidebarFilesMode}
      onOpenFile={(path) => void openFile(path)}
    />
  );

  const panel = currentPanel === "tasks"
    ? <TaskList tasks={tasks} visibleTasks={visibleTasks} currentSessionKey={selectedConversationKey} onOpenSession={(key) => openTaskSession(key)} />
    : <FileBrowser entries={fileEntries} ready={filesReady} fallback={filesFallback} preview={filePreview} onOpen={openFile} />;

  return (
    <div className="h-[100dvh] overflow-hidden bg-canvas text-white">
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.12),transparent_24%)]" />

      <div className="relative flex h-full">
        {/* Desktop sidebar */}
        <div className="hidden w-[300px] shrink-0 border-r border-white/5 xl:block">
          <div className="h-full overflow-y-auto p-3">{sidebar}</div>
        </div>

        {/* Main content area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile header */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/5 px-4 py-2 xl:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <IconButton label="Open sidebar" onClick={toggleMobileSidebar}><MenuIcon /></IconButton>
              <p className="truncate text-base font-semibold text-white">{selectedTitle}</p>
            </div>
            <IconButton label="New chat" onClick={() => void createConversation()}><PlusIcon /></IconButton>
          </div>

          <OfflineBanner visible={connectionState !== "connected"} detail={connectionDetail} />

          {/* Desktop: connection bar (collapsible in future) */}
          <div className="hidden shrink-0 items-center justify-between gap-3 border-b border-white/5 px-4 py-2 xl:flex">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${connectionState === "connected" ? "bg-emerald-400" : connectionState === "connecting" || connectionState === "reconnecting" ? "bg-amber-400" : "bg-rose-400"}`} />
              <span className="text-xs text-zinc-400">{connectionState}</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void refreshSessions()} className="text-xs text-zinc-400 hover:text-white">Refresh</button>
            </div>
          </div>

          {/* Desktop layout: chat + side panel */}
          <div className="hidden min-h-0 flex-1 xl:flex">
            {/* Chat column */}
            <div className="flex min-w-0 flex-1 flex-col">
              <ErrorBoundary label="Chat">
                <ChatView
                  {...chatViewProps}
                  showHeader={true}
                  onTask={(id) => { void addTaskFromMessage(id); setCurrentPanel("tasks"); }}
                />
              </ErrorBoundary>
            </div>

            {/* Right panel: tasks/files + agents */}
            <div className="flex w-[380px] shrink-0 flex-col border-l border-white/5">
              <div className="flex shrink-0 items-center gap-1 border-b border-white/5 p-2">
                <button type="button" onClick={() => setCurrentPanel("tasks")} className={`flex-1 rounded-lg px-3 py-1.5 text-sm ${currentPanel === "tasks" ? "bg-blue-500/14 text-blue-200" : "text-zinc-400 hover:text-zinc-200"}`}>Tasks</button>
                <button type="button" onClick={() => setCurrentPanel("files")} className={`flex-1 rounded-lg px-3 py-1.5 text-sm ${currentPanel === "files" ? "bg-blue-500/14 text-blue-200" : "text-zinc-400 hover:text-zinc-200"}`}>Files</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <ErrorBoundary label={currentPanel === "tasks" ? "Tasks" : "Files"}>{panel}</ErrorBoundary>
              </div>
              <div className="shrink-0 border-t border-white/5 p-3">
                <ErrorBoundary label="Agents">
                  <AgentTranscript agent={selectedAgent} onOpenSession={(key) => void selectConversation(key)} />
                </ErrorBoundary>
              </div>
            </div>
          </div>

          {/* Mobile layout */}
          <div className="flex min-h-0 flex-1 flex-col xl:hidden">
            {mobileTab === "chat" ? (
              <div className="flex min-h-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
                <ErrorBoundary label="Chat">
                  <ChatView
                    {...chatViewProps}
                    showHeader={false}
                    onTask={(id) => { void addTaskFromMessage(id); setMobileTab("tasks"); }}
                  />
                </ErrorBoundary>
              </div>
            ) : null}
            {mobileTab === "tasks" ? (
              <ErrorBoundary label="Tasks">
                <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
                  <TaskList tasks={tasks} visibleTasks={visibleTasks} currentSessionKey={selectedConversationKey} onOpenSession={(key) => openTaskSession(key, true)} />
                </div>
              </ErrorBoundary>
            ) : null}
            {mobileTab === "files" ? (
              <ErrorBoundary label="Files">
                <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
                  <FileBrowser entries={fileEntries} ready={filesReady} fallback={filesFallback} preview={filePreview} onOpen={openFile} />
                </div>
              </ErrorBoundary>
            ) : null}
          </div>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      <div
        className={`fixed inset-0 z-30 bg-black/60 transition xl:hidden ${mobileSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={closeMobileSidebar}
      >
        <div className="h-full w-full max-w-[340px] overflow-hidden border-r border-white/5 bg-canvas" onClick={(event) => event.stopPropagation()}>
          <div className="h-full overflow-y-auto p-3">{sidebar}</div>
        </div>
      </div>

      <MobileNav mobileTab={mobileTab} onSelect={setMobileTab} />
    </div>
  );
}
