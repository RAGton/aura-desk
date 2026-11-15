import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GithubIssueLink, Project, Task, TaskPriority, TaskStatus } from "../lib/ipc";
import { KANBAN_COLUMNS, TaskCard } from "./TaskCard";

export interface TaskEditExtra {
  description?: string | null;
  estimateMin?: number | null;
  tags?: string[] | null;
}

export interface KanbanBoardProps {
  tasks: Task[];
  githubLinks: GithubIssueLink[];
  projects?: Project[];
  requireDeleteConfirm?: boolean;
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
  onUnlinkGithub?: (taskId: string) => void | Promise<void>;
}

interface PointerDragSession {
  task: Task;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
}

const DRAG_THRESHOLD_PX = 6;
const PRESS_HOLD_MS = 140;

function findColumnAtPoint(clientX: number, clientY: number): TaskStatus | null {
  if (typeof document.elementsFromPoint === "function") {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const el of stack) {
      const col = el.getAttribute?.("data-kanban-column") as TaskStatus | null;
      if (col && KANBAN_COLUMNS.includes(col)) {
        return col;
      }
      const parentCol = (el as HTMLElement).closest?.("[data-kanban-column]")?.getAttribute(
        "data-kanban-column"
      ) as TaskStatus | null;
      if (parentCol && KANBAN_COLUMNS.includes(parentCol)) {
        return parentCol;
      }
    }
  }

  // Fallback for test environments (e.g., jsdom) where elementsFromPoint may be absent.
  const cols = document.querySelectorAll<HTMLElement>("[data-kanban-column]");
  for (const el of cols) {
    const rect = el.getBoundingClientRect();
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      const col = el.getAttribute("data-kanban-column") as TaskStatus | null;
      if (col && KANBAN_COLUMNS.includes(col)) return col;
    }
  }

  return null;
}

function findDropIndexInColumn(col: TaskStatus, clientY: number, draggedId: string): number {
  const colEl = document.querySelector<HTMLElement>(`[data-kanban-column="${col}"]`);
  if (!colEl) return 0;
  const cards = Array.from(colEl.querySelectorAll<HTMLElement>("[data-task-card]"));
  let index = 0;
  for (const card of cards) {
    if (card.getAttribute("data-task-card") === draggedId) continue;
    const rect = card.getBoundingClientRect();
    if (clientY > rect.top + rect.height / 2) {
      index += 1;
    }
  }
  return index;
}

export function KanbanBoard({
  tasks,
  githubLinks,
  projects = [],
  requireDeleteConfirm = false,
  onMoveTask,
  onReorderTask,
  onUpdateTask,
  onDeleteTask,
  onFocusTask,
  onUnlinkGithub,
}: KanbanBoardProps) {
  const { t } = useTranslation();
  const [dragSession, setDragSession] = useState<PointerDragSession | null>(null);
  const [hoveredCol, setHoveredCol] = useState<TaskStatus | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [editingTaskPriority, setEditingTaskPriority] = useState<TaskPriority>("normal");
  const [editingTaskDescription, setEditingTaskDescription] = useState("");
  const [editingTaskEstimate, setEditingTaskEstimate] = useState("");
  const [editingTaskTags, setEditingTaskTags] = useState("");

  const dragSessionRef = useRef<PointerDragSession | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const onMoveTaskRef = useRef(onMoveTask);
  onMoveTaskRef.current = onMoveTask;
  const onReorderTaskRef = useRef(onReorderTask);
  onReorderTaskRef.current = onReorderTask;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const linkByTaskId = useMemo(() => {
    const map = new Map<string, GithubIssueLink>();
    for (const link of githubLinks) {
      if (link.taskId) map.set(link.taskId, link);
    }
    return map;
  }, [githubLinks]);

  const projectById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) {
      map.set(p.id, p);
    }
    return map;
  }, [projects]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const cur = dragSessionRef.current;
      if (!cur) return;
      const clientX = typeof e.clientX === "number" ? e.clientX : cur.x;
      const clientY = typeof e.clientY === "number" ? e.clientY : cur.y;
      const dx = clientX - cur.startX;
      const dy = clientY - cur.startY;
      const movedEnough = Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
      const active = cur.active || movedEnough;
      if (active) {
        clearHoldTimer();
      }
      const next: PointerDragSession = {
        ...cur,
        x: clientX,
        y: clientY,
        active,
      };
      dragSessionRef.current = next;
      setDragSession(next);
      if (active) {
        setHoveredCol(findColumnAtPoint(clientX, clientY));
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      clearHoldTimer();
      const cur = dragSessionRef.current;
      if (!cur) return;
      dragSessionRef.current = null;
      setDragSession(null);
      setHoveredCol(null);

      if (cur.active) {
        const clientX = typeof e.clientX === "number" ? e.clientX : cur.x;
        const clientY = typeof e.clientY === "number" ? e.clientY : cur.y;
        const targetCol = findColumnAtPoint(clientX, clientY);
        if (targetCol && targetCol !== cur.task.status) {
          void onMoveTaskRef.current(cur.task, targetCol);
        } else if (targetCol && targetCol === cur.task.status && onReorderTaskRef.current) {
          const colTasks = tasksRef.current
            .filter((x) => x.status === targetCol)
            .sort((a, b) => a.kanban_order - b.kanban_order);
          const currentIdx = colTasks.findIndex((x) => x.id === cur.task.id);
          const targetIdx = findDropIndexInColumn(targetCol, clientY, cur.task.id);
          if (currentIdx >= 0 && targetIdx !== currentIdx) {
            void onReorderTaskRef.current(cur.task, targetIdx);
          }
        }
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      clearHoldTimer();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  const handleCardPointerDown = (e: React.PointerEvent<HTMLDivElement>, task: Task) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, input, select, textarea, a, [data-no-drag]")) {
      return;
    }

    const startX = typeof e.clientX === "number" ? e.clientX : 0;
    const startY = typeof e.clientY === "number" ? e.clientY : 0;

    clearHoldTimer();
    const initial: PointerDragSession = {
      task,
      startX,
      startY,
      x: startX,
      y: startY,
      active: false,
    };
    dragSessionRef.current = initial;
    setDragSession(initial);

    // Long press engages drag mode even before the user starts sliding the card.
    holdTimerRef.current = window.setTimeout(() => {
      const cur = dragSessionRef.current;
      if (!cur || cur.task.id !== task.id) return;
      const engaged: PointerDragSession = { ...cur, active: true };
      dragSessionRef.current = engaged;
      setDragSession(engaged);
      setHoveredCol(findColumnAtPoint(engaged.x, engaged.y));
    }, PRESS_HOLD_MS);
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {KANBAN_COLUMNS.map((col) => {
          const colTasks = tasks
            .filter((x) => x.status === col)
            .sort((a, b) => a.kanban_order - b.kanban_order);
          const totalEstimate = colTasks.reduce((sum, tk) => sum + (tk.estimate_min ?? 0), 0);
          const isDropTarget = Boolean(
            dragSession?.active && hoveredCol === col && dragSession.task.status !== col
          );
          const colAccent =
            col === "todo"
              ? "border-t-2 border-t-sky-400/70"
              : col === "doing"
                ? "border-t-2 border-t-amber-400/70"
                : col === "waiting"
                  ? "border-t-2 border-t-violet-400/70"
                  : "border-t-2 border-t-emerald-400/70";
          const dotAccent =
            col === "todo"
              ? "bg-sky-400"
              : col === "doing"
                ? "bg-amber-400"
                : col === "waiting"
                  ? "bg-violet-400"
                  : "bg-emerald-400";

          return (
            <div
              key={col}
              data-kanban-column={col}
              className={`rounded-2xl aura-glass ${colAccent} p-3.5 flex flex-col gap-3 min-h-[360px] transition-colors ${
                isDropTarget ? "ring-2 ring-sky-400 bg-sky-500/10" : ""
              }`}
            >
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${dotAccent}`} />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    {t(`kanban.columns.${col}`)}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  {totalEstimate > 0 && (
                    <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-300 tabular-nums">
                      {totalEstimate}m
                    </span>
                  )}
                  <span className="rounded-full aura-glass-pill px-2 py-0.5 text-[11px] font-semibold text-sky-400 tabular-nums">
                    {colTasks.length}
                  </span>
                </div>
              </div>

              {colTasks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-800/80 bg-slate-950/20 text-xs text-slate-500 text-center py-8 px-3">
                  {t("kanban.emptyColumn")}
                </p>
              ) : (
                colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    col={col}
                    githubLink={linkByTaskId.get(task.id) ?? null}
                    project={task.project_id ? (projectById.get(task.project_id) ?? null) : null}
                    requireDeleteConfirm={requireDeleteConfirm}
                    isDragging={Boolean(
                      dragSession?.active && dragSession.task.id === task.id
                    )}
                    isEditing={editingTaskId === task.id}
                    editingTitle={editingTaskTitle}
                    editingPriority={editingTaskPriority}
                    editingDescription={editingTaskDescription}
                    editingEstimate={editingTaskEstimate}
                    editingTags={editingTaskTags}
                    onStartEdit={(tk) => {
                      setEditingTaskId(tk.id);
                      setEditingTaskTitle(tk.title);
                      setEditingTaskPriority(tk.priority);
                      setEditingTaskDescription(tk.description ?? "");
                      setEditingTaskEstimate(
                        tk.estimate_min != null ? String(tk.estimate_min) : ""
                      );
                      setEditingTaskTags(Array.isArray(tk.tags) ? tk.tags.join(", ") : "");
                    }}
                    onChangeEditTitle={setEditingTaskTitle}
                    onChangeEditPriority={setEditingTaskPriority}
                    onChangeEditDescription={setEditingTaskDescription}
                    onChangeEditEstimate={setEditingTaskEstimate}
                    onChangeEditTags={setEditingTaskTags}
                    onSaveEdit={async (tk) => {
                      const parsedTags = editingTaskTags
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                      const parsedEst = editingTaskEstimate.trim()
                        ? Number(editingTaskEstimate)
                        : null;
                      await onUpdateTask(tk.id, editingTaskTitle, editingTaskPriority, {
                        description: editingTaskDescription.trim() || null,
                        estimateMin:
                          parsedEst !== null && Number.isFinite(parsedEst) && parsedEst > 0
                            ? parsedEst
                            : null,
                        tags: parsedTags.length > 0 ? parsedTags : null,
                      });
                      setEditingTaskId(null);
                    }}
                    onCancelEdit={() => setEditingTaskId(null)}
                    onMove={onMoveTask}
                    onFocusTask={onFocusTask}
                    onDeleteTask={onDeleteTask}
                    onUnlinkGithub={onUnlinkGithub}
                    onCardPointerDown={handleCardPointerDown}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>

      {dragSession?.active && (
        <div
          data-testid="kanban-drag-ghost"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl aura-glass-elevated px-3.5 py-2 shadow-2xl ring-2 ring-sky-400 max-w-xs"
          style={{ left: dragSession.x, top: dragSession.y }}
        >
          <div className="text-xs font-bold text-slate-100 truncate">
            {dragSession.task.title}
          </div>
          <div className="text-[10px] text-sky-300">{t("kanban.holdingToDrag")}</div>
        </div>
      )}
    </>
  );
}
