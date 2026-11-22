import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderKanban, FolderPlus, GitPullRequest, Plus, Search, X } from "lucide-react";

import { KanbanBoard, type TaskEditExtra } from "../components/KanbanBoard";
import { Badge, Button, Input, Select } from "../components/ui";
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
  onMoveTaskToIndex?: (
    task: Task,
    targetStatus: TaskStatus,
    targetIndex: number
  ) => void | Promise<void>;
  onReorderTask?: (task: Task, targetIndex: number) => void | Promise<void>;
  onUpdateTask: (
    taskId: string,
    title: string,
    priority: TaskPriority,
    extra?: TaskEditExtra
  ) => void | boolean | Promise<void | boolean>;
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
  onMoveTaskToIndex,
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

  const hasFilters = Boolean(search.trim()) || priorityFilter !== "all" || projectFilter !== "all";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl aura-glass-elevated ring-1 ring-aura-accent/30">
            <FolderKanban className="h-5 w-5 text-aura-accent" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl font-bold text-slate-50">{t("kanban.title")}</h2>
              <Badge variant="info" className="rounded-full px-2.5 py-0.5 text-[11px] font-medium tabular-nums">
                {t("kanban.showingCount", { shown: filteredTasks.length, total: tasks.length })}
              </Badge>
            </div>
            <p className="text-xs text-slate-400">{t("kanban.subtitle")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onCreateProject && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowNewProject((v) => !v)}
              className="rounded-xl text-xs font-semibold"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
              {t("kanban.newProject")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={importingGithub}
            loading={importingGithub}
            onClick={() => void onImportGithub()}
            className="rounded-xl bg-indigo-500/20 text-indigo-200 border-indigo-500/40 hover:bg-indigo-500/30 text-xs font-semibold"
          >
            {!importingGithub && <GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />}
            {importingGithub
              ? t("kanban.github.importing")
              : t("kanban.github.importButton")}
          </Button>
        </div>
      </div>

      {/* Unified Filter Toolbar */}
      <div className="rounded-2xl aura-glass aura-card-interactive p-3.5 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none"
            aria-hidden="true"
          />
          <Input
            type="text"
            aria-label={t("kanban.searchLabel")}
            value={search}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder={t("kanban.searchPlaceholder")}
            className="h-9 pl-8 pr-3 py-1.5 text-xs"
          />
        </div>
        <Select
          containerClassName="w-full sm:w-auto sm:min-w-[160px]"
          aria-label={t("kanban.priorityFilterLabel")}
          value={priorityFilter}
          onChange={(e) => onChangePriorityFilter(e.target.value)}
          className="h-9 rounded-xl py-1.5 text-xs"
        >
          <option value="all">{t("kanban.allPriorities")}</option>
          <option value="urgent">{t("kanban.priority.urgent")}</option>
          <option value="high">{t("kanban.priority.high")}</option>
          <option value="normal">{t("kanban.priority.normal")}</option>
          <option value="low">{t("kanban.priority.low")}</option>
        </Select>
        {onChangeProjectFilter && (
          <Select
            containerClassName="w-full sm:w-auto sm:min-w-[160px]"
            aria-label={t("kanban.projectFilterLabel")}
            value={projectFilter}
            onChange={(e) => onChangeProjectFilter(e.target.value)}
            className="h-9 rounded-xl py-1.5 text-xs"
          >
            <option value="all">{t("kanban.allProjects")}</option>
            <option value="none">{t("kanban.noProject")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        {hasFilters && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onChangeSearch("");
              onChangePriorityFilter("all");
              onChangeProjectFilter?.("all");
            }}
            className="h-9 rounded-xl text-xs font-medium text-slate-300 hover:text-amber-300"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            {t("kanban.clearFilters")}
          </Button>
        )}
      </div>

      {showNewProject && onCreateProject && (
        <form
          onSubmit={(e) => void handleProjectSubmit(e)}
          className="rounded-2xl aura-glass aura-card-interactive p-3.5 flex flex-wrap items-center gap-2.5"
        >
          <Input
            containerClassName="flex-1 min-w-[200px]"
            type="text"
            aria-label={t("kanban.projectNamePlaceholder")}
            value={projectNameInput}
            onChange={(e) => setProjectNameInput(e.target.value)}
            placeholder={t("kanban.projectNamePlaceholder")}
            className="h-9 py-1.5 text-xs"
          />
          <Button type="submit" size="sm" variant="primary" className="h-9 rounded-xl text-xs font-semibold">
            {t("kanban.createProject")}
          </Button>
        </form>
      )}

      <form
        onSubmit={(e) => void onCreateTask(e)}
        className="rounded-2xl aura-glass-elevated aura-card-interactive border-t-2 border-t-aura-accent/55 p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            containerClassName="flex-1 min-w-[220px]"
            type="text"
            aria-label={t("kanban.newTaskPlaceholder")}
            value={newTaskTitle}
            onChange={(e) => onChangeNewTitle(e.target.value)}
            placeholder={t("kanban.newTaskPlaceholder")}
            className="h-9 px-3.5 py-1.5 text-sm"
          />
          <Input
            containerClassName="w-24"
            type="number"
            inputMode="numeric"
            min={1}
            aria-label={t("kanban.estimateLabel")}
            value={newTaskEstimate}
            onChange={(e) => onChangeNewEstimate(e.target.value)}
            placeholder={t("kanban.estimatePlaceholder")}
            className="h-9 px-2.5 py-1.5 text-sm"
          />
          <Select
            containerClassName="w-auto min-w-[130px]"
            aria-label={t("kanban.priorityLabel")}
            value={newTaskPriority}
            onChange={(e) => onChangeNewPriority(e.target.value as TaskPriority)}
            className="h-9 rounded-xl py-1.5 text-xs"
          >
            <option value="low">{t("kanban.priority.low")}</option>
            <option value="normal">{t("kanban.priority.normal")}</option>
            <option value="high">{t("kanban.priority.high")}</option>
            <option value="urgent">{t("kanban.priority.urgent")}</option>
          </Select>
          <Button
            type="submit"
            size="md"
            variant="primary"
            className="h-9 rounded-xl text-xs font-semibold shadow-sm"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("kanban.create")}
          </Button>
        </div>

        {(onChangeNewTags || onChangeNewDueAt || onChangeNewProjectId) && (
          <div className="flex flex-wrap items-center gap-2.5 pt-2.5 border-t border-aura-border/25 text-xs">
            {onChangeNewProjectId && (
              <Select
                containerClassName="w-full sm:w-auto sm:flex-1 min-w-[150px]"
                aria-label={t("kanban.projectLabel")}
                value={newTaskProjectId}
                onChange={(e) => onChangeNewProjectId(e.target.value)}
                className="h-8 rounded-xl py-1 text-xs"
              >
                <option value="">{t("kanban.noProject")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
            {onChangeNewTags && (
              <Input
                containerClassName="w-full sm:w-auto sm:flex-[1.5] min-w-[180px]"
                type="text"
                aria-label={t("kanban.tagsLabel")}
                value={newTaskTags}
                onChange={(e) => onChangeNewTags(e.target.value)}
                placeholder={t("kanban.tagsPlaceholder")}
                className="h-8 py-1 text-xs"
              />
            )}
            {onChangeNewDueAt && (
              <label className="inline-flex items-center justify-between sm:justify-end gap-2 text-slate-400 shrink-0 w-full sm:w-auto">
                <span className="shrink-0">{t("kanban.dueAtLabel")}</span>
                <Input
                  type="date"
                  value={newTaskDueAt}
                  onChange={(e) => onChangeNewDueAt(e.target.value)}
                  className="h-8 rounded-xl px-2.5 py-1 text-xs w-auto"
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
        requireDeleteConfirm
        onMoveTask={onMoveTask}
        onMoveTaskToIndex={onMoveTaskToIndex}
        onReorderTask={onReorderTask}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        onFocusTask={onFocusTask}
        onUnlinkGithub={onUnlinkGithub}
      />
    </div>
  );
}
