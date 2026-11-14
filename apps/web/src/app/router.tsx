import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { AlertLockPage } from "../pages/AlertLockPage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />} />
        <Route path="/dashboard" element={<AppShell />} />
        <Route path="/kanban" element={<AppShell />} />
        <Route path="/tasks" element={<AppShell />} />
        <Route path="/pomodoro" element={<AppShell />} />
        <Route path="/alerts" element={<AppShell />} />
        <Route path="/reminders" element={<AppShell />} />
        <Route path="/reports" element={<AppShell />} />
        <Route path="/settings" element={<AppShell />} />
        <Route path="/alert-lock" element={<AlertLockPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
