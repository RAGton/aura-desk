import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { pomodoroApi, type PomodoroSession, type SessionKind } from "../lib/ipc";
import { playNotificationChime } from "../lib/sound";

const POMO_PAUSE_STORAGE_KEY = "auradesk_pomo_pause_v1";

export function readPomoPauseCache(
  sessionId: string
): { paused: boolean; accumulatedMs: number } | null {
  try {
    const raw = sessionStorage.getItem(POMO_PAUSE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      sessionId?: string;
      paused?: boolean;
      accumulatedMs?: number;
    };
    if (parsed.sessionId === sessionId) {
      return {
        paused: Boolean(parsed.paused),
        accumulatedMs: Math.max(0, Number(parsed.accumulatedMs) || 0),
      };
    }
  } catch {
    // ignore sessionStorage failure
  }
  return null;
}

export function writePomoPauseCache(
  sessionId: string | null,
  paused: boolean,
  accumulatedMs: number
): void {
  try {
    if (!sessionId) {
      sessionStorage.removeItem(POMO_PAUSE_STORAGE_KEY);
    } else {
      sessionStorage.setItem(
        POMO_PAUSE_STORAGE_KEY,
        JSON.stringify({ sessionId, paused, accumulatedMs })
      );
    }
  } catch {
    // ignore sessionStorage failure
  }
}

export interface UsePomodoroControllerOptions {
  focusMin: number;
  soundEnabled?: boolean;
  refreshAfterMutation: () => Promise<void>;
  notify: (text: string, isError?: boolean) => void;
  onSessionStarted?: () => void;
}

export interface PomodoroController {
  activePomo: PomodoroSession | null;
  selectedPomoTaskId: string;
  setSelectedPomoTaskId: (taskId: string) => void;
  timerSecondsLeft: number;
  timerPaused: boolean;
  syncFromRemotePomo: (pomo: PomodoroSession | null) => void;
  handleTogglePause: () => void;
  pauseForIdle: () => boolean;
  handleStartPomodoro: (
    kind: SessionKind,
    plannedMin: number,
    taskId?: string | null
  ) => Promise<void>;
  handleCompletePomodoro: () => Promise<void>;
  handleAbandonPomodoro: () => Promise<void>;
}

/**
 * Encapsulates Pomodoro countdown ticker, pause/resume sessionStorage cache,
 * auto-completion at 00:00, and IPC session lifecycle mutations.
 */
export function usePomodoroController({
  focusMin,
  soundEnabled = true,
  refreshAfterMutation,
  notify,
  onSessionStarted,
}: UsePomodoroControllerOptions): PomodoroController {
  const { t } = useTranslation();

  const [activePomo, setActivePomo] = useState<PomodoroSession | null>(null);
  const [selectedPomoTaskId, setSelectedPomoTaskId] = useState<string>("");
  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number>(focusMin * 60);
  const [timerPaused, setTimerPaused] = useState<boolean>(false);

  const trackedPomoIdRef = useRef<string | null>(null);
  const accumulatedElapsedMsRef = useRef<number>(0);
  const segmentStartMsRef = useRef<number | null>(null);
  const autoCompletingPomoRef = useRef<string | null>(null);

  const computeElapsedMs = useCallback(() => {
    const runningSlice =
      segmentStartMsRef.current !== null
        ? Math.max(0, Date.now() - segmentStartMsRef.current)
        : 0;
    return accumulatedElapsedMsRef.current + runningSlice;
  }, []);

  const syncFromRemotePomo = useCallback((pomo: PomodoroSession | null) => {
    setActivePomo(pomo ?? null);

    if (pomo && trackedPomoIdRef.current !== pomo.id) {
      trackedPomoIdRef.current = pomo.id;
      const cachedPause = readPomoPauseCache(pomo.id);
      const totalSec = pomo.planned_min * 60;
      if (cachedPause && cachedPause.paused) {
        accumulatedElapsedMsRef.current = cachedPause.accumulatedMs;
        segmentStartMsRef.current = null;
        setTimerPaused(true);
        setTimerSecondsLeft(
          Math.max(0, totalSec - Math.floor(cachedPause.accumulatedMs / 1000))
        );
      } else {
        const startedMs = Date.parse(pomo.started_at);
        accumulatedElapsedMsRef.current = Number.isNaN(startedMs)
          ? 0
          : Math.max(0, Date.now() - startedMs);
        segmentStartMsRef.current = Date.now();
        setTimerPaused(false);
        setTimerSecondsLeft(
          Math.max(0, totalSec - Math.floor(accumulatedElapsedMsRef.current / 1000))
        );
      }
    } else if (!pomo && trackedPomoIdRef.current !== null) {
      trackedPomoIdRef.current = null;
      accumulatedElapsedMsRef.current = 0;
      segmentStartMsRef.current = null;
      autoCompletingPomoRef.current = null;
      writePomoPauseCache(null, false, 0);
      setTimerPaused(false);
    }
  }, []);

  // Keep idle timer preview synced with configured focus duration.
  useEffect(() => {
    if (!activePomo) {
      setTimerSecondsLeft(focusMin * 60);
    }
  }, [activePomo, focusMin]);

  const finishPomodoroSession = useCallback(async () => {
    if (!activePomo) return;
    const elapsedMin = Math.max(1, Math.round(computeElapsedMs() / 60_000));
    try {
      await pomodoroApi.complete(elapsedMin);
      trackedPomoIdRef.current = null;
      accumulatedElapsedMsRef.current = 0;
      segmentStartMsRef.current = null;
      autoCompletingPomoRef.current = null;
      writePomoPauseCache(null, false, 0);
      setTimerPaused(false);
      setActivePomo(null);
      if (soundEnabled) {
        playNotificationChime("success");
      }
      await refreshAfterMutation();
      notify(t("pomodoro.sessionCompleted", { min: elapsedMin }));
    } catch (err) {
      notify(String(err), true);
    }
  }, [activePomo, computeElapsedMs, notify, refreshAfterMutation, soundEnabled, t]);

  // Live countdown ticker respecting pause state & auto-completing cleanly at 00:00.
  useEffect(() => {
    if (!activePomo || timerPaused) return;
    const totalSec = activePomo.planned_min * 60;
    const updateClock = () => {
      const elapsedSec = Math.floor(computeElapsedMs() / 1000);
      const left = Math.max(0, totalSec - elapsedSec);
      setTimerSecondsLeft(left);
      if (left === 0 && autoCompletingPomoRef.current !== activePomo.id) {
        autoCompletingPomoRef.current = activePomo.id;
        void finishPomodoroSession();
      }
    };
    updateClock();
    const id = window.setInterval(updateClock, 500);
    return () => window.clearInterval(id);
  }, [activePomo, timerPaused, computeElapsedMs, finishPomodoroSession]);

  const pauseForIdle = useCallback((): boolean => {
    if (!activePomo || timerPaused) return false;
    const acc = computeElapsedMs();
    accumulatedElapsedMsRef.current = acc;
    segmentStartMsRef.current = null;
    writePomoPauseCache(activePomo.id, true, acc);
    setTimerPaused(true);
    return true;
  }, [activePomo, computeElapsedMs, timerPaused]);

  const handleTogglePause = useCallback(() => {
    if (!activePomo) return;
    if (!timerPaused) {
      const acc = computeElapsedMs();
      accumulatedElapsedMsRef.current = acc;
      segmentStartMsRef.current = null;
      writePomoPauseCache(activePomo.id, true, acc);
      setTimerPaused(true);
    } else {
      segmentStartMsRef.current = Date.now();
      writePomoPauseCache(activePomo.id, false, accumulatedElapsedMsRef.current);
      setTimerPaused(false);
    }
  }, [activePomo, computeElapsedMs, timerPaused]);

  const handleStartPomodoro = useCallback(
    async (kind: SessionKind, plannedMin: number, taskId?: string | null) => {
      try {
        if (activePomo) {
          const elapsedMin = Math.max(0, Math.round(computeElapsedMs() / 60_000));
          await pomodoroApi.abandon(elapsedMin);
        }
        const started = await pomodoroApi.start({
          kind,
          planned_min: plannedMin,
          task_id: taskId ?? null,
        });
        trackedPomoIdRef.current = started.id;
        accumulatedElapsedMsRef.current = 0;
        segmentStartMsRef.current = Date.now();
        autoCompletingPomoRef.current = null;
        writePomoPauseCache(started.id, false, 0);
        setTimerPaused(false);
        setTimerSecondsLeft(plannedMin * 60);
        setActivePomo(started);
        await refreshAfterMutation();
        onSessionStarted?.();
        notify(t("pomodoro.sessionStarted", { min: plannedMin }));
      } catch (err) {
        notify(String(err), true);
      }
    },
    [activePomo, computeElapsedMs, notify, onSessionStarted, refreshAfterMutation, t]
  );

  const handleCompletePomodoro = useCallback(async () => {
    await finishPomodoroSession();
  }, [finishPomodoroSession]);

  const handleAbandonPomodoro = useCallback(async () => {
    if (!activePomo) return;
    const elapsedMin = Math.max(0, Math.round(computeElapsedMs() / 60_000));
    try {
      await pomodoroApi.abandon(elapsedMin);
      trackedPomoIdRef.current = null;
      accumulatedElapsedMsRef.current = 0;
      segmentStartMsRef.current = null;
      autoCompletingPomoRef.current = null;
      writePomoPauseCache(null, false, 0);
      setTimerPaused(false);
      setActivePomo(null);
      await refreshAfterMutation();
      notify(t("pomodoro.sessionInterrupted"));
    } catch (err) {
      notify(String(err), true);
    }
  }, [activePomo, computeElapsedMs, notify, refreshAfterMutation, t]);

  return {
    activePomo,
    selectedPomoTaskId,
    setSelectedPomoTaskId,
    timerSecondsLeft,
    timerPaused,
    syncFromRemotePomo,
    handleTogglePause,
    pauseForIdle,
    handleStartPomodoro,
    handleCompletePomodoro,
    handleAbandonPomodoro,
  };
}
