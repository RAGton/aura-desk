import { beforeEach, describe, expect, it, vi } from "vitest";

// The browser fallback runs when no Tauri runtime is present.
//
// `isTauriRuntime()` treats a mocked `invoke` as the Tauri runtime (it
// checks for the "mock" marker), so this suite replaces the module with a
// plain function that has no such marker. That makes every call fall
// through to `invokeBrowserFallback`, which is the code under test.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(undefined),
}));

import {
  advanceCalendarMonthIso,
  alertsApi,
  dashboardApi,
  dataIoApi,
  githubApi,
  integrationApi,
  ipc,
  parseDailyPlanNotes,
  pomodoroApi,
  projectsApi,
  remindersApi,
  reportsApi,
  settingsApi,
  tasksApi,
} from "./ipc";
import { base64ToBytes, decodeZipTextEntries, encodeZipBase64 } from "./zip";

const STORAGE_KEY = "auradesk_browser_db_v1";

function seedDb(state: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readDb(): Record<string, never> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
}

describe("browser fallback (localStorage engine)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("answers ping and settings_ping", async () => {
    await expect(ipc.ping()).resolves.toBe("pong");
    await expect(settingsApi.getAll()).resolves.toEqual(expect.any(Array));
  });

  describe("tasks", () => {
    it("creates a task and lists it", async () => {
      const created = await tasksApi.create({
        title: "Escrever documentação",
        priority: "high",
      });
      expect(created.title).toBe("Escrever documentação");
      expect(created.status).toBe("todo");
      expect(created.kanban_order).toBe(0);

      const all = await tasksApi.list();
      expect(all).toHaveLength(1);
      expect(all[0].title).toBe("Escrever documentação");
    });

    it("rejects a task with an empty title", async () => {
      await expect(tasksApi.create({ title: "   ", priority: "normal" })).rejects.toThrow();
    });

    it("gets a task by id and reports a missing one", async () => {
      const created = await tasksApi.create({ title: "Tarefa", priority: "normal" });
      const found = await tasksApi.get(created.id);
      expect(found.id).toBe(created.id);
      await expect(tasksApi.get("nao-existe")).rejects.toThrow();
    });

    it("updates a task and rejects an empty title", async () => {
      const created = await tasksApi.create({ title: "Original", priority: "normal" });
      const updated = await tasksApi.update(created.id, {
        title: "  Renomeada  ",
        priority: "urgent",
      });
      expect(updated.title).toBe("Renomeada");
      expect(updated.priority).toBe("urgent");

      await expect(
        tasksApi.update(created.id, { title: "   " })
      ).rejects.toThrow();
      await expect(tasksApi.update("nao-existe", { title: "X" })).rejects.toThrow();
    });

    it("deletes a task", async () => {
      const created = await tasksApi.create({ title: "Temporária", priority: "normal" });
      await tasksApi.delete(created.id);
      await expect(tasksApi.get(created.id)).rejects.toThrow();
    });

    it("changes status and records timestamps", async () => {
      const created = await tasksApi.create({ title: "Em andamento", priority: "normal" });
      const doing = await tasksApi.setStatus({
        id: created.id,
        status: "doing",
        kanban_order: 0,
      });
      expect(doing.status).toBe("doing");
      expect(doing.started_at).toBeTruthy();

      const done = await tasksApi.setStatus({ id: created.id, status: "done", kanban_order: 0 });
      expect(done.status).toBe("done");
      expect(done.completed_at).toBeTruthy();
    });

    it("filters the task list by status and by priority", async () => {
      await tasksApi.create({ title: "A", priority: "low" });
      await tasksApi.create({ title: "B", priority: "urgent" });

      const todo = await tasksApi.list({ status: "todo" });
      expect(todo).toHaveLength(2);

      await tasksApi.setStatus({ id: todo[0].id, status: "done", kanban_order: 0 });
      const doneOnly = await tasksApi.list({ status: "done" });
      expect(doneOnly).toHaveLength(1);

      const topLevel = await tasksApi.list({ top_level_only: true });
      expect(topLevel).toHaveLength(2);
    });
  });

  describe("projects", () => {
    it("creates a project and lists it", async () => {
      const created = await projectsApi.create({ name: "AuraDesk" });
      expect(created.name).toBe("AuraDesk");
      const all = await projectsApi.list();
      expect(all).toHaveLength(1);
    });

    it("rejects a project without a name", async () => {
      await expect(projectsApi.create({ name: "  " })).rejects.toThrow();
    });
  });

  describe("pomodoro", () => {
    it("starts, completes and lists sessions", async () => {
      const started = await pomodoroApi.start({ kind: "focus", planned_min: 25 });
      expect(started.status).toBe("active");
      expect(started.kind).toBe("focus");

      const active = await pomodoroApi.active();
      expect(active?.id).toBe(started.id);

      const completed = await pomodoroApi.complete(25);
      expect(completed.status).toBe("completed");
      expect(completed.actual_min).toBe(25);

      const history = await pomodoroApi.list(10);
      expect(history.length).toBeGreaterThanOrEqual(1);
    });

    it("refuses to complete when no session is running", async () => {
      await expect(pomodoroApi.complete(25)).rejects.toThrow();
    });

    it("abandons a running session", async () => {
      await pomodoroApi.start({ kind: "focus", planned_min: 25 });
      const abandoned = await pomodoroApi.abandon(0);
      expect(abandoned.status).toBe("abandoned");
    });

    it("refuses to abandon when no session is running", async () => {
      await expect(pomodoroApi.abandon(0)).rejects.toThrow();
    });

    it("credits focus minutes to the linked task", async () => {
      const task = await tasksApi.create({ title: "Com foco", priority: "normal" });
      await pomodoroApi.start({ kind: "focus", planned_min: 25, task_id: task.id });
      await pomodoroApi.complete(25);

      const updated = await tasksApi.get(task.id);
      expect(updated.actual_min).toBe(25);
    });
  });

  describe("reminders", () => {
    it("creates a reminder and lists it", async () => {
      const created = await remindersApi.create({
        title: "Beber água",
        fire_at: new Date(Date.now() + 60_000).toISOString(),
        repeat_kind: "none",
        sound: "normal",
      });
      expect(created.title).toBe("Beber água");
      expect(created.status).toBe("pending");

      const all = await remindersApi.list(true);
      expect(all).toHaveLength(1);
    });

    it("rejects a reminder without a title", async () => {
      await expect(
        remindersApi.create({
          title: "  ",
          fire_at: new Date().toISOString(),
          repeat_kind: "none",
          sound: "normal",
        })
      ).rejects.toThrow();
    });

    it("fires an overdue reminder into an alert exactly once", async () => {
      await remindersApi.create({
        title: "Já venceu",
        fire_at: new Date(Date.now() - 1000).toISOString(),
        repeat_kind: "none",
        sound: "normal",
      });

      const pending = await alertsApi.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe("Já venceu");
      expect(pending[0].kind).toBe("reminder");

      // A second poll must not duplicate the alert.
      const again = await alertsApi.listPending();
      expect(again).toHaveLength(1);
    });

    it("does not fire a reminder scheduled in the future", async () => {
      await remindersApi.create({
        title: "Futuro",
        fire_at: new Date(Date.now() + 3_600_000).toISOString(),
        repeat_kind: "none",
        sound: "normal",
      });
      await expect(alertsApi.listPending()).resolves.toHaveLength(0);
    });

    it("snoozes, dismisses and deletes a reminder", async () => {
      const created = await remindersApi.create({
        title: "Adiar",
        fire_at: new Date(Date.now() + 60_000).toISOString(),
        repeat_kind: "none",
        sound: "normal",
      });

      // Snoozing pushes the fire time out and keeps the reminder pending.
      const snoozed = await remindersApi.snooze(created.id, 10);
      expect(snoozed.status).toBe("pending");
      expect(snoozed.snooze_count).toBe(1);
      expect(new Date(snoozed.fire_at).getTime()).toBeGreaterThan(
        new Date(created.fire_at).getTime()
      );

      const dismissed = await remindersApi.dismiss(created.id);
      expect(dismissed.status).toBe("dismissed");

      await remindersApi.delete(created.id);
      await expect(remindersApi.list(true)).resolves.toHaveLength(0);
    });
  });

  describe("alerts", () => {
    it("creates, resolves and dismisses an alert", async () => {
      const created = await alertsApi.create({
        kind: "routine",
        title: "Hidratação",
        severity: "info",
      });
      expect(created.resolution).toBeNull();

      const resolved = await alertsApi.resolve(created.id);
      expect(resolved.resolution).toBe("resolved");

      const other = await alertsApi.create({
        kind: "routine",
        title: "Pausa",
        severity: "normal",
      });
      const dismissed = await alertsApi.dismiss(other.id);
      expect(dismissed.resolution).toBe("dismissed");
    });

    it("snoozes an alert", async () => {
      const created = await alertsApi.create({
        kind: "routine",
        title: "Snooze",
        severity: "normal",
      });
      const snoozed = await alertsApi.snooze(created.id);
      expect(snoozed.resolution).toBe("snoozed");
    });

    it("records an exception with a justification", async () => {
      const created = await alertsApi.create({
        kind: "routine",
        title: "Exceção",
        severity: "normal",
      });
      const excepted = await alertsApi.except(created.id, "Reunião urgente");
      expect(excepted.resolution).toBe("excepted");
    });

    it("rejects an exception without a justification", async () => {
      const created = await alertsApi.create({
        kind: "routine",
        title: "Sem justificativa",
        severity: "normal",
      });
      await expect(alertsApi.except(created.id, "   ")).rejects.toThrow();
    });

    it("lists only alerts that are still pending", async () => {
      const a = await alertsApi.create({
        kind: "routine",
        title: "A",
        severity: "normal",
      });
      await alertsApi.create({
        kind: "routine",
        title: "B",
        severity: "normal",
      });
      await alertsApi.resolve(a.id);

      const pending = await alertsApi.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe("B");
    });
  });

  describe("settings", () => {
    it("reads defaults, sets a value and reads it back", async () => {
      const all = await settingsApi.getAll();
      const theme = all.find(([k]) => k === "app.theme");
      expect(theme?.[1]).toBe("dark");

      await settingsApi.set("app.theme", "light");
      const after = await settingsApi.getAll();
      expect(after.find(([k]) => k === "app.theme")?.[1]).toBe("light");
    });
  });

  describe("daily plan", () => {
    it("creates today's plan on first read and updates its state", async () => {
      const plan = await dashboardApi.dailyPlanGet();
      expect(plan.state).toBe("not_started");

      await dashboardApi.dailyPlanSetState(plan.id, "in_progress");
      const updated = await dashboardApi.dailyPlanGet();
      expect(updated.state).toBe("in_progress");

      await dashboardApi.dailyPlanSetPayload(plan.id, "Três prioridades");
      const withNotes = await dashboardApi.dailyPlanGet();
      expect(withNotes.payload).toBe('{"notes":"Três prioridades"}');
      expect(parseDailyPlanNotes(withNotes.payload)).toBe("Três prioridades");
      expect(parseDailyPlanNotes("Texto legado direto")).toBe("Texto legado direto");
    });
  });

  describe("dashboard summary", () => {
    it("aggregates tasks, pomodoros and settings", async () => {
      await tasksApi.create({ title: "Uma tarefa", priority: "normal" });
      await tasksApi.create({ title: "Outra", priority: "high" });

      const summary = await dashboardApi.summary();
      expect(summary.pendingCount).toBe(2);
      expect(summary.nextTask).not.toBeNull();
      expect(summary.waterIntervalMin).toBe(60);
      expect(summary.breakIntervalMin).toBe(90);
      expect(summary.dailyPlanningTime).toBe("07:50");
    });
  });

  it("persists state across calls through localStorage", async () => {
    await tasksApi.create({ title: "Persistente", priority: "normal" });
    const stored = readDb();
    expect((stored as unknown as { tasks: unknown[] }).tasks).toHaveLength(1);
  });

  it("recovers from a corrupt storage payload", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    await expect(tasksApi.list()).resolves.toEqual([]);
  });

  it("ignores a stored payload with the wrong shape", async () => {
    seedDb({ tasks: "not-an-array", settings: null });
    await expect(tasksApi.list()).resolves.toEqual([]);
  });

  describe("reports, screen block, github, and zip backup fallbacks", () => {
    it("reads settings_get and triggers blocking test alert", async () => {
      expect(await settingsApi.get("reminders.block_screen")).toBe(false);
      expect(await settingsApi.get("nonexistent.key")).toBeNull();

      const alert = await alertsApi.triggerTestBlock("Teste Lock", "Confirmar leitura");
      expect(alert.severity).toBe("urgent");
      expect(await settingsApi.get("reminders.block_screen")).toBe(true);
      await expect(alertsApi.syncDesktopLock()).resolves.toBeUndefined();
    });

    it("computes 30-day report summary with water counts and integration state", async () => {
      const a = await alertsApi.create({
        kind: "routine",
        title: "Hora da água",
        severity: "normal",
      });
      await alertsApi.resolve(a.id);

      const session = await pomodoroApi.start({ kind: "focus", planned_min: 25 });
      expect((await integrationApi.state()).inFocusSession).toBe(true);
      await pomodoroApi.complete(18);
      expect(session.planned_min).toBe(25);

      const report = await reportsApi.summary();
      expect(report.byDay).toHaveLength(14);
      expect(report.today.focusMin).toBe(18);
      expect(report.today.waterCount).toBe(1);
    });

    it("handles github issue links and zip export/import roundtrip", async () => {
      await expect(githubApi.syncIssues()).rejects.toThrow(/repoRequired/);
      await settingsApi.set("github.repo", "RAGton/AuraDesk");
      const auth = await githubApi.checkAuth();
      expect(auth.authenticated).toBe(true);

      const task = await tasksApi.create({ title: "Fix kanban drag", priority: "high" });
      const linked = await githubApi.linkTask(task.id, "RAGton/AuraDesk", 42);
      expect(linked.externalId).toBe("RAGton/AuraDesk#42");
      expect(await githubApi.listIssues()).toHaveLength(1);

      const zipB64 = await dataIoApi.exportZipBase64();
      localStorage.clear();
      const summary = await dataIoApi.importZipBase64(zipB64);
      expect(summary.tasks).toBe(1);
      expect((await tasksApi.list())[0].title).toBe("Fix kanban drag");

      await githubApi.unlinkTask(task.id);
      expect(await githubApi.listIssues()).toHaveLength(0);
    });
  });

  describe("phase 1 regression fixes", () => {
    it("exports genuine PKZIP archives containing desktop-compatible bundle.json and imports bundle.json-only archives", async () => {
      await tasksApi.create({ title: "PKZIP Task", priority: "high" });
      const zipB64 = await dataIoApi.exportZipBase64();
      const rawBytes = base64ToBytes(zipB64);

      expect(Array.from(rawBytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

      const entries = decodeZipTextEntries(zipB64);
      expect(entries["bundle.json"]).toBeDefined();
      const parsedBundle = JSON.parse(entries["bundle.json"]) as {
        version: number;
        tasks: Array<{ title: string }>;
      };
      expect(parsedBundle.version).toBe(2);
      expect(parsedBundle.tasks[0]?.title).toBe("PKZIP Task");

      // Simulate a Desktop-style bundle.json-only ZIP archive import in browser.
      localStorage.clear();
      const desktopOnlyZip = encodeZipBase64({
        "bundle.json": JSON.stringify({
          version: 2,
          exported_at: new Date().toISOString(),
          projects: [],
          tasks: [
            {
              id: "desktop-task-1",
              project_id: null,
              parent_task_id: null,
              title: "Imported from Desktop Bundle",
              description: null,
              priority: "normal",
              status: "todo",
              due_at: null,
              estimate_min: null,
              actual_min: 0,
              kanban_order: 0,
              tags: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              completed_at: null,
            },
          ],
          routines: [],
          reminders: [],
          pomodoro_sessions: [],
          daily_plans: [],
          settings: [{ key: "app.theme", value: "light" }],
        }),
      });

      const imported = await dataIoApi.importZipBase64(desktopOnlyZip);
      expect(imported.tasks).toBe(1);
      expect((await tasksApi.list())[0]?.title).toBe("Imported from Desktop Bundle");
      expect(await settingsApi.get("app.theme")).toBe("light");
    });

    it("advances monthly recurring reminders by true calendar month and clamps short months", async () => {
      expect(advanceCalendarMonthIso("2026-01-31T10:00:00.000Z")).toBe(
        "2026-02-28T10:00:00.000Z"
      );
      expect(advanceCalendarMonthIso("2028-01-31T10:00:00.000Z")).toBe(
        "2028-02-29T10:00:00.000Z"
      );
      expect(advanceCalendarMonthIso("2026-03-31T10:00:00.000Z")).toBe(
        "2026-04-30T10:00:00.000Z"
      );
      expect(advanceCalendarMonthIso("2026-12-15T14:30:00.000Z")).toBe(
        "2027-01-15T14:30:00.000Z"
      );

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-01-31T10:05:00.000Z"));
        const fireAt = "2026-01-31T10:00:00.000Z";
        const rem = await remindersApi.create({
          title: "Fatura mensal",
          fire_at: fireAt,
          repeat_kind: "monthly",
          sound: "normal",
        });
        const pendingAlerts = await alertsApi.listPending();
        const alert = pendingAlerts.find((a) => a.ref_id === rem.id);
        expect(alert).toBeDefined();

        await alertsApi.resolve(alert!.id);
        const updated = (await remindersApi.list(true)).find((r) => r.id === rem.id);
        expect(updated?.status).toBe("pending");
        expect(updated?.fire_at).toBe("2026-02-28T10:00:00.000Z");
      } finally {
        vi.useRealTimers();
      }
    });

    it("reorders tasks in a single atomic batch and rolls back on missing task id", async () => {
      const t1 = await tasksApi.create({ title: "First", status: "todo", priority: "normal" });
      const t2 = await tasksApi.create({ title: "Second", status: "todo", priority: "normal" });

      const reordered = await tasksApi.reorder([
        { id: t2.id, status: "doing", kanban_order: 0 },
        { id: t1.id, status: "done", kanban_order: 1 },
      ]);
      expect(reordered).toHaveLength(2);
      const t1After = reordered.find((t) => t.id === t1.id);
      const t2After = reordered.find((t) => t.id === t2.id);
      expect(t2After?.status).toBe("doing");
      expect(t2After?.kanban_order).toBe(0);
      expect(t1After?.status).toBe("done");
      expect(t1After?.completed_at).not.toBeNull();

      await expect(
        tasksApi.reorder([
          { id: t2.id, status: "todo", kanban_order: 5 },
          { id: "nonexistent-task", status: "todo", kanban_order: 6 },
        ])
      ).rejects.toThrow();

      // Verify t2 stayed in "doing" after rollback.
      const persistedT2 = (await tasksApi.list()).find((t) => t.id === t2.id);
      expect(persistedT2?.status).toBe("doing");
    });

    it("unlocks pending alerts and disables screen block via emergencyUnlock", async () => {
      await alertsApi.triggerTestBlock("Lock test", "Testing emergency unlock");
      expect(await settingsApi.get("reminders.block_screen")).toBe(true);
      expect((await alertsApi.listPending()).length).toBeGreaterThan(0);

      const dismissedCount = await alertsApi.emergencyUnlock();
      expect(dismissedCount).toBeGreaterThan(0);
      expect(await alertsApi.listPending()).toHaveLength(0);
      expect(await settingsApi.get("reminders.block_screen")).toBe(false);
    });

    it("suppresses overdue reminder firing while reminders.paused_until (DND) is active", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-11-17T12:00:00.000Z"));
        await settingsApi.set("reminders.paused_until", "2026-11-17T13:00:00.000Z");

        await remindersApi.create({
          title: "Silenced overdue",
          fire_at: "2026-11-17T11:55:00.000Z",
          repeat_kind: "none",
          sound: "normal",
        });

        expect(await alertsApi.listPending()).toHaveLength(0);

        // Once DND expires or is cleared, the overdue reminder fires normally.
        await settingsApi.set("reminders.paused_until", null);
        const pending = await alertsApi.listPending();
        expect(pending.some((a) => a.title === "Silenced overdue")).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
