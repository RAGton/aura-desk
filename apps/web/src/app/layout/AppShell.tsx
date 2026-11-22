import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Bell,
  Bot,
  Download,
  Kanban,
  LayoutDashboard,
  Moon,
  PanelLeft,
  PanelTop,
  PictureInPicture2,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
  Timer,
  X,
} from "lucide-react";

import { AuraDeskLogo } from "../../components/AuraDeskLogo";
import { AuraSpaceBackdrop } from "../../components/AuraSpaceBackdrop";
import { CommandPalette } from "../../components/CommandPalette";
import { ReminderModal } from "../../components/ReminderModal";
import { Badge, Button, Toast } from "../../components/ui";
import { AuraChatPanel } from "../../features/aura-chat/AuraChatPanel";
import { AuraMonitoringPanel } from "../../features/aura-chat/AuraMonitoringPanel";
import {
  alertsApi,
  dashboardApi,
  desktopApi,
  githubApi,
  isTauriRuntime,
  pomodoroApi,
  projectsApi,
  proposalsApi,
  remindersApi,
  routinesApi,
  settingsApi,
  tasksApi,
  updaterApi,
  type Alert,
  type DailyPlan,
  parseDailyPlanNotes,
  serializeDailyPlanNotes,
  type DashboardSummary,
  type GithubIssueLink,
  type IdleStateSnapshot,
  type PlanState,
  type PomodoroSession,
  type Project,
  type ProposalItem,
  type Reminder,
  type Routine,
  type Task,
  type UpdateStateSnapshot,
} from "../../lib/ipc";
import { useAlertsController } from "../../hooks/useAlertsController";
import { usePomodoroController } from "../../hooks/usePomodoroController";
import { useTasksController } from "../../hooks/useTasksController";
import {
  applyTheme,
  loadVisualPrefs,
  saveVisualPrefs,
  type VisualPrefs,
} from "../../lib/theme";
import { asArray } from "../../lib/utils";
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

type TabKey =
  | "dashboard"
  | "kanban"
  | "pomodoro"
  | "reminders"
  | "reports"
  | "hermes"
  | "settings";

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
  if (path === "dashboard") return "dashboard";
  if (path === "tasks" || path === "kanban") return "kanban";
  if (path === "alerts" || path === "reminders") return "reminders";
  if (path === "pomodoro") return "pomodoro";
  if (path === "reports") return "reports";
  if (path === "settings") return "settings";
  return "hermes";
}

function tabToPath(tab: TabKey): string {
  switch (tab) {
    case "dashboard":
      return "/dashboard";
    case "kanban":
      return "/tasks";
    case "reminders":
      return "/alerts";
    case "pomodoro":
      return "/pomodoro";
    case "reports":
      return "/reports";
    case "settings":
      return "/settings";
    case "hermes":
    default:
      return "/";
  }
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
  const [visualPrefs, setVisualPrefs] = useState<VisualPrefs>(loadVisualPrefs);

  // Domain State
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [planNotes, setPlanNotes] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [githubLinks, setGithubLinks] = useState<GithubIssueLink[]>([]);
  const [pomoHistory, setPomoHistory] = useState<PomodoroSession[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [settingsMap, setSettingsMap] = useState<Record<string, unknown>>({});

  const popupAlert = useMemo(() => alerts[0] ?? null, [alerts]);

  const [statusBanner, setStatusBanner] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);
  const [updateState, setUpdateState] = useState<UpdateStateSnapshot | null>(null);
  const [dismissedUpdateBanner, setDismissedUpdateBanner] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Dashboard Customizer State
  const [customizingLayout, setCustomizingLayout] = useState(false);
  const [layout, setLayout] = useState<DashboardLayoutState>(loadDashboardLayout);

  const loadedPlanKeyRef = useRef<string | null>(null);
  const loadedPlanPayloadRef = useRef<string>("");
  const appliedSavedLocaleRef = useRef<boolean>(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const pomodoroSyncRef = useRef<(pomo: PomodoroSession | null) => void>(() => {});
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Settings-derived Pomodoro durations & alert behavior
  const focusMin = Math.max(1, Number(settingsMap["pomodoro.focus_min"] ?? 25) || 25);
  const shortMin = Math.max(1, Number(settingsMap["pomodoro.short_min"] ?? 5) || 5);
  const longMin = Math.max(1, Number(settingsMap["pomodoro.long_min"] ?? 15) || 15);
  const cyclesToLong = Math.max(
    1,
    Number(settingsMap["pomodoro.cycles_to_long"] ?? 4) || 4
  );
  const refreshSec = Math.max(5, Number(settingsMap["dashboard.refresh_sec"] ?? 30) || 30);
  const soundEnabled = settingsMap["reminders.sound"] !== false;
  const blockScreenEnabled = settingsMap["reminders.block_screen"] === true;
  const dndUntil =
    typeof settingsMap["reminders.paused_until"] === "string"
      ? (settingsMap["reminders.paused_until"] as string)
      : null;

  const selectTab = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    try {
      const target = tabToPath(tab);
      if (window.location.pathname !== target) {
        window.history.pushState({ tab }, "", target);
      }
    } catch {
      // ignore restricted history environments
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setActiveTab(initialTabFromLocation());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const notify = useCallback((text: string, isError = false) => {
    setStatusBanner({ text, isError });
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setStatusBanner(null);
      toastTimeoutRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
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
      const [
        sum,
        plan,
        allTasks,
        pomo,
        pList,
        rems,
        pendingAlerts,
        entries,
        links,
        allProjects,
        allRoutines,
        pendingProposals,
      ] = await Promise.all([
        dashboardApi.summary(),
        dashboardApi.dailyPlanGet(),
        tasksApi.list(),
        pomodoroApi.active(),
        pomodoroApi.list(20),
        remindersApi.list(),
        alertsApi.listPending(),
        settingsApi.getAll().catch(() => [] as [string, unknown][]),
        githubApi.listIssues().catch(() => [] as GithubIssueLink[]),
        projectsApi.list().catch(() => [] as Project[]),
        routinesApi.list().catch(() => [] as Routine[]),
        proposalsApi.listPending().catch(() => [] as ProposalItem[]),
      ]);

      if (!mountedRef.current) return;

      setSummary(sum);
      setDailyPlan(plan);

      const planKey = plan ? `${plan.id}:${plan.plan_date}` : null;
      const incomingPayload = parseDailyPlanNotes(plan?.payload);
      if (plan && planKey && loadedPlanKeyRef.current !== planKey) {
        loadedPlanKeyRef.current = planKey;
        loadedPlanPayloadRef.current = incomingPayload;
        setPlanNotes(incomingPayload);
      } else if (plan && incomingPayload !== loadedPlanPayloadRef.current) {
        setPlanNotes((cur) =>
          cur === loadedPlanPayloadRef.current ? incomingPayload : cur
        );
        loadedPlanPayloadRef.current = incomingPayload;
      }

      const safeEntries = asArray<[string, unknown]>(entries);
      setTasks(asArray<Task>(allTasks));
      setProjects(asArray<Project>(allProjects));
      setRoutines(asArray<Routine>(allRoutines));
      setProposals(asArray<ProposalItem>(pendingProposals));
      setGithubLinks(asArray<GithubIssueLink>(links));
      pomodoroSyncRef.current(pomo ?? null);
      setPomoHistory(asArray<PomodoroSession>(pList));
      setReminders(asArray<Reminder>(rems));
      setAlerts(asArray<Alert>(pendingAlerts));

      if (safeEntries.length > 0) {
        const nextSettings: Record<string, unknown> = {};
        for (const [k, v] of safeEntries) {
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

    } catch {
      // Preserve UI stability during transient startup IPC states
    }
  }, [i18n]);

  const refreshTasksDomain = useCallback(async () => {
    try {
      const [sum, allTasks, links, allProjects] = await Promise.all([
        dashboardApi.summary(),
        tasksApi.list(),
        githubApi.listIssues().catch(() => [] as GithubIssueLink[]),
        projectsApi.list().catch(() => [] as Project[]),
      ]);
      if (!mountedRef.current) return;

      setSummary(sum);
      setTasks(asArray<Task>(allTasks));
      setGithubLinks(asArray<GithubIssueLink>(links));
      setProjects(asArray<Project>(allProjects));
    } catch {
      // Preserve UI stability during transient IPC errors
    }
  }, []);

  const refreshAlertsDomain = useCallback(async () => {
    try {
      const [sum, rems, pendingAlerts] = await Promise.all([
        dashboardApi.summary(),
        remindersApi.list(),
        alertsApi.listPending(),
      ]);
      if (!mountedRef.current) return;

      setSummary(sum);
      setReminders(asArray<Reminder>(rems));
      setAlerts(asArray<Alert>(pendingAlerts));
    } catch {
      // Preserve UI stability during transient IPC errors
    }
  }, []);

  const refreshPomodoroDomain = useCallback(async () => {
    try {
      const [sum, allTasks, pomo, pList] = await Promise.all([
        dashboardApi.summary(),
        tasksApi.list(),
        pomodoroApi.active(),
        pomodoroApi.list(20),
      ]);
      if (!mountedRef.current) return;

      setSummary(sum);
      setTasks(asArray<Task>(allTasks));
      pomodoroSyncRef.current(pomo ?? null);
      setPomoHistory(asArray<PomodoroSession>(pList));
    } catch {
      // Preserve UI stability during transient IPC errors
    }
  }, []);

  const {
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
  } = usePomodoroController({
    focusMin,
    soundEnabled,
    refreshAfterMutation: refreshPomodoroDomain,
    notify,
    onSessionStarted: () => selectTab("pomodoro"),
  });

  const pausedByIdleRef = useRef<boolean>(false);
  const pauseForIdleRef = useRef<() => boolean>(() => false);
  pauseForIdleRef.current = pauseForIdle;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  pomodoroSyncRef.current = syncFromRemotePomo;

  useEffect(() => {
    void refreshAll();
    const poll = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void refreshAll();
    }, refreshSec * 1000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshAll();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    let unlistenAlerts: (() => void) | undefined;
    let unlistenTasks: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;
    let unlistenResume: (() => void) | undefined;
    let unlistenNavigate: (() => void) | undefined;
    let unlistenIdle: (() => void) | undefined;
    let unlistenProposals: (() => void) | undefined;
    let unlistenUpdate: (() => void) | undefined;
    void updaterApi
      .getState()
      .then((snap) => {
        if (snap && typeof snap === "object") {
          setUpdateState(snap);
        }
      })
      .catch(() => {});

    if (isTauriRuntime()) {
      void import("@tauri-apps/api/event")
        .then(async ({ listen }) => {
          unlistenAlerts = await listen<Alert[]>("auradesk://alerts-updated", (event) => {
            if (Array.isArray(event.payload)) {
              setAlerts(event.payload);
            } else {
              void refreshAlertsDomain();
            }
          });
          unlistenTasks = await listen("auradesk://tasks-updated", () => {
            void refreshTasksDomain();
          });
          unlistenSettings = await listen("auradesk://settings-updated", () => {
            void refreshAll();
          });
          unlistenResume = await listen("auradesk://system-resumed", () => {
            void refreshAll();
          });
          unlistenProposals = await listen("auradesk://proposals-updated", () => {
            void refreshAlertsDomain();
          });
          unlistenUpdate = await listen<UpdateStateSnapshot>(
            "auradesk://update-status",
            (event) => {
              if (!event.payload) return;
              setUpdateState(event.payload);
              if (
                event.payload.status === "available" ||
                event.payload.status === "downloading" ||
                event.payload.status === "verifying" ||
                event.payload.status === "installing"
              ) {
                setDismissedUpdateBanner(false);
              }
            }
          );
          unlistenNavigate = await listen<string>("auradesk://navigate", (event) => {
            const target = event.payload;
            if (
              target === "dashboard" ||
              target === "kanban" ||
              target === "pomodoro" ||
              target === "reminders" ||
              target === "reports" ||
              target === "hermes" ||
              target === "settings"
            ) {
              selectTab(target);
            }
          });
          unlistenIdle = await listen<IdleStateSnapshot>("auradesk://idle-state", (event) => {
            const payload = event.payload;
            if (!payload) return;
            if (payload.isIdle && payload.autoPausePomodoro) {
              if (pauseForIdleRef.current()) {
                pausedByIdleRef.current = true;
                notifyRef.current(t("pomodoro.idleAutoPaused"));
              }
            } else if (!payload.isIdle && pausedByIdleRef.current) {
              pausedByIdleRef.current = false;
              notifyRef.current(t("pomodoro.idleReturned"));
            }
          });
        })
        .catch(() => {});
    }

    return () => {
      window.clearInterval(poll);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (unlistenAlerts) unlistenAlerts();
      if (unlistenTasks) unlistenTasks();
      if (unlistenSettings) unlistenSettings();
      if (unlistenResume) unlistenResume();
      if (unlistenProposals) unlistenProposals();
      if (unlistenUpdate) unlistenUpdate();
      if (unlistenNavigate) unlistenNavigate();
      if (unlistenIdle) unlistenIdle();
    };
  }, [refreshAlertsDomain, refreshAll, refreshSec, refreshTasksDomain, selectTab]);

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleQuickCreateTaskFromPalette = useCallback(
    async (title: string) => {
      try {
        await tasksApi.create({ title, priority: "normal" });
        await refreshTasksDomain();
        notify(t("dashboard.taskCreated"));
      } catch (err) {
        notify(String(err), true);
      }
    },
    [notify, refreshTasksDomain, t]
  );

  const handleToggleCompactFromPalette = useCallback(async () => {
    try {
      const opened = await desktopApi.toggleCompact();
      if (!isTauriRuntime() && opened) {
        window.location.assign("/compact");
      }
    } catch (err) {
      notify(String(err), true);
    }
  }, [notify]);

  const handleQuickThemeToggle = async () => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = current === "light" ? "dark" : "light";
    if (next === "light" && visualPrefs.preset !== "frosted") {
      setVisualPrefs(saveVisualPrefs({ preset: "frosted" }));
    } else if (next === "dark" && visualPrefs.preset === "frosted") {
      setVisualPrefs(saveVisualPrefs({ preset: "aurora" }));
    }
    applyTheme(next);
    setSettingsMap((prev) => ({ ...prev, "app.theme": next }));
    await settingsApi.set("app.theme", next).catch(() => {});
  };

  const handleToggleNavLayout = () => {
    const nextLayout = visualPrefs.navLayout === "sidebar" ? "top" : "sidebar";
    const updated = saveVisualPrefs({ navLayout: nextLayout });
    setVisualPrefs(updated);
  };

  const {
    importingGithub,
    newTaskTitle,
    setNewTaskTitle,
    newTaskPriority,
    setNewTaskPriority,
    newTaskEstimate,
    setNewTaskEstimate,
    newTaskTags,
    setNewTaskTags,
    newTaskDueAt,
    setNewTaskDueAt,
    newTaskProjectId,
    setNewTaskProjectId,
    kanbanSearch,
    setKanbanSearch,
    kanbanPriorityFilter,
    setKanbanPriorityFilter,
    kanbanProjectFilter,
    setKanbanProjectFilter,
    handleCreateTask,
    handleCreateProject,
    handleMoveTask,
    handleMoveTaskToIndex,
    handleReorderTask,
    handleSaveTaskEdit,
    handleDeleteTask,
    handleImportGithub,
    handleUnlinkGithub,
  } = useTasksController({
    tasks,
    settingsMap,
    refreshTasksDomain,
    refreshAll,
    notify,
  });

  const {
    newReminderTitle,
    setNewReminderTitle,
    handleCreateReminder,
    handleToggleDnd,
    handleToggleRoutine,
    handleApproveProposal,
    handleRejectProposal,
    handlePopupResolve,
    handlePopupSnooze,
    handlePopupDismiss,
    handleExceptAlert,
    handleSnoozeReminder,
    handleDismissReminder,
    handleDeleteReminder,
  } = useAlertsController({
    dndUntil,
    setSettingsMap,
    refreshAlertsDomain,
    refreshAll,
    notify,
  });

  const isPt = currentLang.startsWith("pt");
  const isSidebar = visualPrefs.navLayout === "sidebar";
  const isAuraCockpit = activeTab === "hermes";
  const isLightTheme =
    typeof document !== "undefined" && document.documentElement.dataset.theme === "light";

  const navItems = [
    {
      key: "hermes" as const,
      label: t("nav.hermes"),
      icon: Bot,
      badge: proposals.length > 0 ? proposals.length : undefined,
    },
    {
      key: "dashboard" as const,
      label: t("nav.dashboard"),
      icon: LayoutDashboard,
      badge: undefined,
    },
    {
      key: "kanban" as const,
      label: t("nav.kanban"),
      icon: Kanban,
      badge: tasks.length,
    },
    {
      key: "pomodoro" as const,
      label: t("nav.pomodoro"),
      icon: Timer,
      badge: activePomo ? formatClock(timerSecondsLeft) : undefined,
    },
    {
      key: "reminders" as const,
      label: t("nav.reminders"),
      icon: Bell,
      badge: alerts.length > 0 ? alerts.length : undefined,
    },
    {
      key: "reports" as const,
      label: t("nav.reports"),
      icon: BarChart3,
      badge: undefined,
    },
    {
      key: "settings" as const,
      label: t("nav.settings"),
      icon: Settings,
      badge: undefined,
    },
  ];

  const renderNavSection = () => (
    <nav
      aria-label={t("app.title")}
      className={
        isSidebar
          ? "aura-glass border-b md:border-b-0 md:border-r border-slate-800/40 p-3 flex md:flex-col justify-between gap-2 md:w-60 shrink-0 max-md:fixed max-md:bottom-0 max-md:inset-x-0 max-md:z-40 max-md:border-t max-md:border-b-0 max-md:border-aura-border/40 max-md:bg-aura-canvas/95 max-md:backdrop-blur-xl max-md:px-1.5 max-md:py-1.5"
          : "aura-glass border-b border-slate-800/40 px-6 flex items-center justify-between gap-2 max-md:fixed max-md:bottom-0 max-md:inset-x-0 max-md:z-40 max-md:border-t max-md:border-b-0 max-md:border-aura-border/40 max-md:bg-aura-canvas/95 max-md:backdrop-blur-xl max-md:px-1.5 max-md:py-1.5"
      }
    >
      <div
        className={
          isSidebar
            ? "flex md:flex-col gap-1 max-md:grid max-md:grid-cols-7 max-md:w-full"
            : "flex items-center gap-1 max-md:grid max-md:grid-cols-7 max-md:w-full"
        }
      >
        {navItems.map(({ key, label, icon: Icon, badge }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectTab(key)}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center justify-between gap-2 text-xs font-semibold transition-colors cursor-pointer touch-manipulation whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus max-md:min-w-0 max-md:flex-col max-md:justify-center max-md:gap-0.5 max-md:rounded-lg max-md:px-0.5 max-md:py-2 max-md:text-[10px] ${
                isSidebar
                  ? `rounded-xl px-3.5 py-2.5 w-full ${
                      active
                        ? "bg-aura-accent/15 text-aura-accent ring-1 ring-aura-accent/35"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                    }`
                  : `px-4 py-3 border-b-2 max-md:border-b-0 ${
                      active
                        ? "border-aura-accent text-aura-accent bg-aura-accent/10 max-md:bg-aura-accent/15"
                        : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700"
                    }`
              }`}
            >
              <span className="flex items-center gap-2 max-md:min-w-0 max-md:flex-col max-md:gap-0.5">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate max-md:max-w-[46px]">{label}</span>
              </span>
              {badge !== undefined && (
                <Badge
                  variant="info"
                  className="ml-1 rounded-full px-2 py-0.5 text-[11px] tabular-nums max-md:hidden"
                >
                  {badge}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {activeTab === "dashboard" && (
        <button
          type="button"
          onClick={() => setCustomizingLayout((v) => !v)}
          className={`max-md:hidden inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors touch-manipulation cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus ${
            customizingLayout
              ? "bg-aura-accent text-aura-inverse"
              : "aura-glass-pill text-slate-300 hover:text-aura-accent"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          {customizingLayout ? t("dashboard.closeCustomizer") : t("dashboard.customizeLayout")}
        </button>
      )}
    </nav>
  );

  const renderMainContent = () => (
    <main
      id="main-content"
      tabIndex={-1}
      className={
        isAuraCockpit
          ? "flex-1 relative min-h-0 flex flex-col overflow-hidden p-0 max-md:pb-16 focus:outline-none"
          : "flex-1 p-4 sm:p-6 pb-24 md:pb-6 max-w-7xl w-full mx-auto space-y-6 focus:outline-none"
      }
    >
      {activeTab === "dashboard" && (
        <div className="aura-panel-enter space-y-6">
          <DashboardPage
          layout={layout}
          customizingLayout={customizingLayout}
          summary={summary}
          dailyPlan={dailyPlan}
          planNotes={planNotes}
          tasks={tasks}
          reminders={reminders}
          alerts={alerts}
          routines={routines}
          proposals={proposals}
          activePomo={activePomo}
          timerSecondsLeft={timerSecondsLeft}
          focusMin={focusMin}
          newTaskTitle={newTaskTitle}
          newTaskPriority={newTaskPriority}
          onChangePlanNotes={setPlanNotes}
          onSavePlanNotes={async () => {
            if (!dailyPlan) return;
            try {
              const serialized = serializeDailyPlanNotes(planNotes);
              const updated = await dashboardApi.dailyPlanSetPayload(
                dailyPlan.id,
                serialized
              );
              const parsed = parseDailyPlanNotes(updated.payload ?? serialized);
              loadedPlanPayloadRef.current = parsed;
              setPlanNotes(parsed);
              await refreshAll();
              notify(t("dashboard.dailyNotesSaved"));
            } catch (err) {
              notify(String(err), true);
            }
          }}
          onSetPlanState={async (state: PlanState) => {
            if (!dailyPlan) return;
            try {
              await dashboardApi.dailyPlanSetState(dailyPlan.id, state);
              await refreshAll();
              notify(t("dashboard.planStateUpdated"));
            } catch (err) {
              notify(String(err), true);
            }
          }}
          onChangeNewTaskTitle={setNewTaskTitle}
          onChangeNewTaskPriority={setNewTaskPriority}
          onCreateTask={handleCreateTask}
          onUpdateLayout={updateLayout}
          onNavigateTab={selectTab}
          onStartQuickFocus={(taskId) =>
            handleStartPomodoro("focus", focusMin, taskId ?? null)
          }
          onMoveTask={handleMoveTask}
          onResolveAlert={handlePopupResolve}
          onToggleRoutine={handleToggleRoutine}
          onApproveProposal={handleApproveProposal}
          onRejectProposal={handleRejectProposal}
        />
        <AuraMonitoringPanel onProposalApplied={() => void refreshAll()} />
        </div>
      )}

      {activeTab === "kanban" && (
        <div className="aura-panel-enter">
          <KanbanPage
          tasks={tasks}
          projects={projects}
          githubLinks={githubLinks}
          importingGithub={importingGithub}
          newTaskTitle={newTaskTitle}
          newTaskEstimate={newTaskEstimate}
          newTaskPriority={newTaskPriority}
          newTaskTags={newTaskTags}
          newTaskDueAt={newTaskDueAt}
          newTaskProjectId={newTaskProjectId}
          search={kanbanSearch}
          priorityFilter={kanbanPriorityFilter}
          projectFilter={kanbanProjectFilter}
          onChangeNewTitle={setNewTaskTitle}
          onChangeNewEstimate={setNewTaskEstimate}
          onChangeNewPriority={setNewTaskPriority}
          onChangeNewTags={setNewTaskTags}
          onChangeNewDueAt={setNewTaskDueAt}
          onChangeNewProjectId={setNewTaskProjectId}
          onChangeSearch={setKanbanSearch}
          onChangePriorityFilter={setKanbanPriorityFilter}
          onChangeProjectFilter={setKanbanProjectFilter}
          onCreateProject={handleCreateProject}
          onCreateTask={handleCreateTask}
          onImportGithub={handleImportGithub}
          onUnlinkGithub={handleUnlinkGithub}
          onMoveTask={handleMoveTask}
          onMoveTaskToIndex={handleMoveTaskToIndex}
          onReorderTask={handleReorderTask}
          onUpdateTask={handleSaveTaskEdit}
          onDeleteTask={handleDeleteTask}
          onFocusTask={(task) => handleStartPomodoro("focus", focusMin, task.id)}
        />
        </div>
      )}

      {activeTab === "pomodoro" && (
        <div className="aura-panel-enter">
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
          cyclesToLong={cyclesToLong}
          onSelectTaskId={setSelectedPomoTaskId}
          onTogglePause={handleTogglePause}
          onStart={handleStartPomodoro}
          onComplete={handleCompletePomodoro}
          onAbandon={handleAbandonPomodoro}
        />
        </div>
      )}

      {activeTab === "reminders" && (
        <div className="aura-panel-enter">
          <RemindersPage
          reminders={reminders}
          alerts={alerts}
          newReminderTitle={newReminderTitle}
          dndUntil={dndUntil}
          onChangeTitle={setNewReminderTitle}
          onCreateReminder={handleCreateReminder}
          onToggleDnd={handleToggleDnd}
          onResolveAlert={handlePopupResolve}
          onSnoozeAlert={handlePopupSnooze}
          onExceptAlert={handleExceptAlert}
          onDismissAlert={handlePopupDismiss}
          onSnoozeReminder={handleSnoozeReminder}
          onDismissReminder={handleDismissReminder}
          onDeleteReminder={handleDeleteReminder}
        />
        </div>
      )}

      {activeTab === "reports" && (
        <div className="aura-panel-enter">
          <ReportsPage />
        </div>
      )}

      {activeTab === "hermes" && (
        <div className="aura-panel-enter flex-1 flex flex-col min-h-0">
          <AuraChatPanel
            onProposalApplied={() => void refreshAll()}
            onOpenSettings={() => selectTab("settings")}
          />
        </div>
      )}

      {activeTab === "settings" && (
        <div className="aura-panel-enter">
          <SettingsPage
          externalTheme={
            typeof settingsMap["app.theme"] === "string" ? settingsMap["app.theme"] : undefined
          }
          externalLocale={currentLang}
          onSettingSaved={(key, value) => {
            setSettingsMap((prev) => ({ ...prev, [key]: value }));
          }}
          onAlertTriggered={() => {
            setVisualPrefs(loadVisualPrefs());
            void refreshAll();
          }}
          onVisualPrefsChange={setVisualPrefs}
        />
        </div>
      )}
    </main>
  );

  return (
    <div
      className={`aura-bg text-slate-100 flex flex-col relative isolate ${
        isAuraCockpit ? "h-screen overflow-hidden" : "min-h-screen"
      }`}
    >
      <AuraSpaceBackdrop galaxyDark={isAuraCockpit} />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-aura-accent focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-aura-inverse focus:shadow-lg"
      >
        {t("app.skipToContent")}
      </a>

      {/* Top Header with Winged Notebook Logo + Quick Controls + Language Switcher */}
      <header
        className={`aura-glass border-b border-slate-800/40 px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 shrink-0 ${
          isAuraCockpit ? "py-2" : "py-3.5 gap-4"
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`aura-glass-elevated ring-1 ring-sky-500/30 shadow-lg shadow-sky-500/10 shrink-0 ${
              isAuraCockpit ? "p-0.5 rounded-xl" : "p-1 rounded-2xl"
            }`}
          >
            <AuraDeskLogo size={isAuraCockpit ? 34 : 48} animated />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1
                translate="no"
                className={`font-extrabold tracking-tight aura-brand-gradient bg-clip-text text-transparent ${
                  isAuraCockpit ? "text-base" : "text-xl"
                }`}
              >
                {t("app.title")}
              </h1>
              <Badge variant="success" className="rounded-full px-2.5 py-0.5 text-[11px]">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {inTauri ? t("app.connectedTauri") : t("app.connectedBrowser")}
              </Badge>
            </div>
            {!isAuraCockpit && (
              <p className="text-xs text-slate-400 truncate">{t("app.subtitle")}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label={t("commandPalette.title")}
            title={t("commandPalette.title")}
            className="inline-flex h-9 items-center gap-2 rounded-xl aura-glass-pill px-3 text-xs font-medium text-slate-300 hover:text-aura-accent cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{t("commandPalette.button")}</span>
            <kbd className="hidden sm:inline rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              {t("commandPalette.shortcut")}
            </kbd>
          </button>
          <button
            type="button"
            onClick={() => void handleToggleCompactFromPalette()}
            aria-label={t("app.compactMode")}
            title={t("app.compactMode")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl aura-glass-pill text-slate-300 hover:text-aura-accent cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus"
          >
            <PictureInPicture2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void handleQuickThemeToggle()}
            aria-label={t("app.toggleTheme")}
            title={t("app.toggleTheme")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl aura-glass-pill text-slate-300 hover:text-aura-accent cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus"
          >
            {isLightTheme ? (
              <Moon className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Sun className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={handleToggleNavLayout}
            aria-label={isSidebar ? t("app.navTop") : t("app.navSidebar")}
            title={isSidebar ? t("app.navTop") : t("app.navSidebar")}
            className="hidden md:inline-flex h-9 w-9 items-center justify-center rounded-xl aura-glass-pill text-slate-300 hover:text-aura-accent cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus"
          >
            {isSidebar ? (
              <PanelTop className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeft className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <div className="inline-flex rounded-xl aura-glass-pill p-1">
            <button
              type="button"
              onClick={() => void handleLanguageChange("pt-BR")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus ${
                isPt
                  ? "bg-aura-accent text-aura-inverse shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              pt-BR
            </button>
            <button
              type="button"
              onClick={() => void handleLanguageChange("en")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus ${
                !isPt
                  ? "bg-aura-accent text-aura-inverse shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              en
            </button>
          </div>
        </div>
      </header>

      <div className="fixed bottom-20 md:bottom-6 right-4 z-50 max-w-[calc(100vw-2rem)]">
        <Toast
          open={Boolean(statusBanner)}
          message={statusBanner?.text ?? ""}
          variant={statusBanner?.isError ? "error" : "info"}
          onClose={() => setStatusBanner(null)}
        />
      </div>

      {updateState &&
        !dismissedUpdateBanner &&
        (updateState.status === "available" ||
          updateState.status === "downloading" ||
          updateState.status === "verifying" ||
          updateState.status === "installing" ||
          updateState.status === "error") && (
          <div
            role="status"
            aria-label={t("updater.banner.releaseNotes")}
            className="mx-auto mt-3 flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-500/35 bg-indigo-500/10 px-4 py-2.5 text-xs text-slate-100"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {updateState.status === "downloading" ||
              updateState.status === "verifying" ||
              updateState.status === "installing" ? (
                <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-indigo-300" />
              ) : (
                <Download className="h-4 w-4 shrink-0 text-indigo-300" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate font-medium">
                  {updateState.status === "available" &&
                    t("updater.banner.available", {
                      version: updateState.latestVersion ?? updateState.currentVersion,
                    })}
                  {updateState.status === "downloading" &&
                    t("updater.banner.downloading", {
                      version: updateState.latestVersion ?? updateState.currentVersion,
                      pct: updateState.progressPct,
                    })}
                  {updateState.status === "verifying" &&
                    t("updater.banner.verifying", {
                      version: updateState.latestVersion ?? updateState.currentVersion,
                    })}
                  {updateState.status === "installing" &&
                    t("updater.banner.installing", {
                      version: updateState.latestVersion ?? updateState.currentVersion,
                    })}
                  {updateState.status === "error" &&
                    t("updater.banner.error", {
                      message: updateState.errorMessage ?? "",
                    })}
                </p>
                {updateState.status === "downloading" && (
                  <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800/80">
                    <div
                      className="h-full bg-indigo-400 transition-all duration-300"
                      style={{ width: `${Math.max(4, updateState.progressPct)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(updateState.status === "available" || updateState.status === "error") && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void updaterApi.installNow().catch(() => {})}
                  className="rounded-xl px-3 py-1 text-xs font-semibold"
                >
                  {updateState.status === "error"
                    ? t("updater.banner.retry")
                    : t("updater.banner.installNow")}
                </Button>
              )}
              <button
                type="button"
                aria-label={t("updater.banner.dismiss")}
                onClick={() => setDismissedUpdateBanner(true)}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

      {isSidebar ? (
        <div className="flex flex-1 flex-col md:flex-row min-h-0">
          {renderNavSection()}
          {renderMainContent()}
        </div>
      ) : (
        <>
          {renderNavSection()}
          {renderMainContent()}
        </>
      )}

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

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        tasks={tasks}
        hasActivePomodoro={Boolean(activePomo)}
        pomodoroPaused={timerPaused}
        onSelectTab={selectTab}
        onQuickCreateTask={handleQuickCreateTaskFromPalette}
        onStartPomodoro={(taskId) => handleStartPomodoro("focus", focusMin, taskId ?? null)}
        onTogglePausePomodoro={handleTogglePause}
        onToggleDnd={handleToggleDnd}
        onToggleTheme={handleQuickThemeToggle}
        onToggleCompact={handleToggleCompactFromPalette}
      />
    </div>
  );
}
