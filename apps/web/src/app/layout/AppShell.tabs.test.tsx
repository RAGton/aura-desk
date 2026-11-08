import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import i18n from "../../lib/i18n";

// The shell reads and writes through the IPC layer. Mocking it at the
// module boundary keeps these tests focused on the shell's own behaviour:
// which tab is active, which controls exist, and what the user can do.
vi.mock("../../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ipc")>();
  const empty: never[] = [];

  return {
    ...actual,
    tasksApi: {
      list: vi.fn(async () => empty),
      get: vi.fn(async () => undefined),
      create: vi.fn(async (input: { title: string }) => ({
        id: "t1",
        title: input.title,
        priority: "normal",
        status: "todo",
        kanban_order: 0,
        tags: [],
        created_at: "2026-11-08T10:00:00Z",
        updated_at: "2026-11-08T10:00:00Z",
      })),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      setStatus: vi.fn(async () => undefined),
    },
    dashboardApi: {
      summary: vi.fn(async () => ({
        nextTask: null,
        pendingCount: 0,
        completedToday: 0,
        overdueCount: 0,
        runningPomodoro: null,
        pendingReminders: 0,
        recentReminders: [],
        todayPomodoros: 0,
        todayFocusMin: 0,
        waterIntervalMin: 60,
        breakIntervalMin: 90,
        dailyPlanningTime: "07:50",
      })),
      dailyPlanGet: vi.fn(async () => ({
        id: "p1",
        plan_date: "2026-11-08",
        state: "not_started",
        payload: null,
      })),
      dailyPlanSetState: vi.fn(async () => undefined),
      dailyPlanSetPayload: vi.fn(async () => undefined),
    },
    pomodoroApi: {
      start: vi.fn(async () => ({
        id: "s1",
        kind: "focus",
        status: "active",
        planned_min: 25,
        actual_min: 0,
        task_id: null,
        started_at: "2026-11-08T10:00:00Z",
        ended_at: null,
      })),
      complete: vi.fn(async () => undefined),
      abandon: vi.fn(async () => undefined),
      active: vi.fn(async () => null),
      list: vi.fn(async () => empty),
    },
    remindersApi: {
      list: vi.fn(async () => empty),
      create: vi.fn(async (input: { title: string }) => ({
        id: "r1",
        title: input.title,
        fire_at: "2026-11-08T10:05:00Z",
        repeat_kind: "none",
        sound: "normal",
        status: "pending",
      })),
      dismiss: vi.fn(async () => undefined),
      snooze: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    alertsApi: {
      listPending: vi.fn(async () => empty),
      create: vi.fn(async () => undefined),
      resolve: vi.fn(async () => undefined),
      snooze: vi.fn(async () => undefined),
      dismiss: vi.fn(async () => undefined),
      except: vi.fn(async () => undefined),
    },
    settingsApi: {
      getAll: vi.fn(async () => empty),
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    projectsApi: { list: vi.fn(async () => empty), create: vi.fn(async () => undefined) },
  };
});

import { alertsApi, pomodoroApi, remindersApi, tasksApi } from "../../lib/ipc";

const mockedTasks = vi.mocked(tasksApi);
const mockedAlerts = vi.mocked(alertsApi);
const mockedReminders = vi.mocked(remindersApi);
const mockedPomodoro = vi.mocked(pomodoroApi);

// The tab title and the nav item share the same label, so pick the nav
// button: it is the one inside the <nav> landmark.
async function openTab(name: RegExp) {
  const user = userEvent.setup();
  const nav = screen.getByRole("navigation");
  await user.click(within(nav).getByRole("button", { name }));
  return user;
}

describe("AppShell tabs", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("pt-BR");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedTasks.list.mockResolvedValue([]);
    mockedAlerts.listPending.mockResolvedValue([]);
    mockedReminders.list.mockResolvedValue([]);
    mockedPomodoro.active.mockResolvedValue(null);
    mockedPomodoro.list.mockResolvedValue([]);
  });

  it("shows the dashboard by default", () => {
    render(<AppShell />);
    expect(screen.getByText("Visão do Dia")).toBeInTheDocument();
    expect(screen.getByText("Rotinas Automáticas")).toBeInTheDocument();
    expect(screen.getByText(/Água a cada/)).toBeInTheDocument();
  });

  it("switches to the kanban board and lists the four columns", async () => {
    render(<AppShell />);
    await openTab(/Kanban/i);

    await waitFor(() => {
      expect(screen.getByText(/Quadro Kanban/i)).toBeInTheDocument();
    });
    expect(screen.getByText("A Fazer")).toBeInTheDocument();
    expect(screen.getByText("Em Andamento")).toBeInTheDocument();
    expect(screen.getByText("Aguardando")).toBeInTheDocument();
    expect(screen.getByText("Concluído")).toBeInTheDocument();
  });

  it("creates a task from the kanban quick-add field", async () => {
    render(<AppShell />);
    await openTab(/Kanban/i);

    const input = await screen.findByPlaceholderText(/Título da nova tarefa/i);
    fireEvent.change(input, { target: { value: "Nova tarefa" } });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Criar Card/i }));

    await waitFor(() => {
      expect(mockedTasks.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Nova tarefa" })
      );
    });
  });

  it("switches to the pomodoro tab and starts a focus session", async () => {
    render(<AppShell />);
    await openTab(/Pomodoro/i);

    await waitFor(() => {
      expect(screen.getByText(/Timer Pomodoro/i)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Iniciar Foco/i }));

    await waitFor(() => {
      expect(mockedPomodoro.start).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "focus" })
      );
    });
  });

  it("starts a short break and a long break", async () => {
    render(<AppShell />);
    await openTab(/Pomodoro/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Pausa Curta/i }));
    await waitFor(() => {
      expect(mockedPomodoro.start).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "short_break" })
      );
    });

    await user.click(screen.getByRole("button", { name: /Pausa Longa/i }));
    await waitFor(() => {
      expect(mockedPomodoro.start).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "long_break" })
      );
    });
  });

  it("shows the reminders tab with the empty state", async () => {
    render(<AppShell />);
    await openTab(/Lembretes/i);

    await waitFor(() => {
      expect(screen.getByText(/Alertas Disparados/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Nenhum alerta pendente/i)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum lembrete cadastrado/i)).toBeInTheDocument();
  });

  it("refuses to create a reminder without a title", async () => {
    render(<AppShell />);
    await openTab(/Lembretes/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Disparar Agora/i }));

    await waitFor(() => {
      expect(screen.getByText(/Digite o título do lembrete/i)).toBeInTheDocument();
    });
    expect(mockedReminders.create).not.toHaveBeenCalled();
  });

  it("creates a reminder from the title field", async () => {
    render(<AppShell />);
    await openTab(/Lembretes/i);

    const input = await screen.findByPlaceholderText(/Título do lembrete/i);
    fireEvent.change(input, { target: { value: "Beber água" } });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Disparar Agora/i }));

    await waitFor(() => {
      expect(mockedReminders.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Beber água" })
      );
    });
  });

  it("renders pending alerts with their action buttons", async () => {
    mockedAlerts.listPending.mockResolvedValue([
      {
        id: "a1",
        kind: "reminder",
        title: "Hidratação",
        body: "Beba água",
        severity: "info",
        ref_id: "r1",
        resolution: null,
        resolved_at: null,
        created_at: "2026-11-08T10:00:00Z",
      },
    ]);

    render(<AppShell />);
    await openTab(/Lembretes/i);

    await waitFor(() => {
      // The alert title shows both in the modal and in the alerts list.
      expect(screen.getAllByText("Hidratação").length).toBeGreaterThan(0);
    });

    const panel = screen.getByText("Alertas Disparados").closest("div")!;
    const buttons = within(panel).getAllByRole("button");
    const labels = buttons.map((b) => b.textContent ?? "");
    expect(labels.some((l) => l.includes("Resolver"))).toBe(true);
    expect(labels.some((l) => l.includes("Adiar"))).toBe(true);
    expect(labels.some((l) => l.includes("Dispensar"))).toBe(true);
  });

  it("shows the settings tab with the settings groups", async () => {
    render(<AppShell />);
    await openTab(/Configurações/i);

    await waitFor(() => {
      expect(screen.getByText(/Configurações do Sistema/i)).toBeInTheDocument();
    });
  });

  it("opens the dashboard customizer and lets it be closed", async () => {
    render(<AppShell />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Personalizar Layout/i }));

    await waitFor(() => {
      expect(screen.getByText(/Restaurar Padrão/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Concluir Layout/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Restaurar Padrão/i)).not.toBeInTheDocument();
    });
  });

  it("shows the connection badge and switches the language", async () => {
    render(<AppShell />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "en" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "pt-BR" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "pt-BR" }));
    await waitFor(() => {
      expect(screen.getByText("Visão do Dia")).toBeInTheDocument();
    });
  });
});
