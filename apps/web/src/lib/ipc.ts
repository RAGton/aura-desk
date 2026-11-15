import { invoke } from "@tauri-apps/api/core";
import { ERROR_KEYS, errorMessage } from "./errors";

export type TaskStatus = "todo" | "doing" | "waiting" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface Task {
  id: string;
  project_id?: string | null;
  parent_task_id?: string | null;
  recurrence_id?: string | null;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  kanban_order: number;
  due_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  estimate_min?: number | null;
  actual_min?: number | null;
  tags?: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  status: "active" | "paused" | "completed" | "archived";
  start_date?: string | null;
  target_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskFilter {
  status?: TaskStatus;
  project_id?: string;
  overdue?: boolean;
  top_level_only?: boolean;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status?: TaskStatus;
  project_id?: string | null;
  parent_task_id?: string | null;
  due_at?: string | null;
  estimate_min?: number | null;
  tags?: string[] | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  projectId?: string | null;
  dueAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  estimateMin?: number | null;
  kanbanOrder?: number;
  tags?: string[] | null;
}

export interface SetStatusInput {
  id: string;
  status: TaskStatus;
  kanban_order: number;
}

export type SessionKind = "focus" | "short_break" | "long_break";
export type SessionStatus = "active" | "running" | "completed" | "abandoned" | "interrupted";

export interface PomodoroSession {
  id: string;
  task_id?: string | null;
  kind: SessionKind;
  planned_min: number;
  actual_min?: number | null;
  started_at: string;
  ended_at?: string | null;
  status: SessionStatus;
  interruptions?: number;
  note?: string | null;
}

export type RepeatKind = "none" | "daily" | "weekly" | "monthly";
export type ReminderSound = "default" | "chime" | "normal" | "urgent" | "none";
export type ReminderStatus =
  | "pending"
  | "fired"
  | "resolved"
  | "snoozed"
  | "dismissed"
  | "excepted";

export interface Reminder {
  id: string;
  task_id?: string | null;
  title: string;
  body?: string | null;
  fire_at: string;
  repeat_kind: RepeatKind;
  sound: ReminderSound;
  status: ReminderStatus;
  snooze_count: number;
  last_snoozed_at?: string | null;
  resolved_at?: string | null;
  exceptions_log?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type AlertSeverity =
  | "info"
  | "low"
  | "normal"
  | "high"
  | "warning"
  | "urgent"
  | "critical";

export interface Alert {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  severity: AlertSeverity;
  ref_id?: string | null;
  options?: string | null;
  resolution?: "resolved" | "snoozed" | "dismissed" | "excepted" | null;
  resolved_at?: string | null;
  created_at: string;
}

export interface Routine {
  id: string;
  kind: "water" | "break" | "daily_planning" | "custom";
  title: string;
  body?: string | null;
  cron_expr?: string | null;
  enabled: boolean;
  last_fired_at?: string | null;
}

export interface ProposalItem {
  id: string;
  source: string;
  kind: string;
  payload: Record<string, unknown>;
  summary: string;
  status: string;
  created_at: string;
  expires_at: string;
}

export type PlanState = "not_started" | "in_progress" | "completed" | "skipped";

export interface DailyPlan {
  id: string;
  plan_date: string;
  state: PlanState;
  started_at?: string | null;
  completed_at?: string | null;
  payload?: string | null;
}

export interface DashboardSummary {
  nextTask: Task | null;
  pendingCount: number;
  completedToday: number;
  overdueCount: number;
  runningPomodoro: PomodoroSession | null;
  pendingReminders: number;
  recentReminders: Reminder[];
  todayPomodoros: number;
  todayFocusMin: number;
  waterIntervalMin: number;
  breakIntervalMin: number;
  dailyPlanningTime: string;
}

export interface ReportDay {
  date: string;
  focusMin: number;
  breakMin: number;
  waterCount: number;
  pomodoros: number;
  tasksDone: number;
}

export interface ReportPeriod {
  focusMin: number;
  breakMin: number;
  waterCount: number;
  pomodoros: number;
  tasksDone: number;
  activeDays: number;
}

export interface ReportSummary {
  today: ReportDay;
  week: ReportPeriod;
  month: ReportPeriod;
  byDay: ReportDay[];
}

export type GithubIssueState = "open" | "closed";

export interface GithubIssueLink {
  id: string;
  source: string;
  externalId: string;
  repo: string;
  issueNumber: number;
  issueUrl: string;
  title: string;
  labels?: string[] | null;
  sourceStatus: GithubIssueState;
  taskId?: string | null;
  titleLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GithubSyncSummary {
  created: number;
  updated: number;
  skipped: number;
  issues: GithubIssueLink[];
}

export interface GithubAuthStatus {
  available: boolean;
  authenticated: boolean;
  account?: string | null;
  message?: string | null;
}

export interface ImportSummary {
  projects: number;
  tasks: number;
  pomodoros: number;
  reminders: number;
  daily_plans: number;
  settings: number;
  github_issues: number;
}

export interface IntegrationState {
  inFocusSession: boolean;
}

export type IpcErrorKind = "validation" | "transport" | "application";

export class IpcError extends Error {
  readonly kind: IpcErrorKind;
  readonly cause?: unknown;

  constructor(message: string, kind: IpcErrorKind = "application", cause?: unknown) {
    super(message);
    this.name = "IpcError";
    this.kind = kind;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function toIpcError(err: unknown): IpcError {
  if (err instanceof IpcError) {
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  let kind: IpcErrorKind = "application";
  if (lower.includes("validation") || lower.includes("invalid") || lower.includes("schema")) {
    kind = "validation";
  } else if (
    lower.includes("network") ||
    lower.includes("transport") ||
    lower.includes("connection") ||
    lower.includes("ipc") ||
    (typeof err !== "string" && !(err instanceof Error))
  ) {
    kind = "transport";
  }
  return new IpcError(msg, kind, err);
}

/**
 * Checks whether we are running inside the native Tauri webview (`auradesk.exe`)
 * or inside a standard browser (`http://localhost:5173` in Chrome/Edge).
 */
export function isTauriRuntime(): boolean {
  if ("mock" in invoke) return true;
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  const internals = w.__TAURI_INTERNALS__ as Record<string, unknown> | undefined;
  return Boolean(internals && typeof internals.invoke === "function");
}

// ── Browser Persistence Engine (used when opened in Chrome at localhost:5173) ──

interface BrowserDbState {
  tasks: Task[];
  projects: Project[];
  pomodoros: PomodoroSession[];
  reminders: Reminder[];
  alerts: Alert[];
  dailyPlans: DailyPlan[];
  routines?: Routine[];
  proposals?: ProposalItem[];
  settings: Record<string, unknown>;
  githubLinks?: GithubIssueLink[];
  metricsByDay?: Record<string, { waterCount: number; breakMin: number }>;
}

const STORAGE_KEY = "auradesk_browser_db_v1";

const DEFAULT_SETTINGS: Record<string, unknown> = {
  "app.version": "0.1.0",
  "app.theme": "dark",
  "app.locale": "pt-BR",
  "dashboard.refresh_sec": 30,
  "monitor.preferred": "primary",
  "monitor.fallback_strategy": "primary_then_hide",
  "reminders.sound": true,
  "reminders.block_screen": false,
  "reminders.paused_until": null,
  "pomodoro.focus_min": 25,
  "pomodoro.short_min": 5,
  "pomodoro.long_min": 15,
  "pomodoro.cycles_to_long": 4,
  "routine.daily_planning_time": "07:50",
  "routine.water_interval_min": 60,
  "routine.break_interval_min": 90,
  "alerts.max_queue_size": 50,
  "proposals.ttl_hours": 24,
  "github.repo": null,
  "github.project_id": null,
  "github.filter_labels": null,
  "github.auto_sync": false,
};

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localDayFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function encodeBrowserZipBase64(files: Record<string, string>): string {
  const payload = JSON.stringify({ format: "auradesk-browser-backup", files });
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBrowserZipBase64(zipBase64: string): Record<string, string> {
  const clean = zipBase64.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const text = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(text) as { files?: Record<string, string> };
  if (!parsed || typeof parsed !== "object" || !parsed.files) {
    throw new IpcError("errors.invalidBackup", "validation");
  }
  return parsed.files;
}

function loadBrowserDb(): BrowserDbState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BrowserDbState>;
      return {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        pomodoros: Array.isArray(parsed.pomodoros) ? parsed.pomodoros : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
        dailyPlans: Array.isArray(parsed.dailyPlans) ? parsed.dailyPlans : [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        githubLinks: Array.isArray(parsed.githubLinks) ? parsed.githubLinks : [],
        metricsByDay:
          parsed.metricsByDay && typeof parsed.metricsByDay === "object"
            ? parsed.metricsByDay
            : {},
      };
    }
  } catch {
    // ignore corrupt storage
  }
  return {
    tasks: [],
    projects: [],
    pomodoros: [],
    reminders: [],
    alerts: [],
    dailyPlans: [],
    settings: { ...DEFAULT_SETTINGS },
    githubLinks: [],
    metricsByDay: {},
  };
}

function saveBrowserDb(db: BrowserDbState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore quota errors
  }
}

function pollOverdueBrowserReminders(db: BrowserDbState): void {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let mutated = false;
  for (const r of db.reminders) {
    if (r.status === "pending" && new Date(r.fire_at).getTime() <= nowMs) {
      r.status = "fired";
      r.updated_at = nowIso;
      const alreadyQueued = db.alerts.some(
        (a) => a.ref_id === r.id && !a.resolution
      );
      if (!alreadyQueued) {
        db.alerts.unshift({
          id: genId(),
          kind: "reminder",
          title: r.title,
          body: r.body ?? null,
          severity: r.sound === "urgent" ? "urgent" : "normal",
          ref_id: r.id,
          resolution: null,
          resolved_at: null,
          created_at: nowIso,
        });
      }
      mutated = true;
    }
  }
  if (mutated) {
    saveBrowserDb(db);
  }
}

function priorityRank(p: TaskPriority): number {
  switch (p) {
    case "urgent":
      return 0;
    case "high":
      return 1;
    case "normal":
      return 2;
    case "low":
      return 3;
  }
}

function invokeBrowserFallback(cmd: string, args: Record<string, unknown> = {}): unknown {
  const db = loadBrowserDb();
  pollOverdueBrowserReminders(db);
  const nowIso = new Date().toISOString();

  switch (cmd) {
    case "ping":
      return "pong";

    case "settings_ping":
      return Object.keys(db.settings).length;

    case "tasks_list": {
      const filter = (args.filter ?? {}) as TaskFilter;
      let list = [...db.tasks];
      if (filter.status) {
        list = list.filter((t) => t.status === filter.status);
      }
      if (filter.project_id) {
        list = list.filter((t) => t.project_id === filter.project_id);
      }
      if (filter.overdue) {
        const now = Date.now();
        list = list.filter(
          (t) =>
            t.status !== "done" &&
            t.status !== "cancelled" &&
            Boolean(t.due_at && new Date(t.due_at).getTime() < now)
        );
      }
      if (filter.top_level_only) {
        list = list.filter((t) => !t.parent_task_id);
      }
      list.sort(
        (a, b) =>
          a.kanban_order - b.kanban_order ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      return list;
    }

    case "tasks_get": {
      const id = String(args.id ?? "");
      const found = db.tasks.find((t) => t.id === id);
      if (!found) throw new IpcError(`Task not found: ${id}`, "application");
      return found;
    }

    case "tasks_create": {
      const input = args.input as CreateTaskInput;
      const title = (input?.title ?? "").trim();
      if (!title) {
        throw new IpcError(errorMessage(ERROR_KEYS.taskTitleEmpty), "validation");
      }
      const status: TaskStatus = input.status ?? "todo";
      const sameCol = db.tasks.filter((t) => t.status === status);
      const maxOrder = sameCol.reduce((m, t) => Math.max(m, t.kanban_order), -1);
      const newTask: Task = {
        id: genId(),
        project_id: input.project_id ?? null,
        parent_task_id: input.parent_task_id ?? null,
        recurrence_id: null,
        title,
        description: input.description ?? null,
        priority: input.priority ?? "normal",
        status,
        kanban_order: maxOrder + 1,
        due_at: input.due_at ?? null,
        started_at: status === "doing" ? nowIso : null,
        completed_at: status === "done" ? nowIso : null,
        estimate_min: input.estimate_min ?? null,
        actual_min: 0,
        tags: input.tags ?? [],
        created_at: nowIso,
        updated_at: nowIso,
      };
      db.tasks.push(newTask);
      saveBrowserDb(db);
      return newTask;
    }

    case "tasks_update": {
      const id = String(args.id ?? "");
      const patch = (args.patch ?? {}) as UpdateTaskInput;
      const idx = db.tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new IpcError(`Task not found: ${id}`, "application");
      const current = db.tasks[idx];
      if (patch.title !== undefined) {
        const trimmed = patch.title.trim();
        if (!trimmed) throw new IpcError(errorMessage(ERROR_KEYS.taskTitleInvalid), "validation");
        current.title = trimmed;
      }
      if (patch.description !== undefined) current.description = patch.description;
      if (patch.priority !== undefined) current.priority = patch.priority;
      if (patch.status !== undefined) {
        current.status = patch.status;
        if (patch.status === "doing" && !current.started_at) current.started_at = nowIso;
        if (patch.status === "done") current.completed_at = nowIso;
      }
      if (patch.projectId !== undefined) current.project_id = patch.projectId;
      if (patch.dueAt !== undefined) current.due_at = patch.dueAt;
      if (patch.estimateMin !== undefined) current.estimate_min = patch.estimateMin;
      if (patch.kanbanOrder !== undefined) current.kanban_order = patch.kanbanOrder;
      if (patch.tags !== undefined) current.tags = patch.tags;
      current.updated_at = nowIso;
      saveBrowserDb(db);
      return current;
    }

    case "tasks_delete": {
      const id = String(args.id ?? "");
      db.tasks = db.tasks.filter((t) => t.id !== id);
      saveBrowserDb(db);
      return;
    }

    case "tasks_set_status": {
      const input = args.input as SetStatusInput;
      const task = db.tasks.find((t) => t.id === input.id);
      if (!task) throw new IpcError(`Task not found: ${input.id}`, "application");
      task.status = input.status;
      task.kanban_order = input.kanban_order ?? task.kanban_order;
      if (input.status === "doing" && !task.started_at) {
        task.started_at = nowIso;
      }
      if (input.status === "done") {
        task.completed_at = nowIso;
      } else {
        task.completed_at = null;
      }
      task.updated_at = nowIso;
      saveBrowserDb(db);
      return task;
    }

    case "projects_list":
      return db.projects;

    case "projects_create": {
      const input = args.input as {
        name: string;
        description?: string | null;
        color?: string | null;
      };
      const name = (input?.name ?? "").trim();
      if (!name) throw new IpcError(errorMessage(ERROR_KEYS.projectNameRequired), "validation");
      const proj: Project = {
        id: genId(),
        name,
        description: input.description ?? null,
        color: input.color ?? "#38bdf8",
        status: "active",
        created_at: nowIso,
        updated_at: nowIso,
      };
      db.projects.push(proj);
      saveBrowserDb(db);
      return proj;
    }

    case "pomodoro_start": {
      const input = args.input as {
        kind: SessionKind;
        planned_min: number;
        task_id?: string | null;
      };
      // Complete/abandon any previously active session
      for (const s of db.pomodoros) {
        if (s.status === "active" || s.status === "running") {
          s.status = "abandoned";
          s.ended_at = nowIso;
        }
      }
      const session: PomodoroSession = {
        id: genId(),
        task_id: input.task_id ?? null,
        kind: input.kind ?? "focus",
        planned_min: Math.max(1, Number(input.planned_min) || 25),
        actual_min: null,
        started_at: nowIso,
        ended_at: null,
        status: "active",
        interruptions: 0,
        note: null,
      };
      db.pomodoros.unshift(session);
      saveBrowserDb(db);
      return session;
    }

    case "pomodoro_complete": {
      const rawActual = args.actualMin ?? args.actual_min;
      const running = db.pomodoros.find(
        (s) => s.status === "active" || s.status === "running"
      );
      if (!running) {
        throw new IpcError(errorMessage(ERROR_KEYS.pomodoroNotRunning), "application");
      }
      const parsed = rawActual !== undefined && rawActual !== null ? Number(rawActual) : running.planned_min;
      const actualMin = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : running.planned_min;
      running.status = "completed";
      running.actual_min = Math.max(1, actualMin);
      running.ended_at = nowIso;

      // Credit focus minutes to linked task
      if (running.kind === "focus" && running.task_id) {
        const linked = db.tasks.find((t) => t.id === running.task_id);
        if (linked) {
          linked.actual_min = (linked.actual_min ?? 0) + running.actual_min;
          linked.updated_at = nowIso;
        }
      }

      // Create celebration alert when focus finishes
      if (running.kind === "focus") {
        db.alerts.unshift({
          id: genId(),
          kind: "pomodoro",
          title: `✓ Foco concluído · ${running.actual_min} min`,
          body: errorMessage(ERROR_KEYS.focusCompletedBody),
          severity: "normal",
          ref_id: running.id,
          resolution: null,
          resolved_at: null,
          created_at: nowIso,
        });
      }

      saveBrowserDb(db);
      return running;
    }

    case "pomodoro_abandon": {
      const actualMin =
        args.actualMin !== undefined && args.actualMin !== null
          ? Number(args.actualMin)
          : 0;
      const running = db.pomodoros.find(
        (s) => s.status === "active" || s.status === "running"
      );
      if (!running) {
        throw new IpcError(errorMessage(ERROR_KEYS.pomodoroNoneActive), "application");
      }
      running.status = "abandoned";
      running.actual_min = actualMin;
      running.ended_at = nowIso;
      saveBrowserDb(db);
      return running;
    }

    case "pomodoro_active": {
      return (
        db.pomodoros.find((s) => s.status === "active" || s.status === "running") ?? null
      );
    }

    case "pomodoro_list": {
      const limit = Number(args.limit ?? 20);
      return db.pomodoros.slice(0, limit);
    }

    case "reminders_list": {
      const includeDone = Boolean(args.includeDone ?? args.include_done ?? true);
      const list = includeDone
        ? [...db.reminders]
        : db.reminders.filter((r) => r.status === "pending" || r.status === "snoozed");
      list.sort(
        (a, b) => new Date(a.fire_at).getTime() - new Date(b.fire_at).getTime()
      );
      return list;
    }

    case "reminders_create": {
      const input = args.input as {
        title: string;
        body?: string | null;
        fire_at: string;
        repeat_kind: RepeatKind;
        sound: ReminderSound;
        task_id?: string | null;
      };
      const title = (input?.title ?? "").trim();
      if (!title) throw new IpcError(errorMessage(ERROR_KEYS.reminderTitleRequired), "validation");
      const rem: Reminder = {
        id: genId(),
        task_id: input.task_id ?? null,
        title,
        body: input.body ?? null,
        fire_at: input.fire_at,
        repeat_kind: input.repeat_kind ?? "none",
        sound: input.sound ?? "normal",
        status: "pending",
        snooze_count: 0,
        created_at: nowIso,
        updated_at: nowIso,
      };
      db.reminders.push(rem);
      pollOverdueBrowserReminders(db);
      saveBrowserDb(db);
      return rem;
    }

    case "reminders_dismiss": {
      const id = String(args.id ?? "");
      const rem = db.reminders.find((r) => r.id === id);
      if (!rem) throw new IpcError(`Reminder not found: ${id}`, "application");
      rem.status = "dismissed";
      rem.updated_at = nowIso;
      for (const a of db.alerts) {
        if (a.ref_id === id && !a.resolution) {
          a.resolution = "dismissed";
          a.resolved_at = nowIso;
        }
      }
      saveBrowserDb(db);
      return rem;
    }

    case "reminders_snooze": {
      const input = args.input as { id: string; minutes: number };
      const rem = db.reminders.find((r) => r.id === input.id);
      if (!rem) throw new IpcError(`Reminder not found: ${input.id}`, "application");
      const nextFire = new Date(
        Date.now() + Math.max(1, input.minutes) * 60_000
      ).toISOString();
      rem.fire_at = nextFire;
      rem.status = "pending";
      rem.snooze_count = (rem.snooze_count ?? 0) + 1;
      rem.last_snoozed_at = nowIso;
      rem.updated_at = nowIso;
      for (const a of db.alerts) {
        if (a.ref_id === input.id && !a.resolution) {
          a.resolution = "snoozed";
          a.resolved_at = nowIso;
        }
      }
      saveBrowserDb(db);
      return rem;
    }

    case "reminders_delete": {
      const id = String(args.id ?? "");
      db.reminders = db.reminders.filter((r) => r.id !== id);
      db.alerts = db.alerts.filter((a) => a.ref_id !== id);
      saveBrowserDb(db);
      return;
    }

    case "alerts_list_pending":
      return db.alerts.filter((a) => !a.resolution);

    case "alerts_create": {
      const input = args.input as {
        kind: string;
        title: string;
        body?: string | null;
        severity: AlertSeverity;
        ref_id?: string | null;
      };
      const alert: Alert = {
        id: genId(),
        kind: input.kind ?? "custom",
        title: input.title,
        body: input.body ?? null,
        severity: input.severity ?? "normal",
        ref_id: input.ref_id ?? null,
        resolution: null,
        resolved_at: null,
        created_at: nowIso,
      };
      db.alerts.unshift(alert);
      saveBrowserDb(db);
      return alert;
    }

    case "alerts_resolve": {
      const id = String(args.id ?? "");
      const alert = db.alerts.find((a) => a.id === id);
      if (!alert) throw new IpcError(`Alert not found: ${id}`, "application");
      alert.resolution = "resolved";
      alert.resolved_at = nowIso;
      if (alert.ref_id) {
        const rem = db.reminders.find((r) => r.id === alert.ref_id);
        if (rem) {
          if (rem.repeat_kind === "daily") {
            rem.fire_at = new Date(Date.now() + 86400_000).toISOString();
            rem.status = "pending";
          } else if (rem.repeat_kind === "weekly") {
            rem.fire_at = new Date(Date.now() + 7 * 86400_000).toISOString();
            rem.status = "pending";
          } else {
            rem.status = "resolved";
            rem.resolved_at = nowIso;
          }
        }
      }
      saveBrowserDb(db);
      return alert;
    }

    case "alerts_snooze": {
      const id = String(args.id ?? "");
      const alert = db.alerts.find((a) => a.id === id);
      if (!alert) throw new IpcError(`Alert not found: ${id}`, "application");
      alert.resolution = "snoozed";
      alert.resolved_at = nowIso;
      if (alert.ref_id) {
        const rem = db.reminders.find((r) => r.id === alert.ref_id);
        if (rem) {
          rem.fire_at = new Date(Date.now() + 10 * 60_000).toISOString();
          rem.status = "pending";
          rem.snooze_count += 1;
          rem.last_snoozed_at = nowIso;
        }
      }
      saveBrowserDb(db);
      return alert;
    }

    case "alerts_dismiss": {
      const id = String(args.id ?? "");
      const alert = db.alerts.find((a) => a.id === id);
      if (!alert) throw new IpcError(`Alert not found: ${id}`, "application");
      alert.resolution = "dismissed";
      alert.resolved_at = nowIso;
      saveBrowserDb(db);
      return alert;
    }

    case "alerts_except": {
      const id = String(args.id ?? "");
      const note = String(args.note ?? "").trim();
      if (!note) throw new IpcError(errorMessage(ERROR_KEYS.exceptionNoteRequired), "validation");
      const alert = db.alerts.find((a) => a.id === id);
      if (!alert) throw new IpcError(`Alert not found: ${id}`, "application");
      alert.resolution = "excepted";
      alert.resolved_at = nowIso;
      saveBrowserDb(db);
      return alert;
    }

    case "settings_get_all":
      return Object.entries(db.settings);

    case "settings_get": {
      const key = String(args.key ?? "");
      return key in db.settings ? db.settings[key] : null;
    }

    case "settings_set": {
      const input = (args.input ?? args) as { key: string; value: unknown };
      db.settings[input.key] = input.value;
      saveBrowserDb(db);
      return;
    }

    case "daily_plan_get": {
      const today = todayStr();
      let plan = db.dailyPlans.find((p) => p.plan_date === today);
      if (!plan) {
        plan = {
          id: genId(),
          plan_date: today,
          state: "not_started",
          started_at: null,
          completed_at: null,
          payload: null,
        };
        db.dailyPlans.push(plan);
        saveBrowserDb(db);
      }
      return plan;
    }

    case "daily_plan_set_state": {
      const input = args.input as { id: string; state: PlanState };
      const plan = db.dailyPlans.find((p) => p.id === input.id);
      if (!plan) throw new IpcError(`Daily plan not found: ${input.id}`, "application");
      plan.state = input.state;
      if (input.state === "in_progress" && !plan.started_at) plan.started_at = nowIso;
      if (input.state === "completed") plan.completed_at = nowIso;
      saveBrowserDb(db);
      return plan;
    }

    case "daily_plan_set_payload": {
      const input = args.input as { id: string; payload: string | null };
      const plan = db.dailyPlans.find((p) => p.id === input.id);
      if (!plan) throw new IpcError(`Daily plan not found: ${input.id}`, "application");
      plan.payload = input.payload;
      saveBrowserDb(db);
      return plan;
    }

    case "dashboard_summary": {
      const today = todayStr();
      const pendingCandidates = db.tasks.filter(
        (t) => t.status === "todo" || t.status === "waiting" || t.status === "doing"
      );
      pendingCandidates.sort((a, b) => {
        const pr = priorityRank(a.priority) - priorityRank(b.priority);
        if (pr !== 0) return pr;
        return (a.due_at ?? "z").localeCompare(b.due_at ?? "z");
      });
      const nextTask = pendingCandidates[0] ?? null;
      const pendingCount = pendingCandidates.length;
      const now = Date.now();
      const overdueCount = db.tasks.filter(
        (t) =>
          t.status !== "done" &&
          t.status !== "cancelled" &&
          Boolean(t.due_at && new Date(t.due_at).getTime() < now)
      ).length;
      const completedToday = db.tasks.filter(
        (t) => t.status === "done" && (t.completed_at ?? "").startsWith(today)
      ).length;
      const runningPomodoro =
        db.pomodoros.find((s) => s.status === "active" || s.status === "running") ??
        null;
      const todayCompletedPomos = db.pomodoros.filter(
        (s) => s.status === "completed" && s.started_at.startsWith(today)
      );
      const todayPomodoros = todayCompletedPomos.length;
      const todayFocusMin = todayCompletedPomos
        .filter((s) => s.kind === "focus")
        .reduce((acc, s) => acc + (s.actual_min ?? s.planned_min), 0);
      const pendingReminders = db.reminders.filter((r) => r.status === "pending").length;
      const recentReminders = db.reminders.slice(0, 5);

      return {
        nextTask,
        pendingCount,
        completedToday,
        overdueCount,
        runningPomodoro,
        pendingReminders,
        recentReminders,
        todayPomodoros,
        todayFocusMin,
        waterIntervalMin: Number(db.settings["routine.water_interval_min"] ?? 60),
        breakIntervalMin: Number(db.settings["routine.break_interval_min"] ?? 90),
        dailyPlanningTime: String(db.settings["routine.daily_planning_time"] ?? "07:50"),
      } satisfies DashboardSummary;
    }

    case "alerts_sync_desktop_lock":
      return;

    case "alerts_trigger_test_block": {
      db.settings["reminders.block_screen"] = true;
      const alert: Alert = {
        id: genId(),
        kind: "routine",
        title: String(args.title ?? "Test"),
        body: args.body != null ? String(args.body) : null,
        severity: "urgent",
        ref_id: null,
        resolution: null,
        resolved_at: null,
        created_at: nowIso,
      };
      db.alerts.unshift(alert);
      saveBrowserDb(db);
      return alert;
    }

    case "integration_state":
      return {
        inFocusSession: db.pomodoros.some((p) => p.status === "running" || p.status === "active"),
      } satisfies IntegrationState;

    case "report_summary": {
      const days30: ReportDay[] = [];
      const base = new Date();
      base.setHours(0, 0, 0, 0);
      for (let i = 29; i >= 0; i -= 1) {
        const d = new Date(base);
        d.setDate(base.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}`;
        const metrics = db.metricsByDay?.[key];
        days30.push({
          date: key,
          focusMin: 0,
          breakMin: metrics?.breakMin ?? 0,
          waterCount: metrics?.waterCount ?? 0,
          pomodoros: 0,
          tasksDone: 0,
        });
      }
      for (const p of db.pomodoros) {
        if (p.status === "completed") {
          const dKey = localDayFromIso(p.started_at);
          const day = days30.find((x) => x.date === dKey);
          if (day) {
            if (p.kind === "focus") {
              day.focusMin += p.actual_min ?? p.planned_min ?? 0;
              day.pomodoros += 1;
            } else {
              day.breakMin += p.actual_min ?? p.planned_min ?? 0;
            }
          }
        }
      }
      for (const a of db.alerts) {
        if (a.resolution === "resolved" && a.resolved_at) {
          const dKey = localDayFromIso(a.resolved_at);
          const day = days30.find((x) => x.date === dKey);
          if (day && a.kind === "routine") {
            const lower = a.title.toLowerCase();
            if (lower.includes("água") || lower.includes("agua") || lower.includes("water") || lower.includes("hidrata")) {
              day.waterCount += 1;
            }
          }
        }
      }
      for (const t of db.tasks) {
        if (t.status === "done" && t.completed_at) {
          const dKey = localDayFromIso(t.completed_at);
          const day = days30.find((x) => x.date === dKey);
          if (day) day.tasksDone += 1;
        }
      }
      const fold = (slice: ReportDay[]): ReportPeriod =>
        slice.reduce<ReportPeriod>(
          (acc, d) => {
            acc.focusMin += d.focusMin;
            acc.breakMin += d.breakMin;
            acc.waterCount += d.waterCount;
            acc.pomodoros += d.pomodoros;
            acc.tasksDone += d.tasksDone;
            if (d.focusMin > 0 || d.pomodoros > 0 || d.tasksDone > 0) {
              acc.activeDays += 1;
            }
            return acc;
          },
          { focusMin: 0, breakMin: 0, waterCount: 0, pomodoros: 0, tasksDone: 0, activeDays: 0 }
        );
      return {
        today: days30[days30.length - 1],
        week: fold(days30.slice(-7)),
        month: fold(days30),
        byDay: days30.slice(-14).reverse(),
      } satisfies ReportSummary;
    }

    case "github_check_auth":
      return {
        available: true,
        authenticated: Boolean(db.settings["github.repo"]),
        account: db.settings["github.repo"] ? "browser-demo" : null,
        message: db.settings["github.repo"] ? null : "github.authRequired",
      } satisfies GithubAuthStatus;

    case "github_issues_list":
      return db.githubLinks ?? [];

    case "github_sync_issues": {
      const repo = String(db.settings["github.repo"] ?? "").trim();
      if (!repo) {
        throw new IpcError("kanban.github.repoRequired", "validation");
      }
      const links = db.githubLinks ?? [];
      return {
        created: 0,
        updated: 0,
        skipped: links.length,
        issues: links,
      } satisfies GithubSyncSummary;
    }

    case "github_link_task": {
      const taskId = String(args.taskId ?? "");
      const repo = String(args.repo ?? "").trim();
      const num = Number(args.number ?? 0);
      const task = db.tasks.find((t) => t.id === taskId);
      if (!task) throw new IpcError(`Task not found: ${taskId}`, "application");
      const link: GithubIssueLink = {
        id: genId(),
        source: "github",
        externalId: `${repo}#${num}`,
        repo,
        issueNumber: num,
        issueUrl: `https://github.com/${repo}/issues/${num}`,
        title: task.title,
        labels: [],
        sourceStatus: "open",
        taskId,
        titleLocked: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      db.githubLinks = [...(db.githubLinks ?? []).filter((l) => l.taskId !== taskId), link];
      saveBrowserDb(db);
      return link;
    }

    case "github_unlink_task": {
      const taskId = String(args.taskId ?? "");
      db.githubLinks = (db.githubLinks ?? []).filter((l) => l.taskId !== taskId);
      saveBrowserDb(db);
      return;
    }

    case "data_export_zip": {
      return encodeBrowserZipBase64({
        "settings.json": JSON.stringify(db.settings, null, 2),
        "browser-state.json": JSON.stringify({
          tasks: db.tasks,
          projects: db.projects,
          pomodoros: db.pomodoros,
          reminders: db.reminders,
          dailyPlans: db.dailyPlans,
          githubLinks: db.githubLinks ?? [],
        }),
        "audit-log.json": JSON.stringify({ notifications: [], mcp_proposals: [] }),
      });
    }

    case "data_import_zip": {
      const files = decodeBrowserZipBase64(String(args.zipBase64 ?? ""));
      let importedProjects = 0;
      let importedTasks = 0;
      let importedPomodoros = 0;
      let importedReminders = 0;
      let importedPlans = 0;
      let importedSettings = 0;
      let importedGithub = 0;
      if (files["settings.json"]) {
        const s = JSON.parse(files["settings.json"]) as Record<string, unknown>;
        for (const [k, v] of Object.entries(s)) {
          db.settings[k] = v;
          importedSettings += 1;
        }
      }
      if (files["browser-state.json"]) {
        const st = JSON.parse(files["browser-state.json"]) as Partial<BrowserDbState>;
        const mergeById = <T extends { id: string }>(target: T[], incoming?: T[]) => {
          if (!Array.isArray(incoming)) return 0;
          const existingIds = new Set(target.map((x) => x.id));
          let added = 0;
          for (const item of incoming) {
            if (item && item.id && !existingIds.has(item.id)) {
              target.push(item);
              added += 1;
            }
          }
          return added;
        };
        importedProjects = mergeById(db.projects, st.projects);
        importedTasks = mergeById(db.tasks, st.tasks);
        importedPomodoros = mergeById(db.pomodoros, st.pomodoros);
        importedReminders = mergeById(db.reminders, st.reminders);
        importedPlans = mergeById(db.dailyPlans, st.dailyPlans);
        if (!db.githubLinks) db.githubLinks = [];
        importedGithub = mergeById(db.githubLinks, st.githubLinks);
      }
      saveBrowserDb(db);
      return {
        projects: importedProjects,
        tasks: importedTasks,
        pomodoros: importedPomodoros,
        reminders: importedReminders,
        daily_plans: importedPlans,
        settings: importedSettings,
        github_issues: importedGithub,
      } satisfies ImportSummary;
    }

    case "routines_list": {
      if (!Array.isArray(db.routines) || db.routines.length === 0) {
        db.routines = [
          { id: "water-default", kind: "water", title: "water", enabled: true },
          { id: "break-default", kind: "break", title: "break", enabled: true },
          { id: "planning-default", kind: "daily_planning", title: "daily_planning", enabled: true },
        ];
        saveBrowserDb(db);
      }
      return db.routines;
    }

    case "routines_set_enabled": {
      const id = String(args.id ?? "");
      const enabled = Boolean(args.enabled);
      if (!Array.isArray(db.routines)) db.routines = [];
      const found = db.routines.find((r) => r.id === id);
      if (found) {
        found.enabled = enabled;
        saveBrowserDb(db);
        return found;
      }
      const created: Routine = { id, kind: "custom", title: id, enabled };
      db.routines.push(created);
      saveBrowserDb(db);
      return created;
    }

    case "proposals_list_pending":
      return (db.proposals ?? []).filter((p) => p.status === "pending");

    case "proposals_approve": {
      const id = String(args.id ?? "");
      const prop = (db.proposals ?? []).find((p) => p.id === id);
      if (prop) prop.status = "approved";
      saveBrowserDb(db);
      return prop ?? null;
    }

    case "proposals_reject": {
      const id = String(args.id ?? "");
      const prop = (db.proposals ?? []).find((p) => p.id === id);
      if (prop) prop.status = "rejected";
      saveBrowserDb(db);
      return prop ?? null;
    }

    default:
      return null;
  }
}

async function wrapInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    try {
      return invokeBrowserFallback(cmd, args) as T;
    } catch (err) {
      throw toIpcError(err);
    }
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw toIpcError(err);
  }
}

export const tasksApi = {
  list: (filter?: TaskFilter): Promise<Task[]> =>
    wrapInvoke<Task[]>("tasks_list", filter ? { filter } : undefined),

  get: (id: string): Promise<Task> =>
    wrapInvoke<Task>("tasks_get", { id }),

  create: (input: CreateTaskInput): Promise<Task> =>
    wrapInvoke<Task>("tasks_create", { input }),

  update: (id: string, patch: UpdateTaskInput): Promise<Task> =>
    wrapInvoke<Task>("tasks_update", { id, patch }),

  delete: (id: string): Promise<void> =>
    wrapInvoke<void>("tasks_delete", { id }),

  setStatus: (input: SetStatusInput): Promise<Task> =>
    wrapInvoke<Task>("tasks_set_status", { input }),
};

export const projectsApi = {
  list: (): Promise<Project[]> => wrapInvoke<Project[]>("projects_list"),
  create: (input: {
    name: string;
    description?: string | null;
    color?: string | null;
  }): Promise<Project> => wrapInvoke<Project>("projects_create", { input }),
};

export const pomodoroApi = {
  start: (input: {
    kind: SessionKind;
    planned_min: number;
    task_id?: string | null;
  }): Promise<PomodoroSession> =>
    wrapInvoke<PomodoroSession>("pomodoro_start", { input }),

  complete: (actualMin: number): Promise<PomodoroSession> =>
    wrapInvoke<PomodoroSession>("pomodoro_complete", { actualMin }),

  abandon: (actualMin?: number): Promise<PomodoroSession> =>
    wrapInvoke<PomodoroSession>("pomodoro_abandon", { actualMin: actualMin ?? null }),

  active: (): Promise<PomodoroSession | null> =>
    wrapInvoke<PomodoroSession | null>("pomodoro_active"),

  list: (limit = 20): Promise<PomodoroSession[]> =>
    wrapInvoke<PomodoroSession[]>("pomodoro_list", { limit }),
};

export const remindersApi = {
  list: (includeDone = true): Promise<Reminder[]> =>
    wrapInvoke<Reminder[]>("reminders_list", { includeDone }),

  create: (input: {
    title: string;
    body?: string | null;
    fire_at: string;
    repeat_kind: RepeatKind;
    sound: ReminderSound;
    task_id?: string | null;
  }): Promise<Reminder> => wrapInvoke<Reminder>("reminders_create", { input }),

  dismiss: (id: string): Promise<Reminder> =>
    wrapInvoke<Reminder>("reminders_dismiss", { id }),

  snooze: (id: string, minutes: number): Promise<Reminder> =>
    wrapInvoke<Reminder>("reminders_snooze", { input: { id, minutes } }),

  delete: (id: string): Promise<void> =>
    wrapInvoke<void>("reminders_delete", { id }),
};

export const alertsApi = {
  listPending: (): Promise<Alert[]> =>
    wrapInvoke<Alert[]>("alerts_list_pending"),

  create: (input: {
    kind: string;
    title: string;
    body?: string | null;
    severity: AlertSeverity;
    ref_id?: string | null;
  }): Promise<Alert> => wrapInvoke<Alert>("alerts_create", { input }),

  resolve: (id: string): Promise<Alert> =>
    wrapInvoke<Alert>("alerts_resolve", { id }),

  snooze: (id: string): Promise<Alert> =>
    wrapInvoke<Alert>("alerts_snooze", { id }),

  dismiss: (id: string): Promise<Alert> =>
    wrapInvoke<Alert>("alerts_dismiss", { id }),

  except: (id: string, note: string): Promise<Alert> =>
    wrapInvoke<Alert>("alerts_except", { id, note }),

  syncDesktopLock: (): Promise<void> =>
    wrapInvoke<void>("alerts_sync_desktop_lock"),

  triggerTestBlock: (title: string, body?: string | null): Promise<Alert> =>
    wrapInvoke<Alert>("alerts_trigger_test_block", { title, body: body ?? null }),
};

export const settingsApi = {
  getAll: (): Promise<[string, unknown][]> =>
    wrapInvoke<[string, unknown][]>("settings_get_all"),

  get: (key: string): Promise<unknown> =>
    wrapInvoke<unknown>("settings_get", { key }),

  set: (key: string, value: unknown): Promise<void> =>
    wrapInvoke<void>("settings_set", { input: { key, value } }),
};

export const dashboardApi = {
  summary: (): Promise<DashboardSummary> =>
    wrapInvoke<DashboardSummary>("dashboard_summary"),

  dailyPlanGet: (): Promise<DailyPlan> =>
    wrapInvoke<DailyPlan>("daily_plan_get"),

  dailyPlanSetState: (id: string, state: PlanState): Promise<DailyPlan> =>
    wrapInvoke<DailyPlan>("daily_plan_set_state", { input: { id, state } }),

  dailyPlanSetPayload: (id: string, payload: string | null): Promise<DailyPlan> =>
    wrapInvoke<DailyPlan>("daily_plan_set_payload", { input: { id, payload } }),
};

export const integrationApi = {
  state: (): Promise<IntegrationState> =>
    wrapInvoke<IntegrationState>("integration_state"),
};

export const reportsApi = {
  summary: (): Promise<ReportSummary> =>
    wrapInvoke<ReportSummary>("report_summary"),
};

export const githubApi = {
  syncIssues: (
    projectId?: string | null,
    labelFilter?: string | null
  ): Promise<GithubSyncSummary> =>
    wrapInvoke<GithubSyncSummary>("github_sync_issues", { projectId, labelFilter }),

  listIssues: (projectId?: string | null): Promise<GithubIssueLink[]> =>
    wrapInvoke<GithubIssueLink[]>("github_issues_list", { projectId }),

  linkTask: (taskId: string, repo: string, number: number): Promise<GithubIssueLink> =>
    wrapInvoke<GithubIssueLink>("github_link_task", { taskId, repo, number }),

  unlinkTask: (taskId: string): Promise<void> =>
    wrapInvoke<void>("github_unlink_task", { taskId }),

  checkAuth: (): Promise<GithubAuthStatus> =>
    wrapInvoke<GithubAuthStatus>("github_check_auth"),
};

export const dataIoApi = {
  exportZipBase64: (): Promise<string> =>
    wrapInvoke<string>("data_export_zip"),

  importZipBase64: (zipBase64: string): Promise<ImportSummary> =>
    wrapInvoke<ImportSummary>("data_import_zip", { zipBase64 }),
};

export const routinesApi = {
  list: (): Promise<Routine[]> => wrapInvoke<Routine[]>("routines_list"),
  setEnabled: (id: string, enabled: boolean): Promise<Routine> =>
    wrapInvoke<Routine>("routines_set_enabled", { id, enabled }),
};

export const proposalsApi = {
  listPending: (): Promise<ProposalItem[]> =>
    wrapInvoke<ProposalItem[]>("proposals_list_pending"),
  approve: (id: string, note?: string | null): Promise<unknown> =>
    wrapInvoke<unknown>("proposals_approve", { id, note: note ?? null }),
  reject: (id: string, note?: string | null): Promise<unknown> =>
    wrapInvoke<unknown>("proposals_reject", { id, note: note ?? null }),
};

export const ipc = {
  ping: () => wrapInvoke<string>("ping"),
  tasks: tasksApi,
  projects: projectsApi,
  pomodoro: pomodoroApi,
  reminders: remindersApi,
  alerts: alertsApi,
  settings: settingsApi,
  dashboard: dashboardApi,
  integration: integrationApi,
  reports: reportsApi,
  github: githubApi,
  dataIo: dataIoApi,
  routines: routinesApi,
  proposals: proposalsApi,
} as const;
