import React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CheckCircle2,
  Droplets,
  Eye,
  EyeOff,
  Flame,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Timer,
} from "lucide-react";

import { AuraDeskLogo } from "../components/AuraDeskLogo";
import type {
  Alert,
  DailyPlan,
  DashboardSummary,
  PlanState,
  PomodoroSession,
  Reminder,
  Task,
  TaskPriority,
  TaskStatus,
} from "../lib/ipc";

export type WidgetId = "hero" | "kpis" | "next_task" | "routines" | "mini_alerts";

export interface DashboardWidgetConfig {
  id: WidgetId;
  visible: boolean;
  span: "full" | "half";
}

export interface DashboardLayoutState {
  density: "comfortable" | "compact";
  widgets: DashboardWidgetConfig[];
}

export const DEFAULT_LAYOUT: DashboardLayoutState = {
  density: "comfortable",
  widgets: [
    { id: "hero", visible: true, span: "full" },
    { id: "kpis", visible: true, span: "full" },
    { id: "next_task", visible: true, span: "half" },
    { id: "routines", visible: true, span: "half" },
    { id: "mini_alerts", visible: true, span: "full" },
  ],
};

export interface DashboardPageProps {
  layout: DashboardLayoutState;
  customizingLayout: boolean;
  summary: DashboardSummary | null;
  dailyPlan: DailyPlan | null;
  planNotes: string;
  tasks: Task[];
  reminders: Reminder[];
  alerts: Alert[];
  activePomo: PomodoroSession | null;
  timerSecondsLeft: number;
  focusMin: number;
  newTaskTitle: string;
  newTaskPriority: TaskPriority;
  onChangePlanNotes: (notes: string) => void;
  onSavePlanNotes: () => void | Promise<void>;
  onSetPlanState: (state: PlanState) => void | Promise<void>;
  onChangeNewTaskTitle: (v: string) => void;
  onChangeNewTaskPriority: (v: TaskPriority) => void;
  onCreateTask: (e: React.FormEvent) => void | Promise<void>;
  onUpdateLayout: (next: DashboardLayoutState) => void;
  onNavigateTab: (tab: "kanban" | "pomodoro" | "reminders") => void;
  onStartQuickFocus: (taskId?: string | null) => void | Promise<void>;
  onMoveTask: (task: Task, status: TaskStatus) => void | Promise<void>;
  onResolveAlert: (id: string) => void | Promise<void>;
}

function formatClock(secs: number): string {
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export function DashboardPage({
  layout,
  customizingLayout,
  summary,
  dailyPlan,
  planNotes,
  tasks,
  reminders,
  alerts,
  activePomo,
  timerSecondsLeft,
  focusMin,
  newTaskTitle,
  newTaskPriority,
  onChangePlanNotes,
  onSavePlanNotes,
  onSetPlanState,
  onChangeNewTaskTitle,
  onChangeNewTaskPriority,
  onCreateTask,
  onUpdateLayout,
  onNavigateTab,
  onStartQuickFocus,
  onMoveTask,
  onResolveAlert,
}: DashboardPageProps) {
  const { t } = useTranslation();
  const isCompact = layout.density === "compact";

  const moveWidget = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= layout.widgets.length) return;
    const copy = [...layout.widgets];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    onUpdateLayout({ ...layout, widgets: copy });
  };

  const toggleWidgetVisible = (id: WidgetId) => {
    onUpdateLayout({
      ...layout,
      widgets: layout.widgets.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)),
    });
  };

  const toggleWidgetSpan = (id: WidgetId) => {
    onUpdateLayout({
      ...layout,
      widgets: layout.widgets.map((w) =>
        w.id === id ? { ...w, span: w.span === "full" ? "half" : "full" } : w
      ),
    });
  };

  const renderWidget = (w: DashboardWidgetConfig) => {
    if (!w.visible) return null;
    const colClass = w.span === "full" ? "md:col-span-2" : "md:col-span-1";
    const padClass = isCompact ? "p-4" : "p-5";

    switch (w.id) {
      case "hero":
        return (
          <div
            key="hero"
            className={`${colClass} rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 ${padClass} ring-1 ring-slate-800/90 flex flex-col lg:flex-row items-center justify-between gap-6`}
          >
            <div className="flex items-center gap-5">
              <AuraDeskLogo size={isCompact ? 68 : 84} animated />
              <div className="space-y-1.5">
                <h2 className="text-2xl font-bold text-slate-50">{t("dashboard.welcome")}</h2>
                <p className="text-sm text-slate-400">{t("app.subtitle")}</p>
                {activePomo ? (
                  <button
                    type="button"
                    onClick={() => onNavigateTab("pomodoro")}
                    className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3.5 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30 cursor-pointer hover:bg-amber-500/25"
                  >
                    <Flame className="h-3.5 w-3.5" />
                    {t("dashboard.focusActive")} • {formatClock(timerSecondsLeft)}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onStartQuickFocus(null)}
                    className="mt-1 inline-flex items-center gap-2 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer"
                  >
                    <Timer className="h-3.5 w-3.5" />
                    {t("pomodoro.startFocusCustom", { min: focusMin })}
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-slate-950/80 p-4 ring-1 ring-slate-800 w-full lg:w-80 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t("dashboard.dailyPlan")}
                </span>
                <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-medium text-indigo-300">
                  {dailyPlan
                    ? t(`dashboard.planStatus.${dailyPlan.state}`)
                    : t("dashboard.planStatus.not_started")}
                </span>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={planNotes}
                  onChange={(e) => onChangePlanNotes(e.target.value)}
                  placeholder={t("dashboard.planNotesPlaceholder")}
                  className="flex-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs text-slate-200 ring-1 ring-slate-800 outline-none focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={() => void onSavePlanNotes()}
                  className="rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] font-medium text-sky-300 cursor-pointer"
                >
                  {t("dashboard.saveNotes")}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void onSetPlanState("in_progress")}
                  className="flex-1 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 cursor-pointer transition-colors"
                >
                  {t("dashboard.startPlan")}
                </button>
                <button
                  type="button"
                  onClick={() => void onSetPlanState("completed")}
                  className="flex-1 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white cursor-pointer transition-colors"
                >
                  {t("dashboard.completePlan")}
                </button>
              </div>
            </div>
          </div>
        );

      case "kpis":
        return (
          <div key="kpis" className={`${colClass} grid grid-cols-2 md:grid-cols-4 gap-4`}>
            <button
              type="button"
              onClick={() => onNavigateTab("kanban")}
              className={`text-left rounded-xl bg-slate-900/60 ${padClass} ring-1 ring-slate-800/80 hover:ring-sky-500/40 transition-all cursor-pointer`}
            >
              <div className="text-xs text-slate-400">{t("dashboard.pendingTasks")}</div>
              <div className="mt-1 text-3xl font-bold text-sky-400 tabular-nums">
                {summary?.pendingCount ?? tasks.filter((x) => x.status !== "done").length}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab("kanban")}
              className={`text-left rounded-xl bg-slate-900/60 ${padClass} ring-1 ring-slate-800/80 hover:ring-emerald-500/40 transition-all cursor-pointer`}
            >
              <div className="text-xs text-slate-400">{t("dashboard.completedToday")}</div>
              <div className="mt-1 text-3xl font-bold text-emerald-400 tabular-nums">
                {summary?.completedToday ?? tasks.filter((x) => x.status === "done").length}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab("pomodoro")}
              className={`text-left rounded-xl bg-slate-900/60 ${padClass} ring-1 ring-slate-800/80 hover:ring-amber-500/40 transition-all cursor-pointer`}
            >
              <div className="text-xs text-slate-400">{t("dashboard.focusMinutes")}</div>
              <div className="mt-1 text-3xl font-bold text-amber-400 tabular-nums">
                {summary?.todayFocusMin ?? 0}m
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab("reminders")}
              className={`text-left rounded-xl bg-slate-900/60 ${padClass} ring-1 ring-slate-800/80 hover:ring-indigo-500/40 transition-all cursor-pointer`}
            >
              <div className="text-xs text-slate-400">{t("dashboard.pendingReminders")}</div>
              <div className="mt-1 text-3xl font-bold text-indigo-400 tabular-nums">
                {summary?.pendingReminders ??
                  reminders.filter((r) => r.status === "pending").length}
              </div>
            </button>
          </div>
        );

      case "next_task":
        return (
          <div
            key="next_task"
            className={`${colClass} rounded-xl bg-slate-900/50 ${padClass} ring-1 ring-slate-800/80 space-y-4`}
          >
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-sky-400" />
              {t("dashboard.nextTask")}
            </h3>

            {summary?.nextTask ? (
              <div className="rounded-xl bg-slate-950/80 p-4 ring-1 ring-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-slate-100">{summary.nextTask.title}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {t(`kanban.priority.${summary.nextTask.priority}`)} •{" "}
                    {t(`kanban.columns.${summary.nextTask.status}`)}
                    {summary.nextTask.actual_min
                      ? ` • ${summary.nextTask.actual_min}${t("dashboard.focusSuffix")}`
                      : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      summary.nextTask && void onStartQuickFocus(summary.nextTask.id)
                    }
                    className="rounded-lg bg-sky-500/20 px-3 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/30 cursor-pointer"
                  >
                    ▶ {t("kanban.focusTask")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      summary.nextTask && void onMoveTask(summary.nextTask, "done")
                    }
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 cursor-pointer"
                  >
                    ✓ {t("kanban.columns.done")}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">{t("dashboard.noPendingTasks")}</p>
            )}

            <form
              onSubmit={(e) => void onCreateTask(e)}
              className="flex flex-wrap gap-2 pt-1"
            >
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => onChangeNewTaskTitle(e.target.value)}
                placeholder={t("dashboard.quickTaskPlaceholder")}
                className="flex-1 min-w-[200px] rounded-lg bg-slate-950 px-3.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
              />
              <select
                value={newTaskPriority}
                onChange={(e) => onChangeNewTaskPriority(e.target.value as TaskPriority)}
                className="rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-800"
              >
                <option value="low">{t("kanban.priority.low")}</option>
                <option value="normal">{t("kanban.priority.normal")}</option>
                <option value="high">{t("kanban.priority.high")}</option>
                <option value="urgent">{t("kanban.priority.urgent")}</option>
              </select>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer transition-colors"
              >
                <Plus className="h-4 w-4" />
                {t("dashboard.addTask")}
              </button>
            </form>
          </div>
        );

      case "routines":
        return (
          <div
            key="routines"
            className={`${colClass} rounded-xl bg-slate-900/50 ${padClass} ring-1 ring-slate-800/80 space-y-3`}
          >
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Droplets className="h-4 w-4 text-sky-400" />
              {t("dashboard.routinesTitle")}
            </h3>
            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between rounded-lg bg-slate-950/60 p-2.5 ring-1 ring-slate-800/80">
                <span>💧 {t("dashboard.waterEvery")}</span>
                <span className="font-semibold text-sky-300">
                  {summary?.waterIntervalMin ?? 60} min
                </span>
              </div>
              <div className="flex justify-between rounded-lg bg-slate-950/60 p-2.5 ring-1 ring-slate-800/80">
                <span>🧘 {t("dashboard.breakEvery")}</span>
                <span className="font-semibold text-indigo-300">
                  {summary?.breakIntervalMin ?? 90} min
                </span>
              </div>
              <div className="flex justify-between rounded-lg bg-slate-950/60 p-2.5 ring-1 ring-slate-800/80">
                <span>🌅 {t("dashboard.planningAt")}</span>
                <span className="font-semibold text-amber-300">
                  {summary?.dailyPlanningTime ?? "07:50"}
                </span>
              </div>
            </div>
          </div>
        );

      case "mini_alerts":
        return (
          <div
            key="mini_alerts"
            className={`${colClass} rounded-xl bg-slate-900/50 ${padClass} ring-1 ring-slate-800/80 space-y-3`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Bell className="h-4 w-4 text-amber-400" />
                {t("dashboard.widgets.mini_alerts")}
              </h3>
              <button
                type="button"
                onClick={() => onNavigateTab("reminders")}
                className="text-xs text-sky-400 hover:underline cursor-pointer"
              >
                {t("nav.reminders")} →
              </button>
            </div>
            {alerts.length === 0 ? (
              <p className="text-xs text-slate-500">{t("reminders.noAlerts")}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {alerts.slice(0, 4).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-500/30"
                  >
                    <div>
                      <div className="text-xs font-semibold text-amber-200">{a.title}</div>
                      {a.body && <div className="text-[11px] text-amber-300/80">{a.body}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void onResolveAlert(a.id)}
                      className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white cursor-pointer"
                    >
                      ✓ {t("reminders.resolve")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="space-y-5">
      {customizingLayout && (
        <div className="rounded-2xl bg-slate-900/90 p-5 ring-1 ring-sky-500/40 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-sky-400" />
              <h3 className="text-sm font-bold text-slate-100">
                {t("dashboard.customizeLayout")}
              </h3>
            </div>
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-950 p-1 ring-1 ring-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => onUpdateLayout({ ...layout, density: "comfortable" })}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    layout.density === "comfortable"
                      ? "bg-sky-500 text-slate-950 font-semibold"
                      : "text-slate-400"
                  }`}
                >
                  {t("dashboard.densityComfortable")}
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateLayout({ ...layout, density: "compact" })}
                  className={`px-2.5 py-1 rounded-md cursor-pointer ${
                    layout.density === "compact"
                      ? "bg-sky-500 text-slate-950 font-semibold"
                      : "text-slate-400"
                  }`}
                >
                  {t("dashboard.densityCompact")}
                </button>
              </div>
              <button
                type="button"
                onClick={() => onUpdateLayout(DEFAULT_LAYOUT)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("dashboard.resetLayout")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {layout.widgets.map((w, idx) => (
              <div
                key={w.id}
                className="flex items-center justify-between rounded-xl bg-slate-950/90 px-3.5 py-2.5 ring-1 ring-slate-800"
              >
                <span className="text-xs font-medium text-slate-200">
                  {t(`dashboard.widgets.${w.id}`)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleWidgetSpan(w.id)}
                    className="rounded bg-slate-800 px-2 py-1 text-[10px] font-semibold text-sky-300 hover:bg-slate-700 cursor-pointer"
                    title={t("dashboard.widgetWidth")}
                  >
                    {w.span === "full" ? t("dashboard.widthFull") : t("dashboard.widthHalf")}
                  </button>
                  <button
                    type="button"
                    onClick={() => moveWidget(idx, -1)}
                    disabled={idx === 0}
                    className="p-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveWidget(idx, 1)}
                    disabled={idx === layout.widgets.length - 1}
                    className="p-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleWidgetVisible(w.id)}
                    className={`p-1 rounded cursor-pointer ${
                      w.visible
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {w.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`grid grid-cols-1 md:grid-cols-2 ${isCompact ? "gap-3.5" : "gap-6"}`}>
        {layout.widgets.map((w) => renderWidget(w))}
      </div>
    </div>
  );
}
