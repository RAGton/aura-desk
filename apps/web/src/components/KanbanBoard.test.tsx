import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { KanbanBoard } from "./KanbanBoard";
import i18n from "../lib/i18n";
import type { GithubIssueLink, Task } from "../lib/ipc";

const sampleTask: Task = {
  id: "task-1",
  title: "Implement pointer drag",
  priority: "high",
  status: "todo",
  kanban_order: 0,
  tags: ["gh:bug"],
  created_at: "2026-11-10T10:00:00Z",
  updated_at: "2026-11-10T10:00:00Z",
};

const sampleLink: GithubIssueLink = {
  id: "link-1",
  source: "github",
  externalId: "RAGton/AuraDesk#42",
  repo: "RAGton/AuraDesk",
  issueNumber: 42,
  issueUrl: "https://github.com/RAGton/AuraDesk/issues/42",
  title: "Implement pointer drag",
  labels: ["bug"],
  sourceStatus: "open",
  taskId: "task-1",
  titleLocked: false,
  createdAt: "2026-11-10T10:00:00Z",
  updatedAt: "2026-11-10T10:00:00Z",
};

describe("KanbanBoard press-and-hold drag & GitHub links", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("pt-BR");
  });

  it("moves a card via press-and-hold pointer drag across columns", async () => {
    const onMoveTask = vi.fn();
    render(
      <KanbanBoard
        tasks={[sampleTask]}
        githubLinks={[]}
        onMoveTask={onMoveTask}
        onUpdateTask={vi.fn()}
        onDeleteTask={vi.fn()}
        onFocusTask={vi.fn()}
      />
    );

    const card = document.querySelector('[data-task-card="task-1"]') as HTMLElement;
    const doingCol = document.querySelector('[data-kanban-column="doing"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(doingCol).toBeTruthy();

    vi.spyOn(doingCol, "getBoundingClientRect").mockReturnValue({
      left: 300,
      right: 550,
      top: 100,
      bottom: 500,
      width: 250,
      height: 400,
      x: 300,
      y: 100,
      toJSON: () => ({}),
    });

    const dispatchPointer = (
      target: EventTarget,
      type: string,
      clientX: number,
      clientY: number
    ) => {
      const ev = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
      });
      Object.defineProperty(ev, "pointerType", { value: "mouse" });
      target.dispatchEvent(ev);
    };

    act(() => {
      dispatchPointer(card, "pointerdown", 50, 150);
      dispatchPointer(window, "pointermove", 350, 220);
    });

    expect(screen.getByTestId("kanban-drag-ghost")).toBeInTheDocument();
    expect(card).toHaveAttribute("data-dragging", "true");

    act(() => {
      dispatchPointer(window, "pointerup", 350, 220);
    });

    expect(screen.queryByTestId("kanban-drag-ghost")).not.toBeInTheDocument();
    expect(onMoveTask).toHaveBeenCalledWith(sampleTask, "doing");
  });

  it("activates drag after hold delay and ignores clicks on child action buttons", () => {
    vi.useFakeTimers();
    const onMoveTask = vi.fn();
    const onDeleteTask = vi.fn();

    render(
      <KanbanBoard
        tasks={[sampleTask]}
        githubLinks={[]}
        onMoveTask={onMoveTask}
        onUpdateTask={vi.fn()}
        onDeleteTask={onDeleteTask}
        onFocusTask={vi.fn()}
      />
    );

    const deleteBtn = screen.getByRole("button", { name: "Excluir" });
    fireEvent.pointerDown(deleteBtn, { button: 0, clientX: 10, clientY: 10, pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId("kanban-drag-ghost")).not.toBeInTheDocument();

    fireEvent.click(deleteBtn);
    expect(onDeleteTask).toHaveBeenCalledWith("task-1");

    const card = document.querySelector('[data-task-card="task-1"]') as HTMLElement;
    fireEvent.pointerDown(card, { button: 0, clientX: 20, clientY: 20, pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(screen.getByTestId("kanban-drag-ghost")).toBeInTheDocument();
    fireEvent.pointerUp(window, { clientX: 20, clientY: 20 });
    expect(onMoveTask).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("renders GitHub issue badge, supports unlink, and supports keyboard Alt+Arrow moves", () => {
    const onMoveTask = vi.fn();
    const onUnlinkGithub = vi.fn();

    render(
      <KanbanBoard
        tasks={[sampleTask]}
        githubLinks={[sampleLink]}
        onMoveTask={onMoveTask}
        onUpdateTask={vi.fn()}
        onDeleteTask={vi.fn()}
        onFocusTask={vi.fn()}
        onUnlinkGithub={onUnlinkGithub}
      />
    );

    const issueLink = screen.getByRole("link", { name: /#42/i });
    expect(issueLink).toHaveAttribute("href", "https://github.com/RAGton/AuraDesk/issues/42");
    expect(screen.getByText("(Aberta)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Desvincular/i }));
    expect(onUnlinkGithub).toHaveBeenCalledWith("task-1");

    const card = document.querySelector('[data-task-card="task-1"]') as HTMLElement;
    fireEvent.keyDown(card, { key: "ArrowRight", altKey: true });
    expect(onMoveTask).toHaveBeenCalledWith(sampleTask, "doing");
  });
});
