import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IpcError,
  ipc,
  settingsApi,
  tasksApi,
  toIpcError,
  type CreateTaskInput,
  type SetStatusInput,
  type Task,
  type TaskFilter,
  type UpdateTaskInput,
} from "./ipc";

// Mock Tauri core invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

describe("IpcError and toIpcError", () => {
  it("creates an IpcError with default kind and preserves properties", () => {
    const cause = new Error("inner");
    const err = new IpcError("failed operation", "validation", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(IpcError);
    expect(err.name).toBe("IpcError");
    expect(err.message).toBe("failed operation");
    expect(err.kind).toBe("validation");
    expect(err.cause).toBe(cause);
  });

  it("returns the exact instance if already an IpcError", () => {
    const existing = new IpcError("already ipc error", "transport");
    expect(toIpcError(existing)).toBe(existing);
  });

  it("maps Error instances to appropriate kinds based on message", () => {
    const valErr = toIpcError(new Error("Validation failed for title"));
    expect(valErr.kind).toBe("validation");

    const netErr = toIpcError(new Error("Network failed to fetch"));
    expect(netErr.kind).toBe("transport");

    const appErr = toIpcError(new Error("Record not found in database"));
    expect(appErr.kind).toBe("application");
  });

  it("maps string errors to appropriate kinds", () => {
    const valStr = toIpcError("schema mismatch detected");
    expect(valStr.kind).toBe("validation");
    expect(valStr.message).toBe("schema mismatch detected");

    const netStr = toIpcError("connection lost");
    expect(netStr.kind).toBe("transport");

    const appStr = toIpcError("unexpected task state");
    expect(appStr.kind).toBe("application");
  });

  it("maps non-string non-Error values gracefully", () => {
    const numErr = toIpcError(500);
    expect(numErr.kind).toBe("transport");
    expect(numErr.message).toBe("500");
  });
});

describe("tasksApi", () => {
  const dummyTask: Task = {
    id: "task-1",
    title: "Write documentation",
    priority: "normal",
    status: "todo",
    kanbanOrder: 1,
    createdAt: "2026-11-06T00:00:00Z",
    updatedAt: "2026-11-06T00:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls tasks_list with or without filter", async () => {
    mockInvoke.mockResolvedValueOnce([dummyTask]);
    const resWithoutFilter = await tasksApi.list();
    expect(mockInvoke).toHaveBeenCalledWith("tasks_list", undefined);
    expect(resWithoutFilter).toEqual([dummyTask]);

    const filter: TaskFilter = { status: "doing", overdue: true };
    mockInvoke.mockResolvedValueOnce([dummyTask]);
    const resWithFilter = await tasksApi.list(filter);
    expect(mockInvoke).toHaveBeenCalledWith("tasks_list", { filter });
    expect(resWithFilter).toEqual([dummyTask]);
  });

  it("calls tasks_get with id", async () => {
    mockInvoke.mockResolvedValueOnce(dummyTask);
    const res = await tasksApi.get("task-1");
    expect(mockInvoke).toHaveBeenCalledWith("tasks_get", { id: "task-1" });
    expect(res).toEqual(dummyTask);
  });

  it("calls tasks_create with input", async () => {
    const input: CreateTaskInput = {
      title: "New task",
      priority: "high",
    };
    mockInvoke.mockResolvedValueOnce({ ...dummyTask, title: "New task", priority: "high" });
    const res = await tasksApi.create(input);
    expect(mockInvoke).toHaveBeenCalledWith("tasks_create", { input });
    expect(res.title).toBe("New task");
  });

  it("calls tasks_update with id and patch", async () => {
    const patch: UpdateTaskInput = { title: "Updated title" };
    mockInvoke.mockResolvedValueOnce({ ...dummyTask, title: "Updated title" });
    const res = await tasksApi.update("task-1", patch);
    expect(mockInvoke).toHaveBeenCalledWith("tasks_update", { id: "task-1", patch });
    expect(res.title).toBe("Updated title");
  });

  it("calls tasks_delete with id", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await tasksApi.delete("task-1");
    expect(mockInvoke).toHaveBeenCalledWith("tasks_delete", { id: "task-1" });
  });

  it("calls tasks_set_status with input", async () => {
    const input: SetStatusInput = {
      id: "task-1",
      status: "done",
      kanbanOrder: 2,
    };
    mockInvoke.mockResolvedValueOnce({ ...dummyTask, status: "done", kanbanOrder: 2 });
    const res = await tasksApi.setStatus(input);
    expect(mockInvoke).toHaveBeenCalledWith("tasks_set_status", { input });
    expect(res.status).toBe("done");
  });

  it("wraps invocation errors in IpcError", async () => {
    mockInvoke.mockRejectedValueOnce("database error");
    await expect(tasksApi.get("task-404")).rejects.toThrow(IpcError);
  });
});

describe("settingsApi and ipc object", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls settings_get_all and returns entries", async () => {
    const entries: [string, unknown][] = [["app.locale", "pt-BR"]];
    mockInvoke.mockResolvedValueOnce(entries);
    const res = await settingsApi.getAll();
    expect(mockInvoke).toHaveBeenCalledWith("settings_get_all", undefined);
    expect(res).toEqual(entries);
  });

  it("calls settings_get with key", async () => {
    mockInvoke.mockResolvedValueOnce("pt-BR");
    const res = await settingsApi.get("app.locale");
    expect(mockInvoke).toHaveBeenCalledWith("settings_get", { key: "app.locale" });
    expect(res).toBe("pt-BR");
  });

  it("calls settings_set with key and value wrapped in input", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await settingsApi.set("app.theme", "dark");
    expect(mockInvoke).toHaveBeenCalledWith("settings_set", {
      input: { key: "app.theme", value: "dark" },
    });
  });

  it("ipc.ping roundtrips a pong response", async () => {
    mockInvoke.mockResolvedValueOnce("pong");
    const res = await ipc.ping();
    expect(mockInvoke).toHaveBeenCalledWith("ping", undefined);
    expect(res).toBe("pong");
  });
});
