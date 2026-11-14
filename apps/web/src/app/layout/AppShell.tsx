import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CheckCircle2,
  Clock,
  Droplets,
  Edit3,
  Eye,
  EyeOff,
  Flame,
  Kanban,
  LayoutDashboard,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Timer,
  Trash2,
} from "lucide-react";

import { AuraDeskLogo } from "../../components/AuraDeskLogo";
import { ReminderModal } from "../../components/ReminderModal";
import {
  alertsApi,
  dashboardApi,
  isTauriRuntime,
  pomodoroApi,
  remindersApi,
  settingsApi,
  tasksApi,
  type Alert,
  type DailyPlan,
  type DashboardSummary,
  type PomodoroSession,
  type Reminder,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../lib/ipc";
import { SettingsPage } from "../../pages/SettingsPage";

type TabKey = "dashboard" | "kanban" | "pomodoro" | "reminders" | "settings";
type WidgetId = "hero" | "kpis" | "next_task" | "routines" | "mini_alerts";

interface DashboardWidgetConfig {
  id: WidgetId;
  visible: boolean;
  span: "full" | "half";
}

interface DashboardLayoutState {
  density: "comfortable" | "compact";
  widgets: DashboardWidgetConfig[];
}

const DEFAULT_LAYOUT: DashboardLayoutState = {
  density: "comfortable",
  widgets: [
    { id: "hero", visible: true, span: "full" },
    { id: "kpis", visible: true, span: "full" },
    { id: "next_task", visible: true, span: "half" },
    { id: "routines", visible: true, span: "half" },
    { id: "mini_alerts", visible: true, span: "full" },
  ],
};

const LAYOUT_STORAGE_KEY = "auradesk_dashboard_layout_v1";
const KANBAN_COLUMNS: TaskStatus[] = ["todo", "doing", "waiting", "done"];

function loadDashboardLayout(): DashboardLayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DashboardLayoutState>;
      if (Array.isArray(parsed.widgets) && parsed.widgets.length > 0) {
        return {
          density: parsed.density === "compact" ? "compact" : "comfortable",
          widgets: parsed.widgets,
        };
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_LAYOUT;
}

export function AppShell() {
  const { t, i18n } = useTranslation();
  // The initial tab follows the URL, so a deep link like /reminders opens
  // that tab directly. Unknown paths fall back to the dashboard.
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const path = window.location.pathname.replace(/^\//, "");
    const known: TabKey[] = ["dashboard", "kanban", "pomodoro", "reminders", "settings"];
    return known.includes(path as TabKey) ? (path as TabKey) : "dashboard";
  });
  const [currentLang, setCurrentLang] = useState<string>(i18n.language || "pt-BR");
  const [inTauri] = useState<boolean>(() => isTauriRuntime());

  // Domain State
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [planNotes, setPlanNotes] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activePomo, setActivePomo] = useState<PomodoroSession | null>(null);
  const [pomoHistory, setPomoHistory] = useState<PomodoroSession[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // The modal pops up for interruptions that need a decision: routines
  // (water, break) and scheduled reminders. A `pomodoro` alert is a
  // celebration, not an interruption, so it stays in the list.
  const popupAlert = useMemo(
    () => alerts.find((a) => a.kind === "routine" || a.kind === "reminder") ?? null,
    [alerts]
  );
  const [statusBanner, setStatusBanner] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);

  // Dashboard Customizer State
  const [customizingLayout, setCustomizingLayout] = useState(false);
  const [layout, setLayout] = useState<DashboardLayoutState>(loadDashboardLayout);

  // Task Creation / Filtering / Editing State
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("normal");
  const [newTaskEstimate, setNewTaskEstimate] = useState("");
  const [kanbanSearch, setKanbanSearch] = useState("");
  const [kanbanPriorityFilter, setKanbanPriorityFilter] = useState<string>("all");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [editingTaskPriority, setEditingTaskPriority] = useState<TaskPriority>("normal");

  // Pomodoro Live Timer State
  const [selectedPomoTaskId, setSelectedPomoTaskId] = useState<string>("");
  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number>(25 * 60);
  const [timerPaused, setTimerPaused] = useState<boolean>(false);

  // Reminders & Alerts State
  const [newReminderTitle, setNewReminderTitle] = useState("");
  const [exceptAlertId, setExceptAlertId] = useState<string | null>(null);
  const [exceptNote, setExceptNote] = useState("");

  const notify = useCallback((text: string, isError = false) => {
    setStatusBanner({ text, isError });
    setTimeout(() => setStatusBanner(null), 3500);
  }, []);

  const updateLayout = (next: DashboardLayoutState) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const refreshAll = useCallback(async () => {
    try {
      const [sum, plan, taskList, pomoRun, pomoHist, remList, alertList] =
        await Promise.all([
          dashboardApi.summary(),
          dashboardApi.dailyPlanGet(),
          tasksApi.list(),
          pomodoroApi.active(),
          pomodoroApi.list(15),
          remindersApi.list(true),
          alertsApi.listPending(),
        ]);
      setSummary(sum);
      setDailyPlan(plan);
      if (plan?.payload && !planNotes) {
        setPlanNotes(plan.payload);
      }
      setTasks(taskList);
      setActivePomo(pomoRun);
      setPomoHistory(pomoHist);
      setReminders(remList);
      setAlerts(alertList);
    } catch (err) {
      notify(String(err), true);
    }
  }, [notify, planNotes]);

  useEffect(() => {
    void refreshAll();
    const interval = setInterval(() => void refreshAll(), 5000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  // Sync live countdown timer when a Pomodoro session is active
  useEffect(() => {
    if (!activePomo) {
      setTimerSecondsLeft(25 * 60);
      setTimerPaused(false);
      return;
    }
    const updateClock = () => {
      if (timerPaused) return;
      const startedMs = new Date(activePomo.started_at).getTime();
      const totalSeconds = activePomo.planned_min * 60;
      const elapsedSeconds = Math.floor((Date.now() - startedMs) / 1000);
      const remaining = Math.max(0, totalSeconds - elapsedSeconds);
      setTimerSecondsLeft(remaining);
    };
    updateClock();
    const id = setInterval(updateClock, 1000);
    return () => clearInterval(id);
  }, [activePomo, timerPaused]);

  // Modal actions. Each one resolves the alert on the backend and then
  // refreshes, which is what actually closes the modal: once the alert
  // is no longer pending, `popupAlert` becomes null.
  const handlePopupResolve = useCallback(
    async (id: string) => {
      try {
        await alertsApi.resolve(id);
        await refreshAll();
      } catch (err) {
        notify(String(err), true);
      }
    },
    [notify, refreshAll]
  );

  const handlePopupSnooze = useCallback(
    async (id: string) => {
      try {
        await alertsApi.snooze(id);
        await refreshAll();
      } catch (err) {
        notify(String(err), true);
      }
    },
    [notify, refreshAll]
  );

  const handlePopupDismiss = useCallback(
    async (id: string) => {
      try {
        await alertsApi.dismiss(id);
        await refreshAll();
      } catch (err) {
        notify(String(err), true);
      }
    },
    [notify, refreshAll]
  );

  const handleLanguageChange = async (lng: "pt-BR" | "en") => {
    await i18n.changeLanguage(lng);
    setCurrentLang(lng);
    try {
      await settingsApi.set("app.locale", lng);
    } catch {
      // ignore
    }
  };

  // ── Task Handlers ────────────────────────────────────────────────────

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;
    try {
      const est = newTaskEstimate.trim() ? parseInt(newTaskEstimate, 10) : null;
      await tasksApi.create({
        title: trimmed,
        priority: newTaskPriority,
        status: "todo",
        estimate_min: est && est > 0 ? est : null,
      });
      setNewTaskTitle("");
      setNewTaskEstimate("");
      await refreshAll();
      notify(
        currentLang.startsWith("pt") ? "✓ Tarefa criada com sucesso!" : "✓ Task created!"
      );
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleMoveTask = async (task: Task, nextStatus: TaskStatus) => {
    try {
      await tasksApi.setStatus({
        id: task.id,
        status: nextStatus,
        kanban_order: task.kanban_order,
      });
      await refreshAll();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleSaveTaskEdit = async (id: string) => {
    const trimmed = editingTaskTitle.trim();
    if (!trimmed) return;
    try {
      await tasksApi.update(id, {
        title: trimmed,
        priority: editingTaskPriority,
      });
      setEditingTaskId(null);
      await refreshAll();
      notify(currentLang.startsWith("pt") ? "✓ Card atualizado!" : "✓ Card updated!");
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await tasksApi.delete(id);
      await refreshAll();
      notify(t("kanban.taskDeleted"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  // ── Pomodoro Handlers ────────────────────────────────────────────────

  const handleStartPomodoro = async (
    kind: "focus" | "short_break" | "long_break",
    planned_min: number,
    explicitTaskId?: string
  ) => {
    try {
      const taskId =
        explicitTaskId || selectedPomoTaskId || summary?.nextTask?.id || null;
      await pomodoroApi.start({
        kind,
        planned_min,
        task_id: taskId,
      });
      setTimerPaused(false);
      await refreshAll();
      notify(
        currentLang.startsWith("pt")
          ? `🔥 Sessão de ${planned_min} min iniciada!`
          : `🔥 Started ${planned_min}m session!`
      );
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleCompletePomodoro = async () => {
    if (!activePomo) return;
    try {
      await pomodoroApi.complete(activePomo.planned_min);
      await refreshAll();
      notify(
        currentLang.startsWith("pt")
          ? `✓ Sessão concluída (+${activePomo.planned_min}m)!`
          : `✓ Session completed (+${activePomo.planned_min}m)!`
      );
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleAbandonPomodoro = async () => {
    try {
      await pomodoroApi.abandon(0);
      await refreshAll();
      notify(t("pomodoro.sessionInterrupted"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  // ── Reminder & Alert Handlers ────────────────────────────────────────

  const handleCreateReminder = async (minutesFromNow: number) => {
    const trimmed = newReminderTitle.trim();
    if (!trimmed) {
      notify(t("reminders.titleRequired"), true);
      return;
    }
    try {
      const fireAt = new Date(Date.now() + minutesFromNow * 60_000).toISOString();
      await remindersApi.create({
        title: trimmed,
        fire_at: fireAt,
        repeat_kind: "none",
        sound: "normal",
      });
      setNewReminderTitle("");
      await refreshAll();
      notify(
        minutesFromNow <= 0
          ? currentLang.startsWith("pt")
            ? "🔔 Alerta disparado!"
            : "🔔 Alert triggered!"
          : currentLang.startsWith("pt")
            ? `✓ Lembrete agendado (+${minutesFromNow} min)!`
            : `✓ Reminder scheduled (+${minutesFromNow}m)!`
      );
    } catch (err) {
      notify(String(err), true);
    }
  };

  // ── Layout Customization Helpers ─────────────────────────────────────

  const moveWidget = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= layout.widgets.length) return;
    const copy = [...layout.widgets];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    updateLayout({ ...layout, widgets: copy });
  };

  const toggleWidgetVisible = (id: WidgetId) => {
    updateLayout({
      ...layout,
      widgets: layout.widgets.map((w) =>
        w.id === id ? { ...w, visible: !w.visible } : w
      ),
    });
  };

  const toggleWidgetSpan = (id: WidgetId) => {
    updateLayout({
      ...layout,
      widgets: layout.widgets.map((w) =>
        w.id === id ? { ...w, span: w.span === "full" ? "half" : "full" } : w
      ),
    });
  };

  const isPt = currentLang.startsWith("pt");
  const isCompact = layout.density === "compact";
  const formatClock = (secs: number) => {
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  // Filtered tasks for Kanban
  const filteredTasks = tasks.filter((task) => {
    if (kanbanPriorityFilter !== "all" && task.priority !== kanbanPriorityFilter) {
      return false;
    }
    if (kanbanSearch.trim()) {
      const q = kanbanSearch.toLowerCase();
      return (
        task.title.toLowerCase().includes(q) ||
        (task.description ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Render individual Dashboard widgets dynamically based on `layout.widgets`
  const renderDashboardWidget = (w: DashboardWidgetConfig) => {
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
                <h2 className="text-2xl font-bold text-slate-50">
                  {t("dashboard.welcome")}
                </h2>
                <p className="text-sm text-slate-400">{t("app.subtitle")}</p>
                {activePomo ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab("pomodoro")}
                    className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3.5 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30 cursor-pointer hover:bg-amber-500/25"
                  >
                    <Flame className="h-3.5 w-3.5" />
                    {t("dashboard.focusActive")} • {formatClock(timerSecondsLeft)}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleStartPomodoro("focus", 25)}
                    className="mt-1 inline-flex items-center gap-2 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer"
                  >
                    <Timer className="h-3.5 w-3.5" />
                    {t("dashboard.startQuickFocus")}
                  </button>
                )}
              </div>
            </div>

            {/* Daily Plan Widget */}
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
                  onChange={(e) => setPlanNotes(e.target.value)}
                  placeholder={t("dashboard.planNotesPlaceholder")}
                  className="flex-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs text-slate-200 ring-1 ring-slate-800 outline-none focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (dailyPlan) {
                      await dashboardApi.dailyPlanSetPayload(
                        dailyPlan.id,
                        planNotes.trim() || null
                      );
                      await refreshAll();
                      notify(isPt ? "✓ Notas do dia salvas!" : "✓ Daily notes saved!");
                    }
                  }}
                  className="rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] font-medium text-sky-300 cursor-pointer"
                >
                  {t("dashboard.saveNotes")}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (dailyPlan) {
                      await dashboardApi.dailyPlanSetState(dailyPlan.id, "in_progress");
                      await refreshAll();
                    }
                  }}
                  className="flex-1 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 cursor-pointer transition-colors"
                >
                  {t("dashboard.startPlan")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (dailyPlan) {
                      await dashboardApi.dailyPlanSetState(dailyPlan.id, "completed");
                      await refreshAll();
                    }
                  }}
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
              onClick={() => setActiveTab("kanban")}
              className={`text-left rounded-xl bg-slate-900/60 ${padClass} ring-1 ring-slate-800/80 hover:ring-sky-500/40 transition-all cursor-pointer`}
            >
              <div className="text-xs text-slate-400">{t("dashboard.pendingTasks")}</div>
              <div className="mt-1 text-3xl font-bold text-sky-400 tabular-nums">
                {summary?.pendingCount ??
                  tasks.filter((x) => x.status !== "done").length}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("kanban")}
              className={`text-left rounded-xl bg-slate-900/60 ${padClass} ring-1 ring-slate-800/80 hover:ring-emerald-500/40 transition-all cursor-pointer`}
            >
              <div className="text-xs text-slate-400">
                {t("dashboard.completedToday")}
              </div>
              <div className="mt-1 text-3xl font-bold text-emerald-400 tabular-nums">
                {summary?.completedToday ??
                  tasks.filter((x) => x.status === "done").length}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("pomodoro")}
              className={`text-left rounded-xl bg-slate-900/60 ${padClass} ring-1 ring-slate-800/80 hover:ring-amber-500/40 transition-all cursor-pointer`}
            >
              <div className="text-xs text-slate-400">{t("dashboard.focusMinutes")}</div>
              <div className="mt-1 text-3xl font-bold text-amber-400 tabular-nums">
                {summary?.todayFocusMin ?? 0}m
              </div>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("reminders")}
              className={`text-left rounded-xl bg-slate-900/60 ${padClass} ring-1 ring-slate-800/80 hover:ring-indigo-500/40 transition-all cursor-pointer`}
            >
              <div className="text-xs text-slate-400">
                {t("dashboard.pendingReminders")}
              </div>
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
                  <div className="font-semibold text-slate-100">
                    {summary.nextTask.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {t(`kanban.priority.${summary.nextTask.priority}`)} •{" "}
                    {t(`kanban.columns.${summary.nextTask.status}`)}
                    {summary.nextTask.actual_min
                      ? ` • ${summary.nextTask.actual_min}m foco`
                      : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (summary.nextTask) {
                        void handleStartPomodoro("focus", 25, summary.nextTask.id);
                      }
                    }}
                    className="rounded-lg bg-sky-500/20 px-3 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/30 cursor-pointer"
                  >
                    ▶ {t("kanban.focusTask")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      summary.nextTask && void handleMoveTask(summary.nextTask, "done")
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
              onSubmit={(e) => void handleCreateTask(e)}
              className="flex flex-wrap gap-2 pt-1"
            >
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder={t("dashboard.quickTaskPlaceholder")}
                className="flex-1 min-w-[200px] rounded-lg bg-slate-950 px-3.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
              />
              <select
                value={newTaskPriority}
                onChange={(e) => setNewTaskPriority(e.target.value as TaskPriority)}
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
                onClick={() => setActiveTab("reminders")}
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
                      {a.body && (
                        <div className="text-[11px] text-amber-300/80">{a.body}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await alertsApi.resolve(a.id);
                        await refreshAll();
                      }}
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header with Winged Notebook Logo + Language Switcher */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-1 rounded-2xl bg-slate-900/90 ring-1 ring-sky-500/30 shadow-lg shadow-sky-500/10">
            <AuraDeskLogo size={48} animated />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-sky-400 via-indigo-300 to-amber-300 bg-clip-text text-transparent">
                {t("app.title")}
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {inTauri ? t("app.connectedTauri") : t("app.connectedBrowser")}
              </span>
            </div>
            <p className="text-xs text-slate-400">{t("app.subtitle")}</p>
          </div>
        </div>

        {/* Status Toast + Language Toggle (pt-BR / en) */}
        <div className="flex items-center gap-2.5">
          {statusBanner && (
            <span
              className={`rounded-lg px-3 py-1 text-xs font-medium ring-1 ${
                statusBanner.isError
                  ? "bg-red-500/15 text-red-300 ring-red-500/30"
                  : "bg-sky-500/15 text-sky-300 ring-sky-500/30"
              }`}
            >
              {statusBanner.text}
            </span>
          )}
          <div className="inline-flex rounded-xl bg-slate-900 p-1 ring-1 ring-slate-800">
            <button
              type="button"
              onClick={() => void handleLanguageChange("pt-BR")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                isPt
                  ? "bg-sky-500 text-slate-950 shadow-sm shadow-sky-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              pt-BR
            </button>
            <button
              type="button"
              onClick={() => void handleLanguageChange("en")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                !isPt
                  ? "bg-sky-500 text-slate-950 shadow-sm shadow-sky-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              en
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="border-b border-slate-800/70 bg-slate-900/30 px-6 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1">
          {(
            [
              {
                key: "dashboard",
                label: t("nav.dashboard"),
                icon: LayoutDashboard,
                badge: undefined,
              },
              {
                key: "kanban",
                label: t("nav.kanban"),
                icon: Kanban,
                badge: tasks.length,
              },
              {
                key: "pomodoro",
                label: t("nav.pomodoro"),
                icon: Timer,
                badge: activePomo ? formatClock(timerSecondsLeft) : undefined,
              },
              {
                key: "reminders",
                label: t("nav.reminders"),
                icon: Bell,
                badge: alerts.length > 0 ? alerts.length : undefined,
              },
              {
                key: "settings",
                label: t("nav.settings"),
                icon: Settings,
                badge: undefined,
              },
            ] as const
          ).map(({ key, label, icon: Icon, badge }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? "border-sky-400 text-sky-300 bg-sky-500/5"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
                {badge !== undefined && (
                  <span className="ml-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-sky-300 ring-1 ring-slate-700 tabular-nums">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Customize Dashboard Layout Button */}
        {activeTab === "dashboard" && (
          <button
            type="button"
            onClick={() => setCustomizingLayout((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              customizingLayout
                ? "bg-sky-500 text-slate-950"
                : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {customizingLayout
              ? t("dashboard.closeCustomizer")
              : t("dashboard.customizeLayout")}
          </button>
        )}
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {/* ================= DASHBOARD TAB ================= */}
        {activeTab === "dashboard" && (
          <div className="space-y-5">
            {/* Interactive Dashboard Layout Customizer Panel */}
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
                        onClick={() =>
                          updateLayout({ ...layout, density: "comfortable" })
                        }
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
                        onClick={() => updateLayout({ ...layout, density: "compact" })}
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
                      onClick={() => updateLayout(DEFAULT_LAYOUT)}
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
                          {w.span === "full"
                            ? t("dashboard.widthFull")
                            : t("dashboard.widthHalf")}
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
                          {w.visible ? (
                            <Eye className="h-3.5 w-3.5" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dynamic Grid of Dashboard Widgets */}
            <div
              className={`grid grid-cols-1 md:grid-cols-2 ${
                isCompact ? "gap-3.5" : "gap-6"
              }`}
            >
              {layout.widgets.map((w) => renderDashboardWidget(w))}
            </div>
          </div>
        )}

        {/* ================= KANBAN & TASKS TAB ================= */}
        {activeTab === "kanban" && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-slate-50">{t("kanban.title")}</h2>

              {/* Search & Filter + Create Card Form */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={kanbanSearch}
                    onChange={(e) => setKanbanSearch(e.target.value)}
                    placeholder={t("kanban.searchPlaceholder")}
                    className="w-44 rounded-lg bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
                  />
                </div>
                <select
                  value={kanbanPriorityFilter}
                  onChange={(e) => setKanbanPriorityFilter(e.target.value)}
                  className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800"
                >
                  <option value="all">{t("kanban.allPriorities")}</option>
                  <option value="urgent">{t("kanban.priority.urgent")}</option>
                  <option value="high">{t("kanban.priority.high")}</option>
                  <option value="normal">{t("kanban.priority.normal")}</option>
                  <option value="low">{t("kanban.priority.low")}</option>
                </select>
              </div>
            </div>

            {/* New Card Creator Bar */}
            <form
              onSubmit={(e) => void handleCreateTask(e)}
              className="rounded-xl bg-slate-900/60 p-3.5 ring-1 ring-slate-800 flex flex-wrap items-center gap-2.5"
            >
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder={t("kanban.newTaskPlaceholder")}
                className="flex-1 min-w-[220px] rounded-lg bg-slate-950 px-3.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
              />
              <input
                type="number"
                min={1}
                value={newTaskEstimate}
                onChange={(e) => setNewTaskEstimate(e.target.value)}
                placeholder={t("kanban.estimatePlaceholder")}
                className="w-20 rounded-lg bg-slate-950 px-2.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
              />
              <select
                value={newTaskPriority}
                onChange={(e) => setNewTaskPriority(e.target.value as TaskPriority)}
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
                {t("kanban.create")}
              </button>
            </form>

            {/* 4-Column Kanban Board with Drag & Drop */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {KANBAN_COLUMNS.map((colStatus) => {
                const colTasks = filteredTasks.filter((x) => x.status === colStatus);
                return (
                  <div
                    key={colStatus}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (draggedTaskId) {
                        const tObj = tasks.find((x) => x.id === draggedTaskId);
                        if (tObj && tObj.status !== colStatus) {
                          void handleMoveTask(tObj, colStatus);
                        }
                        setDraggedTaskId(null);
                      }
                    }}
                    className="rounded-xl bg-slate-900/50 p-4 ring-1 ring-slate-800/80 flex flex-col gap-3 min-h-[400px]"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                        {t(`kanban.columns.${colStatus}`)}
                      </span>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                        {colTasks.length}
                      </span>
                    </div>

                    {colTasks.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-center text-xs text-slate-500 p-4 border border-dashed border-slate-800/80 rounded-lg">
                        {t("kanban.emptyColumn")}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {colTasks.map((task) => {
                          const isEditing = editingTaskId === task.id;
                          return (
                            <div
                              key={task.id}
                              draggable={!isEditing}
                              onDragStart={() => setDraggedTaskId(task.id)}
                              className="rounded-lg bg-slate-950/90 p-3 ring-1 ring-slate-800/90 hover:ring-sky-500/40 transition-all space-y-2 cursor-grab active:cursor-grabbing"
                            >
                              {isEditing ? (
                                <div className="space-y-2">
                                  <input
                                    type="text"
                                    value={editingTaskTitle}
                                    onChange={(e) => setEditingTaskTitle(e.target.value)}
                                    className="w-full rounded bg-slate-900 px-2 py-1 text-xs text-slate-100 ring-1 ring-sky-500 outline-none"
                                  />
                                  <div className="flex items-center justify-between gap-2">
                                    <select
                                      value={editingTaskPriority}
                                      onChange={(e) =>
                                        setEditingTaskPriority(
                                          e.target.value as TaskPriority
                                        )
                                      }
                                      className="rounded bg-slate-900 px-2 py-1 text-[11px] text-slate-200 ring-1 ring-slate-700"
                                    >
                                      <option value="low">{t("kanban.priority.low")}</option>
                                      <option value="normal">
                                        {t("kanban.priority.normal")}
                                      </option>
                                      <option value="high">
                                        {t("kanban.priority.high")}
                                      </option>
                                      <option value="urgent">
                                        {t("kanban.priority.urgent")}
                                      </option>
                                    </select>
                                    <div className="flex gap-1">
                                      <button
                                        type="button"
                                        onClick={() => void handleSaveTaskEdit(task.id)}
                                        className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white cursor-pointer"
                                      >
                                        {t("kanban.save")}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingTaskId(null)}
                                        className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 cursor-pointer"
                                      >
                                        {t("kanban.cancel")}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="text-sm font-medium text-slate-100">
                                      {task.title}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingTaskId(task.id);
                                          setEditingTaskTitle(task.title);
                                          setEditingTaskPriority(task.priority);
                                        }}
                                        className="text-slate-500 hover:text-sky-400 cursor-pointer"
                                        title={t("kanban.edit")}
                                      >
                                        <Edit3 className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteTask(task.id)}
                                        className="text-slate-500 hover:text-red-400 cursor-pointer"
                                        title={t("kanban.delete")}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between gap-1 text-[10px] text-slate-400">
                                    <span
                                      className={`rounded px-2 py-0.5 font-semibold ${
                                        task.priority === "urgent"
                                          ? "bg-red-500/20 text-red-300"
                                          : task.priority === "high"
                                            ? "bg-amber-500/20 text-amber-300"
                                            : "bg-slate-800 text-slate-300"
                                      }`}
                                    >
                                      {t(`kanban.priority.${task.priority}`)}
                                    </span>
                                    <span>
                                      {task.actual_min ? `${task.actual_min}m` : ""}
                                      {task.estimate_min
                                        ? ` / ${task.estimate_min}m`
                                        : ""}
                                    </span>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-slate-800/60">
                                    {colStatus !== "done" && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void handleStartPomodoro("focus", 25, task.id);
                                          setActiveTab("pomodoro");
                                        }}
                                        className="rounded bg-sky-500/15 hover:bg-sky-500/30 px-2 py-0.5 text-[10px] font-semibold text-sky-300 cursor-pointer"
                                      >
                                        ▶ {t("kanban.focusTask")}
                                      </button>
                                    )}
                                    <div className="flex flex-wrap gap-1">
                                      {KANBAN_COLUMNS.filter((s) => s !== colStatus).map(
                                        (target) => (
                                          <button
                                            key={target}
                                            type="button"
                                            onClick={() =>
                                              void handleMoveTask(task, target)
                                            }
                                            className="rounded bg-slate-800/90 hover:bg-sky-500/20 hover:text-sky-300 px-1.5 py-0.5 text-[10px] text-slate-400 cursor-pointer transition-colors"
                                          >
                                            → {t(`kanban.columns.${target}`)}
                                          </button>
                                        )
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= POMODORO TAB ================= */}
        {activeTab === "pomodoro" && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-slate-900/60 p-8 ring-1 ring-slate-800/80 flex flex-col items-center text-center gap-5">
              <Timer className="h-12 w-12 text-sky-400" />
              <h2 className="text-2xl font-bold text-slate-50">{t("pomodoro.title")}</h2>

              {activePomo ? (
                <div className="space-y-5 w-full max-w-md">
                  <div className="text-6xl font-extrabold tracking-tight text-sky-300 tabular-nums">
                    {formatClock(timerSecondsLeft)}
                  </div>
                  <div className="text-sm font-semibold text-amber-300">
                    {t("pomodoro.running")} • {activePomo.planned_min} min (
                    {activePomo.kind})
                  </div>
                  {activePomo.task_id && (
                    <div className="text-xs text-slate-300 bg-slate-950/70 px-3 py-1.5 rounded-lg ring-1 ring-slate-800">
                      🎯{" "}
                      {tasks.find((x) => x.id === activePomo.task_id)?.title ??
                        activePomo.task_id}
                    </div>
                  )}
                  <div className="flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setTimerPaused((p) => !p)}
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
                      onClick={() => void handleCompletePomodoro()}
                      className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                    >
                      ✓ {t("pomodoro.complete")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAbandonPomodoro()}
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
                    value={selectedPomoTaskId}
                    onChange={(e) => setSelectedPomoTaskId(e.target.value)}
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
                      onClick={() => void handleStartPomodoro("focus", 25)}
                      className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-sky-400 cursor-pointer"
                    >
                      🔥 {t("pomodoro.startFocus")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleStartPomodoro("short_break", 5)}
                      className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                    >
                      ☕ {t("pomodoro.startShortBreak")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleStartPomodoro("long_break", 15)}
                      className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                    >
                      🌿 {t("pomodoro.startLongBreak")}
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
                        {s.kind} • {s.actual_min ?? s.planned_min} min
                      </span>
                      <span className="text-slate-400">{s.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= REMINDERS & ALERTS TAB ================= */}
        {activeTab === "reminders" && (
          <div className="space-y-6">
            <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-4">
              <h2 className="text-lg font-bold text-slate-50">{t("reminders.title")}</h2>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newReminderTitle}
                  onChange={(e) => setNewReminderTitle(e.target.value)}
                  placeholder={t("reminders.newPlaceholder")}
                  className="flex-1 min-w-[240px] rounded-lg bg-slate-950 px-3.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 outline-none focus:ring-sky-500"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateReminder(0)}
                  className="rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
                >
                  ⚡ {t("reminders.addNow")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateReminder(1)}
                  className="rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
                >
                  + {t("reminders.addIn1Min")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateReminder(15)}
                  className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  + {t("reminders.addIn15Min")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateReminder(60)}
                  className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  + {t("reminders.addIn1Hour")}
                </button>
              </div>
            </div>

            {/* Pending Alerts */}
            <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-3">
              <h3 className="text-sm font-semibold text-amber-300">
                {t("reminders.activeAlerts")}
              </h3>
              {alerts.length === 0 ? (
                <p className="text-xs text-slate-500">{t("reminders.noAlerts")}</p>
              ) : (
                <div className="space-y-2.5">
                  {alerts.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg bg-amber-500/10 p-3.5 ring-1 ring-amber-500/30 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-amber-200">
                            {a.title}
                          </div>
                          {a.body && (
                            <div className="text-xs text-amber-300/80">{a.body}</div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              await alertsApi.resolve(a.id);
                              await refreshAll();
                            }}
                            className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white cursor-pointer"
                          >
                            ✓ {t("reminders.resolve")}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await alertsApi.snooze(a.id);
                              await refreshAll();
                            }}
                            className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 cursor-pointer"
                          >
                            ⏰ {t("reminders.snooze")}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setExceptAlertId(exceptAlertId === a.id ? null : a.id)
                            }
                            className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-amber-300 cursor-pointer"
                          >
                            {t("reminders.except")}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await alertsApi.dismiss(a.id);
                              await refreshAll();
                            }}
                            className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400 cursor-pointer"
                          >
                            {t("reminders.dismiss")}
                          </button>
                        </div>
                      </div>
                      {exceptAlertId === a.id && (
                        <div className="flex gap-2 pt-2">
                          <input
                            type="text"
                            value={exceptNote}
                            onChange={(e) => setExceptNote(e.target.value)}
                            placeholder={t("reminders.exceptPlaceholder")}
                            className="flex-1 rounded bg-slate-950 px-2.5 py-1 text-xs text-slate-100 ring-1 ring-slate-700"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              if (!exceptNote.trim()) return;
                              await alertsApi.except(a.id, exceptNote.trim());
                              setExceptAlertId(null);
                              setExceptNote("");
                              await refreshAll();
                            }}
                            className="rounded bg-amber-500 px-3 py-1 text-xs font-semibold text-slate-950 cursor-pointer"
                          >
                            {t("kanban.save")}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reminders List */}
            <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-3">
              <h3 className="text-sm font-semibold text-slate-200">
                {t("reminders.upcoming")}
              </h3>
              {reminders.length === 0 ? (
                <p className="text-xs text-slate-500">{t("reminders.noReminders")}</p>
              ) : (
                <div className="space-y-2">
                  {reminders.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg bg-slate-950/80 p-3 ring-1 ring-slate-800"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-100">{r.title}</div>
                        <div className="text-xs text-slate-400">
                          {new Date(r.fire_at).toLocaleString()} • {r.status}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await remindersApi.snooze(r.id, 10);
                            await refreshAll();
                          }}
                          className="rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                        >
                          {t("reminders.snooze")}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await remindersApi.dismiss(r.id);
                            await refreshAll();
                          }}
                          className="rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                        >
                          {t("reminders.dismiss")}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await remindersApi.delete(r.id);
                            await refreshAll();
                          }}
                          className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= SETTINGS TAB ================= */}
        {activeTab === "settings" && <SettingsPage />}
      </main>

      {/* Reminder popup. Renders only when there is a pending routine or
          scheduled reminder, and stays open until the alert is resolved. */}
      <ReminderModal
        alert={popupAlert}
        onResolve={handlePopupResolve}
        onSnooze={handlePopupSnooze}
        onDismiss={handlePopupDismiss}
      />
    </div>
  );
}
