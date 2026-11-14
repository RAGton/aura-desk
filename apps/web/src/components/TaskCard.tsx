import React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Edit3,
  ExternalLink,
  GripVertical,
  Play,
  Trash2,
  Unlink,
} from "lucide-react";

import type { GithubIssueLink, Task, TaskPriority, TaskStatus } from "../lib/ipc";

export const KANBAN_COLUMNS: TaskStatus[] = ["todo", "doing", "waiting", "done"];

export interface TaskCardProps {
  task: Task;
  col: TaskStatus;
  githubLink?: GithubIssueLink | null;
  isDragging: boolean;
  isEditing: boolean;
  editingTitle: string;
  editingPriority: TaskPriority;
  onStartEdit: (task: Task) => void;
  onChangeEditTitle: (title: string) => void;
  onChangeEditPriority: (priority: TaskPriority) => void;
  onSaveEdit: (task: Task) => void;
  onCancelEdit: () => void;
  onMove: (task: Task, status: TaskStatus) => void;
  onFocusTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  onUnlinkGithub?: (taskId: string) => void;
  onCardPointerDown: (e: React.PointerEvent<HTMLDivElement>, task: Task) => void;
}

export function TaskCard({
  task,
  col,
  githubLink,
  isDragging,
  isEditing,
  editingTitle,
  editingPriority,
  onStartEdit,
  onChangeEditTitle,
  onChangeEditPriority,
  onSaveEdit,
  onCancelEdit,
  onMove,
  onFocusTask,
  onDeleteTask,
  onUnlinkGithub,
  onCardPointerDown,
}: TaskCardProps) {
  const { t } = useTranslation();

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditing) return;
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;

    if (e.key === "ArrowRight" && e.altKey) {
      const idx = KANBAN_COLUMNS.indexOf(col);
      if (idx >= 0 && idx < KANBAN_COLUMNS.length - 1) {
        e.preventDefault();
        onMove(task, KANBAN_COLUMNS[idx + 1]);
      }
    } else if (e.key === "ArrowLeft" && e.altKey) {
      const idx = KANBAN_COLUMNS.indexOf(col);
      if (idx > 0) {
        e.preventDefault();
        onMove(task, KANBAN_COLUMNS[idx - 1]);
      }
    }
  };

  const colIdx = KANBAN_COLUMNS.indexOf(col);

  return (
    <div
      data-task-card={task.id}
      data-dragging={isDragging ? "true" : "false"}
      tabIndex={isEditing ? -1 : 0}
      onKeyDown={handleCardKeyDown}
      onPointerDown={(e) => {
        if (!isEditing) onCardPointerDown(e, task);
      }}
      style={{ touchAction: isEditing ? "auto" : "none" }}
      className={`rounded-xl bg-slate-950/90 p-3 ring-1 transition-all space-y-2 select-none ${
        isDragging
          ? "opacity-40 ring-sky-400 scale-[0.98]"
          : "ring-slate-800 hover:ring-slate-700 cursor-grab active:cursor-grabbing"
      }`}
    >
      {isEditing ? (
        <div className="space-y-2" data-no-drag="true">
          <input
            type="text"
            value={editingTitle}
            onChange={(e) => onChangeEditTitle(e.target.value)}
            className="w-full rounded bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 ring-1 ring-sky-500 outline-none"
          />
          <select
            value={editingPriority}
            onChange={(e) => onChangeEditPriority(e.target.value as TaskPriority)}
            className="w-full rounded bg-slate-900 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-700"
          >
            <option value="low">{t("kanban.priority.low")}</option>
            <option value="normal">{t("kanban.priority.normal")}</option>
            <option value="high">{t("kanban.priority.high")}</option>
            <option value="urgent">{t("kanban.priority.urgent")}</option>
          </select>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onSaveEdit(task)}
              className="flex-1 rounded bg-sky-500 px-2 py-1 text-[11px] font-semibold text-slate-950 cursor-pointer"
            >
              {t("kanban.save")}
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="flex-1 rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 cursor-pointer"
            >
              {t("kanban.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5 min-w-0">
              <GripVertical
                aria-hidden="true"
                className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5"
              />
              <span className="text-xs font-semibold text-slate-100 leading-snug break-words">
                {task.title}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0" data-no-drag="true">
              <button
                type="button"
                onClick={() => onStartEdit(task)}
                className="text-slate-500 hover:text-sky-400 cursor-pointer"
                aria-label={t("kanban.edit")}
                title={t("kanban.edit")}
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteTask(task.id)}
                className="text-slate-500 hover:text-red-400 cursor-pointer"
                aria-label={t("kanban.delete")}
                title={t("kanban.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span
              className={`rounded px-1.5 py-0.5 font-semibold ${
                task.priority === "urgent"
                  ? "bg-red-500/20 text-red-300"
                  : task.priority === "high"
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-slate-800 text-slate-300"
              }`}
            >
              {t(`kanban.priority.${task.priority}`)}
            </span>

            {task.estimate_min ? (
              <span className="inline-flex items-center gap-0.5 text-slate-400">
                <Clock className="h-3 w-3" /> {task.estimate_min}m
              </span>
            ) : null}

            {task.actual_min ? (
              <span className="text-emerald-400 font-medium">
                {task.actual_min}
                {t("kanban.focusSuffix")}
              </span>
            ) : null}

            {githubLink && (
              <span
                className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-0.5 font-medium text-indigo-300 ring-1 ring-indigo-500/30"
                data-no-drag="true"
              >
                <a
                  href={githubLink.issueUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={t("kanban.github.openExternal")}
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <span>#{githubLink.issueNumber}</span>
                  <span className="text-[9px] opacity-80">
                    ({t(
                      githubLink.sourceStatus === "closed"
                        ? "kanban.github.issueClosed"
                        : "kanban.github.issueOpen"
                    )})
                  </span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
                {onUnlinkGithub && (
                  <button
                    type="button"
                    onClick={() => onUnlinkGithub(task.id)}
                    aria-label={t("kanban.github.unlink")}
                    title={t("kanban.github.unlink")}
                    className="ml-0.5 text-slate-400 hover:text-red-300 cursor-pointer"
                  >
                    <Unlink className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            )}
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-slate-900"
            data-no-drag="true"
          >
            <div className="flex items-center gap-1">
              {colIdx > 0 && (
                <button
                  type="button"
                  onClick={() => onMove(task, KANBAN_COLUMNS[colIdx - 1])}
                  aria-label={t("kanban.moveTo", {
                    col: t(`kanban.columns.${KANBAN_COLUMNS[colIdx - 1]}`),
                  })}
                  title={t("kanban.moveTo", {
                    col: t(`kanban.columns.${KANBAN_COLUMNS[colIdx - 1]}`),
                  })}
                  className="rounded bg-slate-800/80 hover:bg-slate-700 p-1 text-slate-300 cursor-pointer"
                >
                  <ArrowLeft className="h-3 w-3" />
                </button>
              )}
              {KANBAN_COLUMNS.filter((c) => c !== col).map((targetCol) => (
                <button
                  key={targetCol}
                  type="button"
                  onClick={() => onMove(task, targetCol)}
                  className="rounded bg-slate-800/70 hover:bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 cursor-pointer"
                >
                  {targetCol === "doing"
                    ? "→ "
                    : targetCol === "done"
                      ? "✓ "
                      : ""}
                  {t(`kanban.columns.${targetCol}`)}
                </button>
              ))}
              {colIdx < KANBAN_COLUMNS.length - 1 && (
                <button
                  type="button"
                  onClick={() => onMove(task, KANBAN_COLUMNS[colIdx + 1])}
                  aria-label={t("kanban.moveTo", {
                    col: t(`kanban.columns.${KANBAN_COLUMNS[colIdx + 1]}`),
                  })}
                  title={t("kanban.moveTo", {
                    col: t(`kanban.columns.${KANBAN_COLUMNS[colIdx + 1]}`),
                  })}
                  className="rounded bg-slate-800/80 hover:bg-slate-700 p-1 text-slate-300 cursor-pointer"
                >
                  <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>

            {col !== "done" && (
              <button
                type="button"
                onClick={() => onFocusTask(task)}
                className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 hover:bg-sky-500/25 px-1.5 py-0.5 text-[10px] font-medium text-sky-300 cursor-pointer"
              >
                <Play className="h-2.5 w-2.5" /> {t("kanban.focusTask")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
