import type { AppStoreState } from "./stores/shared";
import { useAgentsStore } from "./stores/agents-store";
import { useChatStore } from "./stores/chat-store";
import { useFilesStore } from "./stores/files-store";
import { useGatewayStore } from "./stores/gateway-store";
import { useUiStore } from "./stores/ui-store";

export {
  useAgentsStore,
  useChatStore,
  useFilesStore,
  useGatewayStore,
  useUiStore
};

export function useAppStore<T>(selector: (state: AppStoreState) => T): T {
  const gateway = useGatewayStore();
  const chat = useChatStore();
  const files = useFilesStore();
  const agents = useAgentsStore();
  const ui = useUiStore();
  return selector({
    ...gateway,
    ...chat,
    ...files,
    ...agents,
    ...ui
  });
}
