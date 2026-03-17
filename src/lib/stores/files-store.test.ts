import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendAdapter } from "../adapters/types";
import { useAdapterStore } from "../adapters";
import { useFilesStore } from "./files-store";

const mockAdapter: BackendAdapter = {
  type: "local",
  sessions: {
    send: async () => ({ id: "s1", role: "assistant", content: "", timestamp: new Date().toISOString() }),
    history: async () => [],
    list: async () => [],
    create: async () => ({
      key: "local",
      title: "Local",
      preview: "",
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      isStreaming: false,
      runId: null,
    }),
    rename: async () => undefined,
    delete: async () => undefined,
  },
  files: {
    read: async () => "# Notes",
    write: async () => undefined,
    list: async () => [{ path: "notes.md", name: "notes.md", isDirectory: false, size: 12 }],
    exists: async () => true,
    delete: async () => undefined,
  },
  connect: async () => undefined,
  disconnect: () => undefined,
  isConnected: () => true,
};

describe("files store", () => {
  beforeEach(() => {
    useAdapterStore.setState({
      config: { type: "local", gatewayUrl: "ws://localhost", gatewayToken: "token", workspace: "." },
      adapter: mockAdapter,
      connected: true,
    });
    useFilesStore.setState({
      fileEntries: [],
      filePreview: null,
      filesReady: false,
      filesFallback: false,
      methodsByKind: {}
    });
  });

  it("loads entries and opens previews", async () => {
    vi.restoreAllMocks();

    await useFilesStore.getState().loadFiles();
    await useFilesStore.getState().openFile("notes.md");

    expect(useFilesStore.getState().fileEntries).toHaveLength(1);
    expect(useFilesStore.getState().filePreview?.content).toBe("# Notes");
  });
});
