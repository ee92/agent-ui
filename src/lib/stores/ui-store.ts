import { create } from "zustand";
import { fileToDraft, type UiStoreState } from "./shared";

export const useUiStore = create<UiStoreState>((set, get) => ({
  currentPanel: "tasks",
  mobileTab: "chat",
  mobileSidebarOpen: false,
  sidebarFilesMode: false,
  draft: "",
  attachments: [],
  conversationSearch: "",
  focusSearchVersion: 0,
  setConversationSearch: (value) => set({ conversationSearch: value }),
  setDraft: (value) => set({ draft: value }),
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
