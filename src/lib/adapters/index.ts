import { create } from "zustand";
import { OpenClawAdapter } from "./openclaw-adapter";
import { ClaudeCodeAdapter } from "./claude-code-adapter";
import { LocalAdapter } from "./local-adapter";
import type { BackendAdapter } from "./types";
import { DEFAULT_GATEWAY_TOKEN, DEFAULT_GATEWAY_URL, safeJsonParse } from "../stores/shared";

export type AdapterType = BackendAdapter["type"];

export type AdapterConfig = {
  type: AdapterType;
  gatewayUrl: string;
  gatewayToken: string;
  workspace: string;
};

const ADAPTER_CONFIG_KEY = "mission-control-adapter";

function getDefaultWorkspace(): string {
  if (typeof window !== "undefined" && window.location?.pathname) {
    return ".";
  }
  return ".";
}

function loadAdapterConfig(): AdapterConfig {
  const raw = safeJsonParse<Partial<AdapterConfig>>(localStorage.getItem(ADAPTER_CONFIG_KEY), {});
  return {
    type: raw.type === "claude-code" || raw.type === "local" || raw.type === "openclaw" ? raw.type : "openclaw",
    gatewayUrl: raw.gatewayUrl?.trim() || DEFAULT_GATEWAY_URL,
    gatewayToken: raw.gatewayToken?.trim() || DEFAULT_GATEWAY_TOKEN,
    workspace: raw.workspace?.trim() || getDefaultWorkspace(),
  };
}

function persistAdapterConfig(config: AdapterConfig) {
  localStorage.setItem(ADAPTER_CONFIG_KEY, JSON.stringify(config));
}

export function createAdapter(config: AdapterConfig): BackendAdapter {
  switch (config.type) {
    case "openclaw":
      return new OpenClawAdapter(config.gatewayUrl, config.gatewayToken);
    case "claude-code":
      return new ClaudeCodeAdapter(config.workspace);
    case "local":
      return new LocalAdapter(config.workspace);
    default:
      return new OpenClawAdapter(config.gatewayUrl, config.gatewayToken);
  }
}

export type AdapterStoreState = {
  config: AdapterConfig;
  adapter: BackendAdapter;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  setAdapterType: (type: AdapterType) => Promise<void>;
  updateConfig: (patch: Partial<Omit<AdapterConfig, "type">>) => Promise<void>;
};

const initialConfig = loadAdapterConfig();

export const useAdapterStore = create<AdapterStoreState>((set, get) => ({
  config: initialConfig,
  adapter: createAdapter(initialConfig),
  connected: false,
  connect: async () => {
    try {
      await get().adapter.connect();
      set({ connected: get().adapter.isConnected() });
    } catch {
      set({ connected: false });
    }
  },
  disconnect: () => {
    get().adapter.disconnect();
    set({ connected: false });
  },
  setAdapterType: async (type) => {
    const prev = get().adapter;
    prev.disconnect();
    const nextConfig = { ...get().config, type };
    persistAdapterConfig(nextConfig);
    const nextAdapter = createAdapter(nextConfig);
    set({ config: nextConfig, adapter: nextAdapter, connected: false });
    try {
      await nextAdapter.connect();
      set({ connected: nextAdapter.isConnected() });
    } catch {
      set({ connected: false });
    }
  },
  updateConfig: async (patch) => {
    const prev = get().adapter;
    prev.disconnect();
    const nextConfig = { ...get().config, ...patch };
    persistAdapterConfig(nextConfig);
    const nextAdapter = createAdapter(nextConfig);
    set({ config: nextConfig, adapter: nextAdapter, connected: false });
    try {
      await nextAdapter.connect();
      set({ connected: nextAdapter.isConnected() });
    } catch {
      set({ connected: false });
    }
  },
}));

export function getBackendAdapter(): BackendAdapter {
  return useAdapterStore.getState().adapter;
}
