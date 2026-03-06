import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles/globals.css";

// Unregister any stale service workers
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(r => r.forEach(sw => sw.unregister()));
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
