import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { patchFetchForApi } from "./fetchPatch";

declare global {
  interface Window {
    __toptryClientLog?: (event: string, payload?: any) => void;
    __toptryClientSessionId?: string;
    __toptryRawFetch?: typeof fetch;
  }
}

function makeClientSessionId() {
  try {
    const existing = window.sessionStorage.getItem("toptry_client_session_id");
    if (existing) return existing;
    const next = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem("toptry_client_session_id", next);
    return next;
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

window.__toptryClientSessionId = makeClientSessionId();
window.__toptryRawFetch = window.fetch.bind(window);

function isToptryClientLogEnabled() {
  try {
    const qs = new URLSearchParams(window.location.search || "");
    if (qs.get("clientLog") === "1") return true;
    return window.localStorage.getItem("toptry_client_log") === "1";
  } catch {
    return false;
  }
}

window.__toptryClientLog = (event: string, payload: any = {}) => {
  if (!isToptryClientLogEnabled()) return;

  try {
    const body = {
      event,
      sessionId: window.__toptryClientSessionId || "",
      payload: {
        path: window.location.pathname,
        hash: window.location.hash,
        visibilityState: document.visibilityState,
        ...payload,
      },
    };

    (window.__toptryRawFetch || fetch)("/api/client-log", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // diagnostics must never break app boot
  }
};

window.addEventListener("error", (event) => {
  window.__toptryClientLog?.("window_error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error?.message || String(event.error || ""),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  window.__toptryClientLog?.("unhandled_rejection", {
    reason: event.reason?.message || String(event.reason || ""),
    stack: event.reason?.stack ? String(event.reason.stack).slice(0, 1000) : "",
  });
});

window.addEventListener("pageshow", (event) => {
  window.__toptryClientLog?.("pageshow", {
    persisted: event.persisted,
  });
});

document.addEventListener("visibilitychange", () => {
  window.__toptryClientLog?.("visibilitychange", {
    visibilityState: document.visibilityState,
  });
});

window.__toptryClientLog?.("index_module_loaded");

try {
  window.__toptryClientLog?.("fetch_patch_before_call");
  patchFetchForApi();
  window.__toptryClientLog?.("fetch_patch_called");
} catch (err: any) {
  window.__toptryClientLog?.("fetch_patch_error", {
    message: err?.message || String(err || ""),
    stack: err?.stack ? String(err.stack).slice(0, 1000) : "",
  });
  console.error("[toptry] patchFetchForApi failed", err);
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  window.__toptryClientLog?.("root_missing");
  throw new Error("Could not find root element to mount to");
}

window.__toptryClientLog?.("react_render_start");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

window.__toptryClientLog?.("react_render_scheduled");
