import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Bell,
  Kanban,
  LayoutDashboard,
  Settings,
  SlidersHorizontal,
  Timer,
} from "lucide-react";

import { AuraDeskLogo } from "../../components/AuraDeskLogo";
import { ReminderModal } from "../../components/ReminderModal";
import {
  alertsApi,
  dashboardApi,
  githubApi,
  isTauriRuntime,
  pomodoroApi,
  remindersApi,
  settingsApi,
  tasksApi,
  type Alert,
  type DailyPlan,
  type DashboardSummary,
  type GithubIssueLink,
  type PlanState,
  type PomodoroSession,
  type Reminder,
  type SessionKind,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../lib/ipc";
import { applyTheme } from "../../lib/theme";
import {
  DEFAULT_LAYOUT,
  DashboardPage,
  type DashboardLayoutState,
} from "../../pages/DashboardPage";
import { KanbanPage } from "../../pages/KanbanPage";
import { PomodoroPage } from "../../pages/PomodoroPage";
import { RemindersPage } from "../../pages/RemindersPage";
import { ReportsPage } from "../../pages/ReportsPage";
import { SettingsPage } from "../../pages/SettingsPage";

type TabKey = "dashboard" | "kanban" | "pomodoro" | "reminders" | "reports" | "settings";

const LAYOUT_STORAGE_KEY = "auradesk_dashboard_layout_v1";

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
    // ignore corrupt layout cache
  }
  return DEFAULT_LAYOUT;
}

function initialTabFromLocation(): TabKey {
  const path = window.location.pathname.replace(/^\//, "").toLowerCase();
  if (path === "tasks" || path === "kanban") return "kanban";
  if (path === "alerts" || path === "reminders") return "reminders";
  if (path === "pomodoro") return "pomodoro";
  if (path === "reports") return "reports";
  if (path === "settings") return "settings";
  return "dashboard";
}

function formatClock(secs: number): string {
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export function AppShell() {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>(initialTabFromLocation);
  const [currentLang, setCurrentLang] = useState<string>(i18n.language || "pt-BR");
  const [inTauri] = useState<boolean>(() => isTauriRuntime());

  // Domain State
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [planNotes, setPlanNotes] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [githubLinks, setGithubLinks] = useState<GithubIssueLink[]>([]);
  const [importingGithub, setImportingGithub] = useState(false);
  const [activePomo, setActivePomo] = useState<PomodoroSession | null>(null);
  const [pomoHistory, setPomoHistory] = useState<PomodoroSession[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [settingsMap, setSettingsMap] = useState<Record<string, unknown>>({});

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

  // Task Form / Filter State
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("normal");
  const [newTaskEstimate, setNewTaskEstimate] = useState("");
  const [kanbanSearch, setKanbanSearch] = useState("");
  const [kanbanPriorityFilter, setKanbanPriorityFilter] = useState<string>("all");

  // Pomodoro Timer State & Pause Refs
  const [selectedPomoTaskId, setSelectedPomoTaskId] = useState<string>("");
  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number>(25 * 60);
  const [timerPaused, setTimerPaused] = useState<boolean>(false);

  const trackedPomoIdRef = useRef<string | null>(null);
  const accumulatedElapsedMsRef = useRef<number>(0);
  const segmentStartMsRef = useRef<number | null>(null);
  const loadedPlanKeyRef = useRef<string | null>(null);
  const appliedSavedLocaleRef = useRef<boolean>(false);

  // Reminders Form State
  const [newReminderTitle, setNewReminderTitle] = useState("");

  // Settings-derived Pomodoro durations & alert behavior
  const focusMin = Math.max(1, Number(settingsMap["pomodoro.focus_min"] ?? 25) || 25);
  const shortMin = Math.max(1, Number(settingsMap["pomodoro.short_min"] ?? 5) || 5);
  const longMin = Math.max(1, Number(settingsMap["pomodoro.long_min"] ?? 15) || 15);
  const soundEnabled = settingsMap["reminders.sound"] !== false;
  const blockScreenEnabled = settingsMap["reminders.block_screen"] === true;

  const computeElapsedMs = useCallback(() => {
    const runningSlice =
      segmentStartMsRef.current !== null
        ? Math.max(0, Date.now() - segmentStartMsRef.current)
        : 0;
    return accumulatedElapsedMsRef.current + runningSlice;
  }, []);

  const notify = useCallback((text: string, isError = false) => {
    setStatusBanner({ text, isError });
    window.setTimeout(() => setStatusBanner(null), 3500);
  }, []);

  const updateLayout = (next: DashboardLayoutState) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  };

  const refreshAll = useCallback(async () => {
    try {
      const [sum, plan, allTasks, pomo, pList, rems, pendingAlerts, entries, links] =
        await Promise.all([
          dashboardApi.summary(),
          dashboardApi.dailyPlanGet(),
          tasksApi.list(),
          pomodoroApi.active(),
          pomodoroApi.list(20),
          remindersApi.list(),
          alertsApi.listPending(),
          settingsApi.getAll().catch(() => [] as [string, unknown][]),
          githubApi.listIssues().catch(() => [] as GithubIssueLink[]),
        ]);

      setSummary(sum);
      setDailyPlan(plan);

      const planKey = plan ? `${plan.id}:${plan.plan_date}` : null;
      if (plan && planKey && loadedPlanKeyRef.current !== planKey) {
        loadedPlanKeyRef.current = planKey;
        setPlanNotes(plan.payload ?? "");
      }

      setTasks(allTasks);
      setGithubLinks(links);
      setActivePomo(pomo);
      setPomoHistory(pList);
      setReminders(rems);
      setAlerts(pendingAlerts);

      if (entries.length > 0) {
        const nextSettings: Record<string, unknown> = {};
        for (const [k, v] of entries) {
          nextSettings[k] = v;
        }
        setSettingsMap(nextSettings);
        if ("app.theme" in nextSettings) {
          applyTheme(nextSettings["app.theme"]);
        }
        if (
          !appliedSavedLocaleRef.current &&
          typeof nextSettings["app.locale"] === "string" &&
          (nextSettings["app.locale"] === "pt-BR" || nextSettings["app.locale"] === "en")
        ) {
          appliedSavedLocaleRef.current = true;
          if (i18n.language !== nextSettings["app.locale"]) {
            void i18n.changeLanguage(nextSettings["app.locale"] as string);
          }
        }
      }

      if (pomo && trackedPomoIdRef.current !== pomo.id) {
        trackedPomoIdRef.current = pomo.id;
        const startedMs = Date.parse(pomo.started_at);
        accumulatedElapsedMsRef.current = Number.isNaN(startedMs)
          ? 0
          : Math.max(0, Date.now() - startedMs);
        segmentStartMsRef.current = Date.now();
        setTimerPaused(false);
        const totalSec = pomo.planned_min * 60;
        setTimerSecondsLeft(
          Math.max(0, totalSec - Math.floor(accumulatedElapsedMsRef.current / 1000))
        );
      } else if (!pomo && trackedPomoIdRef.current !== null) {
        trackedPomoIdRef.current = null;
        accumulatedElapsedMsRef.current = 0;
        segmentStartMsRef.current = null;
        setTimerPaused(false);
      }
    } catch {
      // Preserve UI stability during transient startup IPC states
    }
  }, []);

  useEffect(() => {
    void refreshAll();
    const poll = window.setInterval(() => {
      void refreshAll();
    }, 3000);

    let unlisten: (() => void) | undefined;
    if (isTauriRuntime()) {
      void import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen<Alert[]>("auradesk://alerts-updated", (event) => {
            if (Array.isArray(event.payload)) {
              setAlerts(event.payload);
            } else {
              void refreshAll();
            }
          })
        )
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    }

    return () => {
      window.clearInterval(poll);
      if (unlisten) unlisten();
    };
  }, [refreshAll]);

  // Keep idle timer preview synced with configured focus duration.
  useEffect(() => {
    if (!activePomo) {
      setTimerSecondsLeft(focusMin * 60);
    }
  }, [activePomo, focusMin]);

  // Live countdown ticker respecting pause state.
  useEffect(() => {
    if (!activePomo || timerPaused) return;
    const totalSec = activePomo.planned_min * 60;
    const updateClock = () => {
      const elapsedSec = Math.floor(computeElapsedMs() / 1000);
      setTimerSecondsLeft(Math.max(0, totalSec - elapsedSec));
    };
    updateClock();
    const id = window.setInterval(updateClock, 500);
    return () => window.clearInterval(id);
  }, [activePomo, timerPaused, computeElapsedMs]);

  useEffect(() => {
    const onLang = (lng: string) => setCurrentLang(lng);
    i18n.on("languageChanged", onLang);
    return () => {
      i18n.off("languageChanged", onLang);
    };
  }, [i18n]);

  const handleLanguageChange = async (lng: "pt-BR" | "en") => {
    await i18n.changeLanguage(lng);
    setCurrentLang(lng);
    await settingsApi.set("app.locale", lng).catch(() => {});
  };

  // --- Tasks & Kanban Handlers ---
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) {
      notify(t("errors.taskTitleEmpty"), true);
      return;
    }
    try {
      await tasksApi.create({
        title: newTaskTitle.trim(),
        priority: newTaskPriority,
        estimate_min: newTaskEstimate ? Number(newTaskEstimate) : undefined,
      });
      setNewTaskTitle("");
      setNewTaskEstimate("");
      await refreshAll();
      notify(t("kanban.taskCreated"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleMoveTask = async (task: Task, targetStatus: TaskStatus) => {
    try {
      const colCount = tasks.filter((x) => x.status === targetStatus).length;
      await tasksApi.setStatus({
        id: task.id,
        status: targetStatus,
        kanban_order: colCount,
      });
      await refreshAll();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleSaveTaskEdit = async (
    taskId: string,
    title: string,
    priority: TaskPriority
  ) => {
    if (!title.trim()) return;
    try {
      await tasksApi.update(taskId, {
        title: title.trim(),
        priority,
      });
      await refreshAll();
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

  const handleImportGithub = async () => {
    setImportingGithub(true);
    try {
      const labelFilter =
        typeof settingsMap["github.filter_labels"] === "string"
          ? settingsMap["github.filter_labels"]
          : null;
      const res = await githubApi.syncIssues(null, labelFilter);
      await refreshAll();
      notify(
        t("kanban.github.importedSummary", {
          created: res.created,
          updated: res.updated,
        })
      );
    } catch (err) {
      const msg = String(err);
      if (msg.includes("github.repo")) {
        notify(t("kanban.github.repoRequired"), true);
      } else if (msg.includes("authRequired") || msg.includes("cliMissing")) {
        notify(t("kanban.github.authRequired"), true);
      } else {
        notify(msg, true);
      }
    } finally {
      setImportingGithub(false);
    }
  };

  const handleUnlinkGithub = async (taskId: string) => {
    try {
      await githubApi.unlinkTask(taskId);
      await refreshAll();
      notify(t("kanban.github.unlinked"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  // --- Pomodoro Handlers ---
  const handleTogglePause = () => {
    if (!activePomo) return;
    if (!timerPaused) {
      accumulatedElapsedMsRef.current = computeElapsedMs();
      segmentStartMsRef.current = null;
      setTimerPaused(true);
    } else {
      segmentStartMsRef.current = Date.now();
      setTimerPaused(false);
    }
  };

  const handleStartPomodoro = async (
    kind: SessionKind,
    plannedMin: number,
    taskId?: string | null
  ) => {
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
      setTimerPaused(false);
      setTimerSecondsLeft(plannedMin * 60);
      setActivePomo(started);
      await refreshAll();
      setActiveTab("pomodoro");
      notify(t("pomodoro.sessionStarted", { min: plannedMin }));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleCompletePomodoro = async () => {
    if (!activePomo) return;
    const elapsedMin = Math.max(1, Math.round(computeElapsedMs() / 60_000));
    try {
      await pomodoroApi.complete(elapsedMin);
      trackedPomoIdRef.current = null;
      accumulatedElapsedMsRef.current = 0;
      segmentStartMsRef.current = null;
      setTimerPaused(false);
      setActivePomo(null);
      await refreshAll();
      notify(t("pomodoro.sessionCompleted", { min: elapsedMin }));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleAbandonPomodoro = async () => {
    if (!activePomo) return;
    const elapsedMin = Math.max(0, Math.round(computeElapsedMs() / 60_000));
    try {
      await pomodoroApi.abandon(elapsedMin);
      trackedPomoIdRef.current = null;
      accumulatedElapsedMsRef.current = 0;
      segmentStartMsRef.current = null;
      setTimerPaused(false);
      setActivePomo(null);
      await refreshAll();
      notify(t("pomodoro.sessionInterrupted"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  // --- Reminders & Alerts Handlers ---
  const handleCreateReminder = async (delayMinutes: number) => {
    if (!newReminderTitle.trim()) {
      notify(t("reminders.titleRequired"), true);
      return;
    }
    const fireAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
    try {
      await remindersApi.create({
        title: newReminderTitle.trim(),
        fire_at: fireAt,
        repeat_kind: "none",
        sound: "normal",
      });
      setNewReminderTitle("");
      await refreshAll();
      notify(delayMinutes === 0 ? t("reminders.firedNow") : t("reminders.scheduled"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handlePopupResolve = async (id: string) => {
    await alertsApi.resolve(id);
    await refreshAll();
  };

  const handlePopupSnooze = async (id: string) => {
    await alertsApi.snooze(id);
    await refreshAll();
  };

  const handlePopupDismiss = async (id: string) => {
    await alertsApi.dismiss(id);
    await refreshAll();
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
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {inTauri ? t("app.connectedTauri") : t("app.connectedBrowser")}
              </span>
            </div>
            <p className="text-xs text-slate-400">{t("app.subtitle")}</p>
          </div>
        </div>

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
                key: "reports",
                label: t("nav.reports"),
                icon: BarChart3,
                badge: undefined,
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
        {activeTab === "dashboard" && (
          <DashboardPage
            layout={layout}
            customizingLayout={customizingLayout}
            summary={summary}
            dailyPlan={dailyPlan}
            planNotes={planNotes}
            tasks={tasks}
            reminders={reminders}
            alerts={alerts}
            activePomo={activePomo}
            timerSecondsLeft={timerSecondsLeft}
            focusMin={focusMin}
            newTaskTitle={newTaskTitle}
            newTaskPriority={newTaskPriority}
            onChangePlanNotes={setPlanNotes}
            onSavePlanNotes={async () => {
              if (!dailyPlan) return;
              await dashboardApi.dailyPlanSetPayload(
                dailyPlan.id,
                planNotes.trim() || null
              );
              await refreshAll();
              notify(t("dashboard.dailyNotesSaved"));
            }}
            onSetPlanState={async (state: PlanState) => {
              if (!dailyPlan) return;
              await dashboardApi.dailyPlanSetState(dailyPlan.id, state);
              await refreshAll();
            }}
            onChangeNewTaskTitle={setNewTaskTitle}
            onChangeNewTaskPriority={setNewTaskPriority}
            onCreateTask={handleCreateTask}
            onUpdateLayout={updateLayout}
            onNavigateTab={setActiveTab}
            onStartQuickFocus={(taskId) =>
              handleStartPomodoro("focus", focusMin, taskId ?? null)
            }
            onMoveTask={handleMoveTask}
            onResolveAlert={handlePopupResolve}
          />
        )}

        {activeTab === "kanban" && (
          <KanbanPage
            tasks={tasks}
            githubLinks={githubLinks}
            importingGithub={importingGithub}
            newTaskTitle={newTaskTitle}
            newTaskEstimate={newTaskEstimate}
            newTaskPriority={newTaskPriority}
            search={kanbanSearch}
            priorityFilter={kanbanPriorityFilter}
            onChangeNewTitle={setNewTaskTitle}
            onChangeNewEstimate={setNewTaskEstimate}
            onChangeNewPriority={setNewTaskPriority}
            onChangeSearch={setKanbanSearch}
            onChangePriorityFilter={setKanbanPriorityFilter}
            onCreateTask={handleCreateTask}
            onImportGithub={handleImportGithub}
            onUnlinkGithub={handleUnlinkGithub}
            onMoveTask={handleMoveTask}
            onUpdateTask={handleSaveTaskEdit}
            onDeleteTask={handleDeleteTask}
            onFocusTask={(task) => handleStartPomodoro("focus", focusMin, task.id)}
          />
        )}

        {activeTab === "pomodoro" && (
          <PomodoroPage
            activePomo={activePomo}
            pomoHistory={pomoHistory}
            tasks={tasks}
            selectedTaskId={selectedPomoTaskId}
            timerSecondsLeft={timerSecondsLeft}
            timerPaused={timerPaused}
            focusMin={focusMin}
            shortMin={shortMin}
            longMin={longMin}
            onSelectTaskId={setSelectedPomoTaskId}
            onTogglePause={handleTogglePause}
            onStart={handleStartPomodoro}
            onComplete={handleCompletePomodoro}
            onAbandon={handleAbandonPomodoro}
          />
        )}

        {activeTab === "reminders" && (
          <RemindersPage
            reminders={reminders}
            alerts={alerts}
            newReminderTitle={newReminderTitle}
            onChangeTitle={setNewReminderTitle}
            onCreateReminder={handleCreateReminder}
            onResolveAlert={handlePopupResolve}
            onSnoozeAlert={handlePopupSnooze}
            onExceptAlert={async (id, note) => {
              await alertsApi.except(id, note);
              await refreshAll();
            }}
            onDismissAlert={handlePopupDismiss}
            onSnoozeReminder={async (id) => {
              await remindersApi.snooze(id, 10);
              await refreshAll();
            }}
            onDismissReminder={async (id) => {
              await remindersApi.dismiss(id);
              await refreshAll();
            }}
            onDeleteReminder={async (id) => {
              await remindersApi.delete(id);
              await refreshAll();
            }}
          />
        )}

        {activeTab === "reports" && <ReportsPage />}

        {activeTab === "settings" && (
          <SettingsPage
            onSettingSaved={(key, value) => {
              setSettingsMap((prev) => ({ ...prev, [key]: value }));
            }}
            onAlertTriggered={() => void refreshAll()}
          />
        )}
      </main>

      {!isTauriRuntime() && (
        <ReminderModal
          alert={popupAlert}
          locked={blockScreenEnabled}
          playSound={soundEnabled}
          onResolve={handlePopupResolve}
          onSnooze={handlePopupSnooze}
          onDismiss={handlePopupDismiss}
        />
      )}
    </div>
  );
}
