import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../lib/i18n";
import { pomodoroApi, type PomodoroSession } from "../lib/ipc";
import {
  readPomoPauseCache,
  usePomodoroController,
  writePomoPauseCache,
} from "./usePomodoroController";

function makeSession(overrides: Partial<PomodoroSession> = {}): PomodoroSession {
  return {
    id: "pomo-1",
    task_id: null,
    kind: "focus",
    planned_min: 25,
    actual_min: 0,
    started_at: new Date().toISOString(),
    ended_at: null,
    status: "running",
    ...overrides,
  };
}

describe("usePomodoroController", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks idle focus duration and pauses/resumes with sessionStorage persistence", () => {
    const notify = vi.fn();
    const refreshAfterMutation = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      usePomodoroController({
        focusMin: 25,
        refreshAfterMutation,
        notify,
      }),
    );

    expect(result.current.timerSecondsLeft).toBe(1500);
    expect(result.current.timerPaused).toBe(false);

    const session = makeSession({ id: "pomo-sync", planned_min: 10 });
    act(() => {
      result.current.syncFromRemotePomo(session);
    });

    expect(result.current.activePomo?.id).toBe("pomo-sync");
    expect(result.current.timerSecondsLeft).toBe(600);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.timerSecondsLeft).toBeLessThanOrEqual(595);

    act(() => {
      result.current.handleTogglePause();
    });
    expect(result.current.timerPaused).toBe(true);
    expect(readPomoPauseCache("pomo-sync")?.paused).toBe(true);

    // Resyncing with same remote session ID keeps paused state.
    const cached = readPomoPauseCache("pomo-sync");
    expect(cached?.accumulatedMs).toBeGreaterThanOrEqual(5000);

    act(() => {
      result.current.handleTogglePause();
    });
    expect(result.current.timerPaused).toBe(false);
    expect(readPomoPauseCache("pomo-sync")?.paused).toBe(false);

    writePomoPauseCache(null, false, 0);
    expect(readPomoPauseCache("pomo-sync")).toBeNull();
  });

  it("starts, completes, abandons, and notifies errors cleanly", async () => {
    const started = makeSession({ id: "pomo-start", planned_min: 1 });
    const startSpy = vi.spyOn(pomodoroApi, "start").mockResolvedValue(started);
    const completeSpy = vi.spyOn(pomodoroApi, "complete").mockResolvedValue({
      ...started,
      status: "completed",
    });
    const abandonSpy = vi.spyOn(pomodoroApi, "abandon").mockResolvedValue({
      ...started,
      status: "abandoned",
    });

    const notify = vi.fn();
    const onSessionStarted = vi.fn();
    const refreshAfterMutation = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      usePomodoroController({
        focusMin: 25,
        refreshAfterMutation,
        notify,
        onSessionStarted,
      }),
    );

    await act(async () => {
      await result.current.handleStartPomodoro("focus", 1, "task-9");
    });

    expect(startSpy).toHaveBeenCalledWith({
      kind: "focus",
      planned_min: 1,
      task_id: "task-9",
    });
    expect(onSessionStarted).toHaveBeenCalledTimes(1);
    expect(refreshAfterMutation).toHaveBeenCalled();
    expect(result.current.activePomo?.id).toBe("pomo-start");

    await act(async () => {
      await result.current.handleCompletePomodoro();
    });

    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(result.current.activePomo).toBeNull();

    // Start again then abandon with an IPC error to verify error path.
    await act(async () => {
      await result.current.handleStartPomodoro("focus", 25, null);
    });
    await act(async () => {
      await result.current.handleAbandonPomodoro();
    });
    expect(abandonSpy).toHaveBeenCalledTimes(1);

    startSpy.mockRejectedValueOnce(new Error("pomodoro boom"));
    await act(async () => {
      await result.current.handleStartPomodoro("focus", 25, null);
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("pomodoro boom"), true);
  });

  it("auto-completes when countdown hits 00:00", async () => {
    const completeSpy = vi
      .spyOn(pomodoroApi, "complete")
      .mockResolvedValue(makeSession({ status: "completed", actual_min: 1 }));
    const notify = vi.fn();
    const refreshAfterMutation = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      usePomodoroController({
        focusMin: 1,
        refreshAfterMutation,
        notify,
      }),
    );

    const shortSession = makeSession({ id: "pomo-auto", planned_min: 1 });
    act(() => {
      result.current.syncFromRemotePomo(shortSession);
    });

    await act(async () => {
      vi.advanceTimersByTime(60_500);
      await Promise.resolve();
    });

    expect(completeSpy).toHaveBeenCalledTimes(1);
  });
});
