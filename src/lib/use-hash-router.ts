import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Route =
  | { page: "dashboard" }
  | { page: "chat"; sessionKey: string }
  | { page: "files"; path?: string }
  | { page: "flow" }
  | { page: "timeline" }
  | { page: "projects" }
  | { page: "system" };

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  if (!raw || raw === "dashboard") return { page: "dashboard" };
  if (raw === "flow") return { page: "flow" };
  if (raw === "timeline") return { page: "timeline" };
  if (raw === "projects") return { page: "projects" };
  if (raw === "system") return { page: "system" };
  if (raw === "files") return { page: "files" };
  if (raw.startsWith("files/")) return { page: "files", path: decodeURIComponent(raw.slice(6)) };
  if (raw.startsWith("chat/")) return { page: "chat", sessionKey: decodeURIComponent(raw.slice(5)) };
  return { page: "dashboard" };
}

let listeners: Array<() => void> = [];
let currentHash = typeof window !== "undefined" ? window.location.hash : "#/";

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function getSnapshot() {
  return currentHash;
}

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    currentHash = window.location.hash;
    for (const cb of listeners) cb();
  });
}

export function navigate(hash: string) {
  window.location.hash = hash;
}

export function useHashRouter() {
  const hash = useSyncExternalStore(subscribe, getSnapshot);
  const route = parseHash(hash);

  const nav = useCallback((target: string) => {
    navigate(target);
  }, []);

  return { route, navigate: nav };
}
