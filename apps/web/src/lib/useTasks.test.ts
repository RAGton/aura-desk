import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcError, tasksApi, type Task, type TaskFilter } from "./ipc";
import { useTasks } from "./useTasks";

vi.mock("./ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ipc")>();
  return {
    ...actual,
    tasksApi: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      setStatus: vi.fn(),
    },
  };
});

const mockTasksApi = vi.mocked(tasksApi);

describe("useTasks hook", () => {
  const sampleTasks: Task[] = [
    {
      id: "task-1",
      title: "First Task",
      priority: "normal",
      status: "todo",
      kanban_order: 0,
      created_at: "2026-11-06T00:00:00Z",
      updated_at: "2026-11-06T00:00:00Z",
    },
    {
      id: "task-2",
      title: "Second Task",
      priority: "high",
      status: "doing",
      kanban_order: 1,
      created_at: "2026-11-06T00:00:00Z",
      updated_at: "2026-11-06T00:00:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches tasks on initial mount and sets loading state", async () => {
    mockTasksApi.list.mockResolvedValueOnce(sampleTasks);

    const { result } = renderHook(() => useTasks());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tasks).toEqual(sampleTasks);
    expect(result.current.error).toBeNull();
    expect(mockTasksApi.list).toHaveBeenCalledWith({});
  });

  it("captures and exposes errors when tasksApi.list fails", async () => {
    mockTasksApi.list.mockRejectedValueOnce(
      new IpcError("Failed to fetch tasks", "application")
    );

    const { result } = renderHook(() => useTasks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tasks).toEqual([]);
    expect(result.current.error).toBe("Failed to fetch tasks");
  });

  it("creates a task and re-fetches the list", async () => {
    mockTasksApi.list
      .mockResolvedValueOnce([sampleTasks[0]])
      .mockResolvedValueOnce(sampleTasks);
    mockTasksApi.create.mockResolvedValueOnce(sampleTasks[1]);

    const { result } = renderHook(() => useTasks());

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(1);
    });

    let created: Task | undefined;
    await act(async () => {
      created = await result.current.create({
        title: "Second Task",
        priority: "high",
      });
    });

    expect(mockTasksApi.create).toHaveBeenCalledWith({
      title: "Second Task",
      priority: "high",
    });
    expect(created).toEqual(sampleTasks[1]);
    expect(result.current.tasks).toEqual(sampleTasks);
  });

  it("updates a task and re-fetches the list", async () => {
    const updatedTask: Task = { ...sampleTasks[0], title: "Updated Title" };
    mockTasksApi.list
      .mockResolvedValueOnce(sampleTasks)
      .mockResolvedValueOnce([updatedTask, sampleTasks[1]]);
    mockTasksApi.update.mockResolvedValueOnce(updatedTask);

    const { result } = renderHook(() => useTasks());

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(2);
    });

    let res: Task | undefined;
    await act(async () => {
      res = await result.current.update("task-1", { title: "Updated Title" });
    });

    expect(mockTasksApi.update).toHaveBeenCalledWith("task-1", {
      title: "Updated Title",
    });
    expect(res?.title).toBe("Updated Title");
  });

  it("removes a task and re-fetches the list", async () => {
    mockTasksApi.list
      .mockResolvedValueOnce(sampleTasks)
      .mockResolvedValueOnce([sampleTasks[1]]);
    mockTasksApi.delete.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useTasks());

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(2);
    });

    await act(async () => {
      await result.current.remove("task-1");
    });

    expect(mockTasksApi.delete).toHaveBeenCalledWith("task-1");
    expect(result.current.tasks).toHaveLength(1);
  });

  it("sets status and re-fetches the list", async () => {
    const movedTask: Task = { ...sampleTasks[0], status: "done", kanban_order: 3 };
    mockTasksApi.list
      .mockResolvedValueOnce(sampleTasks)
      .mockResolvedValueOnce([movedTask, sampleTasks[1]]);
    mockTasksApi.setStatus.mockResolvedValueOnce(movedTask);

    const { result } = renderHook(() => useTasks());

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(2);
    });

    let res: Task | undefined;
    await act(async () => {
      res = await result.current.setStatus({
        id: "task-1",
        status: "done",
        kanban_order: 3,
      });
    });

    expect(mockTasksApi.setStatus).toHaveBeenCalledWith({
      id: "task-1",
      status: "done",
      kanban_order: 3,
    });
    expect(res?.status).toBe("done");
  });

  it("re-fetches automatically when filter changes", async () => {
    mockTasksApi.list.mockResolvedValue(sampleTasks);

    let filter: TaskFilter = { status: "todo" };
    const { rerender } = renderHook((props: { filter: TaskFilter }) => useTasks(props.filter), {
      initialProps: { filter },
    });

    await waitFor(() => {
      expect(mockTasksApi.list).toHaveBeenCalledWith({ status: "todo" });
    });

    filter = { status: "done" };
    rerender({ filter });

    await waitFor(() => {
      expect(mockTasksApi.list).toHaveBeenCalledWith({ status: "done" });
    });
  });
});
