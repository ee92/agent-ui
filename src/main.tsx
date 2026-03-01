import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles/globals.css";

// Unregister any stale service workers
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(r => r.forEach(sw => sw.unregister()));
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
