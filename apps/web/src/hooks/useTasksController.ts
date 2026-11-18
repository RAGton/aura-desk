import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import type { TaskEditExtra } from "../components/KanbanBoard";
import {
  githubApi,
  projectsApi,
  tasksApi,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../lib/ipc";

export interface UseTasksControllerOptions {
  tasks: Task[];
  settingsMap: Record<string, unknown>;
  refreshTasksDomain: () => Promise<void>;
  refreshAll: () => Promise<void>;
  notify: (text: string, isError?: boolean) => void;
}

export interface TasksController {
  importingGithub: boolean;
  newTaskTitle: string;
  setNewTaskTitle: Dispatch<SetStateAction<string>>;
  newTaskPriority: TaskPriority;
  setNewTaskPriority: Dispatch<SetStateAction<TaskPriority>>;
  newTaskEstimate: string;
  setNewTaskEstimate: Dispatch<SetStateAction<string>>;
  newTaskTags: string;
  setNewTaskTags: Dispatch<SetStateAction<string>>;
  newTaskDueAt: string;
  setNewTaskDueAt: Dispatch<SetStateAction<string>>;
  newTaskProjectId: string;
  setNewTaskProjectId: Dispatch<SetStateAction<string>>;
  kanbanSearch: string;
  setKanbanSearch: Dispatch<SetStateAction<string>>;
  kanbanPriorityFilter: string;
  setKanbanPriorityFilter: Dispatch<SetStateAction<string>>;
  kanbanProjectFilter: string;
  setKanbanProjectFilter: Dispatch<SetStateAction<string>>;
  handleCreateTask: (e: FormEvent) => Promise<void>;
  handleCreateProject: (name: string) => Promise<void>;
  handleMoveTask: (task: Task, targetStatus: TaskStatus) => Promise<void>;
  handleMoveTaskToIndex: (
    task: Task,
    targetStatus: TaskStatus,
    targetIndex: number
  ) => Promise<void>;
  handleReorderTask: (task: Task, targetIndex: number) => Promise<void>;
  handleSaveTaskEdit: (
    taskId: string,
    title: string,
    priority: TaskPriority,
    extra?: TaskEditExtra
  ) => Promise<boolean>;
  handleDeleteTask: (id: string) => Promise<void>;
  handleImportGithub: () => Promise<void>;
  handleUnlinkGithub: (taskId: string) => Promise<void>;
}

/**
 * Encapsulates task creation, Kanban status/order mutations, project creation,
 * filter state, and GitHub issue sync operations used by `AppShell`.
 */
export function useTasksController({
  tasks,
  settingsMap,
  refreshTasksDomain,
  refreshAll,
  notify,
}: UseTasksControllerOptions): TasksController {
  const { t } = useTranslation();

  const [importingGithub, setImportingGithub] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("normal");
  const [newTaskEstimate, setNewTaskEstimate] = useState("");
  const [newTaskTags, setNewTaskTags] = useState("");
  const [newTaskDueAt, setNewTaskDueAt] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [kanbanSearch, setKanbanSearch] = useState("");
  const [kanbanPriorityFilter, setKanbanPriorityFilter] = useState<string>("all");
  const [kanbanProjectFilter, setKanbanProjectFilter] = useState<string>("all");

  const handleCreateTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) {
      notify(t("errors.taskTitleEmpty"), true);
      return;
    }
    let parsedEstimate: number | undefined;
    if (newTaskEstimate.trim()) {
      const n = Number(newTaskEstimate.trim());
      if (!Number.isInteger(n) || n <= 0) {
        notify(t("errors.invalidEstimate"), true);
        return;
      }
      parsedEstimate = n;
    }
    let dueAt: string | undefined;
    if (newTaskDueAt.trim()) {
      const parsedDate = new Date(`${newTaskDueAt.trim()}T12:00:00`);
      if (Number.isNaN(parsedDate.getTime())) {
        notify(t("errors.invalidDueDate"), true);
        return;
      }
      dueAt = parsedDate.toISOString();
    }
    try {
      const parsedTags = newTaskTags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await tasksApi.create({
        title: newTaskTitle.trim(),
        priority: newTaskPriority,
        status: "todo",
        estimate_min: parsedEstimate,
        project_id: newTaskProjectId || undefined,
        tags: parsedTags.length > 0 ? parsedTags : undefined,
        due_at: dueAt,
      });
      setNewTaskTitle("");
      setNewTaskEstimate("");
      setNewTaskTags("");
      setNewTaskDueAt("");
      await refreshTasksDomain();
      notify(t("kanban.taskCreated"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleCreateProject = async (name: string) => {
    try {
      const created = await projectsApi.create({ name });
      setNewTaskProjectId(created.id);
      await refreshTasksDomain();
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
      await refreshTasksDomain();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleMoveTaskToIndex = async (
    task: Task,
    targetStatus: TaskStatus,
    targetIndex: number
  ) => {
    if (task.status === targetStatus) {
      await handleReorderTask(task, targetIndex);
      return;
    }
    try {
      const destTasks = tasks
        .filter((x) => x.status === targetStatus && x.id !== task.id)
        .sort((a, b) => a.kanban_order - b.kanban_order);
      const boundedIdx = Math.max(0, Math.min(targetIndex, destTasks.length));
      destTasks.splice(boundedIdx, 0, task);
      const batch = destTasks.map((tk, idx) => ({
        id: tk.id,
        status: targetStatus,
        kanban_order: idx,
      }));
      if (typeof tasksApi.reorder === "function") {
        await tasksApi.reorder(batch);
      } else {
        await tasksApi.setStatus({
          id: task.id,
          status: targetStatus,
          kanban_order: boundedIdx,
        });
      }
      await refreshTasksDomain();
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
      const batch = colTasks
        .map((tk, idx) =>
          tk.kanban_order !== idx || tk.id === task.id
            ? { id: tk.id, status: tk.status, kanban_order: idx }
            : null
        )
        .filter((x): x is { id: string; status: TaskStatus; kanban_order: number } => x !== null);
      if (batch.length === 0) return;
      if (typeof tasksApi.reorder === "function") {
        await tasksApi.reorder(batch);
      } else {
        await Promise.all(
          batch.map((item) => tasksApi.update(item.id, { kanbanOrder: item.kanban_order }))
        );
      }
      await refreshTasksDomain();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleSaveTaskEdit = async (
    taskId: string,
    title: string,
    priority: TaskPriority,
    extra?: TaskEditExtra
  ): Promise<boolean> => {
    if (!title.trim()) {
      notify(t("errors.taskTitleEmpty"), true);
      return false;
    }
    try {
      await tasksApi.update(taskId, {
        title: title.trim(),
        priority,
        ...(extra
          ? {
              description: extra.description,
              estimateMin: extra.estimateMin,
              tags: extra.tags,
              dueAt: extra.dueAt,
              projectId: extra.projectId,
            }
          : {}),
      });
      await refreshAll();
      return true;
    } catch (err) {
      notify(String(err), true);
      return false;
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await tasksApi.delete(id);
      await refreshTasksDomain();
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
      await refreshTasksDomain();
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
      await refreshTasksDomain();
      notify(t("kanban.github.unlinked"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  return {
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
  };
}
