import { useAgentsStore } from "./agents-store";
import { useActivityStore } from "./activity-store";
import { useChatStore } from "./chat-store";
import { useSessionFlowStore } from "./session-flow-store";
import type { AppStoreState } from "./shared";
import type { ConnectionState } from "../types";

const CONNECTION_DEDUPE_MS = 5 * 60 * 1000;
let lastRecordedConnectionState: ConnectionState | null = null;

function pushDedupedConnection(summary: string, metadata?: Record<string, unknown>) {
  const latestConnectionEvent = useActivityStore
    .getState()
    .events.find((entry) => entry.kind === "connection");
  if (latestConnectionEvent) {
    const age = Date.now() - Date.parse(latestConnectionEvent.timestamp);
    if (age < CONNECTION_DEDUPE_MS && latestConnectionEvent.summary === summary) {
      return;
    }
  }
  useActivityStore.getState().push("connection", summary, { metadata });
}

function buildChatSummary(data: Record<string, unknown>) {
  const sessionKey = typeof data.sessionKey === "string" ? data.sessionKey : undefined;
  const message =
    typeof data.message === "string"
      ? data.message
      : data.message && typeof data.message === "object" && typeof (data.message as Record<string, unknown>).text === "string"
        ? String((data.message as Record<string, unknown>).text)
        : "";
  const preview = message.trim().replace(/\s+/g, " ").slice(0, 80);
  if (sessionKey?.includes("cron:")) {
    return {
      kind: "cron" as const,
      summary: preview ? `Cron ran: ${preview}` : "Cron job ran",
      sessionKey,
    };
  }
  return {
    kind: "session_message" as const,
    summary: preview ? `Message in ${sessionKey ?? "session"}: ${preview}` : `Activity in ${sessionKey ?? "session"}`,
    sessionKey,
  };
}

function buildAgentSummary(event: Record<string, unknown>) {
  const data = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
  const stream = typeof event.stream === "string" ? event.stream : "lifecycle";
  const phase = typeof data.phase === "string" ? data.phase : null;
  const label =
    (typeof data.tool === "string" && data.tool) ||
    (typeof data.text === "string" && data.text.slice(0, 48)) ||
    "Agent";
  const sessionKey = typeof event.sessionKey === "string" ? event.sessionKey : undefined;

  if (stream === "error" || phase === "error") {
    return { kind: "agent_error" as const, summary: `Agent errored: ${label}`, sessionKey };
  }
  if (phase === "start") {
    return { kind: "agent_start" as const, summary: `Agent started: ${label}`, sessionKey };
  }
  if (phase === "end") {
    return { kind: "agent_done" as const, summary: `Agent finished: ${label}`, sessionKey };
  }
  return null;
}

export function recordConnectionActivity(connectionState: ConnectionState, detail = "") {
  if (lastRecordedConnectionState === connectionState) {
    return;
  }
  lastRecordedConnectionState = connectionState;

  const summary =
    connectionState === "connected"
      ? "Gateway connected"
      : connectionState === "connecting"
        ? "Gateway connecting"
        : connectionState === "reconnecting"
          ? "Gateway reconnecting"
          : "Gateway disconnected";

  pushDedupedConnection(summary, { state: connectionState, detail });
}

export function processGatewayEvent(state: Pick<AppStoreState, "lastGatewayEvent">) {
  const event = state.lastGatewayEvent;
  if (!event) {
    return;
  }
  if (event.event === "chat") {
    useChatStore.getState().handleChatEvent(event.data);
    if (event.data && typeof event.data === "object") {
      const data = event.data as Record<string, unknown>;
      const chatState = typeof data.state === "string" ? data.state : null;
      const runId = typeof data.runId === "string" ? data.runId : null;
      const sessionKey = typeof data.sessionKey === "string" ? data.sessionKey : undefined;

      // Feed session flow store
      if (runId && sessionKey) {
        const flow = useSessionFlowStore.getState();
        if (chatState === "delta") {
          flow.recordRunDelta(runId, sessionKey);
        } else if (chatState === "final") {
          flow.recordRunEnd(runId, "done");
        } else if (chatState === "error") {
          flow.recordRunEnd(runId, "error");
        } else if (chatState === "aborted") {
          flow.recordRunEnd(runId, "aborted");
        }
      }

      if (chatState === "start") {
        useActivityStore.getState().push("session_start", `Session opened: ${sessionKey ?? "new session"}`, {
          sessionKey,
          metadata: data,
        });
      }
      if (chatState === "final" || chatState === "error" || chatState === "aborted") {
        const entry = buildChatSummary(data);
        useActivityStore.getState().push(entry.kind, entry.summary, { sessionKey: entry.sessionKey, metadata: data });
      }
    }
    return;
  }
  if (event.event === "agent") {
    useAgentsStore.getState().handleAgentEvent(event.data);
    if (event.data && typeof event.data === "object") {
      const agentData = event.data as Record<string, unknown>;
      const agentRunId = typeof agentData.runId === "string" ? agentData.runId : null;
      const agentStream = typeof agentData.stream === "string" ? agentData.stream : null;
      const agentInner = agentData.data && typeof agentData.data === "object"
        ? (agentData.data as Record<string, unknown>)
        : {};

      // Feed tool calls to session flow store
      if (agentRunId && agentStream === "tool" && typeof agentInner.tool === "string") {
        useSessionFlowStore.getState().recordToolCall(agentRunId, agentInner.tool);
      }

      const entry = buildAgentSummary(agentData);
      if (entry) {
        useActivityStore
          .getState()
          .push(entry.kind, entry.summary, { sessionKey: entry.sessionKey, metadata: agentData });
      }
    }
    return;
  }
  if (event.event === "presence") {
    useAgentsStore.getState().addPresenceBeacon();
    pushDedupedConnection("Gateway heartbeat received", { source: "presence" });
  }
}
