import { create } from "zustand";
import { GatewayClient } from "../gateway";
import { fetchServerToken, getInitialSettings, persistSettings, type GatewayStoreState } from "./shared";

const initialSettings = getInitialSettings();

export const useGatewayStore = create<GatewayStoreState>((set, get) => ({
  connectionState: "disconnected",
  connectionDetail: "",
  gatewayUrl: initialSettings.gatewayUrl,
  gatewayToken: initialSettings.gatewayToken,
  gatewayClient: null,
  lastGatewayEvent: null,
  gatewayEventVersion: 0,
  connect: async () => {
    get().gatewayClient?.disconnect();
    // Auto-fetch server token if using default
    if (get().gatewayToken === "openclaw" || !get().gatewayToken) {
      const serverToken = await fetchServerToken();
      if (serverToken) {
        set({ gatewayToken: serverToken });
        persistSettings(get().gatewayUrl, serverToken);
      }
    }
    const client = new GatewayClient({
      url: get().gatewayUrl,
      token: get().gatewayToken,
      onConnectionState: (connectionState, detail) => {
        set({ connectionState, connectionDetail: detail ?? "" });
      },
      onEvent: (event) => {
        set((state) => ({
          lastGatewayEvent: event,
          gatewayEventVersion: state.gatewayEventVersion + 1
        }));
      }
    });
    set({ gatewayClient: client });
    client.connect();
  },
  disconnect: () => {
    get().gatewayClient?.disconnect();
    set({
      gatewayClient: null,
      connectionState: "disconnected",
      connectionDetail: ""
    });
  },
  setGatewayConfig: (url, token) => {
    persistSettings(url, token);
    set({ gatewayUrl: url, gatewayToken: token });
  }
}));
