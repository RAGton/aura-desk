import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./CommandPalette";
import type { Task } from "@/lib/ipc";

const sampleTasks: Task[] = [
  {
    id: "t1",
    title: "Revisar arquitetura IPC",
    description: null,
    status: "todo",
    priority: "high",
    tags: ["rust"],
    estimate_min: 30,
    actual_min: 0,
    due_at: null,
    recurrence_id: null,
    project_id: null,
    parent_task_id: null,
    kanban_order: 0,
    created_at: "2026-11-21T10:00:00Z",
    updated_at: "2026-11-21T10:00:00Z",
    completed_at: null,
  },
];

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CommandPalette
        open={false}
        onClose={vi.fn()}
        tasks={sampleTasks}
        hasActivePomodoro={false}
        pomodoroPaused={false}
        onSelectTab={vi.fn()}
        onQuickCreateTask={vi.fn()}
        onStartPomodoro={vi.fn()}
        onTogglePausePomodoro={vi.fn()}
        onToggleDnd={vi.fn()}
        onToggleTheme={vi.fn()}
        onToggleCompact={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("filters tasks and supports quick-creating a task via Enter", () => {
    const onClose = vi.fn();
    const onQuickCreateTask = vi.fn();

    render(
      <CommandPalette
        open
        onClose={onClose}
        tasks={sampleTasks}
        hasActivePomodoro={false}
        pomodoroPaused={false}
        onSelectTab={vi.fn()}
        onQuickCreateTask={onQuickCreateTask}
        onStartPomodoro={vi.fn()}
        onTogglePausePomodoro={vi.fn()}
        onToggleDnd={vi.fn()}
        onToggleTheme={vi.fn()}
        onToggleCompact={vi.fn()}
      />
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Nova tarefa rapida" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onQuickCreateTask).toHaveBeenCalledWith("Nova tarefa rapida");
  });

  it("navigates to matching task and starts Pomodoro focus", () => {
    const onSelectTab = vi.fn();
    const onStartPomodoro = vi.fn();
    const onClose = vi.fn();

    render(
      <CommandPalette
        open
        onClose={onClose}
        tasks={sampleTasks}
        hasActivePomodoro={false}
        pomodoroPaused={false}
        onSelectTab={onSelectTab}
        onQuickCreateTask={vi.fn()}
        onStartPomodoro={onStartPomodoro}
        onTogglePausePomodoro={vi.fn()}
        onToggleDnd={vi.fn()}
        onToggleTheme={vi.fn()}
        onToggleCompact={vi.fn()}
      />
    );

    const taskBtn = screen.getByText("Revisar arquitetura IPC");
    fireEvent.click(taskBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelectTab).toHaveBeenCalledWith("pomodoro");
    expect(onStartPomodoro).toHaveBeenCalledWith("t1");
  });
});
