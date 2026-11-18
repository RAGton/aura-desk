import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../lib/i18n";
import { RemindersPage } from "./RemindersPage";
import type { Alert, Reminder } from "../lib/ipc";

describe("RemindersPage", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  const sampleAlerts: Alert[] = [
    {
      id: "a1",
      kind: "routine",
      title: "Drink water",
      body: "Hydration break",
      severity: "normal",
      created_at: "2026-11-17T10:00:00Z",
    },
    {
      id: "a2",
      kind: "reminder",
      title: "Standup meeting",
      body: null,
      severity: "urgent",
      created_at: "2026-11-17T10:05:00Z",
    },
  ];

  const sampleReminders: Reminder[] = [
    {
      id: "r1",
      task_id: null,
      title: "Deploy check",
      body: "Verify CI green",
      fire_at: "2026-11-17T12:00:00Z",
      repeat_kind: "daily",
      sound: "urgent",
      status: "snoozed",
      snooze_count: 1,
      created_at: "2026-11-17T09:00:00Z",
      updated_at: "2026-11-17T10:00:00Z",
    },
  ];

  it("renders templates, schedules reminder, toggles DND, and resolves alerts", async () => {
    const onChangeTitle = vi.fn();
    const onCreateReminder = vi.fn(async () => {});
    const onToggleDnd = vi.fn(async () => {});
    const onResolveAlert = vi.fn(async () => {});
    const onSnoozeAlert = vi.fn(async () => {});
    const onExceptAlert = vi.fn(async () => {});
    const onDismissAlert = vi.fn(async () => {});
    const onSnoozeReminder = vi.fn(async () => {});
    const onDismissReminder = vi.fn(async () => {});
    const onDeleteReminder = vi.fn(async () => {});

    render(
      <RemindersPage
        reminders={sampleReminders}
        alerts={sampleAlerts}
        newReminderTitle="Check build"
        dndUntil={null}
        onChangeTitle={onChangeTitle}
        onCreateReminder={onCreateReminder}
        onToggleDnd={onToggleDnd}
        onResolveAlert={onResolveAlert}
        onSnoozeAlert={onSnoozeAlert}
        onExceptAlert={onExceptAlert}
        onDismissAlert={onDismissAlert}
        onSnoozeReminder={onSnoozeReminder}
        onDismissReminder={onDismissReminder}
        onDeleteReminder={onDeleteReminder}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Do Not Disturb (1h)" }));
    expect(onToggleDnd).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Drink water" }));
    expect(onChangeTitle).toHaveBeenCalledWith("Drink water");

    fireEvent.click(screen.getByRole("button", { name: "Fire Now (Test)" }));
    await waitFor(() => {
      expect(onCreateReminder).toHaveBeenCalledWith(0, expect.any(Object));
    });

    // Resolve all pending alerts
    fireEvent.click(screen.getByRole("button", { name: "Resolve All" }));
    await waitFor(() => {
      expect(onResolveAlert).toHaveBeenCalledWith("a1");
      expect(onResolveAlert).toHaveBeenCalledWith("a2");
    });

    // Open exception form for first alert and submit justification
    const exceptionButtons = screen.getAllByRole("button", { name: "Exception" });
    fireEvent.click(exceptionButtons[0]);
    const noteInput = screen.getByLabelText("Reason for exception");
    fireEvent.change(noteInput, { target: { value: "Recording demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onExceptAlert).toHaveBeenCalledWith("a1", "Recording demo");
    });

    // Two-step reminder delete confirmation
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDeleteReminder).toHaveBeenCalledWith("r1");
  });
});
