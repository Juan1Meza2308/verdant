import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme } from "./lib/theme";
import { invoke } from "@tauri-apps/api/core";

initTheme();

// Los invokes fire-and-forget (void invoke(...)) pueden fallar en silencio:
// este listener los reporta por debug_log para no perder fallos de backend.
window.addEventListener("unhandledrejection", (event) => {
  void invoke("debug_log", { msg: `[unhandled] ${String(event.reason)}` });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);