import { invoke } from "@tauri-apps/api/core";
import i18n from "./i18n";
import { ERROR_KEYS, errorMessage } from "./errors";
import { decodeZipTextEntries, encodeZipBase64 } from "./zip";
import type {
  AgentBotRecord,
  AgentExecutionSummary,
  AgentRunRecord,
  AgentSkillRecord,
  AgentsOverview,
  AgentToolEntry,
  ChatSession,
  ContextEventRecord,
  ContextInspection,
  HindsightBankStats,
  HindsightBankSummary,
  HindsightDirective,
  HindsightDocumentDetail,
  HindsightDocumentPage,
  HindsightEntityDetail,
  HindsightEntityPage,
  HindsightGalaxySnapshot,
  HindsightGlobalSearchHit,
  HindsightGraphPayload,
  HindsightMemoryDetail,
  HindsightMemoryHistoryEntry,
  HindsightMemoryPage,
  HindsightMentalModel,
  HindsightMentalModelPage,
  HindsightOperation,
  HindsightTag,
  InstallSkillInput,
  KnowledgeDocumentDetail,
  KnowledgeDocumentsResult,
  KnowledgeExplorerOverview,
  KnowledgeGraphPayload,
  KnowledgeSearchResult,
  McpPluginRecord,
  NormalizedPluginEvent,
  PrivatePluginAuditEntry,
  PrivatePluginManifest,
  PrivatePluginRecord,
  EventDispatchResult,
  ExecutePluginActionInput,
  SelectedCapability,
  UnifiedCapability,
  UpsertBotInput,
  UpsertMcpPluginInput,
} from "./auraTypes";
import { handleAuraBrowserIpc } from "./ipcBrowserAura";

export * from "./auraTypes";

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

export interface TaskReorderItem {
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
  decided_at?: string | null;
  decision_note?: string | null;
  result_ref_id?: string | null;
  decided_by?: string | null;
}

export interface IaCommandEntry {
  id: string;
  source: string;
  toolName: string;
  argsJson: string;
  resultStatus: string;
  resultMessage?: string | null;
  proposalId?: string | null;
  invokedAt: string;
}

export interface HermesStatus {
  available: boolean;
  binaryPath: string | null;
}

export interface HermesChatReply {
  requestId: string;
  mode: string;
  replyText: string;
  proposal: ProposalItem | null;
  streaming: boolean;
}

export interface HermesStreamEvent {
  requestId: string;
  chunk: string;
  done: boolean;
  isError: boolean;
}

export interface VoiceCaptureResult {
  filePath: string;
  bytes: number;
}

export type PlanState = "not_started" | "in_progress" | "completed" | "skipped";

export interface DailyPlan {
  id: string;
  plan_date: string;
  state: PlanState;
  started_at?: string | null;
  completed_at?: string | null;
  payload?: string | null;
  created_at?: string;
  updated_at?: string;
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

export interface AiProviderStatus {
  configuredProvider: string;
  activeProvider: string;
  model: string;
  baseUrl?: string | null;
  hasApiKey: boolean;
  hermesCliAvailable: boolean;
  codexCliAvailable: boolean;
  ready: boolean;
}

export interface PersistedChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  provider?: string | null;
  model?: string | null;
  areaId?: string | null;
  createdAt: string;
}

export interface RaglightStatus {
  enabled: boolean;
  mode: string;
  baseUrl: string;
  provider: string;
  embeddingModel: string;
  llmModel: string;
  vectorStore: string;
  folders: string[];
  hasApiKey: boolean;
  installed: boolean;
  running: boolean;
  managedPid?: number | null;
  venvPath: string;
  dbPath: string;
  pythonTool?: string | null;
}

export interface RaglightActionResult {
  ok: boolean;
  message: string;
  outputTail: string;
  status: RaglightStatus;
}

export interface RaglightQueryResult {
  answer: string;
  sources: string[];
}

export interface HindsightStatus {
  enabled: boolean;
  baseUrl: string;
  defaultBank: string;
  autoCreateBanks: boolean;
  dailyMaintenance: boolean;
  lastMaintenanceDate: string;
  online: boolean;
  banks: string[];
  localCount: number;
}

export interface HindsightRecallItem {
  id: string;
  bank: string;
  content: string;
  source: string;
  createdAt?: string | null;
}

export interface HindsightMaintenanceResult {
  ok: boolean;
  message: string;
  date: string;
  banksProcessed: number;
}

export interface MonitorInfo {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor: number;
  isPrimary: boolean;
}

export type MonitorFallbackStrategy = "primary_then_hide" | "primary" | "hide";

export interface DesktopStateSnapshot {
  monitors: MonitorInfo[];
  compactOpen: boolean;
  autostartEnabled: boolean;
  preferredMonitor: string;
  fallbackStrategy: MonitorFallbackStrategy | string;
}

export interface IdleStateSnapshot {
  idleSecs: number;
  thresholdSecs: number;
  isIdle: boolean;
  autoPausePomodoro: boolean;
  suppressRoutines: boolean;
  supported: boolean;
}

export type UpdateStatusKind =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "verifying"
  | "installing"
  | "up_to_date"
  | "error";

export interface UpdateStateSnapshot {
  status: UpdateStatusKind;
  currentVersion: string;
  latestVersion: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  assetName: string | null;
  progressPct: number;
  autoUpdateEnabled: boolean;
  lastCheckedAt: string | null;
  downloadedPath: string | null;
  errorMessage: string | null;
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
  iaCommands?: IaCommandEntry[];
  voiceCaptures?: Array<{ filePath: string; bytes: number; createdAt: string }>;
  settings: Record<string, unknown>;
  githubLinks?: GithubIssueLink[];
  metricsByDay?: Record<string, { waterCount: number; breakMin: number }>;
  chatSessions?: ChatSession[];
  chatMessages?: PersistedChatMessage[];
  contextEvents?: ContextEventRecord[];
  agentToolPolicies?: Record<string, { permission: string; enabled: boolean }>;
  agentRuns?: AgentRunRecord[];
  agentBots?: AgentBotRecord[];
  agentSkills?: AgentSkillRecord[];
  mcpPlugins?: McpPluginRecord[];
}

const STORAGE_KEY = "auradesk_browser_db_v1";

const DEFAULT_SETTINGS: Record<string, unknown> = {
  "app.version": "0.2.2",
  "app.theme": "dark",
  "app.locale": "pt-BR",
  "app.autostart": false,
  "updates.auto_update": true,
  "desktop.compact_mode": false,
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
  return encodeZipBase64(files);
}

function decodeBrowserZipBase64(zipBase64: string): Record<string, string> {
  try {
    return decodeZipTextEntries(zipBase64);
  } catch {
    throw new IpcError("errors.invalidBackup", "validation");
  }
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
        routines: Array.isArray(parsed.routines) ? parsed.routines : undefined,
        proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
        iaCommands: Array.isArray(parsed.iaCommands) ? parsed.iaCommands : [],
        voiceCaptures: Array.isArray(parsed.voiceCaptures) ? parsed.voiceCaptures : [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        githubLinks: Array.isArray(parsed.githubLinks) ? parsed.githubLinks : [],
        metricsByDay:
          parsed.metricsByDay && typeof parsed.metricsByDay === "object"
            ? parsed.metricsByDay
            : {},
        chatSessions: Array.isArray(parsed.chatSessions) ? parsed.chatSessions : undefined,
        chatMessages: Array.isArray(parsed.chatMessages) ? parsed.chatMessages : [],
        contextEvents: Array.isArray(parsed.contextEvents) ? parsed.contextEvents : [],
        agentToolPolicies:
          parsed.agentToolPolicies && typeof parsed.agentToolPolicies === "object"
            ? parsed.agentToolPolicies
            : {},
        agentRuns: Array.isArray(parsed.agentRuns) ? parsed.agentRuns : [],
        agentBots: Array.isArray(parsed.agentBots) ? parsed.agentBots : undefined,
        agentSkills: Array.isArray(parsed.agentSkills) ? parsed.agentSkills : undefined,
        mcpPlugins: Array.isArray(parsed.mcpPlugins) ? parsed.mcpPlugins : undefined,
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
    proposals: [],
    iaCommands: [],
    voiceCaptures: [],
    settings: { ...DEFAULT_SETTINGS },
    githubLinks: [],
    metricsByDay: {},
    chatMessages: [],
    contextEvents: [],
    agentToolPolicies: {},
    agentRuns: [],
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
  const pausedUntil = db.settings["reminders.paused_until"];
  if (typeof pausedUntil === "string") {
    const pausedMs = Date.parse(pausedUntil);
    if (!Number.isNaN(pausedMs) && pausedMs > nowMs) {
      return;
    }
  }
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

function applyTaskStatusTransition(
  task: Task,
  status: TaskStatus,
  kanbanOrder: number,
  nowIso: string
): void {
  task.status = status;
  task.kanban_order = kanbanOrder ?? task.kanban_order;
  if (status === "doing" && !task.started_at) {
    task.started_at = nowIso;
  }
  if (status === "done") {
    task.completed_at = nowIso;
  } else {
    task.completed_at = null;
  }
  task.updated_at = nowIso;
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

export function advanceCalendarMonthIso(baseIso: string, months = 1): string {
  const parsed = new Date(baseIso);
  const base = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const maxDayInTargetMonth = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(day, maxDayInTargetMonth);
  const next = new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      clampedDay,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds()
    )
  );
  return next.toISOString();
}

function recordBrowserIaCommand(
  db: BrowserDbState,
  entry: Omit<IaCommandEntry, "id" | "invokedAt">
): void {
  if (!Array.isArray(db.iaCommands)) db.iaCommands = [];
  db.iaCommands.unshift({
    id: genId(),
    ...entry,
    invokedAt: new Date().toISOString(),
  });
  if (db.iaCommands.length > 200) {
    db.iaCommands.length = 200;
  }
}

function stripAnyPrefix(trimmed: string, lower: string, prefixes: string[]): string | null {
  for (const p of prefixes) {
    if (lower.startsWith(p)) {
      const rest = trimmed.slice(p.length).trim();
      if (rest) return rest;
    }
  }
  return null;
}

function applyBrowserProposal(
  db: BrowserDbState,
  prop: ProposalItem,
  note: string | null,
  modifications: Record<string, unknown> | null,
  nowIso: string
): { proposal: ProposalItem; result_ref_id: string | null; result_kind: string } {
  if (prop.status !== "pending") {
    throw new Error("proposal is not pending");
  }
  const effectivePayload =
    modifications && typeof modifications === "object" && !Array.isArray(modifications)
      ? { ...prop.payload, ...modifications }
      : { ...prop.payload };

  let resultRefId: string | null = null;
  let resultKind = "none";

  if (prop.kind === "create_task") {
    const title = String(effectivePayload.title ?? "").trim();
    if (!title) throw new Error(ERROR_KEYS.taskTitleEmpty);
    const task: Task = {
      id: genId(),
      project_id: (effectivePayload.project_id as string | null) ?? null,
      parent_task_id: null,
      recurrence_id: null,
      title,
      description: (effectivePayload.description as string | null) ?? null,
      priority: (effectivePayload.priority as TaskPriority) ?? "normal",
      status: "todo",
      kanban_order: db.tasks.length,
      due_at: (effectivePayload.due_at as string | null) ?? null,
      started_at: null,
      completed_at: null,
      estimate_min: (effectivePayload.estimate_min as number | null) ?? null,
      actual_min: 0,
      tags: Array.isArray(effectivePayload.tags) ? (effectivePayload.tags as string[]) : null,
      created_at: nowIso,
      updated_at: nowIso,
    };
    db.tasks.unshift(task);
    resultRefId = task.id;
    resultKind = "task";
  } else if (prop.kind === "create_reminder") {
    const title = String(effectivePayload.title ?? "").trim();
    if (!title) throw new Error(ERROR_KEYS.reminderTitleRequired);
    const fireAt =
      typeof effectivePayload.fire_at === "string" && effectivePayload.fire_at
        ? effectivePayload.fire_at
        : new Date(Date.now() + 15 * 60_000).toISOString();
    const reminder: Reminder = {
      id: genId(),
      task_id: (effectivePayload.task_id as string | null) ?? null,
      title,
      body: (effectivePayload.body as string | null) ?? null,
      fire_at: fireAt,
      repeat_kind: "none",
      status: "pending",
      sound: (effectivePayload.sound as ReminderSound) ?? "normal",
      snooze_count: 0,
      created_at: nowIso,
      updated_at: nowIso,
    };
    db.reminders.unshift(reminder);
    resultRefId = reminder.id;
    resultKind = "reminder";
  }

  prop.status = "approved";
  prop.payload = effectivePayload;
  prop.decided_at = nowIso;
  prop.decision_note = note;
  prop.result_ref_id = resultRefId;
  prop.decided_by = "user";

  recordBrowserIaCommand(db, {
    source: "mcp",
    toolName: "approve_proposal",
    argsJson: JSON.stringify({ id: prop.id, note, modifications }),
    resultStatus: "ok",
    resultMessage: null,
    proposalId: prop.id,
  });

  return { proposal: prop, result_ref_id: resultRefId, result_kind: resultKind };
}

function runBrowserHermesPrompt(
  db: BrowserDbState,
  prompt: string,
  nowIso: string
): HermesChatReply {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const requestId = genId();
  if (!Array.isArray(db.proposals)) db.proposals = [];

  const expiresAt = new Date(Date.now() + 24 * 3_600_000).toISOString();

  const taskTitle = stripAnyPrefix(trimmed, lower, [
    "criar tarefa:",
    "criar tarefa ",
    "cria tarefa:",
    "cria tarefa ",
    "nova tarefa:",
    "nova tarefa ",
    "create task:",
    "create task ",
    "add task:",
    "add task ",
    "task:",
  ]);
  if (taskTitle) {
    const priority: TaskPriority =
      lower.includes("urgente") || lower.includes("urgent")
        ? "urgent"
        : lower.includes("alta") || lower.includes("high")
          ? "high"
          : "normal";
    const summary = i18n.t("hermes.proposalTaskSummary", { title: taskTitle });
    const prop: ProposalItem = {
      id: genId(),
      source: "hermes",
      kind: "create_task",
      payload: { title: taskTitle, priority },
      summary,
      status: "pending",
      created_at: nowIso,
      expires_at: expiresAt,
    };
    db.proposals.unshift(prop);
    recordBrowserIaCommand(db, {
      source: "hermes",
      toolName: "propose_create_task",
      argsJson: JSON.stringify(prop.payload),
      resultStatus: "ok",
      resultMessage: null,
      proposalId: prop.id,
    });
    return {
      requestId,
      mode: "local",
      replyText: i18n.t("hermes.proposalCreatedReply", { summary }),
      proposal: prop,
      streaming: false,
    };
  }

  const reminderTitle = stripAnyPrefix(trimmed, lower, [
    "criar lembrete:",
    "criar lembrete ",
    "lembrete:",
    "lembrete ",
    "me lembre de ",
    "me lembre ",
    "remind me to ",
    "remind me:",
    "remind me ",
    "create reminder:",
    "create reminder ",
  ]);
  if (reminderTitle) {
    const fireAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const summary = i18n.t("hermes.proposalReminderSummary", { title: reminderTitle });
    const prop: ProposalItem = {
      id: genId(),
      source: "hermes",
      kind: "create_reminder",
      payload: { title: reminderTitle, fire_at: fireAt, sound: "normal" },
      summary,
      status: "pending",
      created_at: nowIso,
      expires_at: expiresAt,
    };
    db.proposals.unshift(prop);
    recordBrowserIaCommand(db, {
      source: "hermes",
      toolName: "propose_create_reminder",
      argsJson: JSON.stringify(prop.payload),
      resultStatus: "ok",
      resultMessage: null,
      proposalId: prop.id,
    });
    return {
      requestId,
      mode: "local",
      replyText: i18n.t("hermes.proposalCreatedReply", { summary }),
      proposal: prop,
      streaming: false,
    };
  }

  if (lower.includes("resumo") || lower.includes("summary") || lower === "status") {
    const today = todayStr();
    const now = Date.now();
    const open = db.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
    const overdue = open.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length;
    const dueToday = open.filter((t) => t.due_at?.startsWith(today)).length;
    const inProgress = open.filter((t) => t.status === "doing").length;
    const focusMin = db.pomodoros
      .filter((s) => s.kind === "focus" && s.status === "completed" && s.started_at.startsWith(today))
      .reduce((acc, s) => acc + (s.actual_min ?? s.planned_min), 0);
    recordBrowserIaCommand(db, {
      source: "hermes",
      toolName: "get_today_overview",
      argsJson: "{}",
      resultStatus: "ok",
      resultMessage: null,
      proposalId: null,
    });
    return {
      requestId,
      mode: "local",
      replyText: i18n.t("hermes.overviewReply", {
        overdue,
        due_today: dueToday,
        in_progress: inProgress,
        focus_min: focusMin,
      }),
      proposal: null,
      streaming: false,
    };
  }

  return {
    requestId,
    mode: "local",
    replyText: i18n.t("hermes.helpReply"),
    proposal: null,
    streaming: false,
  };
}

/**
 * Voice service status for the browser build. The browser cannot manage
 * containers, so the neural voice is unavailable there; the UI falls back to
 * the OS `SpeechSynthesis` engine.
 */
function browserVoiceStatus(): VoiceServiceStatus {
  return {
    runtimeAvailable: false,
    runtime: null,
    serviceReady: false,
    containerRunning: false,
    imagePresent: false,
    baseUrl: "http://127.0.0.1:8925",
    image: "ghcr.io/remsky/kokoro-fastapi-cpu:latest",
    voiceCount: null,
    detail:
      "O serviço de voz local requer o aplicativo de desktop (o navegador não gerencia contêineres).",
    sttReady: false,
    sttBaseUrl: "http://127.0.0.1:9000",
    sttContainerRunning: false,
  };
}

async function invokeBrowserFallback(
  cmd: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const db = loadBrowserDb();
  pollOverdueBrowserReminders(db);
  const nowIso = new Date().toISOString();

  const auraHandled = await handleAuraBrowserIpc(cmd, {
    db,
    args,
    nowIso,
    genId,
    saveBrowserDb,
    runBrowserHermesPrompt,
  });
  if (auraHandled.handled) {
    return auraHandled.result;
  }

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
      applyTaskStatusTransition(task, input.status, input.kanban_order, nowIso);
      saveBrowserDb(db);
      return task;
    }

    case "tasks_reorder": {
      const items = (args.items ?? []) as TaskReorderItem[];
      if (!Array.isArray(items) || items.length === 0) {
        return [];
      }
      const matched: Array<{ task: Task; item: TaskReorderItem }> = [];
      for (const item of items) {
        const task = db.tasks.find((t) => t.id === item.id);
        if (!task) throw new IpcError(`Task not found: ${item.id}`, "application");
        matched.push({ task, item });
      }
      const updated = matched.map(({ task, item }) => {
        applyTaskStatusTransition(task, item.status, item.kanban_order, nowIso);
        return task;
      });
      saveBrowserDb(db);
      return updated;
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

    case "reminders_update": {
      const id = String(args.id ?? "");
      const patch = (args.patch ?? {}) as {
        title?: string | null;
        body?: string | null;
        fire_at?: string | null;
        repeat_kind?: RepeatKind | null;
        sound?: ReminderSound | null;
        status?: ReminderStatus | null;
      };
      const rem = db.reminders.find((r) => r.id === id);
      if (!rem) throw new IpcError(`Reminder not found: ${id}`, "application");
      if (typeof patch.title === "string") {
        const cleanTitle = patch.title.trim();
        if (!cleanTitle) throw new IpcError(errorMessage(ERROR_KEYS.reminderTitleRequired), "validation");
        rem.title = cleanTitle;
      }
      if (patch.body !== undefined) rem.body = patch.body;
      if (typeof patch.fire_at === "string" && patch.fire_at.trim()) rem.fire_at = patch.fire_at;
      if (patch.repeat_kind) rem.repeat_kind = patch.repeat_kind;
      if (patch.sound) rem.sound = patch.sound;
      if (patch.status) rem.status = patch.status;
      rem.updated_at = nowIso;
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
          } else if (rem.repeat_kind === "monthly") {
            const parsedFireMs = new Date(rem.fire_at).getTime();
            const baseIso = Number.isNaN(parsedFireMs) ? nowIso : rem.fire_at;
            rem.fire_at = advanceCalendarMonthIso(baseIso, 1);
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
      plan.payload =
        input.payload === null || input.payload === undefined
          ? null
          : serializeDailyPlanNotes(input.payload);
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

    case "alerts_emergency_unlock": {
      let dismissed = 0;
      for (const alert of db.alerts) {
        if (!alert.resolved_at) {
          alert.resolution = "dismissed";
          alert.resolved_at = nowIso;
          dismissed += 1;
        }
      }
      db.settings["reminders.block_screen"] = false;
      saveBrowserDb(db);
      return dismissed;
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
      const desktopBundle = {
        version: 2,
        exported_at: nowIso,
        projects: db.projects,
        tasks: db.tasks,
        pomodoros: db.pomodoros.map((p) => ({
          ...p,
          status: p.status === "active" ? "running" : p.status,
        })),
        reminders: db.reminders.map((r) => ({
          ...r,
          created_at: r.created_at ?? nowIso,
          updated_at: r.updated_at ?? nowIso,
        })),
        daily_plans: db.dailyPlans.map((dp) => ({
          ...dp,
          payload:
            dp.payload === null || dp.payload === undefined
              ? null
              : serializeDailyPlanNotes(dp.payload),
          created_at: dp.created_at ?? nowIso,
          updated_at: dp.updated_at ?? nowIso,
        })),
        settings: Object.entries(db.settings).map(([key, value]) => ({
          key,
          value: JSON.stringify(value),
          updated_at: nowIso,
        })),
        github_issues: db.githubLinks ?? [],
      };
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
        "bundle.json": JSON.stringify(desktopBundle, null, 2),
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

      const applySettingValue = (key: string, rawVal: unknown) => {
        if (!key) return;
        db.settings[key] = rawVal;
        importedSettings += 1;
      };

      if (files["settings.json"]) {
        const parsedSettings = JSON.parse(files["settings.json"]) as
          | Record<string, unknown>
          | Array<{ key: string; value: string }>;
        if (Array.isArray(parsedSettings)) {
          for (const item of parsedSettings) {
            if (item && typeof item.key === "string") {
              try {
                applySettingValue(item.key, JSON.parse(item.value));
              } catch {
                applySettingValue(item.key, item.value);
              }
            }
          }
        } else if (parsedSettings && typeof parsedSettings === "object") {
          for (const [k, v] of Object.entries(parsedSettings)) {
            applySettingValue(k, v);
          }
        }
      }

      const mergeById = <T extends { id: string }>(target: T[], incoming?: T[]) => {
        if (!Array.isArray(incoming)) return 0;
        const existingIds = new Set(target.map((x) => x.id));
        let added = 0;
        for (const item of incoming) {
          if (item && item.id && !existingIds.has(item.id)) {
            existingIds.add(item.id);
            target.push(item);
            added += 1;
          }
        }
        return added;
      };

      if (files["browser-state.json"]) {
        const st = JSON.parse(files["browser-state.json"]) as Partial<BrowserDbState>;
        importedProjects += mergeById(db.projects, st.projects);
        importedTasks += mergeById(db.tasks, st.tasks);
        importedPomodoros += mergeById(db.pomodoros, st.pomodoros);
        importedReminders += mergeById(db.reminders, st.reminders);
        importedPlans += mergeById(db.dailyPlans, st.dailyPlans);
        if (!db.githubLinks) db.githubLinks = [];
        importedGithub += mergeById(db.githubLinks, st.githubLinks);
      } else if (files["bundle.json"]) {
        const bundle = JSON.parse(files["bundle.json"]) as {
          projects?: Project[];
          tasks?: Task[];
          pomodoros?: PomodoroSession[];
          reminders?: Reminder[];
          daily_plans?: DailyPlan[];
          settings?: Array<{ key: string; value: string }>;
          github_issues?: GithubIssueLink[];
        };
        importedProjects += mergeById(db.projects, bundle.projects);
        importedTasks += mergeById(db.tasks, bundle.tasks);
        importedPomodoros += mergeById(db.pomodoros, bundle.pomodoros);
        importedReminders += mergeById(db.reminders, bundle.reminders);
        importedPlans += mergeById(db.dailyPlans, bundle.daily_plans);
        if (!db.githubLinks) db.githubLinks = [];
        importedGithub += mergeById(db.githubLinks, bundle.github_issues);
        if (!files["settings.json"] && Array.isArray(bundle.settings)) {
          for (const item of bundle.settings) {
            if (item && typeof item.key === "string") {
              try {
                applySettingValue(item.key, JSON.parse(item.value));
              } catch {
                applySettingValue(item.key, item.value);
              }
            }
          }
        }
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

    case "proposals_list_recent": {
      const limit = Number(args.limit ?? 50);
      return (db.proposals ?? []).slice(0, Math.max(1, limit));
    }

    case "proposals_approve": {
      const id = String(args.id ?? "");
      const note = (args.note as string | null | undefined) ?? null;
      const modifications = (args.modifications as Record<string, unknown> | null | undefined) ?? null;
      const prop = (db.proposals ?? []).find((p) => p.id === id);
      if (!prop) throw new Error("proposal not found");
      const res = applyBrowserProposal(db, prop, note, modifications, nowIso);
      saveBrowserDb(db);
      return res;
    }

    case "proposals_reject": {
      const id = String(args.id ?? "");
      const note = (args.note as string | null | undefined) ?? null;
      const prop = (db.proposals ?? []).find((p) => p.id === id);
      if (prop) {
        prop.status = "rejected";
        prop.decided_at = nowIso;
        prop.decision_note = note;
        prop.decided_by = "user";
        recordBrowserIaCommand(db, {
          source: "mcp",
          toolName: "reject_proposal",
          argsJson: JSON.stringify({ id, note }),
          resultStatus: "ok",
          resultMessage: null,
          proposalId: id,
        });
      }
      saveBrowserDb(db);
      return prop ?? null;
    }

    case "ia_commands_list": {
      const limit = Number(args.limit ?? 50);
      return (db.iaCommands ?? []).slice(0, Math.max(1, limit));
    }

    case "hermes_status":
      return { available: false, binaryPath: null } satisfies HermesStatus;

    case "ai_provider_status": {
      const configured = String(db.settings["ai.provider"] ?? "auto");
      const active = configured === "auto" ? "offline" : configured;
      const model = String(db.settings["ai.model"] ?? "") || active;
      const baseUrl = String(db.settings["ai.base_url"] ?? "") || null;
      const hasApiKey = Boolean(String(db.settings["ai.api_key"] ?? "").trim());
      return {
        configuredProvider: configured,
        activeProvider: active,
        model,
        baseUrl,
        hasApiKey,
        hermesCliAvailable: false,
        codexCliAvailable: false,
        ready: active === "offline" || active === "ollama" || hasApiKey,
      } satisfies AiProviderStatus;
    }

    case "raglight_status":
      return {
        enabled: Boolean(db.settings["raglight.enabled"]),
        mode: String(db.settings["raglight.mode"] ?? "managed_local"),
        baseUrl: String(db.settings["raglight.base_url"] ?? "http://127.0.0.1:8000"),
        provider: String(db.settings["raglight.provider"] ?? "ollama"),
        embeddingModel: String(db.settings["raglight.embedding_model"] ?? "nomic-embed-text"),
        llmModel: String(db.settings["raglight.llm_model"] ?? "qwen3:0.6b"),
        vectorStore: String(db.settings["raglight.vector_store"] ?? "chroma"),
        folders: String(db.settings["raglight.folders"] ?? "")
          .split(/[;\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        hasApiKey: Boolean(String(db.settings["raglight.api_key"] ?? "").trim()),
        installed: false,
        running: false,
        managedPid: null,
        venvPath: "browser-local://raglight/.venv",
        dbPath: "browser-local://raglight/db",
        pythonTool: null,
      } satisfies RaglightStatus;

    case "raglight_provision":
    case "raglight_start":
    case "raglight_stop":
    case "raglight_ingest":
      return {
        ok: false,
        message: "desktop_required",
        outputTail: "",
        status: {
          enabled: Boolean(db.settings["raglight.enabled"]),
          mode: String(db.settings["raglight.mode"] ?? "managed_local"),
          baseUrl: String(db.settings["raglight.base_url"] ?? "http://127.0.0.1:8000"),
          provider: String(db.settings["raglight.provider"] ?? "ollama"),
          embeddingModel: String(db.settings["raglight.embedding_model"] ?? "nomic-embed-text"),
          llmModel: String(db.settings["raglight.llm_model"] ?? "qwen3:0.6b"),
          vectorStore: String(db.settings["raglight.vector_store"] ?? "chroma"),
          folders: [],
          hasApiKey: false,
          installed: false,
          running: false,
          managedPid: null,
          venvPath: "browser-local://raglight/.venv",
          dbPath: "browser-local://raglight/db",
          pythonTool: null,
        },
      } satisfies RaglightActionResult;

    case "raglight_query":
      return { answer: "", sources: [] } satisfies RaglightQueryResult;

    case "desktop_pick_folder":
      return null;

    case "hindsight_run_maintenance": {
      const today = new Date().toISOString().slice(0, 10);
      db.settings["hindsight.last_maintenance_date"] = today;
      saveBrowserDb(db);
      return {
        ok: true,
        message: "maintenance_completed",
        date: today,
        banksProcessed: 1,
      } satisfies HindsightMaintenanceResult;
    }

    case "audio_capture_save": {
      const b64 = String(args.wavBase64 ?? args.wav_base64 ?? "").trim();
      if (!b64) throw new Error("empty audio payload");
      const rawHint = String(args.filename ?? "voice-note")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const stem = rawHint || "voice-note";
      const bytes = Math.max(1, Math.floor((b64.replace(/=+$/, "").length * 3) / 4));
      const filePath = `browser-local://voice-captures/${stem}-${Date.now()}.wav`;
      if (!Array.isArray(db.voiceCaptures)) db.voiceCaptures = [];
      db.voiceCaptures.unshift({ filePath, bytes, createdAt: nowIso });
      saveBrowserDb(db);
      return { filePath, bytes } satisfies VoiceCaptureResult;
    }

    case "voice_service_status":
      // The browser build cannot manage containers; the desktop app can.
      return browserVoiceStatus();

    case "voice_service_start":
      return {
        ok: false,
        message:
          "O provisionamento do serviço de voz exige o aplicativo de desktop.",
        status: browserVoiceStatus(),
      } satisfies VoiceServiceOutcome;

    case "voice_service_stop":
      return {
        ok: false,
        message: "O serviço de voz não é gerenciado no navegador.",
        status: browserVoiceStatus(),
      } satisfies VoiceServiceOutcome;

    case "desktop_list_monitors":
      return [
        {
          name: "display-primary",
          width: typeof window !== "undefined" ? window.screen.width || 1920 : 1920,
          height: typeof window !== "undefined" ? window.screen.height || 1080 : 1080,
          x: 0,
          y: 0,
          scaleFactor: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
          isPrimary: true,
        } satisfies MonitorInfo,
      ];

    case "desktop_apply_monitor_preference":
      return `placed:${String(db.settings["monitor.preferred"] ?? "primary")}`;

    case "desktop_toggle_compact": {
      const next =
        typeof args.enabled === "boolean"
          ? args.enabled
          : !Boolean(db.settings["desktop.compact_mode"]);
      db.settings["desktop.compact_mode"] = next;
      saveBrowserDb(db);
      return next;
    }

    case "desktop_show_main":
      return;

    case "desktop_set_tray_live_voice":
      return;

    case "desktop_set_autostart": {
      const enabled = Boolean(args.enabled);
      db.settings["app.autostart"] = enabled;
      saveBrowserDb(db);
      return enabled;
    }

    case "desktop_get_state":
      return {
        monitors: [
          {
            name: "display-primary",
            width: typeof window !== "undefined" ? window.screen.width || 1920 : 1920,
            height: typeof window !== "undefined" ? window.screen.height || 1080 : 1080,
            x: 0,
            y: 0,
            scaleFactor: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
            isPrimary: true,
          },
        ],
        compactOpen: Boolean(db.settings["desktop.compact_mode"]),
        autostartEnabled: Boolean(db.settings["app.autostart"]),
        preferredMonitor: String(db.settings["monitor.preferred"] ?? "primary"),
        fallbackStrategy: String(db.settings["monitor.fallback_strategy"] ?? "primary_then_hide"),
      } satisfies DesktopStateSnapshot;

    case "desktop_get_idle_state":
      return {
        idleSecs: 0,
        thresholdSecs: Math.max(1, Number(db.settings["desktop.idle_threshold_min"] ?? 5)) * 60,
        isIdle: false,
        autoPausePomodoro: db.settings["desktop.idle_auto_pause_pomodoro"] !== false,
        suppressRoutines: db.settings["desktop.idle_suppress_routines"] !== false,
        supported: false,
      } satisfies IdleStateSnapshot;

    case "updater_get_state":
      return {
        status: "idle",
        currentVersion: String(db.settings["app.version"] ?? "0.2.2"),
        latestVersion: null,
        releaseNotes: null,
        releaseUrl: null,
        assetName: null,
        progressPct: 0,
        autoUpdateEnabled: db.settings["updates.auto_update"] !== false,
        lastCheckedAt: null,
        downloadedPath: null,
        errorMessage: null,
      } satisfies UpdateStateSnapshot;

    case "updater_check_now":
    case "updater_install_now": {
      const version = String(db.settings["app.version"] ?? "0.2.2");
      return {
        status: "up_to_date",
        currentVersion: version,
        latestVersion: version,
        releaseNotes: null,
        releaseUrl: null,
        assetName: null,
        progressPct: 100,
        autoUpdateEnabled: db.settings["updates.auto_update"] !== false,
        lastCheckedAt: new Date().toISOString(),
        downloadedPath: null,
        errorMessage: null,
      } satisfies UpdateStateSnapshot;
    }

    case "app_open_logs_dir":
      return "browser://logs";

    case "app_get_logs_tail":
      return [];

    default:
      return null;
  }
}

async function wrapInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    try {
      return (await invokeBrowserFallback(cmd, args)) as T;
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

  reorder: (items: TaskReorderItem[]): Promise<Task[]> =>
    wrapInvoke<Task[]>("tasks_reorder", { items }),
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

  update: (
    id: string,
    patch: {
      title?: string;
      body?: string | null;
      fire_at?: string;
      repeat_kind?: RepeatKind;
      sound?: ReminderSound;
      status?: ReminderStatus;
    }
  ): Promise<Reminder> => wrapInvoke<Reminder>("reminders_update", { id, patch }),

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

  emergencyUnlock: (): Promise<number> =>
    wrapInvoke<number>("alerts_emergency_unlock"),
};

export const settingsApi = {
  getAll: (): Promise<[string, unknown][]> =>
    wrapInvoke<[string, unknown][]>("settings_get_all"),

  get: (key: string): Promise<unknown> =>
    wrapInvoke<unknown>("settings_get", { key }),

  set: (key: string, value: unknown): Promise<void> =>
    wrapInvoke<void>("settings_set", { input: { key, value } }),
};

export function serializeDailyPlanNotes(notes: string): string | null {
  const trimmed = notes.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object") {
        return notes;
      }
    } catch {
      // wrap non-JSON plain text in a JSON object for SQLite json_valid()
    }
  }
  return JSON.stringify({ notes });
}

export function parseDailyPlanNotes(payload: string | null | undefined): string {
  if (!payload) return "";
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed === "string") return parsed;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { notes?: unknown }).notes === "string"
    ) {
      return (parsed as { notes: string }).notes;
    }
    return payload;
  } catch {
    return payload;
  }
}

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
  listRecent: (limit = 50): Promise<ProposalItem[]> =>
    wrapInvoke<ProposalItem[]>("proposals_list_recent", { limit }),
  approve: (
    id: string,
    note?: string | null,
    modifications?: Record<string, unknown> | null
  ): Promise<unknown> =>
    wrapInvoke<unknown>("proposals_approve", {
      id,
      note: note ?? null,
      ...(modifications !== undefined ? { modifications } : {}),
    }),
  reject: (id: string, note?: string | null): Promise<unknown> =>
    wrapInvoke<unknown>("proposals_reject", { id, note: note ?? null }),
  listCommands: (limit = 50): Promise<IaCommandEntry[]> =>
    wrapInvoke<IaCommandEntry[]>("ia_commands_list", { limit }),
};

export const hermesApi = {
  status: (): Promise<HermesStatus> =>
    wrapInvoke<HermesStatus>("hermes_status"),
  sendMessage: (
    prompt: string,
    useCli = false,
    sessionId?: string | null
  ): Promise<HermesChatReply> =>
    wrapInvoke<HermesChatReply>("hermes_chat_send", {
      prompt,
      useCli,
      sessionId: sessionId ?? null,
    }),
  /**
   * Stops an in-flight reply. The CLI child is killed and the stream emits
   * its final `done` event, so the UI settles like a normal end.
   */
  cancel: (requestId: string): Promise<boolean> =>
    wrapInvoke<boolean>("hermes_chat_cancel", { requestId }),
};

export const aiApi = {
  providerStatus: (): Promise<AiProviderStatus> =>
    wrapInvoke<AiProviderStatus>("ai_provider_status"),
  chatHistory: (limit = 50, sessionId?: string | null): Promise<PersistedChatMessage[]> =>
    wrapInvoke<PersistedChatMessage[]>("ai_chat_history", {
      limit,
      sessionId: sessionId ?? null,
    }),
  chatClear: (sessionId?: string | null): Promise<number> =>
    wrapInvoke<number>("ai_chat_clear", { sessionId: sessionId ?? null }),
};

export const hindsightExploreApi = {
  banksList: (): Promise<HindsightBankSummary[]> =>
    wrapInvoke<HindsightBankSummary[]>("hindsight_banks_list"),
  bankCreate: (input: {
    bankId: string;
    name?: string | null;
    mission?: string | null;
    background?: string | null;
  }): Promise<HindsightBankSummary> =>
    wrapInvoke<HindsightBankSummary>("hindsight_bank_create", {
      bankId: input.bankId,
      name: input.name ?? null,
      mission: input.mission ?? null,
      background: input.background ?? null,
    }),
  /** Renames a bank or changes its mission/background. */
  bankUpdate: (input: {
    bankId: string;
    name?: string | null;
    mission?: string | null;
    background?: string | null;
  }): Promise<HindsightBankSummary> =>
    wrapInvoke<HindsightBankSummary>("hindsight_bank_update", {
      bankId: input.bankId,
      name: input.name ?? null,
      mission: input.mission ?? null,
      background: input.background ?? null,
    }),
  /** Deletes a bank and everything it holds. */
  bankDelete: (bankId: string): Promise<void> =>
    wrapInvoke<void>("hindsight_bank_delete", { bankId }),
  bankStats: (bank: string): Promise<HindsightBankStats> =>
    wrapInvoke<HindsightBankStats>("hindsight_bank_stats", { bank }),
  memoriesList: (
    bank: string,
    query?: string | null,
    limit?: number,
    offset?: number,
    factType?: string | null,
    tags?: string[]
  ): Promise<HindsightMemoryPage> =>
    wrapInvoke<HindsightMemoryPage>("hindsight_memories_list", {
      bank,
      query: query ?? null,
      factType: factType ?? null,
      tags: tags ?? [],
      limit: limit ?? null,
      offset: offset ?? null,
    }),
  memoryRetain: (input: {
    bank: string;
    content: string;
    context?: string | null;
    tags?: string[];
  }): Promise<unknown> =>
    wrapInvoke<unknown>("hindsight_memory_retain", {
      bank: input.bank,
      content: input.content,
      context: input.context ?? null,
      tags: input.tags ?? [],
    }),
  memoryGet: (bank: string, memoryId: string): Promise<HindsightMemoryDetail> =>
    wrapInvoke<HindsightMemoryDetail>("hindsight_memory_get", { bank, memoryId }),
  memoryHistory: (bank: string, memoryId: string): Promise<HindsightMemoryHistoryEntry[]> =>
    wrapInvoke<HindsightMemoryHistoryEntry[]>("hindsight_memory_history", {
      bank,
      memoryId,
    }),
  memoryUpdate: (input: {
    bank: string;
    memoryId: string;
    text?: string | null;
    context?: string | null;
    factType?: string | null;
  }): Promise<HindsightMemoryDetail> =>
    wrapInvoke<HindsightMemoryDetail>("hindsight_memory_update", {
      bank: input.bank,
      memoryId: input.memoryId,
      text: input.text ?? null,
      context: input.context ?? null,
      factType: input.factType ?? null,
    }),
  memoryInvalidate: (input: {
    bank: string;
    memoryId: string;
    reason?: string | null;
  }): Promise<HindsightMemoryDetail> =>
    wrapInvoke<HindsightMemoryDetail>("hindsight_memory_invalidate", {
      bank: input.bank,
      memoryId: input.memoryId,
      reason: input.reason ?? null,
    }),
  memoryRestore: (bank: string, memoryId: string): Promise<HindsightMemoryDetail> =>
    wrapInvoke<HindsightMemoryDetail>("hindsight_memory_restore", {
      bank,
      memoryId,
    }),
  memoriesClear: (bank: string, factType?: string | null): Promise<unknown> =>
    wrapInvoke<unknown>("hindsight_memories_clear", {
      bank,
      factType: factType ?? null,
    }),
  documentDelete: (bank: string, documentId: string): Promise<boolean> =>
    wrapInvoke<boolean>("hindsight_document_delete", { bank, documentId }),
  operationCancel: (bank: string, operationId: string): Promise<boolean> =>
    wrapInvoke<boolean>("hindsight_operation_cancel", { bank, operationId }),
  operationRetry: (bank: string, operationId: string): Promise<boolean> =>
    wrapInvoke<boolean>("hindsight_operation_retry", { bank, operationId }),
  tagsList: (
    bank: string,
    query?: string | null,
    limit?: number
  ): Promise<HindsightTag[]> =>
    wrapInvoke<HindsightTag[]>("hindsight_tags_list", {
      bank,
      query: query ?? null,
      limit: limit ?? null,
    }),
  documentsList: (
    bank: string,
    query?: string | null,
    limit?: number,
    offset?: number
  ): Promise<HindsightDocumentPage> =>
    wrapInvoke<HindsightDocumentPage>("hindsight_documents_list", {
      bank,
      query: query ?? null,
      limit: limit ?? null,
      offset: offset ?? null,
    }),
  documentGet: (bank: string, documentId: string): Promise<HindsightDocumentDetail> =>
    wrapInvoke<HindsightDocumentDetail>("hindsight_document_get", { bank, documentId }),
  entitiesList: (
    bank: string,
    limit?: number,
    offset?: number
  ): Promise<HindsightEntityPage> =>
    wrapInvoke<HindsightEntityPage>("hindsight_entities_list", {
      bank,
      limit: limit ?? null,
      offset: offset ?? null,
    }),
  entityGet: (bank: string, entityId: string): Promise<HindsightEntityDetail> =>
    wrapInvoke<HindsightEntityDetail>("hindsight_entity_get", { bank, entityId }),
  graph: (
    bank: string,
    limit?: number,
    query?: string | null,
    factType?: string | null
  ): Promise<HindsightGraphPayload> =>
    wrapInvoke<HindsightGraphPayload>("hindsight_graph", {
      bank,
      limit: limit ?? null,
      query: query ?? null,
      factType: factType ?? null,
    }),
  mentalModels: (bank: string, limit?: number): Promise<HindsightMentalModelPage> =>
    wrapInvoke<HindsightMentalModelPage>("hindsight_mental_models", {
      bank,
      limit: limit ?? null,
    }),
  mentalModelCreate: (input: {
    bank: string;
    name: string;
    sourceQuery: string;
    customId?: string | null;
    tags?: string[];
  }): Promise<HindsightMentalModel> =>
    wrapInvoke<HindsightMentalModel>("hindsight_mental_model_create", {
      bank: input.bank,
      name: input.name,
      sourceQuery: input.sourceQuery,
      customId: input.customId ?? null,
      tags: input.tags ?? [],
    }),
  mentalModelRefresh: (bank: string, modelId: string): Promise<unknown> =>
    wrapInvoke<unknown>("hindsight_mental_model_refresh", { bank, modelId }),
  mentalModelDelete: (bank: string, modelId: string): Promise<boolean> =>
    wrapInvoke<boolean>("hindsight_mental_model_delete", { bank, modelId }),
  directivesList: (bank: string): Promise<HindsightDirective[]> =>
    wrapInvoke<HindsightDirective[]>("hindsight_directives_list", { bank }),
  directiveCreate: (input: {
    bank: string;
    name: string;
    content: string;
    tags?: string[];
  }): Promise<HindsightDirective> =>
    wrapInvoke<HindsightDirective>("hindsight_directive_create", {
      bank: input.bank,
      name: input.name,
      content: input.content,
      tags: input.tags ?? [],
    }),
  directiveDelete: (bank: string, directiveId: string): Promise<boolean> =>
    wrapInvoke<boolean>("hindsight_directive_delete", { bank, directiveId }),
  operationsList: (bank: string, limit = 20): Promise<HindsightOperation[]> =>
    wrapInvoke<HindsightOperation[]>("hindsight_operations_list", { bank, limit }),
  bankConsolidate: (bank: string): Promise<unknown> =>
    wrapInvoke<unknown>("hindsight_bank_consolidate", { bank }),
  globalSearch: (
    query: string,
    bank?: string | null,
    factType?: string | null,
    limit?: number
  ): Promise<HindsightGlobalSearchHit[]> =>
    wrapInvoke<HindsightGlobalSearchHit[]>("hindsight_global_search", {
      query,
      bank: bank ?? null,
      factType: factType ?? null,
      limit: limit ?? null,
    }),
  galaxySnapshot: (
    bankFilter?: string | null,
    limitPerBank?: number
  ): Promise<HindsightGalaxySnapshot> =>
    wrapInvoke<HindsightGalaxySnapshot>("hindsight_galaxy_snapshot", {
      bankFilter: bankFilter ?? null,
      limitPerBank: limitPerBank ?? null,
    }),
};

export const knowledgeApi = {
  overview: (): Promise<KnowledgeExplorerOverview> =>
    wrapInvoke<KnowledgeExplorerOverview>("knowledge_overview"),
  documentsList: (
    query?: string | null,
    limit?: number
  ): Promise<KnowledgeDocumentsResult> =>
    wrapInvoke<KnowledgeDocumentsResult>("knowledge_documents_list", {
      query: query ?? null,
      limit: limit ?? null,
    }),
  documentGet: (docId: string): Promise<KnowledgeDocumentDetail> =>
    wrapInvoke<KnowledgeDocumentDetail>("knowledge_document_get", { docId }),
  graph: (
    label?: string | null,
    query?: string | null,
    limit?: number
  ): Promise<KnowledgeGraphPayload> =>
    wrapInvoke<KnowledgeGraphPayload>("knowledge_graph", {
      label: label ?? null,
      query: query ?? null,
      limit: limit ?? null,
    }),
  search: (query: string, topK?: number): Promise<KnowledgeSearchResult> =>
    wrapInvoke<KnowledgeSearchResult>("knowledge_search", {
      query,
      topK: topK ?? null,
    }),
};

export const sessionsApi = {
  list: (
    query?: string | null,
    status?: string | null,
    dateFrom?: string | null,
    dateTo?: string | null
  ): Promise<ChatSession[]> =>
    wrapInvoke<ChatSession[]>("chat_sessions_list", {
      query: query ?? null,
      status: status ?? null,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
    }),
  create: (title?: string | null): Promise<ChatSession> =>
    wrapInvoke<ChatSession>("chat_sessions_create", { title: title ?? null }),
  get: (sessionId: string): Promise<ChatSession | null> =>
    wrapInvoke<ChatSession | null>("chat_sessions_get", { sessionId }),
  rename: (sessionId: string, title: string): Promise<ChatSession> =>
    wrapInvoke<ChatSession>("chat_sessions_rename", { sessionId, title }),
  setStatus: (sessionId: string, status: string): Promise<ChatSession> =>
    wrapInvoke<ChatSession>("chat_sessions_set_status", { sessionId, status }),
  delete: (sessionId: string): Promise<void> =>
    wrapInvoke<void>("chat_sessions_delete", { sessionId }),
};

export const contextEngineApi = {
  inspect: (sessionId?: string | null): Promise<ContextInspection> =>
    wrapInvoke<ContextInspection>("context_engine_inspect", {
      sessionId: sessionId ?? null,
    }),
  compress: (sessionId?: string | null, reason?: string | null): Promise<ContextInspection> =>
    wrapInvoke<ContextInspection>("context_engine_compress", {
      sessionId: sessionId ?? null,
      reason: reason ?? null,
    }),
};

export const agentsApi = {
  overview: (): Promise<AgentsOverview> =>
    wrapInvoke<AgentsOverview>("agents_overview"),
  setToolPolicy: (
    toolName: string,
    permission: string,
    enabled: boolean
  ): Promise<AgentToolEntry> =>
    wrapInvoke<AgentToolEntry>("agents_set_tool_policy", {
      toolName,
      permission,
      enabled,
    }),
  planPreview: (goal: string, sessionId?: string | null): Promise<AgentRunRecord> =>
    wrapInvoke<AgentRunRecord>("agents_plan_preview", {
      goal,
      sessionId: sessionId ?? null,
    }),
  executeRun: (runId: string): Promise<AgentExecutionSummary> =>
    wrapInvoke<AgentExecutionSummary>("agents_run_execute", { runId }),
  resumeRun: (runId: string): Promise<AgentExecutionSummary> =>
    wrapInvoke<AgentExecutionSummary>("agents_run_resume", { runId }),
  listCapabilities: (): Promise<UnifiedCapability[]> =>
    wrapInvoke<UnifiedCapability[]>("agents_capabilities_list"),
  selectCapabilities: (intent: string, maxTools = 5): Promise<SelectedCapability[]> =>
    wrapInvoke<SelectedCapability[]>("agents_capabilities_select", { intent, maxTools }),
  listBots: (): Promise<AgentBotRecord[]> =>
    wrapInvoke<AgentBotRecord[]>("agents_bots_list"),
  upsertBot: (input: UpsertBotInput): Promise<AgentBotRecord> =>
    wrapInvoke<AgentBotRecord>("agents_bots_upsert", { input }),
  deleteBot: (botId: string): Promise<void> =>
    wrapInvoke<void>("agents_bots_delete", { botId }),
  listSkills: (): Promise<AgentSkillRecord[]> =>
    wrapInvoke<AgentSkillRecord[]>("agents_skills_list"),
  installSkill: (input: InstallSkillInput): Promise<AgentSkillRecord> =>
    wrapInvoke<AgentSkillRecord>("agents_skills_install", { input }),
  importLocalSkills: (): Promise<AgentSkillRecord[]> =>
    wrapInvoke<AgentSkillRecord[]>("agents_skills_import_local"),
  toggleSkill: (skillId: string, enabled: boolean): Promise<AgentSkillRecord> =>
    wrapInvoke<AgentSkillRecord>("agents_skills_toggle", { skillId, enabled }),
  deleteSkill: (skillId: string): Promise<void> =>
    wrapInvoke<void>("agents_skills_delete", { skillId }),
  listMcpPlugins: (): Promise<McpPluginRecord[]> =>
    wrapInvoke<McpPluginRecord[]>("agents_mcp_plugins_list"),
  upsertMcpPlugin: (input: UpsertMcpPluginInput): Promise<McpPluginRecord> =>
    wrapInvoke<McpPluginRecord>("agents_mcp_plugins_upsert", { input }),
  testMcpPlugin: (pluginId: string): Promise<McpPluginRecord> =>
    wrapInvoke<McpPluginRecord>("agents_mcp_plugins_test", { pluginId }),
  deleteMcpPlugin: (pluginId: string): Promise<void> =>
    wrapInvoke<void>("agents_mcp_plugins_delete", { pluginId }),
};

export const raglightApi = {
  status: (): Promise<RaglightStatus> =>
    wrapInvoke<RaglightStatus>("raglight_status"),
  provision: (): Promise<RaglightActionResult> =>
    wrapInvoke<RaglightActionResult>("raglight_provision"),
  start: (): Promise<RaglightActionResult> =>
    wrapInvoke<RaglightActionResult>("raglight_start"),
  stop: (): Promise<RaglightActionResult> =>
    wrapInvoke<RaglightActionResult>("raglight_stop"),
  ingest: (): Promise<RaglightActionResult> =>
    wrapInvoke<RaglightActionResult>("raglight_ingest"),
  query: (query: string, topK = 5): Promise<RaglightQueryResult> =>
    wrapInvoke<RaglightQueryResult>("raglight_query", { query, topK }),
};

export const hindsightApi = {
  status: (): Promise<HindsightStatus> =>
    wrapInvoke<HindsightStatus>("hindsight_status"),
  runMaintenance: (): Promise<HindsightMaintenanceResult> =>
    wrapInvoke<HindsightMaintenanceResult>("hindsight_run_maintenance"),
  recall: (query: string, bank?: string | null, limit = 8): Promise<HindsightRecallItem[]> =>
    wrapInvoke<HindsightRecallItem[]>("hindsight_recall", {
      query,
      bank: bank ?? null,
      limit,
    }),
};

export const audioApi = {
  saveVoiceCapture: (
    wavBase64: string,
    filename?: string | null
  ): Promise<VoiceCaptureResult> =>
    wrapInvoke<VoiceCaptureResult>("audio_capture_save", {
      wavBase64,
      filename: filename ?? null,
    }),
};

/** Status of the local voice stack (Kokoro in Podman). */
export interface VoiceServiceStatus {
  runtimeAvailable: boolean;
  runtime: string | null;
  serviceReady: boolean;
  containerRunning: boolean;
  imagePresent: boolean;
  baseUrl: string;
  image: string;
  voiceCount: number | null;
  detail: string | null;
  /** True when the local Whisper speech-to-text service is reachable. */
  sttReady: boolean;
  /** Base URL of the speech-to-text service (loopback). */
  sttBaseUrl: string;
  /** True when the Whisper container is running. */
  sttContainerRunning: boolean;
}

/** Result of a provisioning attempt on the voice service. */
export interface VoiceServiceOutcome {
  ok: boolean;
  message: string;
  status: VoiceServiceStatus;
}

/** Progress event emitted while the voice stack is provisioned. */
export interface VoiceServiceProgress {
  stage: string;
  message: string;
  status: VoiceServiceStatus;
}

export const voiceApi = {
  status: (): Promise<VoiceServiceStatus> =>
    wrapInvoke<VoiceServiceStatus>("voice_service_status"),

  start: (): Promise<VoiceServiceOutcome> =>
    wrapInvoke<VoiceServiceOutcome>("voice_service_start"),

  stop: (): Promise<VoiceServiceOutcome> =>
    wrapInvoke<VoiceServiceOutcome>("voice_service_stop"),
};

export const desktopApi = {
  listMonitors: (): Promise<MonitorInfo[]> =>
    wrapInvoke<MonitorInfo[]>("desktop_list_monitors"),
  applyMonitorPreference: (reveal = false): Promise<string> =>
    wrapInvoke<string>("desktop_apply_monitor_preference", { reveal }),
  toggleCompact: (enabled?: boolean): Promise<boolean> =>
    wrapInvoke<boolean>("desktop_toggle_compact", { enabled: enabled ?? null }),
  showMain: (): Promise<void> => wrapInvoke<void>("desktop_show_main"),
  setTrayLiveVoice: (active: boolean): Promise<void> =>
    wrapInvoke<void>("desktop_set_tray_live_voice", { active }),
  getState: (): Promise<DesktopStateSnapshot> =>
    wrapInvoke<DesktopStateSnapshot>("desktop_get_state"),
  setAutostart: (enabled: boolean): Promise<boolean> =>
    wrapInvoke<boolean>("desktop_set_autostart", { enabled }),
  getIdleState: (): Promise<IdleStateSnapshot> =>
    wrapInvoke<IdleStateSnapshot>("desktop_get_idle_state"),
  pickFolder: (): Promise<string | null> =>
    wrapInvoke<string | null>("desktop_pick_folder"),
};

export const updaterApi = {
  getState: (): Promise<UpdateStateSnapshot> =>
    wrapInvoke<UpdateStateSnapshot>("updater_get_state"),
  checkNow: (autoInstall?: boolean): Promise<UpdateStateSnapshot> =>
    wrapInvoke<UpdateStateSnapshot>("updater_check_now", {
      autoInstall: autoInstall ?? null,
    }),
  installNow: (): Promise<UpdateStateSnapshot> =>
    wrapInvoke<UpdateStateSnapshot>("updater_install_now"),
  openLogsDir: (): Promise<string> => wrapInvoke<string>("app_open_logs_dir"),
  getLogsTail: (limit = 80): Promise<string[]> =>
    wrapInvoke<string[]>("app_get_logs_tail", { limit }),
};

export const privatePluginsApi = {
  list: (): Promise<PrivatePluginRecord[]> =>
    wrapInvoke<PrivatePluginRecord[]>("plugins_list"),
  discover: (): Promise<PrivatePluginManifest[]> =>
    wrapInvoke<PrivatePluginManifest[]>("plugins_discover"),
  install: (path: string): Promise<PrivatePluginRecord> =>
    wrapInvoke<PrivatePluginRecord>("plugins_install", { path }),
  setEnabled: (pluginId: string, enabled: boolean): Promise<void> =>
    wrapInvoke<void>("plugins_set_enabled", { pluginId, enabled }),
  setPermission: (
    pluginId: string,
    permission: string,
    granted: boolean
  ): Promise<void> =>
    wrapInvoke<void>("plugins_set_permission", {
      pluginId,
      permission,
      granted,
    }),
  setSecret: (
    pluginId: string,
    secretKey: string,
    secretValue: string
  ): Promise<void> =>
    wrapInvoke<void>("plugins_set_secret", {
      pluginId,
      secretKey,
      secretValue,
    }),
  hasSecret: (pluginId: string, secretKey: string): Promise<boolean> =>
    wrapInvoke<boolean>("plugins_has_secret", { pluginId, secretKey }),
  executeAction: (input: ExecutePluginActionInput): Promise<unknown> =>
    wrapInvoke<unknown>("plugins_execute_action", { input }),
  ingestEvent: (event: NormalizedPluginEvent): Promise<EventDispatchResult> =>
    wrapInvoke<EventDispatchResult>("plugins_ingest_event", { event }),
  auditLog: (
    pluginId?: string,
    limit = 50
  ): Promise<PrivatePluginAuditEntry[]> =>
    wrapInvoke<PrivatePluginAuditEntry[]>("plugins_audit_log", {
      pluginId,
      limit,
    }),
  recentEvents: (limit = 50): Promise<NormalizedPluginEvent[]> =>
    wrapInvoke<NormalizedPluginEvent[]>("plugins_recent_events", { limit }),
  uninstall: (pluginId: string): Promise<void> =>
    wrapInvoke<void>("plugins_uninstall", { pluginId }),
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
  hermes: hermesApi,
  hindsightExplore: hindsightExploreApi,
  knowledge: knowledgeApi,
  sessions: sessionsApi,
  contextEngine: contextEngineApi,
  agents: agentsApi,
  plugins: privatePluginsApi,
  audio: audioApi,
  voice: voiceApi,
  desktop: desktopApi,
  updater: updaterApi,
} as const;
