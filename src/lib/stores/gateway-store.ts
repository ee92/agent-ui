import { create } from "zustand";
import { GatewayClient } from "../gateway";
import { getInitialSettings, persistSettings, type GatewayStoreState } from "./shared";

const initialSettings = getInitialSettings();

export const useGatewayStore = create<GatewayStoreState>((set, get) => ({
  connectionState: "disconnected",
  connectionDetail: "",
  gatewayUrl: initialSettings.gatewayUrl,
  gatewayToken: initialSettings.gatewayToken,
  gatewayClient: null,
  lastGatewayEvent: null,
  gatewayEventVersion: 0,
  connect: () => {
    get().gatewayClient?.disconnect();
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
