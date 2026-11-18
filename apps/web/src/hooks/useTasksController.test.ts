import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../lib/i18n";
import { useTasksController } from "./useTasksController";
import type { Task } from "../lib/ipc";

vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return {
    ...actual,
    tasksApi: {
      ...actual.tasksApi,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      setStatus: vi.fn(),
      reorder: vi.fn(),
    },
    projectsApi: {
      ...actual.projectsApi,
      create: vi.fn(),
    },
    githubApi: {
      ...actual.githubApi,
      syncIssues: vi.fn(),
      unlinkTask: vi.fn(),
    },
  };
});

import { githubApi, projectsApi, tasksApi } from "../lib/ipc";

const mockTasksApi = vi.mocked(tasksApi);
const mockProjectsApi = vi.mocked(projectsApi);
const mockGithubApi = vi.mocked(githubApi);

function makeTask(partial: Partial<Task>): Task {
  return {
    id: partial.id ?? "t1",
    project_id: partial.project_id ?? null,
    parent_task_id: null,
    recurrence_id: null,
    title: partial.title ?? "Task",
    description: null,
    priority: partial.priority ?? "normal",
    status: partial.status ?? "todo",
    kanban_order: partial.kanban_order ?? 0,
    due_at: null,
    started_at: null,
    completed_at: null,
    estimate_min: null,
    actual_min: null,
    tags: [],
    created_at: "2026-11-17T10:00:00Z",
    updated_at: "2026-11-17T10:00:00Z",
  };
}

describe("useTasksController", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates task title, estimate, and due date before creating", async () => {
    const notify = vi.fn();
    const refreshTasksDomain = vi.fn(async () => {});
    const refreshAll = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useTasksController({
        tasks: [],
        settingsMap: {},
        refreshTasksDomain,
        refreshAll,
        notify,
      })
    );

    const preventDefault = vi.fn();
    await act(async () => {
      await result.current.handleCreateTask({ preventDefault } as unknown as React.FormEvent);
    });
    expect(notify).toHaveBeenCalledWith("The task title cannot be empty.", true);
    expect(mockTasksApi.create).not.toHaveBeenCalled();

    act(() => {
      result.current.setNewTaskTitle("Review PR");
      result.current.setNewTaskEstimate("-5");
    });
    await act(async () => {
      await result.current.handleCreateTask({ preventDefault } as unknown as React.FormEvent);
    });
    expect(notify).toHaveBeenCalledWith("Estimate must be a positive number of minutes.", true);

    act(() => {
      result.current.setNewTaskEstimate("30");
      result.current.setNewTaskDueAt("not-a-date");
    });
    await act(async () => {
      await result.current.handleCreateTask({ preventDefault } as unknown as React.FormEvent);
    });
    expect(notify).toHaveBeenCalledWith("Invalid due date.", true);

    mockTasksApi.create.mockResolvedValueOnce(makeTask({ id: "t-created", title: "Review PR" }));
    act(() => {
      result.current.setNewTaskDueAt("2026-11-20");
      result.current.setNewTaskTags("api, urgent");
    });
    await act(async () => {
      await result.current.handleCreateTask({ preventDefault } as unknown as React.FormEvent);
    });

    expect(mockTasksApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Review PR",
        estimate_min: 30,
        tags: ["api", "urgent"],
        due_at: expect.stringMatching(/^2026-11-20T/),
      })
    );
    expect(refreshTasksDomain).toHaveBeenCalled();
    expect(result.current.newTaskTitle).toBe("");
  });

  it("handles project creation, task edit, deletion, and atomic kanban reorder", async () => {
    const notify = vi.fn();
    const refreshTasksDomain = vi.fn(async () => {});
    const refreshAll = vi.fn(async () => {});
    const t1 = makeTask({ id: "t1", status: "todo", kanban_order: 0 });
    const t2 = makeTask({ id: "t2", status: "todo", kanban_order: 1 });
    const t3 = makeTask({ id: "t3", status: "doing", kanban_order: 0 });

    const { result } = renderHook(() =>
      useTasksController({
        tasks: [t1, t2, t3],
        settingsMap: { "github.filter_labels": "bug" },
        refreshTasksDomain,
        refreshAll,
        notify,
      })
    );

    mockProjectsApi.create.mockResolvedValueOnce({
      id: "proj-1",
      name: "Core",
      status: "active",
      created_at: "2026-11-17T10:00:00Z",
      updated_at: "2026-11-17T10:00:00Z",
    });
    await act(async () => {
      await result.current.handleCreateProject("Core");
    });
    expect(result.current.newTaskProjectId).toBe("proj-1");

    await act(async () => {
      await result.current.handleMoveTaskToIndex(t1, "doing", 0);
    });
    expect(mockTasksApi.reorder).toHaveBeenCalledWith([
      { id: "t1", status: "doing", kanban_order: 0 },
      { id: "t3", status: "doing", kanban_order: 1 },
    ]);

    await act(async () => {
      await result.current.handleReorderTask(t2, 0);
    });
    expect(mockTasksApi.reorder).toHaveBeenCalledWith([
      { id: "t2", status: "todo", kanban_order: 0 },
      { id: "t1", status: "todo", kanban_order: 1 },
    ]);

    const emptySave = await result.current.handleSaveTaskEdit("t1", "   ", "normal");
    expect(emptySave).toBe(false);

    mockTasksApi.update.mockResolvedValueOnce(t1);
    const saved = await result.current.handleSaveTaskEdit("t1", "Updated", "high", {
      description: "Details",
      estimateMin: 45,
    });
    expect(saved).toBe(true);
    expect(refreshAll).toHaveBeenCalled();

    await act(async () => {
      await result.current.handleDeleteTask("t2");
    });
    expect(mockTasksApi.delete).toHaveBeenCalledWith("t2");
  });

  it("maps GitHub import errors and unlink actions cleanly", async () => {
    const notify = vi.fn();
    const refreshTasksDomain = vi.fn(async () => {});
    const refreshAll = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useTasksController({
        tasks: [],
        settingsMap: { "github.filter_labels": "bug" },
        refreshTasksDomain,
        refreshAll,
        notify,
      })
    );

    mockGithubApi.syncIssues.mockRejectedValueOnce(new Error("github.repo missing"));
    await act(async () => {
      await result.current.handleImportGithub();
    });
    expect(notify).toHaveBeenCalledWith("Set github.repo in settings", true);

    mockGithubApi.syncIssues.mockRejectedValueOnce(new Error("authRequired"));
    await act(async () => {
      await result.current.handleImportGithub();
    });
    expect(notify).toHaveBeenCalledWith("Run gh auth login in terminal first", true);

    mockGithubApi.syncIssues.mockResolvedValueOnce({
      created: 2,
      updated: 1,
      skipped: 0,
      issues: [],
    });
    await act(async () => {
      await result.current.handleImportGithub();
    });
    expect(notify).toHaveBeenCalledWith("2 created, 1 updated");

    await act(async () => {
      await result.current.handleUnlinkGithub("t1");
    });
    expect(mockGithubApi.unlinkTask).toHaveBeenCalledWith("t1");
    expect(notify).toHaveBeenCalledWith("Issue unlinked from card");
  });
});
