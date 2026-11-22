import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { AlertLockPage } from "../pages/AlertLockPage";
import { CompactPage } from "../pages/CompactPage";

export type StandaloneWindowMode =
  | "alert-popup"
  | "alert-lock-backdrop"
  | "alert-lock"
  | "compact"
  | null;

export function detectStandaloneWindowMode(): StandaloneWindowMode {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    __AURADESK_WINDOW_MODE__?: string;
    __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
  };
  if (win.__AURADESK_WINDOW_MODE__ === "alert-popup") return "alert-popup";
  if (win.__AURADESK_WINDOW_MODE__ === "alert-lock-backdrop") return "alert-lock-backdrop";
  if (win.__AURADESK_WINDOW_MODE__ === "compact") return "compact";

  const label = win.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  if (label === "alert-popup") return "alert-popup";
  if (label === "compact") return "compact";
  if (typeof label === "string" && label.startsWith("alert-lock-")) {
    return "alert-lock-backdrop";
  }

  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "alert-popup") return "alert-popup";
  if (view === "compact") return "compact";
  if (view === "alert-lock") {
    return window.location.search.includes("backdrop=1") ? "alert-lock-backdrop" : "alert-lock";
  }
  return null;
}

export function AppRouter() {
  const mode = detectStandaloneWindowMode();

  if (mode === "alert-popup") {
    return <AlertLockPage popupWindow />;
  }
  if (mode === "alert-lock-backdrop") {
    return <AlertLockPage forceBackdrop />;
  }
  if (mode === "alert-lock") {
    return <AlertLockPage />;
  }
  if (mode === "compact") {
    return <CompactPage />;
  }

  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/" element={<AppShell />} />
        <Route path="/dashboard" element={<AppShell />} />
        <Route path="/kanban" element={<AppShell />} />
        <Route path="/tasks" element={<AppShell />} />
        <Route path="/pomodoro" element={<AppShell />} />
        <Route path="/alerts" element={<AppShell />} />
        <Route path="/reminders" element={<AppShell />} />
        <Route path="/reports" element={<AppShell />} />
        <Route path="/aura" element={<AppShell />} />
        <Route path="/hermes" element={<AppShell />} />
        <Route path="/settings" element={<AppShell />} />
        <Route path="/compact" element={<CompactPage />} />
        <Route path="/alert-popup" element={<AlertLockPage popupWindow />} />
        <Route path="/alert-lock" element={<AlertLockPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
