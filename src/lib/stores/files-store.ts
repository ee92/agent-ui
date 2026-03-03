import { create } from "zustand";
import { useGatewayStore } from "./gateway-store";
import { inferMimeType, type FileMethodKind, type FilesStoreState, type MethodVariant } from "./shared";

export const useFilesStore = create<FilesStoreState>((set, get) => ({
  fileEntries: [],
  filePreview: null,
  filesReady: false,
  filesFallback: false,
  methodsByKind: {},
  loadFiles: async () => {
    try {
      const token = useGatewayStore.getState().gatewayToken;
      const res = await fetch("/api/files/list?path=", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error("fetch failed");
      }
      const data = (await res.json()) as {
        entries: Array<{
          path: string;
          name: string;
          type: string;
          size?: number;
          childCount?: number;
          mtime?: number | string;
          ctime?: number | string;
        }>;
      };
      set({
        fileEntries: data.entries.map((entry) => ({
          path: entry.path,
          name: entry.name,
          type: entry.type === "directory" ? "directory" : "file",
          depth: 0,
          size: entry.size,
          childCount: entry.childCount,
          mtime: typeof entry.mtime === "number" ? new Date(entry.mtime).toISOString() : entry.mtime,
          ctime: typeof entry.ctime === "number" ? new Date(entry.ctime).toISOString() : entry.ctime
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
      const token = useGatewayStore.getState().gatewayToken;
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error("fetch failed");
      }
      const data = (await res.json()) as { content: string };
      set({ filePreview: { path: filePath, content: data.content, mimeType: inferMimeType(filePath) } });
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
