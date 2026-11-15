import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, GitPullRequest, Plus, RefreshCw, Search } from "lucide-react";

import { KanbanBoard, type TaskEditExtra } from "../components/KanbanBoard";
import type { GithubIssueLink, Project, Task, TaskPriority, TaskStatus } from "../lib/ipc";

export interface KanbanPageProps {
  tasks: Task[];
  projects?: Project[];
  githubLinks: GithubIssueLink[];
  importingGithub: boolean;
  newTaskTitle: string;
  newTaskEstimate: string;
  newTaskPriority: TaskPriority;
  newTaskTags?: string;
  newTaskDueAt?: string;
  newTaskProjectId?: string;
  search: string;
  priorityFilter: string;
  projectFilter?: string;
  onChangeNewTitle: (v: string) => void;
  onChangeNewEstimate: (v: string) => void;
  onChangeNewPriority: (v: TaskPriority) => void;
  onChangeNewTags?: (v: string) => void;
  onChangeNewDueAt?: (v: string) => void;
  onChangeNewProjectId?: (v: string) => void;
  onChangeSearch: (v: string) => void;
  onChangePriorityFilter: (v: string) => void;
  onChangeProjectFilter?: (v: string) => void;
  onCreateProject?: (name: string) => void | Promise<void>;
  onCreateTask: (e: React.FormEvent) => void | Promise<void>;
  onImportGithub: () => void | Promise<void>;
  onUnlinkGithub: (taskId: string) => void | Promise<void>;
  onMoveTask: (task: Task, targetStatus: TaskStatus) => void | Promise<void>;
  onReorderTask?: (task: Task, targetIndex: number) => void | Promise<void>;
  onUpdateTask: (
    taskId: string,
    title: string,
    priority: TaskPriority,
    extra?: TaskEditExtra
  ) => void | Promise<void>;
  onDeleteTask: (taskId: string) => void | Promise<void>;
  onFocusTask: (task: Task) => void | Promise<void>;
}

export function KanbanPage({
  tasks,
  projects = [],
  githubLinks,
  importingGithub,
  newTaskTitle,
  newTaskEstimate,
  newTaskPriority,
  newTaskTags = "",
  newTaskDueAt = "",
  newTaskProjectId = "",
  search,
  priorityFilter,
  projectFilter = "all",
  onChangeNewTitle,
  onChangeNewEstimate,
  onChangeNewPriority,
  onChangeNewTags,
  onChangeNewDueAt,
  onChangeNewProjectId,
  onChangeSearch,
  onChangePriorityFilter,
  onChangeProjectFilter,
  onCreateProject,
  onCreateTask,
  onImportGithub,
  onUnlinkGithub,
  onMoveTask,
  onReorderTask,
  onUpdateTask,
  onDeleteTask,
  onFocusTask,
}: KanbanPageProps) {
  const { t } = useTranslation();
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState("");

  const filteredTasks = tasks.filter((task) => {
    if (priorityFilter !== "all" && task.priority !== priorityFilter) {
      return false;
    }
    if (projectFilter === "none" && task.project_id) {
      return false;
    }
    if (projectFilter !== "all" && projectFilter !== "none" && task.project_id !== projectFilter) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const inTags = Array.isArray(task.tags)
        ? task.tags.some((tg) => tg.toLowerCase().includes(q))
        : false;
      return (
        task.title.toLowerCase().includes(q) ||
        (task.description ?? "").toLowerCase().includes(q) ||
        inTags
      );
    }
    return true;
  });

  const handleProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectNameInput.trim() || !onCreateProject) return;
    await onCreateProject(projectNameInput.trim());
    setProjectNameInput("");
    setShowNewProject(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-50">{t("kanban.title")}</h2>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => onChangeSearch(e.target.value)}
              placeholder={t("kanban.searchPlaceholder")}
              className="w-44 rounded-lg aura-glass-pill pl-8 pr-3 py-1.5 text-xs text-slate-100 focus:ring-sky-500 outline-none"
            />
          </div>
          <select
            value={priorityFilter}
            onChange={(e) => onChangePriorityFilter(e.target.value)}
            className="rounded-lg aura-glass-pill px-2.5 py-1.5 text-xs text-slate-200"
          >
            <option value="all">{t("kanban.allPriorities")}</option>
            <option value="urgent">{t("kanban.priority.urgent")}</option>
            <option value="high">{t("kanban.priority.high")}</option>
            <option value="normal">{t("kanban.priority.normal")}</option>
            <option value="low">{t("kanban.priority.low")}</option>
          </select>
          {onChangeProjectFilter && (
            <select
              value={projectFilter}
              onChange={(e) => onChangeProjectFilter(e.target.value)}
              className="rounded-lg aura-glass-pill px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">{t("kanban.allProjects")}</option>
              <option value="none">{t("kanban.noProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {onCreateProject && (
            <button
              type="button"
              onClick={() => setShowNewProject((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg aura-glass-pill px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-sky-300 cursor-pointer"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {t("kanban.newProject")}
            </button>
          )}
          <button
            type="button"
            disabled={importingGithub}
            onClick={() => void onImportGithub()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-200 ring-1 ring-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-50 cursor-pointer"
          >
            {importingGithub ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitPullRequest className="h-3.5 w-3.5" />
            )}
            {importingGithub
              ? t("kanban.github.importing")
              : t("kanban.github.importButton")}
          </button>
        </div>
      </div>

      {showNewProject && onCreateProject && (
        <form
          onSubmit={(e) => void handleProjectSubmit(e)}
          className="rounded-xl aura-glass p-3 flex flex-wrap items-center gap-2"
        >
          <input
            type="text"
            value={projectNameInput}
            onChange={(e) => setProjectNameInput(e.target.value)}
            placeholder={t("kanban.projectNamePlaceholder")}
            className="flex-1 min-w-[200px] rounded-lg bg-slate-950/70 px-3 py-1.5 text-xs text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
          >
            {t("kanban.createProject")}
          </button>
        </form>
      )}

      <form
        onSubmit={(e) => void onCreateTask(e)}
        className="rounded-2xl aura-glass p-3.5 space-y-2.5"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            value={newTaskTitle}
            onChange={(e) => onChangeNewTitle(e.target.value)}
            placeholder={t("kanban.newTaskPlaceholder")}
            className="flex-1 min-w-[220px] rounded-lg bg-slate-950/70 px-3.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
          />
          <input
            type="number"
            min={1}
            value={newTaskEstimate}
            onChange={(e) => onChangeNewEstimate(e.target.value)}
            placeholder={t("kanban.estimatePlaceholder")}
            className="w-20 rounded-lg bg-slate-950/70 px-2.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
          />
          <select
            value={newTaskPriority}
            onChange={(e) => onChangeNewPriority(e.target.value as TaskPriority)}
            className="rounded-lg bg-slate-950/70 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-800"
          >
            <option value="low">{t("kanban.priority.low")}</option>
            <option value="normal">{t("kanban.priority.normal")}</option>
            <option value="high">{t("kanban.priority.high")}</option>
            <option value="urgent">{t("kanban.priority.urgent")}</option>
          </select>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            {t("kanban.create")}
          </button>
        </div>

        {(onChangeNewTags || onChangeNewDueAt || onChangeNewProjectId) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {onChangeNewProjectId && (
              <select
                value={newTaskProjectId}
                onChange={(e) => onChangeNewProjectId(e.target.value)}
                className="rounded-lg bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800"
              >
                <option value="">{t("kanban.noProject")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {onChangeNewTags && (
              <input
                type="text"
                value={newTaskTags}
                onChange={(e) => onChangeNewTags(e.target.value)}
                placeholder={t("kanban.tagsPlaceholder")}
                className="flex-1 min-w-[160px] rounded-lg bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800 outline-none focus:ring-sky-500"
              />
            )}
            {onChangeNewDueAt && (
              <label className="inline-flex items-center gap-1.5 text-slate-400">
                <span>{t("kanban.dueAtLabel")}</span>
                <input
                  type="date"
                  value={newTaskDueAt}
                  onChange={(e) => onChangeNewDueAt(e.target.value)}
                  className="rounded-lg bg-slate-950/70 px-2.5 py-1 text-xs text-slate-200 ring-1 ring-slate-800 outline-none focus:ring-sky-500"
                />
              </label>
            )}
          </div>
        )}
      </form>

      <KanbanBoard
        tasks={filteredTasks}
        projects={projects}
        githubLinks={githubLinks}
        requireDeleteConfirm={Boolean(onCreateProject)}
        onMoveTask={onMoveTask}
        onReorderTask={onReorderTask}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        onFocusTask={onFocusTask}
        onUnlinkGithub={onUnlinkGithub}
      />
    </div>
  );
}
