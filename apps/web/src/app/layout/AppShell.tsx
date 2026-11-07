import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  CheckCircle2,
  Clock,
  Droplets,
  Flame,
  Kanban,
  LayoutDashboard,
  Plus,
  Settings,
  Timer,
  Trash2,
} from "lucide-react";

import { AuraDeskLogo } from "../../components/AuraDeskLogo";
import {
  alertsApi,
  dashboardApi,
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

const KANBAN_COLUMNS: TaskStatus[] = ["todo", "doing", "waiting", "done"];

export function AppShell() {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [currentLang, setCurrentLang] = useState<string>(i18n.language || "pt-BR");

  // Shared Domain State
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activePomo, setActivePomo] = useState<PomodoroSession | null>(null);
  const [pomoHistory, setPomoHistory] = useState<PomodoroSession[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Forms
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("normal");
  const [newReminderTitle, setNewReminderTitle] = useState("");

  const refreshAll = useCallback(async () => {
    try {
      const [sum, plan, taskList, pomoRun, pomoHist, remList, alertList] = await Promise.all([
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
      setTasks(taskList);
      setActivePomo(pomoRun);
      setPomoHistory(pomoHist);
      setReminders(remList);
      setAlerts(alertList);
    } catch {
      // Browser fallback when previewed outside Tauri
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    const interval = setInterval(() => void refreshAll(), 10000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  const handleLanguageChange = async (lng: "pt-BR" | "en") => {
    await i18n.changeLanguage(lng);
    setCurrentLang(lng);
    try {
      await settingsApi.set("app.locale", lng);
    } catch {
      // Ignore if running outside Tauri
    }
  };

  const notify = (msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => setStatusBanner(null), 3000);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;
    try {
      await tasksApi.create({
        title: trimmed,
        priority: newTaskPriority,
        status: "todo",
      });
      setNewTaskTitle("");
      await refreshAll();
      notify(currentLang === "en" ? "Task created!" : "Tarefa criada!");
    } catch (err) {
      notify(String(err));
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
      notify(String(err));
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await tasksApi.delete(id);
      await refreshAll();
    } catch (err) {
      notify(String(err));
    }
  };

  const handleStartPomodoro = async (
    kind: "focus" | "short_break" | "long_break",
    planned_min: number
  ) => {
    try {
      await pomodoroApi.start({
        kind,
        planned_min,
        task_id: summary?.nextTask?.id ?? null,
      });
      await refreshAll();
      notify(
        currentLang === "en"
          ? `Started ${planned_min}m session!`
          : `Sessão de ${planned_min} min iniciada!`
      );
    } catch (err) {
      notify(String(err));
    }
  };

  const handleCompletePomodoro = async () => {
    if (!activePomo) return;
    try {
      await pomodoroApi.complete(activePomo.planned_min);
      await refreshAll();
      notify(currentLang === "en" ? "Session completed!" : "Sessão concluída!");
    } catch (err) {
      notify(String(err));
    }
  };

  const handleAbandonPomodoro = async () => {
    try {
      await pomodoroApi.abandon(0);
      await refreshAll();
      notify(currentLang === "en" ? "Session interrupted." : "Sessão interrompida.");
    } catch (err) {
      notify(String(err));
    }
  };

  const handleCreateReminder = async (minutesFromNow: number) => {
    const trimmed = newReminderTitle.trim();
    if (!trimmed) return;
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
        currentLang === "en"
          ? `Reminder scheduled (+${minutesFromNow}m)!`
          : `Lembrete agendado (+${minutesFromNow} min)!`
      );
    } catch (err) {
      notify(String(err));
    }
  };

  const isPt = currentLang.startsWith("pt");

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
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {t("app.connected")}
              </span>
            </div>
            <p className="text-xs text-slate-400">{t("app.subtitle")}</p>
          </div>
        </div>

        {/* Language Toggle Buttons (pt-BR / en) */}
        <div className="flex items-center gap-2">
          {statusBanner && (
            <span className="rounded-lg bg-sky-500/15 px-3 py-1 text-xs font-medium text-sky-300 ring-1 ring-sky-500/30">
              {statusBanner}
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
      <nav className="border-b border-slate-800/70 bg-slate-900/30 px-6 flex items-center gap-2 overflow-x-auto">
        {(
          [
            { key: "dashboard", label: t("nav.dashboard"), icon: LayoutDashboard, badge: undefined },
            { key: "kanban", label: t("nav.kanban"), icon: Kanban, badge: tasks.length },
            {
              key: "pomodoro",
              label: t("nav.pomodoro"),
              icon: Timer,
              badge: activePomo ? "ON" : undefined,
            },
            {
              key: "reminders",
              label: t("nav.reminders"),
              icon: Bell,
              badge: alerts.length > 0 ? alerts.length : undefined,
            },
            { key: "settings", label: t("nav.settings"), icon: Settings, badge: undefined },
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
                <span className="ml-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-sky-300 ring-1 ring-slate-700">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {/* ================= DASHBOARD TAB ================= */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {/* Hero Banner with Winged Notebook Emblem */}
            <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/50 to-slate-900 p-6 ring-1 ring-slate-800/90 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <AuraDeskLogo size={88} animated />
                <div className="space-y-1.5">
                  <h2 className="text-2xl font-bold text-slate-50">{t("dashboard.welcome")}</h2>
                  <p className="text-sm text-slate-400">{t("app.subtitle")}</p>
                  {activePomo ? (
                    <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300 ring-1 ring-amber-500/30">
                      <Flame className="h-3.5 w-3.5" />
                      {t("dashboard.focusActive")} ({activePomo.planned_min} min)
                    </div>
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

              {/* Daily Plan Card */}
              <div className="rounded-xl bg-slate-950/70 p-4 ring-1 ring-slate-800 min-w-[250px] space-y-2.5">
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

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-xl bg-slate-900/60 p-4 ring-1 ring-slate-800/80">
                <div className="text-xs text-slate-400">{t("dashboard.pendingTasks")}</div>
                <div className="mt-1 text-3xl font-bold text-sky-400 tabular-nums">
                  {summary?.pendingCount ?? tasks.filter((x) => x.status !== "done").length}
                </div>
              </div>
              <div className="rounded-xl bg-slate-900/60 p-4 ring-1 ring-slate-800/80">
                <div className="text-xs text-slate-400">{t("dashboard.completedToday")}</div>
                <div className="mt-1 text-3xl font-bold text-emerald-400 tabular-nums">
                  {summary?.completedToday ?? tasks.filter((x) => x.status === "done").length}
                </div>
              </div>
              <div className="rounded-xl bg-slate-900/60 p-4 ring-1 ring-slate-800/80">
                <div className="text-xs text-slate-400">{t("dashboard.focusMinutes")}</div>
                <div className="mt-1 text-3xl font-bold text-amber-400 tabular-nums">
                  {summary?.todayFocusMin ?? 0}m
                </div>
              </div>
              <div className="rounded-xl bg-slate-900/60 p-4 ring-1 ring-slate-800/80">
                <div className="text-xs text-slate-400">{t("dashboard.pendingReminders")}</div>
                <div className="mt-1 text-3xl font-bold text-indigo-400 tabular-nums">
                  {summary?.pendingReminders ?? reminders.length}
                </div>
              </div>
            </div>

            {/* Quick Task Creator + Routines Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-4">
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-sky-400" />
                  {t("dashboard.nextTask")}
                </h3>

                {summary?.nextTask ? (
                  <div className="rounded-xl bg-slate-950/80 p-4 ring-1 ring-slate-800 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-semibold text-slate-100">{summary.nextTask.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {t(`kanban.priority.${summary.nextTask.priority}`)} •{" "}
                        {t(`kanban.columns.${summary.nextTask.status}`)}
                      </div>
                    </div>
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
                ) : (
                  <p className="text-sm text-slate-400">{t("dashboard.noPendingTasks")}</p>
                )}

                <form onSubmit={(e) => void handleCreateTask(e)} className="flex gap-2 pt-2">
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder={t("dashboard.quickTaskPlaceholder")}
                    className="flex-1 rounded-lg bg-slate-950 px-3.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
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

              <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-3">
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
            </div>
          </div>
        )}

        {/* ================= KANBAN & TASKS TAB ================= */}
        {activeTab === "kanban" && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-slate-50">{t("kanban.title")}</h2>
              <form onSubmit={(e) => void handleCreateTask(e)} className="flex gap-2">
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder={t("kanban.newTaskPlaceholder")}
                  className="w-64 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
                />
                <select
                  value={newTaskPriority}
                  onChange={(e) => setNewTaskPriority(e.target.value as TaskPriority)}
                  className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800"
                >
                  <option value="low">{t("kanban.priority.low")}</option>
                  <option value="normal">{t("kanban.priority.normal")}</option>
                  <option value="high">{t("kanban.priority.high")}</option>
                  <option value="urgent">{t("kanban.priority.urgent")}</option>
                </select>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  {t("kanban.create")}
                </button>
              </form>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {KANBAN_COLUMNS.map((colStatus) => {
                const colTasks = tasks.filter((x) => x.status === colStatus);
                return (
                  <div
                    key={colStatus}
                    className="rounded-xl bg-slate-900/50 p-4 ring-1 ring-slate-800/80 flex flex-col gap-3 min-h-[360px]"
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
                      <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
                        {t("kanban.emptyColumn")}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {colTasks.map((task) => (
                          <div
                            key={task.id}
                            className="rounded-lg bg-slate-950/90 p-3 ring-1 ring-slate-800/90 space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-medium text-slate-100">
                                {task.title}
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleDeleteTask(task.id)}
                                className="text-slate-500 hover:text-red-400 cursor-pointer"
                                title={t("kanban.delete")}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="flex items-center justify-between gap-1 pt-1">
                              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                                {t(`kanban.priority.${task.priority}`)}
                              </span>
                              <div className="flex gap-1">
                                {KANBAN_COLUMNS.filter((s) => s !== colStatus).map((target) => (
                                  <button
                                    key={target}
                                    type="button"
                                    onClick={() => void handleMoveTask(task, target)}
                                    className="rounded bg-slate-800/90 hover:bg-sky-500/20 hover:text-sky-300 px-1.5 py-0.5 text-[10px] text-slate-400 cursor-pointer transition-colors"
                                  >
                                    → {t(`kanban.columns.${target}`)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
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
            <div className="rounded-2xl bg-slate-900/60 p-6 ring-1 ring-slate-800/80 flex flex-col items-center text-center gap-4">
              <Timer className="h-12 w-12 text-sky-400" />
              <h2 className="text-2xl font-bold text-slate-50">{t("pomodoro.title")}</h2>
              {activePomo ? (
                <div className="space-y-4">
                  <div className="text-lg font-semibold text-amber-300">
                    {t("pomodoro.running")} • {activePomo.planned_min} min ({activePomo.kind})
                  </div>
                  <div className="flex justify-center gap-3">
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
                <div className="space-y-4">
                  <p className="text-sm text-slate-400">{t("pomodoro.idle")}</p>
                  <div className="flex flex-wrap justify-center gap-3">
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
                  onClick={() => void handleCreateReminder(1)}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
                >
                  + {t("reminders.addIn1Min")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateReminder(15)}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  + {t("reminders.addIn15Min")}
                </button>
              </div>
            </div>

            {/* Pending Alerts */}
            <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-3">
              <h3 className="text-sm font-semibold text-amber-300">{t("reminders.activeAlerts")}</h3>
              {alerts.length === 0 ? (
                <p className="text-xs text-slate-500">{t("reminders.noAlerts")}</p>
              ) : (
                <div className="space-y-2">
                  {alerts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-500/30"
                    >
                      <div>
                        <div className="text-sm font-semibold text-amber-200">{a.title}</div>
                        {a.body && <div className="text-xs text-amber-300/80">{a.body}</div>}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await alertsApi.resolve(a.id);
                            await refreshAll();
                          }}
                          className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white cursor-pointer"
                        >
                          {t("reminders.resolve")}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await alertsApi.snooze(a.id);
                            await refreshAll();
                          }}
                          className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 cursor-pointer"
                        >
                          {t("reminders.snooze")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reminders List */}
            <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-3">
              <h3 className="text-sm font-semibold text-slate-200">{t("reminders.upcoming")}</h3>
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
    </div>
  );
}
