import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles/globals.css";

// Unregister any stale service workers and clear caches they left behind.
// Important after removing vite-plugin-pwa so installed PWAs stop serving
// stale precached HTML/JS on next load.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((sw) => sw.unregister()));
  if ("caches" in window) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
}

// Handle ?session= deep links → redirect to hash route
const params = new URLSearchParams(window.location.search);
const sessionParam = params.get("session");
if (sessionParam) {
  window.history.replaceState(null, "", window.location.pathname);
  window.location.hash = `#/chat/${encodeURIComponent(sessionParam)}`;
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
