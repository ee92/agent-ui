import { create } from "zustand";
import { getBackendAdapter } from "../adapters";
import { inferMimeType, type FileMethodKind, type FilesStoreState, type MethodVariant } from "./shared";

export const useFilesStore = create<FilesStoreState>((set, get) => ({
  fileEntries: [],
  filePreview: null,
  filesReady: false,
  filesFallback: false,
  methodsByKind: {},
  loadFiles: async () => {
    try {
      const data = await getBackendAdapter().files.list("");
      set({
        fileEntries: data.map((entry) => ({
          path: entry.path,
          name: entry.name,
          type: entry.isDirectory ? "directory" : "file",
          depth: 0,
          size: entry.size,
          mtime: entry.modifiedAt
        })),
        filePreview: null,
        filesReady: true,
        filesFallback: false
      });
    } catch {
      set({ fileEntries: [], filePreview: null, filesReady: true, filesFallback: true });
    }
  },
  openFile: async (filePath) => {
    try {
      const content = await getBackendAdapter().files.read(filePath);
      set({ filePreview: { path: filePath, content, mimeType: inferMimeType(filePath) } });
    } catch {
      set({
        filePreview: { path: filePath, content: "Unable to read this file.", mimeType: "text/plain" }
      });
    }
  },
  setMethodVariant: (kind: FileMethodKind, method: MethodVariant) => {
    set({ methodsByKind: { ...get().methodsByKind, [kind]: method } });
  }
}));
