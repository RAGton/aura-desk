import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* The shell owns the tab state. These paths are deep links into
            that shell: the E2E flows navigate straight to a tab, and each
            path selects the matching tab on mount. */}
        <Route path="/" element={<AppShell />} />
        <Route path="/dashboard" element={<AppShell />} />
        <Route path="/kanban" element={<AppShell />} />
        <Route path="/pomodoro" element={<AppShell />} />
        <Route path="/reminders" element={<AppShell />} />
        <Route path="/settings" element={<AppShell />} />
      </Routes>
    </BrowserRouter>
  );
}
