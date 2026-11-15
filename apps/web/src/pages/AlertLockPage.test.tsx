import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AlertLockPage } from "./AlertLockPage";
import i18n from "../lib/i18n";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("AlertLockPage", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("pt-BR");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads pending alert in locked mode and resolves after read confirmation", async () => {
    let pending = [
      {
        id: "lock-alert-1",
        kind: "reminder",
        title: "Hora de alongar",
        body: "Pare 5 minutos",
        severity: "urgent",
        ref_id: null,
        resolution: null,
        resolved_at: null,
        created_at: "2026-11-14T12:00:00Z",
      },
    ];

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "alerts_list_pending") return pending;
      if (cmd === "settings_get") return null;
      if (cmd === "alerts_resolve") {
        const resolved = pending[0];
        pending = [];
        return resolved;
      }
      return null;
    });

    render(<AlertLockPage />);

    expect(await screen.findByText("Hora de alongar")).toBeInTheDocument();
    expect(screen.getByTestId("reminder-modal")).toHaveAttribute("data-locked", "true");

    const resolveBtn = screen.getByRole("button", { name: /Resolver/i });
    expect(resolveBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId("confirm-read-checkbox"));
    expect(resolveBtn).toBeEnabled();

    fireEvent.click(resolveBtn);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("alerts_resolve", { id: "lock-alert-1" });
    });
  });

  it("renders external popupWindow unlocked when block_screen is false", async () => {
    const pending = [
      {
        id: "popup-alert-1",
        kind: "reminder",
        title: "Revisar pull request",
        body: "Checar build do CI",
        severity: "info",
        ref_id: null,
        resolution: null,
        resolved_at: null,
        created_at: "2026-11-14T12:00:00Z",
      },
    ];

    mockInvoke.mockImplementation(async (cmd: string, args) => {
      const key = (args as Record<string, unknown> | undefined)?.key;
      if (cmd === "alerts_list_pending") return pending;
      if (cmd === "settings_get" && key === "reminders.block_screen") return false;
      if (cmd === "settings_get") return null;
      return null;
    });

    render(<AlertLockPage popupWindow />);

    expect(await screen.findByText("Revisar pull request")).toBeInTheDocument();
    expect(screen.getByTestId("reminder-modal")).toHaveAttribute("data-locked", "false");
    expect(screen.queryByTestId("confirm-read-checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resolver/i })).toBeEnabled();
  });

  it("renders lock backdrop screen when ?backdrop=1 query param is present", async () => {
    mockInvoke.mockResolvedValue([]);
    window.history.pushState({}, "", "/alert-lock?backdrop=1");
    render(<AlertLockPage />);
    expect(await screen.findByTestId("alert-lock-backdrop")).toBeInTheDocument();
    window.history.pushState({}, "", "/");
  });
});
