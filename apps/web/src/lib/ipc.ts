import { invoke } from "@tauri-apps/api/core";

export type TaskStatus = "todo" | "doing" | "waiting" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface Task {
  id: string;
  projectId?: string | null;
  parentTaskId?: string | null;
  recurrenceId?: string | null;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  kanbanOrder: number;
  dueAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  estimateMin?: number | null;
  actualMin?: number | null;
  tags?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFilter {
  status?: TaskStatus;
  projectId?: string;
  overdue?: boolean;
  topLevelOnly?: boolean;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  projectId?: string;
  parentTaskId?: string;
  dueAt?: string;
  estimateMin?: number;
  tags?: string[];
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
  kanbanOrder: number;
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
    const msg = err.message.toLowerCase();
    const kind: IpcErrorKind =
      msg.includes("invalid") || msg.includes("validation") || msg.includes("schema")
        ? "validation"
        : msg.includes("network") || msg.includes("transport") || msg.includes("failed to fetch")
          ? "transport"
          : "application";
    return new IpcError(err.message, kind, err);
  }
  if (typeof err === "string") {
    const msg = err.toLowerCase();
    const kind: IpcErrorKind =
      msg.includes("invalid") || msg.includes("validation") || msg.includes("schema")
        ? "validation"
        : msg.includes("network") || msg.includes("transport") || msg.includes("connection")
          ? "transport"
          : "application";
    return new IpcError(err, kind);
  }
  return new IpcError(String(err), "transport", err);
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

export const settingsApi = {
  getAll: (): Promise<[string, unknown][]> =>
    wrapInvoke<[string, unknown][]>("settings_get_all"),

  get: (key: string): Promise<unknown> =>
    wrapInvoke<unknown>("settings_get", { key }),

  set: (key: string, value: unknown): Promise<void> =>
    wrapInvoke<void>("settings_set", { input: { key, value } }),
};

export const ipc = {
  ping: () => wrapInvoke<string>("ping"),
  tasks: tasksApi,
  settings: settingsApi,
} as const;
