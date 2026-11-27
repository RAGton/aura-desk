import { useEffect, useState } from "react";
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

import { Badge, Button, EmptyState, Input, PageHeader, Select } from "../components/ui";
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

function formatSessionTime(locale: string, iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
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
  const { t, i18n } = useTranslation();
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

  useEffect(() => {
    if (!activePomo) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      onTogglePause();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePomo, onTogglePause]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Timer className="h-5 w-5" aria-hidden="true" />}
        title={t("pomodoro.title")}
        subtitle={t("pomodoro.subtitle")}
        badges={
          <Badge variant="info" className="rounded-full px-3 py-0.5 text-[11px] font-medium">
            {t("pomodoro.cycleProgress", { current: cycleCurrent, total: safeCyclesTotal })}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Focus Studio */}
        <div className="lg:col-span-7 rounded-2xl aura-glass p-6 flex flex-col items-center text-center gap-5">
          <div className="inline-flex items-center gap-1.5 rounded-full aura-glass-pill px-3 py-1.5">
            {Array.from({ length: safeCyclesTotal }).map((_, idx) => {
              const filled = idx < completedFocusCount % safeCyclesTotal;
              const isCurrent = idx === completedFocusCount % safeCyclesTotal;
              return (
                <span
                  key={idx}
                  className={`h-2.5 w-2.5 rounded-full transition-colors ${
                    filled
                      ? "bg-emerald-400"
                      : isCurrent && activePomo
                        ? "bg-sky-400 animate-pulse"
                        : isCurrent
                          ? "bg-sky-400/75"
                          : "bg-aura-muted/60"
                  }`}
                />
              );
            })}
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
                aria-live="off"
                className="absolute text-5xl font-extrabold tracking-tight text-sky-300 tabular-nums"
              >
                {formatClock(timerSecondsLeft)}
              </div>
            </div>

            <div role="status" aria-live="polite">
              <Badge variant="warning" className="rounded-full px-4 py-1 text-xs font-semibold">
                {timerPaused ? t("pomodoro.paused") : t("pomodoro.running")} •{" "}
                {activePomo.planned_min} min ({t(`pomodoro.kinds.${activePomo.kind}`)})
              </Badge>
            </div>
            {activePomo.task_id && (
              <div className="inline-flex items-center gap-1.5 text-xs text-slate-300 aura-glass-pill px-3.5 py-1.5 rounded-xl">
                <Target className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span>{tasks.find((x) => x.id === activePomo.task_id)?.title ?? activePomo.task_id}</span>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                size="md"
                variant="secondary"
                onClick={onTogglePause}
                className="rounded-xl text-xs font-semibold"
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
              </Button>
              <Button
                size="lg"
                variant="primary"
                onClick={() => void onComplete()}
                className="rounded-xl bg-aura-success text-aura-inverse font-bold shadow-sm hover:bg-aura-success/90"
              >
                ✓ {t("pomodoro.complete")}
              </Button>
              <Button
                size="lg"
                variant="danger"
                onClick={() => void onAbandon()}
                className="rounded-xl bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/30 font-semibold"
              >
                ✕ {t("pomodoro.abandon")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 w-full max-w-lg">
            <div className="relative mx-auto flex items-center justify-center w-52 h-52">
              <div className="absolute inset-4 rounded-full bg-sky-500/10 blur-2xl pointer-events-none" />
              <svg viewBox="0 0 192 192" className="w-full h-full -rotate-90" aria-hidden="true">
                <circle
                  cx="96"
                  cy="96"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="7"
                  className="text-slate-800/60"
                />
                <circle
                  cx="96"
                  cy="96"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * 0.25}
                  className="text-sky-400/75"
                />
              </svg>
              <span
                data-testid="pomodoro-clock"
                className="absolute text-5xl font-extrabold tracking-tight text-slate-100 tabular-nums"
              >
                {formatClock(focusMin * 60)}
              </span>
            </div>
            <p className="text-sm text-slate-400">{t("pomodoro.idle")}</p>
            <Select
              aria-label={t("pomodoro.selectTaskLabel")}
              value={selectedTaskId}
              onChange={(e) => onSelectTaskId(e.target.value)}
              className="rounded-xl text-xs"
            >
              <option value="">{t("pomodoro.noTaskLinked")}</option>
              {tasks
                .filter((x) => x.status !== "done")
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} ({t(`kanban.priority.${task.priority}`)})
                  </option>
                ))}
            </Select>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 w-full">
              <Button
                size="md"
                variant="primary"
                onClick={() => void onStart("focus", focusMin, selectedTaskId || null)}
                className="min-h-[44px] rounded-xl font-bold text-xs shadow-sm shadow-sky-500/25 w-full"
              >
                <Flame className="h-4 w-4 shrink-0" />
                <span>{t("pomodoro.startFocusCustom", { min: focusMin })}</span>
              </Button>
              <Button
                size="md"
                variant="secondary"
                onClick={() => void onStart("short_break", shortMin, null)}
                className="min-h-[44px] rounded-xl font-semibold text-xs w-full"
              >
                <Coffee className="h-4 w-4 shrink-0" />
                <span>{t("pomodoro.startShortBreakCustom", { min: shortMin })}</span>
              </Button>
              <Button
                size="md"
                variant="secondary"
                onClick={() => void onStart("long_break", longMin, null)}
                className="min-h-[44px] rounded-xl font-semibold text-xs w-full"
              >
                <Leaf className="h-4 w-4 shrink-0" />
                <span>{t("pomodoro.startLongBreakCustom", { min: longMin })}</span>
              </Button>
            </div>

            <form
              onSubmit={handleCustomSubmit}
              className="flex items-center justify-center gap-2 pt-1"
            >
              <Input
                containerClassName="w-24"
                type="number"
                inputMode="numeric"
                min={1}
                aria-label={t("pomodoro.customMinutesLabel")}
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
                placeholder={t("pomodoro.customMinutesPlaceholder")}
                className="rounded-xl text-xs text-center"
              />
              <Button type="submit" size="md" variant="outline" className="rounded-xl text-xs font-semibold text-sky-300">
                {t("pomodoro.startCustomFocus")}
              </Button>
            </form>
          </div>
        )}
      </div>

      {/* Right Column: Session Metrics & History */}
      <div className="lg:col-span-5 space-y-4">
        <div className="grid grid-cols-2 gap-3.5">
          <div className="rounded-2xl aura-glass p-4 border-t-2 border-t-emerald-400/70">
            <div className="flex items-center justify-between text-xs text-aura-text-muted">
              <span>{t("pomodoro.completedSessions")}</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="mt-1.5 text-2xl font-bold text-emerald-300 tabular-nums">
              {completedFocusCount}
            </div>
          </div>
          <div className="rounded-2xl aura-glass p-4 border-t-2 border-t-sky-400/70">
            <div className="flex items-center justify-between text-xs text-aura-text-muted">
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
            <h3 className="text-sm font-semibold text-aura-primary flex items-center gap-2">
              <Clock className="h-4 w-4 text-sky-400" />
              {t("pomodoro.history")}
            </h3>
            <Badge variant="neutral" className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums">
              {pomoHistory.length}
            </Badge>
          </div>
          {pomoHistory.length === 0 ? (
            <EmptyState title={t("pomodoro.noHistory")} className="py-6 px-3" />
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
                const statusVariant =
                  s.status === "completed"
                    ? "success"
                    : s.status === "running" || s.status === "active"
                      ? "info"
                      : "neutral";
                const startedAt = formatSessionTime(i18n.language, s.started_at);
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2.5 rounded-xl aura-glass-pill px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`rounded-lg p-1.5 shrink-0 ${kindTone}`} aria-hidden="true">
                        <KindIcon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-aura-primary truncate">
                          {t(`pomodoro.kinds.${s.kind}`)} • {s.actual_min ?? s.planned_min} min
                        </div>
                        {startedAt && (
                          <div className="text-[11px] text-aura-text-muted tabular-nums">{startedAt}</div>
                        )}
                      </div>
                    </div>
                    <Badge variant={statusVariant} className="rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0">
                      {t(`pomodoro.statuses.${s.status}`)}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
