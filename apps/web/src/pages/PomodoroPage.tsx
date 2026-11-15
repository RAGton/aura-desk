import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Clock,
  Coffee,
  Flame,
  Leaf,
  Pause,
  Play,
  Target,
  Timer,
} from "lucide-react";

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

function formatSessionTime(iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  const completedFocusSessions = pomoHistory.filter(
    (s) => s.kind === "focus" && s.status === "completed"
  );
  const completedFocusCount = completedFocusSessions.length;
  const totalLoggedFocusMin = completedFocusSessions.reduce(
    (sum, s) => sum + (s.actual_min ?? s.planned_min),
    0
  );
  const cycleCurrent = (completedFocusCount % safeCyclesTotal) + 1;

  const totalSec = activePomo ? Math.max(1, activePomo.planned_min * 60) : focusMin * 60;
  const progress = activePomo ? Math.min(1, Math.max(0, timerSecondsLeft / totalSec)) : 1;
  const radius = 82;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const mins = Math.max(1, Number(customMin) || focusMin);
    void onStart("focus", mins, selectedTaskId || null);
    setCustomMin("");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Main Focus Studio */}
      <div className="lg:col-span-7 rounded-2xl aura-glass p-7 flex flex-col items-center text-center gap-5">
        <div className="space-y-1.5">
          <div className="flex items-center justify-center gap-3">
            <div className="rounded-xl bg-sky-500/15 p-2 ring-1 ring-sky-400/30">
              <Timer className="h-7 w-7 text-sky-400" />
            </div>
            <h2 className="text-2xl font-bold text-slate-50">{t("pomodoro.title")}</h2>
          </div>
          <p className="text-xs text-slate-400">{t("pomodoro.subtitle")}</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full aura-glass-pill px-3.5 py-1 text-xs font-medium text-sky-300">
            {t("pomodoro.cycleProgress", { current: cycleCurrent, total: safeCyclesTotal })}
          </span>
          <div className="inline-flex items-center gap-1.5 rounded-full aura-glass-pill px-2.5 py-1.5">
            {Array.from({ length: safeCyclesTotal }).map((_, idx) => {
              const filled = idx < completedFocusCount % safeCyclesTotal;
              const isCurrent = idx === completedFocusCount % safeCyclesTotal;
              return (
                <span
                  key={idx}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    filled
                      ? "bg-emerald-400"
                      : isCurrent && activePomo
                        ? "bg-sky-400 animate-pulse"
                        : isCurrent
                          ? "bg-sky-400/70"
                          : "bg-slate-700"
                  }`}
                />
              );
            })}
          </div>
        </div>

        {activePomo ? (
          <div className="space-y-5 w-full max-w-md flex flex-col items-center">
            <div className="relative flex items-center justify-center w-56 h-56">
              <div className="absolute inset-4 rounded-full bg-sky-500/10 blur-2xl pointer-events-none" />
              <svg viewBox="0 0 192 192" className="w-full h-full -rotate-90">
                <circle
                  cx="96"
                  cy="96"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-slate-800/70"
                />
                <circle
                  cx="96"
                  cy="96"
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
                className="absolute text-5xl font-extrabold tracking-tight text-sky-300 tabular-nums"
              >
                {formatClock(timerSecondsLeft)}
              </div>
            </div>

            <div className="rounded-full aura-glass-pill px-4 py-1 text-xs font-semibold text-amber-300">
              {timerPaused ? t("pomodoro.paused") : t("pomodoro.running")} •{" "}
              {activePomo.planned_min} min ({t(`pomodoro.kinds.${activePomo.kind}`)})
            </div>
            {activePomo.task_id && (
              <div className="inline-flex items-center gap-1.5 text-xs text-slate-300 aura-glass-pill px-3.5 py-1.5 rounded-xl">
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
                className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 shadow-sm shadow-emerald-500/25 hover:bg-emerald-400 cursor-pointer"
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
            <div className="relative mx-auto flex items-center justify-center w-44 h-44 rounded-full aura-glass-elevated ring-1 ring-sky-400/25">
              <div className="absolute inset-3 rounded-full bg-sky-500/10 blur-xl pointer-events-none" />
              <span
                data-testid="pomodoro-clock"
                className="text-4xl font-extrabold tracking-tight text-slate-100 tabular-nums"
              >
                {formatClock(focusMin * 60)}
              </span>
            </div>
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
            <div className="flex flex-wrap justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => void onStart("focus", focusMin, selectedTaskId || null)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-bold text-slate-950 shadow-sm shadow-sky-500/25 hover:bg-sky-400 cursor-pointer"
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

            <form
              onSubmit={handleCustomSubmit}
              className="flex items-center justify-center gap-2 pt-1"
            >
              <input
                type="number"
                min={1}
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
                placeholder={t("pomodoro.customMinutesPlaceholder")}
                className="w-24 rounded-xl bg-slate-950/70 px-3 py-1.5 text-xs text-slate-100 ring-1 ring-slate-800 outline-none focus:ring-sky-500 text-center"
              />
              <button
                type="submit"
                className="rounded-xl aura-glass-pill px-3.5 py-1.5 text-xs font-semibold text-sky-300 hover:text-sky-200 cursor-pointer"
              >
                {t("pomodoro.startCustomFocus")}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Right Column: Session Metrics & History */}
      <div className="lg:col-span-5 space-y-4">
        <div className="grid grid-cols-2 gap-3.5">
          <div className="rounded-2xl aura-glass p-4 border-t-2 border-t-emerald-400/70">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{t("pomodoro.completedSessions")}</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-emerald-300 tabular-nums">
              {completedFocusCount}
            </div>
          </div>
          <div className="rounded-2xl aura-glass p-4 border-t-2 border-t-sky-400/70">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{t("pomodoro.loggedFocus")}</span>
              <Flame className="h-3.5 w-3.5 text-sky-400" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-sky-300 tabular-nums">
              {totalLoggedFocusMin}m
            </div>
          </div>
        </div>

        <div className="rounded-2xl aura-glass p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Clock className="h-4 w-4 text-sky-400" />
              {t("pomodoro.history")}
            </h3>
            <span className="rounded-full aura-glass-pill px-2 py-0.5 text-[11px] font-semibold text-slate-300 tabular-nums">
              {pomoHistory.length}
            </span>
          </div>
          {pomoHistory.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">{t("pomodoro.noHistory")}</p>
          ) : (
            <div className="space-y-2 max-h-[340px] overflow-y-auto aura-scrollbar pr-1">
              {pomoHistory.map((s) => {
                const KindIcon =
                  s.kind === "focus" ? Flame : s.kind === "short_break" ? Coffee : Leaf;
                const kindTone =
                  s.kind === "focus"
                    ? "text-sky-400 bg-sky-500/15"
                    : s.kind === "short_break"
                      ? "text-amber-400 bg-amber-500/15"
                      : "text-emerald-400 bg-emerald-500/15";
                const statusBadge =
                  s.status === "completed"
                    ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                    : s.status === "running" || s.status === "active"
                      ? "bg-sky-500/15 text-sky-300 ring-sky-500/30"
                      : "bg-slate-800/80 text-slate-400 ring-slate-700/60";
                const startedAt = formatSessionTime(s.started_at);
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2.5 rounded-xl aura-glass-pill px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`rounded-lg p-1.5 shrink-0 ${kindTone}`}>
                        <KindIcon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-slate-200 truncate">
                          {t(`pomodoro.kinds.${s.kind}`)} • {s.actual_min ?? s.planned_min} min
                        </div>
                        {startedAt && (
                          <div className="text-[10px] text-slate-400">{startedAt}</div>
                        )}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 shrink-0 ${statusBadge}`}
                    >
                      {t(`pomodoro.statuses.${s.status}`)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
