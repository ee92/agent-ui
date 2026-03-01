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

function ChatSection({
  title,
  loading,
  messages,
  onNewChat,
  onRetry,
  onHide,
  onTask
}: {
  title: string;
  loading: boolean;
  messages: ReturnType<typeof useChatStore.getState>["messagesByConversation"][string];
  onNewChat: () => void;
  onRetry: (id: string) => void;
  onHide: (id: string) => void;
  onTask: (id: string) => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastMessage?.id, lastMessage?.pending, loading, messages.length]);

  return (
    <section className="flex min-h-0 flex-1 flex-col xl:rounded-[2rem] xl:border xl:border-white/8 xl:bg-white/[0.03] xl:p-4">
      <div className="mb-4 hidden items-center justify-between gap-3 xl:flex">
        <div>
          <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">Chat</p>
          <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onNewChat}
          className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200"
        >
          New Chat
        </button>
      </div>
      <div className="scroll-soft min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-1 pb-2 xl:pr-1 xl:pl-0">
        {loading ? <LoadingSkeleton rows={4} className="h-24 rounded-3xl" /> : null}
        {!loading && messages.length === 0 ? (
          <div className="flex h-full min-h-[40svh] flex-col items-center justify-center rounded-[2rem] bg-gradient-to-b from-white/[0.05] to-white/[0.02] px-8 text-center">
            <p className="text-lg font-medium text-white">Start something new</p>
            <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-400">
              Send a message, drop in a file, or reference a task with <span className="text-zinc-200">#</span>.
            </p>
          </div>
        ) : null}
        {messages.map((message) => (
          <MessageCard
            key={message.id}
            message={message}
            onCopy={() => void navigator.clipboard.writeText(extractText(message))}
            onRetry={() => onRetry(message.id)}
            onHide={() => onHide(message.id)}
            onTask={() => onTask(message.id)}
          />
        ))}
        <div ref={endRef} />
      </div>
    </section>
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

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    void useTaskStore.getState().load();
  }, []);

  useEffect(() => {
    setUrlDraft(gatewayUrl);
    setTokenDraft(gatewayToken);
  }, [gatewayToken, gatewayUrl]);

  useEffect(() => {
    if (connectionState === "connected") {
      void refreshSessions();
      void loadFiles();
      if (queuedMessages.length > 0) {
        void flushQueuedMessages();
      }
    }
  }, [connectionState, flushQueuedMessages, loadFiles, queuedMessages.length, refreshSessions]);

  useEffect(() => {
    processGatewayEvent({ lastGatewayEvent });
  }, [gatewayEventVersion, lastGatewayEvent]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        requestSearchFocus();
        closeMobileSidebar();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createConversation();
      }
      if (event.key === "Escape") {
        closeOverlays();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileSidebar, closeOverlays, createConversation, requestSearchFocus]);

  const selectedMessages = selectedConversationKey ? messagesByConversation[selectedConversationKey] ?? [] : [];
  const selectedTitle =
    conversations.find((conversation) => conversation.key === selectedConversationKey)?.title || "New Chat";
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

  const openTaskSession = (key: string, mobile = false) => {
    void selectConversation(key);
    if (mobile) {
      setMobileTab("chat");
    }
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

  const composer = (
    <ChatComposer
      draft={draft}
      attachments={attachments}
      tasks={tasks}
      agents={agents}
      onDraftChange={setDraft}
      onSend={() => void sendMessage()}
      onAttach={(incoming) => void addAttachments(Array.from(incoming))}
      onRemoveAttachment={removeAttachment}
    />
  );

  const panel = currentPanel === "tasks"
    ? (
        <TaskList
          tasks={tasks}
          visibleTasks={visibleTasks}
          currentSessionKey={selectedConversationKey}
          onOpenSession={(key) => openTaskSession(key)}
        />
      )
    : <FileBrowser entries={fileEntries} ready={filesReady} fallback={filesFallback} preview={filePreview} onOpen={openFile} />;

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-canvas text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(14,165,233,0.12),transparent_24%)]" />
      <div className="relative mx-auto flex h-[100dvh] max-w-[1800px] flex-col gap-3 overflow-hidden px-3 pb-0 pt-3 md:p-4 xl:h-auto xl:min-h-[100dvh] xl:flex-row xl:gap-4">
        <div className="hidden w-[300px] shrink-0 xl:block">{sidebar}</div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden xl:gap-4">
          <div className="flex min-h-12 items-center justify-between gap-3 px-1 py-1 xl:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <IconButton label="Open sidebar" onClick={toggleMobileSidebar}>
                <MenuIcon />
              </IconButton>
              <p className="truncate text-base font-semibold text-white">OpenClaw</p>
            </div>
            <IconButton label="New chat" onClick={() => void createConversation()}>
              <PlusIcon />
            </IconButton>
          </div>
          <OfflineBanner visible={connectionState !== "connected"} detail={connectionDetail} />
          <div className="hidden items-center justify-between gap-3 rounded-[2rem] border border-white/8 bg-white/[0.03] px-4 py-3 xl:flex">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${connectionState === "connected" ? "bg-emerald-400" : connectionState === "connecting" || connectionState === "reconnecting" ? "bg-amber-400" : "bg-rose-400"}`} />
              <span className="text-sm text-white">{connectionState}</span>
              {connectionDetail ? <span className="text-xs text-zinc-500">{connectionDetail}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <input value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} className="h-10 w-56 rounded-2xl border border-white/8 bg-black/20 px-3 text-sm text-zinc-100 outline-none" />
              <input value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} className="h-10 w-64 rounded-2xl border border-white/8 bg-black/20 px-3 text-sm text-zinc-100 outline-none" />
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
              <button type="button" onClick={() => void refreshSessions()} className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200">
                Refresh
              </button>
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1">
            <div className="hidden h-full xl:block">
              <div className="grid min-h-0 h-full gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="flex min-h-0 flex-col gap-4">
                  <ErrorBoundary label="Chat">
                    <ChatSection
                      title={selectedTitle}
                      loading={loadingConversationKey === selectedConversationKey}
                      messages={selectedMessages}
                      onNewChat={() => void createConversation()}
                      onRetry={(id) => void retryMessage(id)}
                      onHide={hideMessage}
                      onTask={(id) => {
                        void addTaskFromMessage(id);
                        setCurrentPanel("tasks");
                      }}
                    />
                  </ErrorBoundary>
                  {composer}
                </div>
                <div className="hidden min-h-0 xl:flex xl:flex-col xl:gap-4">
                  <div className="flex items-center gap-2 rounded-[2rem] border border-white/8 bg-white/[0.03] p-2">
                    <button type="button" onClick={() => setCurrentPanel("tasks")} className={`flex-1 rounded-2xl px-4 py-2 text-sm ${currentPanel === "tasks" ? "bg-blue-500/14 text-blue-200" : "text-zinc-300"}`}>Tasks</button>
                    <button type="button" onClick={() => setCurrentPanel("files")} className={`flex-1 rounded-2xl px-4 py-2 text-sm ${currentPanel === "files" ? "bg-blue-500/14 text-blue-200" : "text-zinc-300"}`}>Files</button>
                  </div>
                  <ErrorBoundary label={currentPanel === "tasks" ? "Tasks" : "Files"}>{panel}</ErrorBoundary>
                  <ErrorBoundary label="Agents">
                    <AgentTranscript agent={selectedAgent} onOpenSession={(key) => void selectConversation(key)} />
                  </ErrorBoundary>
                </div>
              </div>
            </div>
            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden xl:hidden">
              {mobileTab === "chat" ? (
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pb-[calc(5.25rem+env(safe-area-inset-bottom))]">
                  <ErrorBoundary label="Chat">
                    <ChatSection
                      title={selectedTitle}
                      loading={loadingConversationKey === selectedConversationKey}
                      messages={selectedMessages}
                      onNewChat={() => void createConversation()}
                      onRetry={(id) => void retryMessage(id)}
                      onHide={hideMessage}
                      onTask={(id) => {
                        void addTaskFromMessage(id);
                        setMobileTab("tasks");
                      }}
                    />
                  </ErrorBoundary>
                  {composer}
                </div>
              ) : null}
              {mobileTab === "tasks" ? (
                <ErrorBoundary label="Tasks">
                  <div className="min-h-0 flex-1 overflow-hidden pb-[calc(5.25rem+env(safe-area-inset-bottom))]">
                    <TaskList
                      tasks={tasks}
                      visibleTasks={visibleTasks}
                      currentSessionKey={selectedConversationKey}
                      onOpenSession={(key) => openTaskSession(key, true)}
                    />
                  </div>
                </ErrorBoundary>
              ) : null}
              {mobileTab === "files" ? (
                <ErrorBoundary label="Files">
                  <div className="min-h-0 flex-1 overflow-hidden pb-[calc(5.25rem+env(safe-area-inset-bottom))]">
                    <FileBrowser entries={fileEntries} ready={filesReady} fallback={filesFallback} preview={filePreview} onOpen={openFile} />
                  </div>
                </ErrorBoundary>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div
        className={`fixed inset-0 z-30 bg-black/60 p-3 transition xl:hidden ${mobileSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={closeMobileSidebar}
      >
        <div className="h-full w-full max-w-[340px] overflow-hidden" onClick={(event) => event.stopPropagation()}>
          {sidebar}
        </div>
      </div>
      <MobileNav mobileTab={mobileTab} onSelect={setMobileTab} />
    </div>
  );
}
