import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  Clock,
  Edit3,
  ExternalLink,
  FolderKanban,
  GripVertical,
  Play,
  Trash2,
  Unlink,
} from "lucide-react";

import type { GithubIssueLink, Project, Task, TaskPriority, TaskStatus } from "../lib/ipc";
import { Badge, Button, Input, Select, Textarea } from "./ui";

export const KANBAN_COLUMNS: TaskStatus[] = ["todo", "doing", "waiting", "done"];

export interface TaskCardProps {
  task: Task;
  col: TaskStatus;
  githubLink?: GithubIssueLink | null;
  project?: Project | null;
  projects?: Project[];
  isDragging: boolean;
  isEditing: boolean;
  editingTitle: string;
  editingPriority: TaskPriority;
  editingDescription?: string;
  editingEstimate?: string;
  editingTags?: string;
  editingDueAt?: string;
  editingProjectId?: string;
  requireDeleteConfirm?: boolean;
  onStartEdit: (task: Task) => void;
  onChangeEditTitle: (title: string) => void;
  onChangeEditPriority: (priority: TaskPriority) => void;
  onChangeEditDescription?: (description: string) => void;
  onChangeEditEstimate?: (estimate: string) => void;
  onChangeEditTags?: (tags: string) => void;
  onChangeEditDueAt?: (dueAt: string) => void;
  onChangeEditProjectId?: (projectId: string) => void;
  onSaveEdit: (task: Task) => void | Promise<void>;
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
  project,
  projects = [],
  isDragging,
  isEditing,
  editingTitle,
  editingPriority,
  editingDescription = "",
  editingEstimate = "",
  editingTags = "",
  editingDueAt = "",
  editingProjectId = "",
  requireDeleteConfirm = true,
  onStartEdit,
  onChangeEditTitle,
  onChangeEditPriority,
  onChangeEditDescription,
  onChangeEditEstimate,
  onChangeEditTags,
  onChangeEditDueAt,
  onChangeEditProjectId,
  onSaveEdit,
  onCancelEdit,
  onMove,
  onFocusTask,
  onDeleteTask,
  onUnlinkGithub,
  onCardPointerDown,
}: TaskCardProps) {
  const { t, i18n } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = window.setTimeout(() => setConfirmingDelete(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

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
  const priorityStripe =
    task.priority === "urgent"
      ? "border-l-4 border-l-rose-500"
      : task.priority === "high"
        ? "border-l-4 border-l-amber-400"
        : task.priority === "normal"
          ? "border-l-4 border-l-sky-400"
          : "border-l-4 border-l-slate-600";
  const priorityBadgeVariant =
    task.priority === "urgent"
      ? "danger"
      : task.priority === "high"
        ? "warning"
        : task.priority === "normal"
          ? "info"
          : "neutral";

  const tags = Array.isArray(task.tags) ? task.tags : [];
  const visibleTags = tags.slice(0, 3);
  const overflowTagCount = Math.max(0, tags.length - 3);
  const showQuickComplete = col !== "done" && colIdx < 2;

  return (
    <div
      data-task-card={task.id}
      data-dragging={isDragging ? "true" : "false"}
      tabIndex={isEditing ? -1 : 0}
      onKeyDown={handleCardKeyDown}
      onPointerDown={(e) => {
        if (isEditing) return;
        const target = e.target as HTMLElement | null;
        // On coarse touch screens, require starting drag on the grip handle so column vertical scrolling works naturally.
        if (e.pointerType === "touch" && !target?.closest("[data-drag-handle]")) {
          return;
        }
        onCardPointerDown(e, task);
      }}
      style={{ touchAction: isEditing ? "auto" : "pan-y" }}
      className={`group rounded-xl aura-glass-elevated ${priorityStripe} p-3.5 transition-[border-color,box-shadow,opacity,transform] space-y-2.5 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus ${
        isDragging
          ? "opacity-40 ring-2 ring-aura-focus scale-[0.98]"
          : "hover:ring-1 hover:ring-aura-focus/50 cursor-grab active:cursor-grabbing"
      }`}
    >
      {isEditing ? (
        <div className="space-y-2" data-no-drag="true">
          <Input
            type="text"
            aria-label={t("kanban.newTaskPlaceholder")}
            value={editingTitle}
            onChange={(e) => onChangeEditTitle(e.target.value)}
            className="py-1.5 text-xs"
          />
          {onChangeEditDescription && (
            <Textarea
              rows={2}
              aria-label={t("kanban.descriptionLabel")}
              value={editingDescription}
              onChange={(e) => onChangeEditDescription(e.target.value)}
              placeholder={t("kanban.descriptionPlaceholder")}
              className="px-2.5 py-1.5 text-xs resize-none"
            />
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <Select
              aria-label={t("kanban.priorityLabel")}
              value={editingPriority}
              onChange={(e) => onChangeEditPriority(e.target.value as TaskPriority)}
              className="px-2 py-1 text-xs"
            >
              <option value="low">{t("kanban.priority.low")}</option>
              <option value="normal">{t("kanban.priority.normal")}</option>
              <option value="high">{t("kanban.priority.high")}</option>
              <option value="urgent">{t("kanban.priority.urgent")}</option>
            </Select>
            {onChangeEditEstimate && (
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                aria-label={t("kanban.estimateLabel")}
                value={editingEstimate}
                onChange={(e) => onChangeEditEstimate(e.target.value)}
                placeholder={t("kanban.estimatePlaceholder")}
                className="py-1 text-xs"
              />
            )}
          </div>
          {(onChangeEditProjectId || onChangeEditDueAt) && (
            <div className="grid grid-cols-2 gap-1.5">
              {onChangeEditProjectId && (
                <Select
                  aria-label={t("kanban.projectLabel")}
                  value={editingProjectId}
                  onChange={(e) => onChangeEditProjectId(e.target.value)}
                  className="px-2 py-1 text-xs"
                >
                  <option value="">{t("kanban.noProject")}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
              {onChangeEditDueAt && (
                <Input
                  type="date"
                  aria-label={t("kanban.dueAtLabel")}
                  value={editingDueAt}
                  onChange={(e) => onChangeEditDueAt(e.target.value)}
                  className="px-2 py-1 text-xs"
                />
              )}
            </div>
          )}
          {onChangeEditTags && (
            <Input
              type="text"
              aria-label={t("kanban.tagsLabel")}
              value={editingTags}
              onChange={(e) => onChangeEditTags(e.target.value)}
              placeholder={t("kanban.tagsPlaceholder")}
              className="py-1 text-xs"
            />
          )}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="primary"
              onClick={() => void onSaveEdit(task)}
              className="flex-1 h-8 text-xs font-semibold"
            >
              {t("kanban.save")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={onCancelEdit}
              className="flex-1 h-8 text-xs"
            >
              {t("kanban.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5 min-w-0">
              <span
                data-drag-handle="true"
                style={{ touchAction: "none" }}
                aria-hidden="true"
                className="p-0.5 -ml-0.5 text-slate-500 opacity-60 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 cursor-grab"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold text-slate-100 leading-snug break-words">
                {task.title}
              </span>
            </div>
            <div
              className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
              data-no-drag="true"
            >
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onStartEdit(task)}
                className="h-7 w-7 text-slate-400 hover:text-sky-400"
                aria-label={t("kanban.edit")}
                title={t("kanban.edit")}
              >
                <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              {requireDeleteConfirm && confirmingDelete ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setConfirmingDelete(false);
                    onDeleteTask(task.id);
                  }}
                  className="h-7 px-2 text-[11px] font-semibold"
                >
                  {t("kanban.confirmDelete")}
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (requireDeleteConfirm) {
                      setConfirmingDelete(true);
                    } else {
                      onDeleteTask(task.id);
                    }
                  }}
                  className="h-7 w-7 text-slate-400 hover:text-red-400"
                  aria-label={t("kanban.delete")}
                  title={t("kanban.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>

          {task.description && (
            <p className="text-[11px] text-slate-400 line-clamp-2 break-words pl-5 leading-relaxed">
              {task.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <Badge variant={priorityBadgeVariant} className="px-1.5 py-0.5 text-[11px] font-semibold">
              {t(`kanban.priority.${task.priority}`)}
            </Badge>

            {project && (
              <Badge variant="default" className="px-1.5 py-0.5 text-[11px]">
                <FolderKanban
                  aria-hidden="true"
                  className="h-3 w-3"
                  style={project.color ? { color: project.color } : undefined}
                />
                {project.name}
              </Badge>
            )}

            {task.estimate_min ? (
              <span className="inline-flex items-center gap-0.5 text-slate-400 tabular-nums">
                <Clock className="h-3 w-3" aria-hidden="true" /> {task.estimate_min}m
              </span>
            ) : null}

            {task.actual_min ? (
              <span className="text-emerald-400 font-medium tabular-nums">
                {task.actual_min}
                {t("kanban.focusSuffix")}
              </span>
            ) : null}

            {task.due_at ? (
              <span className="inline-flex items-center gap-0.5 text-amber-300/90 tabular-nums">
                <Calendar className="h-3 w-3" aria-hidden="true" />
                {new Date(task.due_at).toLocaleDateString(i18n.language)}
              </span>
            ) : null}

            {visibleTags.map((tag) => (
              <Badge
                key={tag}
                variant="neutral"
                className="rounded-full px-2 py-0.5 text-[11px]"
              >
                #{tag}
              </Badge>
            ))}

            {overflowTagCount > 0 && (
              <Badge
                variant="neutral"
                className="rounded-full px-2 py-0.5 text-[11px] tabular-nums"
              >
                {t("kanban.moreTags", { count: overflowTagCount })}
              </Badge>
            )}

            {githubLink && (
              <Badge
                variant="info"
                className="px-1.5 py-0.5 text-[11px]"
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
                  <span className="opacity-80">
                    ({t(
                      githubLink.sourceStatus === "closed"
                        ? "kanban.github.issueClosed"
                        : "kanban.github.issueOpen"
                    )})
                  </span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
                {onUnlinkGithub && (
                  <button
                    type="button"
                    onClick={() => onUnlinkGithub(task.id)}
                    aria-label={t("kanban.github.unlink")}
                    title={t("kanban.github.unlink")}
                    className="ml-0.5 text-slate-400 hover:text-red-300 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus rounded-sm"
                  >
                    <Unlink className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </Badge>
            )}
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-aura-border/25"
            data-no-drag="true"
          >
            <div className="flex items-center gap-1">
              {colIdx > 0 && (
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => onMove(task, KANBAN_COLUMNS[colIdx - 1])}
                  aria-label={t("kanban.moveTo", {
                    col: t(`kanban.columns.${KANBAN_COLUMNS[colIdx - 1]}`),
                  })}
                  title={t("kanban.moveTo", {
                    col: t(`kanban.columns.${KANBAN_COLUMNS[colIdx - 1]}`),
                  })}
                  className="h-7 w-7 rounded-aura-sm"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
              {colIdx < KANBAN_COLUMNS.length - 1 && (
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => onMove(task, KANBAN_COLUMNS[colIdx + 1])}
                  aria-label={t("kanban.moveTo", {
                    col: t(`kanban.columns.${KANBAN_COLUMNS[colIdx + 1]}`),
                  })}
                  title={t("kanban.moveTo", {
                    col: t(`kanban.columns.${KANBAN_COLUMNS[colIdx + 1]}`),
                  })}
                  className="h-7 w-7 rounded-aura-sm"
                >
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
              {showQuickComplete && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onMove(task, "done")}
                  aria-label={t("kanban.moveTo", { col: t("kanban.columns.done") })}
                  title={t("kanban.moveTo", { col: t("kanban.columns.done") })}
                  className="h-7 px-2 text-[11px] text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200 rounded-aura-sm"
                >
                  <Check className="h-3 w-3" aria-hidden="true" />
                  {t("kanban.columns.done")}
                </Button>
              )}
            </div>

            {col !== "done" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onFocusTask(task)}
                className="h-7 px-2.5 text-[11px] font-semibold text-aura-accent border-aura-accent/30 bg-aura-accent/10 hover:bg-aura-accent/20 rounded-aura-sm shrink-0"
              >
                <Play className="h-3 w-3" aria-hidden="true" /> {t("kanban.focusTask")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
