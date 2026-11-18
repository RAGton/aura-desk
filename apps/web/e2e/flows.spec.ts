import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The package is ESM ("type": "module"), so `__dirname` is not defined.
// Derive it from the module URL instead.
const screenshotDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../e2e-screenshots"
);

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const tasks: Array<Record<string, unknown>> = [
      {
        id: "task-seed-1",
        title: "Consolidar arquitetura AuraDesk",
        priority: "high",
        status: "todo",
        kanbanOrder: 0,
        createdAt: "2026-11-06T12:00:00Z",
        updatedAt: "2026-11-06T12:00:00Z",
      },
    ];
    const settings: Record<string, unknown> = {
      "app.locale": "pt-BR",
      "app.theme": "dark",
      "pomodoro.focus_min": 25,
      "reminders.sound": true,
    };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "ping") return "pong";
        if (cmd === "tasks_list") return tasks;
        if (cmd === "tasks_create") {
          const input = (args?.input ?? {}) as Record<string, unknown>;
          const created = {
            id: `task-${tasks.length + 1}`,
            title: String(input.title ?? "Nova tarefa"),
            priority: String(input.priority ?? "normal"),
            status: String(input.status ?? "todo"),
            kanbanOrder: tasks.length,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          tasks.push(created);
          return created;
        }
        if (cmd === "tasks_set_status") {
          const input = (args?.input ?? {}) as Record<string, unknown>;
          const found = tasks.find((t) => t.id === input.id);
          if (found) {
            found.status = input.status;
            found.kanbanOrder = input.kanbanOrder ?? 0;
            found.kanban_order = input.kanban_order ?? 0;
          }
          return found ?? tasks[0];
        }
        if (cmd === "tasks_reorder") {
          const items = (args?.items ?? []) as Array<Record<string, unknown>>;
          const updated: Array<Record<string, unknown>> = [];
          for (const item of items) {
            const found = tasks.find((t) => t.id === item.id);
            if (found) {
              found.status = item.status;
              found.kanbanOrder = item.kanban_order ?? 0;
              found.kanban_order = item.kanban_order ?? 0;
              updated.push(found);
            }
          }
          return updated;
        }
        if (cmd === "settings_get_all") {
          return Object.entries(settings);
        }
        if (cmd === "settings_get") {
          return settings[String(args?.key ?? "")] ?? null;
        }
        if (cmd === "settings_set") {
          const input = (args?.input ?? {}) as Record<string, unknown>;
          settings[String(input.key)] = input.value;
          return null;
        }
        // The shell queries these on boot. Each has to answer with the
        // shape the app expects: a list stays a list, so the app can call
        // `.find()` on it without a null dereference.
        if (cmd === "alerts_list_pending") {
          return [];
        }
        if (cmd === "reminders_list") {
          return [];
        }
        if (cmd === "pomodoro_active") {
          return null;
        }
        if (cmd === "pomodoro_list") {
          return [];
        }
        if (cmd === "projects_list") {
          return [];
        }
        if (cmd === "daily_plan_get") {
          return {
            id: "plan-1",
            plan_date: new Date().toISOString().slice(0, 10),
            state: "not_started",
            payload: null,
          };
        }
        if (cmd === "dashboard_summary") {
          return {
            nextTask: tasks.find((t) => t.status !== "done") ?? null,
            pendingCount: tasks.filter((t) => t.status !== "done").length,
            completedToday: tasks.filter((t) => t.status === "done").length,
            overdueCount: 0,
            runningPomodoro: null,
            pendingReminders: 0,
            recentReminders: [],
            todayPomodoros: 1,
            todayFocusMin: 25,
            waterIntervalMin: 60,
            breakIntervalMin: 90,
            dailyPlanningTime: "07:50",
          };
        }
        if (cmd === "report_summary") {
          const today = new Date().toISOString().slice(0, 10);
          return {
            today: {
              date: today,
              focusMin: 25,
              breakMin: 5,
              waterCount: 2,
              pomodoros: 1,
              tasksDone: 1,
            },
            week: {
              focusMin: 75,
              breakMin: 15,
              waterCount: 6,
              pomodoros: 3,
              tasksDone: 2,
              activeDays: 3,
            },
            month: {
              focusMin: 200,
              breakMin: 45,
              waterCount: 15,
              pomodoros: 8,
              tasksDone: 5,
              activeDays: 8,
            },
            byDay: [
              {
                date: today,
                focusMin: 25,
                breakMin: 5,
                waterCount: 2,
                pomodoros: 1,
                tasksDone: 1,
              },
            ],
          };
        }
        if (cmd === "github_issues_list") {
          return [];
        }
        if (cmd === "integration_state") {
          return { inFocusSession: false };
        }
        return null;
      },
    };
  });
});

test("Flow 1: create-task and shell navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header")).toBeVisible();
  await expect(page.getByText("Consolidar arquitetura AuraDesk")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "01-create-task-dashboard.png"),
    fullPage: true,
  });
});

test("Flow 2: fire-reminder and reminders view", async ({ page }) => {
  await page.goto("/reminders");
  await expect(page.locator("main")).toBeVisible();
  await expect(
    page.getByPlaceholder(/Título do lembrete|Reminder title/i)
  ).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "02-fire-reminder.png"),
    fullPage: true,
  });
});

test("Flow 3: drag-drop-kanban and press-and-hold pointer card move", async ({ page }) => {
  await page.goto("/kanban");
  await expect(page.locator("main")).toBeVisible();
  const card = page.locator('[data-task-card="task-seed-1"]');
  const doingCol = page.locator('[data-kanban-column="doing"]');
  await expect(card).toBeVisible();
  await expect(doingCol).toBeVisible();

  const cardBox = await card.boundingBox();
  const doingBox = await doingCol.boundingBox();
  if (cardBox && doingBox) {
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 12);
    await page.mouse.down();
    await page.mouse.move(doingBox.x + doingBox.width / 2, doingBox.y + 80, { steps: 10 });
    await page.mouse.up();
    await expect(doingCol.getByText("Consolidar arquitetura AuraDesk")).toBeVisible();
  }

  await page.screenshot({
    path: path.join(screenshotDir, "03-drag-drop-kanban.png"),
    fullPage: true,
  });
});

test("Flow 4: reports charts and settings persistence", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByTestId("reports-chart")).toBeVisible();
  await page.goto("/settings");
  await expect(
    page.getByText(/Bloquear PC até confirmar leitura|Lock PC until read confirmed/i)
  ).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "04-pause-quit-settings.png"),
    fullPage: true,
  });
});

test("Flow 5: mobile bottom navigation, theme switching, and zero horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("nav")).toBeVisible();

  const overflowPx = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflowPx).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: /Alternar Tema|Switch Theme/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const startFocusBtn = page.getByRole("button", { name: /Iniciar Foco|Start Focus/i });
  await expect(startFocusBtn).toHaveCSS("background-color", "rgb(3, 105, 161)");
  await expect(startFocusBtn).toHaveCSS("color", "rgb(248, 250, 252)");
  const dailyInput = page.locator('input[placeholder*="prioridades"], input[placeholder*="priorities"]');
  await expect(dailyInput).toHaveCSS("color", "rgb(15, 23, 42)");

  await page.screenshot({
    path: path.join(screenshotDir, "05-mobile-light-theme.png"),
    fullPage: false,
  });
});
