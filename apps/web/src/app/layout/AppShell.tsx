import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Bell,
  Kanban,
  LayoutDashboard,
  Moon,
  PanelLeft,
  PanelTop,
  Settings,
  SlidersHorizontal,
  Sun,
  Timer,
} from "lucide-react";

import { AuraDeskLogo } from "../../components/AuraDeskLogo";
import { type TaskEditExtra } from "../../components/KanbanBoard";
import { ReminderModal } from "../../components/ReminderModal";
import {
  alertsApi,
  dashboardApi,
  githubApi,
  isTauriRuntime,
  pomodoroApi,
  projectsApi,
  proposalsApi,
  remindersApi,
  routinesApi,
  settingsApi,
  tasksApi,
  type Alert,
  type DailyPlan,
  type DashboardSummary,
  type GithubIssueLink,
  type PlanState,
  type PomodoroSession,
  type Project,
  type ProposalItem,
  type Reminder,
  type ReminderSound,
  type RepeatKind,
  type Routine,
  type SessionKind,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../lib/ipc";
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
import { type CreateReminderOptions, RemindersPage } from "../../pages/RemindersPage";
import { ReportsPage } from "../../pages/ReportsPage";
import { SettingsPage } from "../../pages/SettingsPage";

type TabKey = "dashboard" | "kanban" | "pomodoro" | "reminders" | "reports" | "settings";

const LAYOUT_STORAGE_KEY = "auradesk_dashboard_layout_v1";
const POMO_PAUSE_STORAGE_KEY = "auradesk_pomo_pause_v1";

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

function tabToPath(tab: TabKey): string {
  switch (tab) {
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
    default:
      return "/";
  }
}

function formatClock(secs: number): string {
  const m = String(Math.floor(secs / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function readPomoPauseCache(sessionId: string): { paused: boolean; accumulatedMs: number } | null {
  try {
    const raw = sessionStorage.getItem(POMO_PAUSE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      sessionId?: string;
      paused?: boolean;
      accumulatedMs?: number;
    };
    if (parsed.sessionId === sessionId) {
      return {
        paused: Boolean(parsed.paused),
        accumulatedMs: Math.max(0, Number(parsed.accumulatedMs) || 0),
      };
    }
  } catch {
    // ignore sessionStorage failure
  }
  return null;
}

function writePomoPauseCache(
  sessionId: string | null,
  paused: boolean,
  accumulatedMs: number
) {
  try {
    if (!sessionId) {
      sessionStorage.removeItem(POMO_PAUSE_STORAGE_KEY);
    } else {
      sessionStorage.setItem(
        POMO_PAUSE_STORAGE_KEY,
        JSON.stringify({ sessionId, paused, accumulatedMs })
      );
    }
  } catch {
    // ignore sessionStorage failure
  }
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
  const [importingGithub, setImportingGithub] = useState(false);
  const [activePomo, setActivePomo] = useState<PomodoroSession | null>(null);
  const [pomoHistory, setPomoHistory] = useState<PomodoroSession[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [settingsMap, setSettingsMap] = useState<Record<string, unknown>>({});

  const popupAlert = useMemo(() => alerts[0] ?? null, [alerts]);

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
  const [newTaskTags, setNewTaskTags] = useState("");
  const [newTaskDueAt, setNewTaskDueAt] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [kanbanSearch, setKanbanSearch] = useState("");
  const [kanbanPriorityFilter, setKanbanPriorityFilter] = useState<string>("all");
  const [kanbanProjectFilter, setKanbanProjectFilter] = useState<string>("all");

  // Pomodoro Timer State & Pause Refs
  const [selectedPomoTaskId, setSelectedPomoTaskId] = useState<string>("");
  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number>(25 * 60);
  const [timerPaused, setTimerPaused] = useState<boolean>(false);

  const trackedPomoIdRef = useRef<string | null>(null);
  const accumulatedElapsedMsRef = useRef<number>(0);
  const segmentStartMsRef = useRef<number | null>(null);
  const autoCompletingPomoRef = useRef<string | null>(null);
  const loadedPlanKeyRef = useRef<string | null>(null);
  const loadedPlanPayloadRef = useRef<string>("");
  const appliedSavedLocaleRef = useRef<boolean>(false);
  const toastTimeoutRef = useRef<number | null>(null);

  // Reminders Form State
  const [newReminderTitle, setNewReminderTitle] = useState("");

  // Settings-derived Pomodoro durations & alert behavior
  const focusMin = Math.max(1, Number(settingsMap["pomodoro.focus_min"] ?? 25) || 25);
  const shortMin = Math.max(1, Number(settingsMap["pomodoro.short_min"] ?? 5) || 5);
  const longMin = Math.max(1, Number(settingsMap["pomodoro.long_min"] ?? 15) || 15);
  const cyclesToLong = Math.max(
    1,
    Number(settingsMap["pomodoro.cycles_to_long"] ?? 4) || 4
  );
  const refreshSec = Math.max(2, Number(settingsMap["dashboard.refresh_sec"] ?? 5) || 5);
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

  const computeElapsedMs = useCallback(() => {
    const runningSlice =
      segmentStartMsRef.current !== null
        ? Math.max(0, Date.now() - segmentStartMsRef.current)
        : 0;
    return accumulatedElapsedMsRef.current + runningSlice;
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

      setSummary(sum);
      setDailyPlan(plan);

      const planKey = plan ? `${plan.id}:${plan.plan_date}` : null;
      const incomingPayload = plan?.payload ?? "";
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
      setActivePomo(pomo ?? null);
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

      if (pomo && trackedPomoIdRef.current !== pomo.id) {
        trackedPomoIdRef.current = pomo.id;
        const cachedPause = readPomoPauseCache(pomo.id);
        const totalSec = pomo.planned_min * 60;
        if (cachedPause && cachedPause.paused) {
          accumulatedElapsedMsRef.current = cachedPause.accumulatedMs;
          segmentStartMsRef.current = null;
          setTimerPaused(true);
          setTimerSecondsLeft(
            Math.max(0, totalSec - Math.floor(cachedPause.accumulatedMs / 1000))
          );
        } else {
          const startedMs = Date.parse(pomo.started_at);
          accumulatedElapsedMsRef.current = Number.isNaN(startedMs)
            ? 0
            : Math.max(0, Date.now() - startedMs);
          segmentStartMsRef.current = Date.now();
          setTimerPaused(false);
          setTimerSecondsLeft(
            Math.max(0, totalSec - Math.floor(accumulatedElapsedMsRef.current / 1000))
          );
        }
      } else if (!pomo && trackedPomoIdRef.current !== null) {
        trackedPomoIdRef.current = null;
        accumulatedElapsedMsRef.current = 0;
        segmentStartMsRef.current = null;
        autoCompletingPomoRef.current = null;
        writePomoPauseCache(null, false, 0);
        setTimerPaused(false);
      }
    } catch {
      // Preserve UI stability during transient startup IPC states
    }
  }, [i18n]);

  useEffect(() => {
    void refreshAll();
    const poll = window.setInterval(() => {
      void refreshAll();
    }, refreshSec * 1000);

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
  }, [refreshAll, refreshSec]);

  // Keep idle timer preview synced with configured focus duration.
  useEffect(() => {
    if (!activePomo) {
      setTimerSecondsLeft(focusMin * 60);
    }
  }, [activePomo, focusMin]);

  const finishPomodoroSession = useCallback(async () => {
    if (!activePomo) return;
    const elapsedMin = Math.max(1, Math.round(computeElapsedMs() / 60_000));
    try {
      await pomodoroApi.complete(elapsedMin);
      trackedPomoIdRef.current = null;
      accumulatedElapsedMsRef.current = 0;
      segmentStartMsRef.current = null;
      autoCompletingPomoRef.current = null;
      writePomoPauseCache(null, false, 0);
      setTimerPaused(false);
      setActivePomo(null);
      await refreshAll();
      notify(t("pomodoro.sessionCompleted", { min: elapsedMin }));
    } catch (err) {
      notify(String(err), true);
    }
  }, [activePomo, computeElapsedMs, notify, refreshAll, t]);

  // Live countdown ticker respecting pause state & auto-completing cleanly at 00:00.
  useEffect(() => {
    if (!activePomo || timerPaused) return;
    const totalSec = activePomo.planned_min * 60;
    const updateClock = () => {
      const elapsedSec = Math.floor(computeElapsedMs() / 1000);
      const left = Math.max(0, totalSec - elapsedSec);
      setTimerSecondsLeft(left);
      if (left === 0 && autoCompletingPomoRef.current !== activePomo.id) {
        autoCompletingPomoRef.current = activePomo.id;
        void finishPomodoroSession();
      }
    };
    updateClock();
    const id = window.setInterval(updateClock, 500);
    return () => window.clearInterval(id);
  }, [activePomo, timerPaused, computeElapsedMs, finishPomodoroSession]);

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

  // --- Tasks & Kanban Handlers ---
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) {
      notify(t("errors.taskTitleEmpty"), true);
      return;
    }
    try {
      const parsedTags = newTaskTags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const dueAt = newTaskDueAt ? new Date(`${newTaskDueAt}T12:00:00`).toISOString() : undefined;
      await tasksApi.create({
        title: newTaskTitle.trim(),
        priority: newTaskPriority,
        estimate_min: newTaskEstimate ? Number(newTaskEstimate) : undefined,
        project_id: newTaskProjectId || undefined,
        tags: parsedTags.length > 0 ? parsedTags : undefined,
        due_at: dueAt,
      });
      setNewTaskTitle("");
      setNewTaskEstimate("");
      setNewTaskTags("");
      setNewTaskDueAt("");
      await refreshAll();
      notify(t("kanban.taskCreated"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleCreateProject = async (name: string) => {
    try {
      const created = await projectsApi.create({ name });
      setNewTaskProjectId(created.id);
      await refreshAll();
      notify(t("kanban.projectCreated"));
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

  const handleReorderTask = async (task: Task, targetIndex: number) => {
    try {
      const colTasks = tasks
        .filter((x) => x.status === task.status && x.id !== task.id)
        .sort((a, b) => a.kanban_order - b.kanban_order);
      const boundedIdx = Math.max(0, Math.min(targetIndex, colTasks.length));
      colTasks.splice(boundedIdx, 0, task);
      await Promise.all(
        colTasks.map((tk, idx) =>
          tk.kanban_order !== idx || tk.id === task.id
            ? tasksApi.update(tk.id, { kanbanOrder: idx })
            : Promise.resolve(tk)
        )
      );
      await refreshAll();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleSaveTaskEdit = async (
    taskId: string,
    title: string,
    priority: TaskPriority,
    extra?: TaskEditExtra
  ) => {
    if (!title.trim()) return;
    try {
      await tasksApi.update(taskId, {
        title: title.trim(),
        priority,
        ...(extra
          ? {
              description: extra.description,
              estimateMin: extra.estimateMin,
              tags: extra.tags,
            }
          : {}),
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
      const acc = computeElapsedMs();
      accumulatedElapsedMsRef.current = acc;
      segmentStartMsRef.current = null;
      writePomoPauseCache(activePomo.id, true, acc);
      setTimerPaused(true);
    } else {
      segmentStartMsRef.current = Date.now();
      writePomoPauseCache(activePomo.id, false, accumulatedElapsedMsRef.current);
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
      autoCompletingPomoRef.current = null;
      writePomoPauseCache(started.id, false, 0);
      setTimerPaused(false);
      setTimerSecondsLeft(plannedMin * 60);
      setActivePomo(started);
      await refreshAll();
      selectTab("pomodoro");
      notify(t("pomodoro.sessionStarted", { min: plannedMin }));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleCompletePomodoro = async () => {
    await finishPomodoroSession();
  };

  const handleAbandonPomodoro = async () => {
    if (!activePomo) return;
    const elapsedMin = Math.max(0, Math.round(computeElapsedMs() / 60_000));
    try {
      await pomodoroApi.abandon(elapsedMin);
      trackedPomoIdRef.current = null;
      accumulatedElapsedMsRef.current = 0;
      segmentStartMsRef.current = null;
      autoCompletingPomoRef.current = null;
      writePomoPauseCache(null, false, 0);
      setTimerPaused(false);
      setActivePomo(null);
      await refreshAll();
      notify(t("pomodoro.sessionInterrupted"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  // --- Reminders & Alerts Handlers ---
  const handleCreateReminder = async (
    delayMinutes: number,
    opts?: CreateReminderOptions
  ) => {
    if (!newReminderTitle.trim()) {
      notify(t("reminders.titleRequired"), true);
      return;
    }
    const fireAt = opts?.fireAtIso ?? new Date(Date.now() + delayMinutes * 60_000).toISOString();
    try {
      await remindersApi.create({
        title: newReminderTitle.trim(),
        body: opts?.body,
        fire_at: fireAt,
        repeat_kind: opts?.repeatKind ?? ("none" as RepeatKind),
        sound: opts?.sound ?? ("normal" as ReminderSound),
      });
      setNewReminderTitle("");
      await refreshAll();
      notify(delayMinutes === 0 && !opts?.fireAtIso ? t("reminders.firedNow") : t("reminders.scheduled"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleToggleDnd = async () => {
    const active = Boolean(dndUntil && Date.parse(dndUntil) > Date.now());
    const nextVal = active ? null : new Date(Date.now() + 60 * 60_000).toISOString();
    await settingsApi.set("reminders.paused_until", nextVal).catch(() => {});
    setSettingsMap((prev) => ({ ...prev, "reminders.paused_until": nextVal }));
    await refreshAll();
  };

  const handleToggleRoutine = async (id: string, enabled: boolean) => {
    try {
      await routinesApi.setEnabled(id, enabled);
      await refreshAll();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleApproveProposal = async (id: string) => {
    try {
      await proposalsApi.approve(id);
      await refreshAll();
      notify(t("dashboard.proposalApproved"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleRejectProposal = async (id: string) => {
    try {
      await proposalsApi.reject(id);
      await refreshAll();
      notify(t("dashboard.proposalRejected"));
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
  const isSidebar = visualPrefs.navLayout === "sidebar";
  const isLightTheme =
    typeof document !== "undefined" && document.documentElement.dataset.theme === "light";

  const navItems = [
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
      className={
        isSidebar
          ? "aura-glass border-b md:border-b-0 md:border-r border-slate-800/40 p-3 flex md:flex-col justify-between gap-2 md:w-60 shrink-0 overflow-x-auto"
          : "aura-glass border-b border-slate-800/40 px-6 flex items-center justify-between gap-2 overflow-x-auto"
      }
    >
      <div className={isSidebar ? "flex md:flex-col gap-1" : "flex items-center gap-1"}>
        {navItems.map(({ key, label, icon: Icon, badge }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectTab(key)}
              className={`flex items-center justify-between gap-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                isSidebar
                  ? `rounded-xl px-3.5 py-2.5 w-full ${
                      active
                        ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                    }`
                  : `px-4 py-3 border-b-2 ${
                      active
                        ? "border-sky-400 text-sky-300 bg-sky-500/5"
                        : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700"
                    }`
              }`}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </span>
              {badge !== undefined && (
                <span className="ml-1 rounded-full aura-glass-pill px-2 py-0.5 text-[10px] text-sky-300 tabular-nums">
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
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
            customizingLayout
              ? "bg-sky-500 text-slate-950"
              : "aura-glass-pill text-slate-300 hover:text-sky-300"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {customizingLayout ? t("dashboard.closeCustomizer") : t("dashboard.customizeLayout")}
        </button>
      )}
    </nav>
  );

  const renderMainContent = () => (
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
      )}

      {activeTab === "kanban" && (
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
          onReorderTask={handleReorderTask}
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
          cyclesToLong={cyclesToLong}
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
          dndUntil={dndUntil}
          onChangeTitle={setNewReminderTitle}
          onCreateReminder={handleCreateReminder}
          onToggleDnd={handleToggleDnd}
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
          onAlertTriggered={() => {
            setVisualPrefs(loadVisualPrefs());
            void refreshAll();
          }}
          onVisualPrefsChange={setVisualPrefs}
        />
      )}
    </main>
  );

  return (
    <div className="min-h-screen aura-bg text-slate-100 flex flex-col">
      {/* Top Header with Winged Notebook Logo + Quick Controls + Language Switcher */}
      <header className="aura-glass border-b border-slate-800/40 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-1 rounded-2xl aura-glass-elevated ring-1 ring-sky-500/30 shadow-lg shadow-sky-500/10">
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

        <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => void handleQuickThemeToggle()}
            aria-label={t("app.toggleTheme")}
            title={t("app.toggleTheme")}
            className="rounded-xl aura-glass-pill p-2 text-slate-300 hover:text-sky-300 cursor-pointer"
          >
            {isLightTheme ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={handleToggleNavLayout}
            aria-label={isSidebar ? t("app.navTop") : t("app.navSidebar")}
            title={isSidebar ? t("app.navTop") : t("app.navSidebar")}
            className="rounded-xl aura-glass-pill p-2 text-slate-300 hover:text-sky-300 cursor-pointer"
          >
            {isSidebar ? <PanelTop className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
          <div className="inline-flex rounded-xl aura-glass-pill p-1">
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
    </div>
  );
}
