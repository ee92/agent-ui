import { create } from "zustand";
import { fileToDraft, type UiStoreState } from "./shared";

const DRAFTS_STORAGE_KEY = "agent-ui.drafts.v1";

// Load persisted per-session drafts synchronously at module init so the
// composer can hydrate on first render. Bad/missing storage → empty map.
function loadPersistedDrafts(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === "string" && typeof value === "string" && value) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function persistDrafts(drafts: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    // Prune empty strings so the store doesn't accumulate stale keys.
    const compacted: Record<string, string> = {};
    for (const [key, value] of Object.entries(drafts)) {
      if (typeof value === "string" && value.length > 0) compacted[key] = value;
    }
    window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(compacted));
  } catch {
    // Quota full or storage disabled — drop silently, drafts are nice-to-have.
  }
}

export const useUiStore = create<UiStoreState>((set, get) => ({
  currentPanel: "tasks",
  mobileTab: "chat",
  mobileSidebarOpen: false,
  sidebarFilesMode: false,
  draft: "",
  drafts: loadPersistedDrafts(),
  activeDraftKey: null,
  attachments: [],
  conversationSearch: "",
  focusSearchVersion: 0,
  setConversationSearch: (value) => set({ conversationSearch: value }),
  setDraft: (value) => {
    const { activeDraftKey, drafts } = get();
    if (activeDraftKey) {
      set({ draft: value, drafts: { ...drafts, [activeDraftKey]: value } });
    } else {
      set({ draft: value });
    }
  },
  setActiveDraftKey: (sessionKey) => {
    const { activeDraftKey, drafts, draft } = get();
    if (activeDraftKey === sessionKey) return;
    // Save the outgoing draft under its key before switching.
    const outgoingDrafts =
      activeDraftKey != null ? { ...drafts, [activeDraftKey]: draft } : drafts;
    const nextDraft = sessionKey != null ? (outgoingDrafts[sessionKey] ?? "") : "";
    set({
      activeDraftKey: sessionKey,
      drafts: outgoingDrafts,
      draft: nextDraft,
    });
  },
  addAttachments: async (files) => {
    const nextDrafts = await Promise.all(Array.from(files, (file) => fileToDraft(file)));
    set({ attachments: [...get().attachments, ...nextDrafts] });
  },
  removeAttachment: (id) => {
    set({ attachments: get().attachments.filter((attachment) => attachment.id !== id) });
  },
  setCurrentPanel: (panel) => set({ currentPanel: panel, sidebarFilesMode: panel === "files" }),
  setMobileTab: (tab) => set({ mobileTab: tab }),
  toggleMobileSidebar: () => set({ mobileSidebarOpen: !get().mobileSidebarOpen }),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
  toggleSidebarFilesMode: () => {
    const next = !get().sidebarFilesMode;
    set({
      sidebarFilesMode: next,
      currentPanel: next ? "files" : get().currentPanel
    });
  },
  requestSearchFocus: () => {
    set((state) => ({
      focusSearchVersion: state.focusSearchVersion + 1,
      sidebarFilesMode: false,
      mobileSidebarOpen: true
    }));
  },
  closeOverlays: () => {
    set({ mobileSidebarOpen: false, sidebarFilesMode: false });
  }
}));

// Persist drafts whenever they change — regardless of which action fired the
// mutation (setDraft, setActiveDraftKey, or chat-store clearing on send).
let lastPersistedDrafts = useUiStore.getState().drafts;
useUiStore.subscribe((state) => {
  if (state.drafts !== lastPersistedDrafts) {
    lastPersistedDrafts = state.drafts;
    persistDrafts(state.drafts);
  }
});
