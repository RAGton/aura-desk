import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />} />
      </Routes>
    </BrowserRouter>
  );
}
