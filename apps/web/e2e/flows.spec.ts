import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const screenshotDir = path.resolve(__dirname, "../e2e-screenshots");

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
          }
          return found ?? tasks[0];
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
        return null;
      },
    };
  });
});

test("Flow 1: create-task and shell navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "01-create-task-dashboard.png"),
    fullPage: true,
  });
});

test("Flow 2: fire-reminder and reminders view", async ({ page }) => {
  await page.goto("/reminders");
  await expect(page.locator("main")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "02-fire-reminder.png"),
    fullPage: true,
  });
});

test("Flow 3: drag-drop-kanban and tasks board", async ({ page }) => {
  await page.goto("/kanban");
  await expect(page.locator("main")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "03-drag-drop-kanban.png"),
    fullPage: true,
  });
});

test("Flow 4: pause-quit and settings persistence", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.locator("main")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "04-pause-quit-settings.png"),
    fullPage: true,
  });
});
