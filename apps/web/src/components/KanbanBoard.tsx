import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { GithubIssueLink, Task, TaskPriority, TaskStatus } from "../lib/ipc";
import { KANBAN_COLUMNS, TaskCard } from "./TaskCard";

export interface KanbanBoardProps {
  tasks: Task[];
  githubLinks: GithubIssueLink[];
  onMoveTask: (task: Task, targetStatus: TaskStatus) => void | Promise<void>;
  onUpdateTask: (taskId: string, title: string, priority: TaskPriority) => void | Promise<void>;
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

export function KanbanBoard({
  tasks,
  githubLinks,
  onMoveTask,
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

  const dragSessionRef = useRef<PointerDragSession | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const onMoveTaskRef = useRef(onMoveTask);
  onMoveTaskRef.current = onMoveTask;

  const linkByTaskId = useMemo(() => {
    const map = new Map<string, GithubIssueLink>();
    for (const link of githubLinks) {
      if (link.taskId) map.set(link.taskId, link);
    }
    return map;
  }, [githubLinks]);

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
          const colTasks = tasks.filter((x) => x.status === col);
          const isDropTarget = Boolean(
            dragSession?.active && hoveredCol === col && dragSession.task.status !== col
          );

          return (
            <div
              key={col}
              data-kanban-column={col}
              className={`rounded-xl bg-slate-900/50 p-3.5 ring-1 flex flex-col gap-3 min-h-[340px] transition-colors ${
                isDropTarget
                  ? "ring-2 ring-sky-400 bg-sky-500/10"
                  : "ring-slate-800/80"
              }`}
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  {t(`kanban.columns.${col}`)}
                </h3>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-sky-400 tabular-nums">
                  {colTasks.length}
                </span>
              </div>

              {colTasks.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-8">
                  {t("kanban.emptyColumn")}
                </p>
              ) : (
                colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    col={col}
                    githubLink={linkByTaskId.get(task.id) ?? null}
                    isDragging={Boolean(
                      dragSession?.active && dragSession.task.id === task.id
                    )}
                    isEditing={editingTaskId === task.id}
                    editingTitle={editingTaskTitle}
                    editingPriority={editingTaskPriority}
                    onStartEdit={(tk) => {
                      setEditingTaskId(tk.id);
                      setEditingTaskTitle(tk.title);
                      setEditingTaskPriority(tk.priority);
                    }}
                    onChangeEditTitle={setEditingTaskTitle}
                    onChangeEditPriority={setEditingTaskPriority}
                    onSaveEdit={async (tk) => {
                      await onUpdateTask(tk.id, editingTaskTitle, editingTaskPriority);
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
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-slate-900/95 px-3.5 py-2 shadow-2xl ring-2 ring-sky-400 max-w-xs"
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
