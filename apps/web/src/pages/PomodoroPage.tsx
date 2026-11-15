import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Coffee, Flame, Leaf, Pause, Play, Target, Timer } from "lucide-react";

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
  cyclesToLong?: number;
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
  cyclesToLong = 4,
  onSelectTaskId,
  onTogglePause,
  onStart,
  onComplete,
  onAbandon,
}: PomodoroPageProps) {
  const { t } = useTranslation();
  const [customMin, setCustomMin] = useState("");

  const safeCyclesTotal = Math.max(1, cyclesToLong);
  const completedFocusCount = pomoHistory.filter(
    (s) => s.kind === "focus" && s.status === "completed"
  ).length;
  const cycleCurrent = (completedFocusCount % safeCyclesTotal) + 1;

  const totalSec = activePomo ? Math.max(1, activePomo.planned_min * 60) : focusMin * 60;
  const progress = activePomo ? Math.min(1, Math.max(0, timerSecondsLeft / totalSec)) : 1;
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl aura-glass p-8 flex flex-col items-center text-center gap-5">
        <div className="flex items-center gap-3">
          <Timer className="h-9 w-9 text-sky-400" />
          <h2 className="text-2xl font-bold text-slate-50">{t("pomodoro.title")}</h2>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-full aura-glass-pill px-3.5 py-1 text-xs font-medium text-sky-300">
          {t("pomodoro.cycleProgress", { current: cycleCurrent, total: safeCyclesTotal })}
        </span>

        {activePomo ? (
          <div className="space-y-5 w-full max-w-md flex flex-col items-center">
            <div className="relative flex items-center justify-center w-48 h-48">
              <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90">
                <circle
                  cx="90"
                  cy="90"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-slate-800/70"
                />
                <circle
                  cx="90"
                  cy="90"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="text-sky-400 transition-[stroke-dashoffset] duration-500"
                />
              </svg>
              <div
                data-testid="pomodoro-clock"
                className="absolute text-4xl font-extrabold tracking-tight text-sky-300 tabular-nums"
              >
                {formatClock(timerSecondsLeft)}
              </div>
            </div>

            <div className="text-sm font-semibold text-amber-300">
              {timerPaused ? t("pomodoro.paused") : t("pomodoro.running")} •{" "}
              {activePomo.planned_min} min ({t(`pomodoro.kinds.${activePomo.kind}`)})
            </div>
            {activePomo.task_id && (
              <div className="inline-flex items-center gap-1.5 text-xs text-slate-300 aura-glass-pill px-3.5 py-1.5 rounded-lg">
                <Target className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span>{tasks.find((x) => x.id === activePomo.task_id)?.title ?? activePomo.task_id}</span>
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
              className="w-full rounded-xl bg-slate-950/80 px-3.5 py-2.5 text-xs text-slate-200 ring-1 ring-slate-800"
            >
              <option value="">{t("pomodoro.noTaskLinked")}</option>
              {tasks
                .filter((x) => x.status !== "done")
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} ({t(`kanban.priority.${task.priority}`)})
                  </option>
                ))}
            </select>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => void onStart("focus", focusMin, selectedTaskId || null)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 cursor-pointer"
              >
                <Flame className="h-4 w-4" />
                {t("pomodoro.startFocusCustom", { min: focusMin })}
              </button>
              <button
                type="button"
                onClick={() => void onStart("short_break", shortMin, null)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                <Coffee className="h-4 w-4" />
                {t("pomodoro.startShortBreakCustom", { min: shortMin })}
              </button>
              <button
                type="button"
                onClick={() => void onStart("long_break", longMin, null)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                <Leaf className="h-4 w-4" />
                {t("pomodoro.startLongBreakCustom", { min: longMin })}
              </button>
            </div>

            <div className="flex items-center justify-center gap-2 pt-1">
              <input
                type="number"
                min={1}
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
                placeholder={t("pomodoro.customMinutesPlaceholder")}
                className="w-24 rounded-lg bg-slate-950/70 px-3 py-1.5 text-xs text-slate-100 ring-1 ring-slate-800 outline-none focus:ring-sky-500 text-center"
              />
              <button
                type="button"
                onClick={() => {
                  const mins = Math.max(1, Number(customMin) || focusMin);
                  void onStart("focus", mins, selectedTaskId || null);
                  setCustomMin("");
                }}
                className="rounded-lg aura-glass-pill px-3.5 py-1.5 text-xs font-semibold text-sky-300 hover:text-sky-200 cursor-pointer"
              >
                {t("pomodoro.startCustomFocus")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl aura-glass p-5 space-y-3">
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
                className="flex items-center justify-between rounded-lg aura-glass-pill px-3.5 py-2 text-xs"
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
