import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ReportsPage } from "./ReportsPage";
import i18n from "../lib/i18n";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("ReportsPage", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("pt-BR");
  });

  it("renders today, week, month metrics and the 14-day SVG chart", async () => {
    mockInvoke.mockResolvedValueOnce({
      today: {
        date: "2026-11-14",
        focusMin: 75,
        breakMin: 15,
        waterCount: 4,
        pomodoros: 3,
        tasksDone: 2,
      },
      week: {
        focusMin: 240,
        breakMin: 45,
        waterCount: 18,
        pomodoros: 10,
        tasksDone: 8,
        activeDays: 5,
      },
      month: {
        focusMin: 900,
        breakMin: 180,
        waterCount: 62,
        pomodoros: 36,
        tasksDone: 27,
        activeDays: 19,
      },
      byDay: [
        { date: "2026-11-14", focusMin: 75, breakMin: 15, waterCount: 4, pomodoros: 3, tasksDone: 2 },
        { date: "2026-11-13", focusMin: 50, breakMin: 10, waterCount: 3, pomodoros: 2, tasksDone: 1 },
      ],
    });

    render(<ReportsPage />);

    expect(screen.getByText("Relatórios & Métricas")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("75m")).toBeInTheDocument();
    });
    expect(screen.getByText("900m")).toBeInTheDocument();
    expect(screen.getByText("62")).toBeInTheDocument();
    expect(screen.getByTestId("reports-chart")).toBeInTheDocument();
  });
});
