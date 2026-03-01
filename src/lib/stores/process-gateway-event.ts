import { useAgentsStore } from "./agents-store";
import { useChatStore } from "./chat-store";
import type { AppStoreState } from "./shared";

export function processGatewayEvent(state: Pick<AppStoreState, "lastGatewayEvent">) {
  const event = state.lastGatewayEvent;
  if (!event) {
    return;
  }
  if (event.event === "chat") {
    useChatStore.getState().handleChatEvent(event.data);
    return;
  }
  if (event.event === "agent") {
    useAgentsStore.getState().handleAgentEvent(event.data);
    return;
  }
  if (event.event === "presence") {
    useAgentsStore.getState().addPresenceBeacon();
  }
}
