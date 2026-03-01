import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "./files-store";
import { useGatewayStore } from "./gateway-store";

describe("files store", () => {
  beforeEach(() => {
    useGatewayStore.setState({
      connectionState: "connected",
      connectionDetail: "",
      gatewayUrl: "ws://localhost",
      gatewayToken: "token",
      gatewayClient: null,
      lastGatewayEvent: null,
      gatewayEventVersion: 0
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
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/api/files/list")) {
        return {
          ok: true,
          json: async () => ({
            entries: [{ path: "notes.md", name: "notes.md", type: "file", size: 12 }]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ content: "# Notes" })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await useFilesStore.getState().loadFiles();
    await useFilesStore.getState().openFile("notes.md");

    expect(useFilesStore.getState().fileEntries).toHaveLength(1);
    expect(useFilesStore.getState().filePreview?.content).toBe("# Notes");
  });
});
