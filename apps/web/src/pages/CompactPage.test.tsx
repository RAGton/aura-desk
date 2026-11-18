import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../lib/i18n";
import { CompactPage } from "./CompactPage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("CompactPage", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "dashboard_summary") {
        return {
          nextTask: {
            id: "t-next",
            title: "Ship Phase 3 desktop",
            priority: "high",
            status: "todo",
            kanban_order: 0,
            tags: [],
            created_at: "2026-11-17T10:00:00Z",
            updated_at: "2026-11-17T10:00:00Z",
          },
          pendingCount: 1,
          completedToday: 0,
          overdueCount: 0,
          runningPomodoro: null,
          pendingReminders: 0,
          recentReminders: [],
          todayPomodoros: 0,
          todayFocusMin: 0,
          waterIntervalMin: 60,
          breakIntervalMin: 90,
          dailyPlanningTime: "07:50",
        };
      }
      if (cmd === "pomodoro_active") return null;
      if (cmd === "alerts_list_pending") {
        return [
          {
            id: "a1",
            kind: "reminder",
            title: "Hydration",
            severity: "normal",
            created_at: "2026-11-17T10:00:00Z",
          },
        ];
      }
      if (cmd === "settings_get_all") return [["pomodoro.focus_min", 25]];
      return undefined;
    });
  });

  it("renders next task, alert badge, and starts focus or completes task", async () => {
    render(<CompactPage />);

    expect(await screen.findByText("Ship Phase 3 desktop")).toBeInTheDocument();
    expect(screen.getByText("1 alert(s)")).toBeInTheDocument();
    expect(screen.getByText("25:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("pomodoro_start", {
        input: { kind: "focus", planned_min: 25, task_id: "t-next" },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Mark next task done" }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("tasks_set_status", {
        input: { id: "t-next", status: "done", kanban_order: 0 },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Close compact widget" }));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("desktop_toggle_compact", { enabled: false });
    });
  });
});
