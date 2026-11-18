import React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellRing,
  CalendarDays,
  CheckCircle2,
  Coffee,
  Droplets,
  Eye,
  EyeOff,
  Flame,
  ListTodo,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Timer,
} from "lucide-react";

import { AuraDeskLogo } from "../components/AuraDeskLogo";
import { Badge, Button, EmptyState, Input, Select, Switch } from "../components/ui";
import { asArray } from "../lib/utils";
import type {
  Alert,
  DailyPlan,
  DashboardSummary,
  PlanState,
  PomodoroSession,
  ProposalItem,
  Reminder,
  Routine,
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
  routines?: Routine[];
  proposals?: ProposalItem[];
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
  onNavigateTab: (tab: "kanban" | "pomodoro" | "reminders" | "settings") => void;
  onStartQuickFocus: (taskId?: string | null) => void | Promise<void>;
  onMoveTask: (task: Task, status: TaskStatus) => void | Promise<void>;
  onResolveAlert: (id: string) => void | Promise<void>;
  onToggleRoutine?: (id: string, enabled: boolean) => void | Promise<void>;
  onApproveProposal?: (id: string) => void | Promise<void>;
  onRejectProposal?: (id: string) => void | Promise<void>;
}

function formatClock(secs: number): string {
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function priorityBorderClass(priority: TaskPriority): string {
  switch (priority) {
    case "urgent":
      return "border-l-4 border-l-rose-500";
    case "high":
      return "border-l-4 border-l-amber-400";
    case "normal":
      return "border-l-4 border-l-sky-400";
    default:
      return "border-l-4 border-l-slate-600";
  }
}

function planStatusBadgeClass(state: PlanState | undefined): string {
  switch (state) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/35";
    case "in_progress":
      return "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/35";
    case "skipped":
      return "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/35";
    default:
      return "bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/35";
  }
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
  routines = [],
  proposals = [],
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
  onToggleRoutine,
  onApproveProposal,
  onRejectProposal,
}: DashboardPageProps) {
  const { t, i18n } = useTranslation();
  const isCompact = layout.density === "compact";
  const safeRoutines = asArray<Routine>(routines);
  const safeProposals = asArray<ProposalItem>(proposals);
  const formattedToday = new Date().toLocaleDateString(i18n.language, {
    weekday: "long",
    day: "2-digit",
    month: "short",
  });
  const overdueCount = summary?.overdueCount ?? 0;

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
            className={`${colClass} rounded-2xl aura-glass aura-hero-gradient bg-gradient-to-r from-slate-900/75 via-indigo-950/50 to-slate-900/75 ${padClass} flex flex-col lg:flex-row items-center justify-between gap-6`}
          >
            <div className="flex items-center gap-5">
              <AuraDeskLogo size={isCompact ? 68 : 84} animated />
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-2xl font-bold text-slate-50">{t("dashboard.welcome")}</h2>
                  <Badge variant="neutral" className="rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize">
                    <CalendarDays className="h-3 w-3 text-sky-400" />
                    {formattedToday}
                  </Badge>
                </div>
                <p className="text-xs text-slate-400">{t("dashboard.subtitle")}</p>
                {activePomo ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigateTab("pomodoro")}
                    className="rounded-full bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25 text-xs font-semibold"
                  >
                    <Flame className="h-3.5 w-3.5" />
                    {t("dashboard.focusActive")} • {formatClock(timerSecondsLeft)}
                  </Button>
                ) : (
                  <Button
                    size="md"
                    variant="primary"
                    onClick={() => void onStartQuickFocus(null)}
                    className="rounded-xl text-xs font-semibold shadow-sm shadow-sky-500/25"
                  >
                    <Timer className="h-3.5 w-3.5" />
                    {t("pomodoro.startFocusCustom", { min: focusMin })}
                  </Button>
                )}
              </div>
            </div>

            <div className="rounded-xl aura-glass-elevated p-4 w-full lg:w-96 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t("dashboard.dailyPlan")}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${planStatusBadgeClass(dailyPlan?.state)}`}
                >
                  {dailyPlan
                    ? t(`dashboard.planStatus.${dailyPlan.state}`)
                    : t("dashboard.planStatus.not_started")}
                </span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void onSavePlanNotes();
                }}
                className="flex gap-1.5"
              >
                <Input
                  containerClassName="flex-1"
                  type="text"
                  aria-label={t("dashboard.dailyNotesLabel")}
                  value={planNotes}
                  onChange={(e) => onChangePlanNotes(e.target.value)}
                  placeholder={t("dashboard.planNotesPlaceholder")}
                  className="py-1.5 text-xs"
                />
                <Button type="submit" size="sm" variant="secondary" className="text-[11px] text-aura-accent">
                  {t("dashboard.saveNotes")}
                </Button>
              </form>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void onSetPlanState("in_progress")}
                  className="flex-1 text-xs"
                >
                  {t("dashboard.startPlan")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void onSetPlanState("completed")}
                  className="flex-1 bg-aura-success hover:bg-aura-success/90 text-aura-inverse font-semibold text-xs"
                >
                  {t("dashboard.completePlan")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void onSetPlanState("skipped")}
                  className="text-xs text-slate-300 hover:text-amber-300"
                >
                  {t("dashboard.skipPlan")}
                </Button>
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
              className={`text-left rounded-2xl aura-glass aura-card-interactive border-t-2 border-t-sky-400/70 ${padClass} hover:ring-1 hover:ring-sky-500/40 cursor-pointer space-y-1.5`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">{t("dashboard.pendingTasks")}</span>
                <span className="rounded-lg bg-sky-500/15 p-1.5 text-sky-400">
                  <ListTodo className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-3xl font-bold text-sky-400 tabular-nums">
                  {summary?.pendingCount ?? tasks.filter((x) => x.status !== "done").length}
                </span>
                {overdueCount > 0 && (
                  <Badge variant="danger" className="rounded-full px-2 py-0.5 text-[10px] font-semibold">
                    {t("dashboard.overdueBadge", { count: overdueCount })}
                  </Badge>
                )}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab("kanban")}
              className={`text-left rounded-2xl aura-glass aura-card-interactive border-t-2 border-t-emerald-400/70 ${padClass} hover:ring-1 hover:ring-emerald-500/40 cursor-pointer space-y-1.5`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">{t("dashboard.completedToday")}</span>
                <span className="rounded-lg bg-emerald-500/15 p-1.5 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="text-3xl font-bold text-emerald-400 tabular-nums">
                {summary?.completedToday ?? tasks.filter((x) => x.status === "done").length}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab("pomodoro")}
              className={`text-left rounded-2xl aura-glass aura-card-interactive border-t-2 border-t-amber-400/70 ${padClass} hover:ring-1 hover:ring-amber-500/40 cursor-pointer space-y-1.5`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">{t("dashboard.focusMinutes")}</span>
                <span className="rounded-lg bg-amber-500/15 p-1.5 text-amber-400">
                  <Flame className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="text-3xl font-bold text-amber-400 tabular-nums">
                {summary?.todayFocusMin ?? 0}m
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab("reminders")}
              className={`text-left rounded-2xl aura-glass aura-card-interactive border-t-2 border-t-indigo-400/70 ${padClass} hover:ring-1 hover:ring-indigo-500/40 cursor-pointer space-y-1.5`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-400">{t("dashboard.pendingReminders")}</span>
                <span className="rounded-lg bg-indigo-500/15 p-1.5 text-indigo-400">
                  <Bell className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="text-3xl font-bold text-indigo-400 tabular-nums">
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
            className={`${colClass} rounded-2xl aura-glass ${padClass} space-y-4`}
          >
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-sky-400" />
              {t("dashboard.nextTask")}
            </h3>

            {summary?.nextTask ? (
              <div
                className={`rounded-xl aura-glass-elevated ${priorityBorderClass(summary.nextTask.priority)} p-4 flex flex-wrap items-center justify-between gap-4`}
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="font-semibold text-slate-100 break-words">
                    {summary.nextTask.title}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <Badge
                      variant={
                        summary.nextTask.priority === "urgent"
                          ? "danger"
                          : summary.nextTask.priority === "high"
                            ? "warning"
                            : "info"
                      }
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    >
                      {t(`kanban.priority.${summary.nextTask.priority}`)}
                    </Badge>
                    <Badge variant="neutral" className="rounded-full px-2 py-0.5 text-[11px]">
                      {t(`kanban.columns.${summary.nextTask.status}`)}
                    </Badge>
                    {summary.nextTask.actual_min ? (
                      <span className="text-emerald-400 font-medium">
                        {summary.nextTask.actual_min}
                        {t("dashboard.focusSuffix")}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      summary.nextTask && void onStartQuickFocus(summary.nextTask.id)
                    }
                    className="text-xs font-medium text-sky-300 border-sky-500/30 bg-sky-500/15 hover:bg-sky-500/25"
                  >
                    ▶ {t("kanban.focusTask")}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      summary.nextTask && void onMoveTask(summary.nextTask, "done")
                    }
                    className="bg-aura-success hover:bg-aura-success/90 text-aura-inverse text-xs font-semibold"
                  >
                    ✓ {t("kanban.columns.done")}
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState title={t("dashboard.noPendingTasks")} className="py-5 px-3" />
            )}

            <form
              onSubmit={(e) => void onCreateTask(e)}
              className="flex flex-wrap gap-2 pt-1"
            >
              <Input
                containerClassName="flex-1 min-w-[200px]"
                type="text"
                aria-label={t("kanban.newTaskPlaceholder")}
                value={newTaskTitle}
                onChange={(e) => onChangeNewTaskTitle(e.target.value)}
                placeholder={t("dashboard.quickTaskPlaceholder")}
                className="px-3.5 py-2 text-sm"
              />
              <Select
                containerClassName="w-auto min-w-[110px]"
                aria-label={t("dashboard.priorityLabel")}
                value={newTaskPriority}
                onChange={(e) => onChangeNewTaskPriority(e.target.value as TaskPriority)}
                className="py-2 text-xs"
              >
                <option value="low">{t("kanban.priority.low")}</option>
                <option value="normal">{t("kanban.priority.normal")}</option>
                <option value="high">{t("kanban.priority.high")}</option>
                <option value="urgent">{t("kanban.priority.urgent")}</option>
              </Select>
              <Button type="submit" size="md" variant="primary" className="text-xs font-semibold">
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("dashboard.addTask")}
              </Button>
            </form>
          </div>
        );

      case "routines":
        return (
          <div
            key="routines"
            className={`${colClass} rounded-2xl aura-glass ${padClass} space-y-3`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Droplets className="h-4 w-4 text-sky-400" />
                {t("dashboard.routinesTitle")}
              </h3>
              <button
                type="button"
                onClick={() => onNavigateTab("settings")}
                className="text-xs text-sky-400 hover:underline cursor-pointer"
              >
                {t("dashboard.openRoutinesSettings")} →
              </button>
            </div>
            {safeRoutines.length > 0 ? (
              <div className="space-y-2 text-xs text-slate-300">
                {safeRoutines.map((r) => {
                  const RoutineIcon =
                    r.kind === "water"
                      ? Droplets
                      : r.kind === "break"
                        ? Coffee
                        : Sparkles;
                  const iconColor =
                    r.kind === "water"
                      ? "text-sky-400 bg-sky-500/15"
                      : r.kind === "break"
                        ? "text-indigo-400 bg-indigo-500/15"
                        : "text-amber-400 bg-amber-500/15";
                  return (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2.5 rounded-xl aura-glass-pill p-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`rounded-lg p-1.5 shrink-0 ${iconColor}`}>
                          <RoutineIcon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-100 truncate">{r.title}</div>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                r.enabled ? "bg-emerald-400" : "bg-slate-500"
                              }`}
                            />
                            {r.enabled
                              ? t("dashboard.routineEnabled")
                              : t("dashboard.routineDisabled")}
                            {r.kind === "water"
                              ? ` • ${summary?.waterIntervalMin ?? 60} min`
                              : r.kind === "break"
                                ? ` • ${summary?.breakIntervalMin ?? 90} min`
                                : r.kind === "daily_planning"
                                  ? ` • ${summary?.dailyPlanningTime ?? "07:50"}`
                                  : ""}
                          </div>
                        </div>
                      </div>
                      {onToggleRoutine && (
                        <Switch
                          size="sm"
                          aria-label={`${t("dashboard.toggleRoutine")}: ${r.title}`}
                          checked={r.enabled}
                          onCheckedChange={(next) => void onToggleRoutine(r.id, next)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2 text-xs text-slate-300">
                <div className="flex justify-between rounded-xl aura-glass-pill p-2.5">
                  <span className="inline-flex items-center gap-2">
                    <Droplets className="h-3.5 w-3.5 text-sky-400" />
                    {t("dashboard.waterEvery")}
                  </span>
                  <span className="font-semibold text-sky-300">
                    {summary?.waterIntervalMin ?? 60} min
                  </span>
                </div>
                <div className="flex justify-between rounded-xl aura-glass-pill p-2.5">
                  <span className="inline-flex items-center gap-2">
                    <Coffee className="h-3.5 w-3.5 text-indigo-400" />
                    {t("dashboard.breakEvery")}
                  </span>
                  <span className="font-semibold text-indigo-300">
                    {summary?.breakIntervalMin ?? 90} min
                  </span>
                </div>
                <div className="flex justify-between rounded-xl aura-glass-pill p-2.5">
                  <span className="inline-flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                    {t("dashboard.planningAt")}
                  </span>
                  <span className="font-semibold text-amber-300">
                    {summary?.dailyPlanningTime ?? "07:50"}
                  </span>
                </div>
              </div>
            )}
          </div>
        );

      case "mini_alerts":
        return (
          <div
            key="mini_alerts"
            className={`${colClass} rounded-2xl aura-glass ${padClass} space-y-3`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Bell className="h-4 w-4 text-amber-400" />
                {t("dashboard.widgets.mini_alerts")}
                {alerts.length > 0 && (
                  <Badge variant="warning" className="rounded-full px-2 py-0.5 text-[11px] font-semibold">
                    {alerts.length}
                  </Badge>
                )}
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
              <EmptyState title={t("reminders.noAlerts")} className="py-5 px-3" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {alerts.slice(0, 4).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-2.5 rounded-xl aura-glass-elevated p-3 ring-1 ring-amber-500/30"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="rounded-lg bg-amber-500/15 p-1.5 text-amber-400 shrink-0">
                        <BellRing className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-amber-200 truncate">{a.title}</div>
                        {a.body && (
                          <div className="text-[11px] text-slate-400 truncate">{a.body}</div>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void onResolveAlert(a.id)}
                      className="h-7 px-2.5 bg-aura-success text-[11px] font-bold text-aura-inverse hover:bg-aura-success/90 shrink-0"
                    >
                      ✓ {t("reminders.resolve")}
                    </Button>
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
        <div className="rounded-2xl aura-glass-elevated p-5 ring-1 ring-sky-500/40 space-y-4">
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
                      ? "bg-aura-accent text-aura-inverse font-semibold"
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
                      ? "bg-aura-accent text-aura-inverse font-semibold"
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
                className="flex items-center justify-between rounded-xl aura-glass-pill px-3.5 py-2.5"
              >
                <span className="text-xs font-medium text-slate-200">
                  {t(`dashboard.widgets.${w.id}`)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleWidgetSpan(w.id)}
                    className="rounded bg-slate-800 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-slate-700 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus"
                    title={t("dashboard.widgetWidth")}
                  >
                    {w.span === "full" ? t("dashboard.widthFull") : t("dashboard.widthHalf")}
                  </button>
                  <button
                    type="button"
                    aria-label={`${t("dashboard.moveWidgetUp")}: ${t(`dashboard.widgets.${w.id}`)}`}
                    onClick={() => moveWidget(idx, -1)}
                    disabled={idx === 0}
                    className="p-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus"
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`${t("dashboard.moveWidgetDown")}: ${t(`dashboard.widgets.${w.id}`)}`}
                    onClick={() => moveWidget(idx, 1)}
                    disabled={idx === layout.widgets.length - 1}
                    className="p-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus"
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`${t("dashboard.toggleWidgetVisible")}: ${t(`dashboard.widgets.${w.id}`)}`}
                    onClick={() => toggleWidgetVisible(w.id)}
                    className={`p-1.5 rounded cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus ${
                      w.visible
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {w.visible ? (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
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

      {safeProposals.length > 0 && (
        <div className="rounded-2xl aura-glass p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-sky-400" />
            {t("dashboard.proposalsTitle")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {safeProposals.map((p) => (
              <div
                key={p.id}
                className="rounded-xl aura-glass-pill p-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-100">{p.summary}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{p.kind}</div>
                </div>
                <div className="flex items-center gap-2">
                  {onApproveProposal && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void onApproveProposal(p.id)}
                      className="bg-aura-success hover:bg-aura-success/90 text-aura-inverse text-xs font-semibold"
                    >
                      {t("dashboard.proposalsApprove")}
                    </Button>
                  )}
                  {onRejectProposal && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void onRejectProposal(p.id)}
                      className="text-xs font-medium"
                    >
                      {t("dashboard.proposalsReject")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
