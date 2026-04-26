import type { AppStoreState } from "./stores/shared";
import { useAgentsStore } from "./stores/agents-store";
import { useChatStore } from "./stores/chat-store";
import { useFilesStore } from "./stores/files-store";
import { useUiStore } from "./stores/ui-store";

export {
  useAgentsStore,
  useChatStore,
  useFilesStore,
  useUiStore
};

export function useAppStore<T>(selector: (state: AppStoreState) => T): T {
  const chat = useChatStore();
  const files = useFilesStore();
  const agents = useAgentsStore();
  const ui = useUiStore();
  return selector({
    ...chat,
    ...files,
    ...agents,
    ...ui
  });
}
