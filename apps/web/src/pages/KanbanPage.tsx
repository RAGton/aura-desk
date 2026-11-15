import React from "react";
import { useTranslation } from "react-i18next";
import { GitPullRequest, Plus, RefreshCw, Search } from "lucide-react";

import { KanbanBoard } from "../components/KanbanBoard";
import type { GithubIssueLink, Task, TaskPriority, TaskStatus } from "../lib/ipc";

export interface KanbanPageProps {
  tasks: Task[];
  githubLinks: GithubIssueLink[];
  importingGithub: boolean;
  newTaskTitle: string;
  newTaskEstimate: string;
  newTaskPriority: TaskPriority;
  search: string;
  priorityFilter: string;
  onChangeNewTitle: (v: string) => void;
  onChangeNewEstimate: (v: string) => void;
  onChangeNewPriority: (v: TaskPriority) => void;
  onChangeSearch: (v: string) => void;
  onChangePriorityFilter: (v: string) => void;
  onCreateTask: (e: React.FormEvent) => void | Promise<void>;
  onImportGithub: () => void | Promise<void>;
  onUnlinkGithub: (taskId: string) => void | Promise<void>;
  onMoveTask: (task: Task, targetStatus: TaskStatus) => void | Promise<void>;
  onUpdateTask: (taskId: string, title: string, priority: TaskPriority) => void | Promise<void>;
  onDeleteTask: (taskId: string) => void | Promise<void>;
  onFocusTask: (task: Task) => void | Promise<void>;
}

export function KanbanPage({
  tasks,
  githubLinks,
  importingGithub,
  newTaskTitle,
  newTaskEstimate,
  newTaskPriority,
  search,
  priorityFilter,
  onChangeNewTitle,
  onChangeNewEstimate,
  onChangeNewPriority,
  onChangeSearch,
  onChangePriorityFilter,
  onCreateTask,
  onImportGithub,
  onUnlinkGithub,
  onMoveTask,
  onUpdateTask,
  onDeleteTask,
  onFocusTask,
}: KanbanPageProps) {
  const { t } = useTranslation();

  const filteredTasks = tasks.filter((task) => {
    if (priorityFilter !== "all" && task.priority !== priorityFilter) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        task.title.toLowerCase().includes(q) ||
        (task.description ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

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
              className="w-44 rounded-lg bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
            />
          </div>
          <select
            value={priorityFilter}
            onChange={(e) => onChangePriorityFilter(e.target.value)}
            className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800"
          >
            <option value="all">{t("kanban.allPriorities")}</option>
            <option value="urgent">{t("kanban.priority.urgent")}</option>
            <option value="high">{t("kanban.priority.high")}</option>
            <option value="normal">{t("kanban.priority.normal")}</option>
            <option value="low">{t("kanban.priority.low")}</option>
          </select>
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

      <form
        onSubmit={(e) => void onCreateTask(e)}
        className="rounded-xl bg-slate-900/60 p-3.5 ring-1 ring-slate-800 flex flex-wrap items-center gap-2.5"
      >
        <input
          type="text"
          value={newTaskTitle}
          onChange={(e) => onChangeNewTitle(e.target.value)}
          placeholder={t("kanban.newTaskPlaceholder")}
          className="flex-1 min-w-[220px] rounded-lg bg-slate-950 px-3.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
        />
        <input
          type="number"
          min={1}
          value={newTaskEstimate}
          onChange={(e) => onChangeNewEstimate(e.target.value)}
          placeholder={t("kanban.estimatePlaceholder")}
          className="w-20 rounded-lg bg-slate-950 px-2.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 focus:ring-sky-500 outline-none"
        />
        <select
          value={newTaskPriority}
          onChange={(e) => onChangeNewPriority(e.target.value as TaskPriority)}
          className="rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-800"
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
      </form>

      <KanbanBoard
        tasks={filteredTasks}
        githubLinks={githubLinks}
        onMoveTask={onMoveTask}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        onFocusTask={onFocusTask}
        onUnlinkGithub={onUnlinkGithub}
      />
    </div>
  );
}
