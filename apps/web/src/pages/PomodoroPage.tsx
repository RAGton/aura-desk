import { useTranslation } from "react-i18next";
import { Clock, Pause, Play, Timer } from "lucide-react";

import type { PomodoroSession, SessionKind, Task } from "../lib/ipc";

export interface PomodoroPageProps {
  activePomo: PomodoroSession | null;
  pomoHistory: PomodoroSession[];
  tasks: Task[];
  selectedTaskId: string;
  timerSecondsLeft: number;
  timerPaused: boolean;
  focusMin: number;
  shortMin: number;
  longMin: number;
  onSelectTaskId: (id: string) => void;
  onTogglePause: () => void;
  onStart: (kind: SessionKind, plannedMin: number, taskId?: string | null) => void | Promise<void>;
  onComplete: () => void | Promise<void>;
  onAbandon: () => void | Promise<void>;
}

function formatClock(secs: number): string {
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export function PomodoroPage({
  activePomo,
  pomoHistory,
  tasks,
  selectedTaskId,
  timerSecondsLeft,
  timerPaused,
  focusMin,
  shortMin,
  longMin,
  onSelectTaskId,
  onTogglePause,
  onStart,
  onComplete,
  onAbandon,
}: PomodoroPageProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-slate-900/60 p-8 ring-1 ring-slate-800/80 flex flex-col items-center text-center gap-5">
        <Timer className="h-12 w-12 text-sky-400" />
        <h2 className="text-2xl font-bold text-slate-50">{t("pomodoro.title")}</h2>

        {activePomo ? (
          <div className="space-y-5 w-full max-w-md">
            <div
              data-testid="pomodoro-clock"
              className="text-6xl font-extrabold tracking-tight text-sky-300 tabular-nums"
            >
              {formatClock(timerSecondsLeft)}
            </div>
            <div className="text-sm font-semibold text-amber-300">
              {timerPaused ? t("pomodoro.paused") : t("pomodoro.running")} •{" "}
              {activePomo.planned_min} min ({t(`pomodoro.kinds.${activePomo.kind}`)})
            </div>
            {activePomo.task_id && (
              <div className="text-xs text-slate-300 bg-slate-950/70 px-3 py-1.5 rounded-lg ring-1 ring-slate-800">
                🎯 {tasks.find((x) => x.id === activePomo.task_id)?.title ?? activePomo.task_id}
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={onTogglePause}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                {timerPaused ? (
                  <>
                    <Play className="h-4 w-4" /> {t("pomodoro.resumeTimer")}
                  </>
                ) : (
                  <>
                    <Pause className="h-4 w-4" /> {t("pomodoro.pauseTimer")}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => void onComplete()}
                className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
              >
                ✓ {t("pomodoro.complete")}
              </button>
              <button
                type="button"
                onClick={() => void onAbandon()}
                className="rounded-xl bg-red-500/20 px-5 py-2.5 text-sm font-semibold text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/30 cursor-pointer"
              >
                ✕ {t("pomodoro.abandon")}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 w-full max-w-lg">
            <p className="text-sm text-slate-400">{t("pomodoro.idle")}</p>
            <select
              value={selectedTaskId}
              onChange={(e) => onSelectTaskId(e.target.value)}
              className="w-full rounded-xl bg-slate-950 px-3.5 py-2.5 text-xs text-slate-200 ring-1 ring-slate-800"
            >
              <option value="">{t("pomodoro.noTaskLinked")}</option>
              {tasks
                .filter((x) => x.status !== "done")
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    🎯 {task.title} ({t(`kanban.priority.${task.priority}`)})
                  </option>
                ))}
            </select>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => void onStart("focus", focusMin, selectedTaskId || null)}
                className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 cursor-pointer"
              >
                🔥 {t("pomodoro.startFocusCustom", { min: focusMin })}
              </button>
              <button
                type="button"
                onClick={() => void onStart("short_break", shortMin, null)}
                className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                ☕ {t("pomodoro.startShortBreakCustom", { min: shortMin })}
              </button>
              <button
                type="button"
                onClick={() => void onStart("long_break", longMin, null)}
                className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                🌿 {t("pomodoro.startLongBreakCustom", { min: longMin })}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-3">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Clock className="h-4 w-4 text-sky-400" />
          {t("pomodoro.history")}
        </h3>
        {pomoHistory.length === 0 ? (
          <p className="text-xs text-slate-500">{t("pomodoro.noHistory")}</p>
        ) : (
          <div className="space-y-2">
            {pomoHistory.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg bg-slate-950/70 px-3.5 py-2 text-xs ring-1 ring-slate-800/80"
              >
                <span className="font-medium text-slate-200">
                  {t(`pomodoro.kinds.${s.kind}`)} • {s.actual_min ?? s.planned_min} min
                </span>
                <span className="text-slate-400">{t(`pomodoro.statuses.${s.status}`)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
