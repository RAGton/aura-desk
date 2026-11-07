import { invoke } from "@tauri-apps/api/core";

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
  status: TaskStatus;
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
export type SessionStatus = "running" | "completed" | "interrupted";

export interface PomodoroSession {
  id: string;
  task_id?: string | null;
  kind: SessionKind;
  planned_min: number;
  actual_min?: number | null;
  started_at: string;
  ended_at?: string | null;
  status: SessionStatus;
  notes?: string | null;
}

export interface Reminder {
  id: string;
  task_id?: string | null;
  title: string;
  body?: string | null;
  fire_at: string;
  repeat_kind: "none" | "daily" | "weekly" | "monthly" | "cron";
  sound: "none" | "gentle" | "normal" | "urgent";
  status: "pending" | "fired" | "snoozed" | "resolved" | "dismissed" | "cancelled";
  snooze_count: number;
}

export interface Alert {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  severity: "info" | "low" | "normal" | "high" | "warning" | "urgent" | "critical";
  ref_id?: string | null;
  created_at: string;
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
  if (err instanceof Error) {
    return new IpcError(err.message, "application", err);
  }
  return new IpcError(String(err), "application", err);
}

async function wrapInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
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

export const pomodoroApi = {
  start: (input: { kind: SessionKind; planned_min: number; task_id?: string | null }): Promise<PomodoroSession> =>
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
    repeat_kind: "none" | "daily" | "weekly" | "monthly";
    sound: "none" | "gentle" | "normal" | "urgent";
    task_id?: string | null;
  }): Promise<Reminder> =>
    wrapInvoke<Reminder>("reminders_create", { input }),

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

  resolve: (id: string): Promise<Alert> =>
    wrapInvoke<Alert>("alerts_resolve", { id }),

  snooze: (id: string): Promise<Alert> =>
    wrapInvoke<Alert>("alerts_snooze", { id }),

  dismiss: (id: string): Promise<Alert> =>
    wrapInvoke<Alert>("alerts_dismiss", { id }),
};

export const settingsApi = {
  getAll: (): Promise<[string, unknown][]> =>
    wrapInvoke<[string, unknown][]>("settings_get_all"),

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
};

export const ipc = {
  ping: () => wrapInvoke<string>("ping"),
  tasks: tasksApi,
  pomodoro: pomodoroApi,
  reminders: remindersApi,
  alerts: alertsApi,
  settings: settingsApi,
  dashboard: dashboardApi,
} as const;
