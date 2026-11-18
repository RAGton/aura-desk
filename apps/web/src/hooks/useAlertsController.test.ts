import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../lib/i18n";
import { useAlertsController } from "./useAlertsController";

vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return {
    ...actual,
    remindersApi: {
      ...actual.remindersApi,
      create: vi.fn(),
      snooze: vi.fn(),
      dismiss: vi.fn(),
      delete: vi.fn(),
    },
    alertsApi: {
      ...actual.alertsApi,
      resolve: vi.fn(),
      snooze: vi.fn(),
      dismiss: vi.fn(),
      except: vi.fn(),
    },
    settingsApi: {
      ...actual.settingsApi,
      set: vi.fn(),
    },
    routinesApi: {
      ...actual.routinesApi,
      setEnabled: vi.fn(),
    },
    proposalsApi: {
      ...actual.proposalsApi,
      approve: vi.fn(),
      reject: vi.fn(),
    },
  };
});

import {
  alertsApi,
  proposalsApi,
  remindersApi,
  routinesApi,
  settingsApi,
} from "../lib/ipc";

describe("useAlertsController", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates reminder creation, creates reminder, and toggles DND", async () => {
    const notify = vi.fn();
    const setSettingsMap = vi.fn();
    const refreshAlertsDomain = vi.fn(async () => {});
    const refreshAll = vi.fn(async () => {});

    const { result, rerender } = renderHook(
      ({ dndUntil }) =>
        useAlertsController({
          dndUntil,
          setSettingsMap,
          refreshAlertsDomain,
          refreshAll,
          notify,
        }),
      { initialProps: { dndUntil: null as string | null } }
    );

    await act(async () => {
      await result.current.handleCreateReminder(5);
    });
    expect(notify).toHaveBeenCalledWith("Enter a reminder title first.", true);
    expect(remindersApi.create).not.toHaveBeenCalled();

    act(() => {
      result.current.setNewReminderTitle("Drink water");
    });
    await act(async () => {
      await result.current.handleCreateReminder(0);
    });
    expect(remindersApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Drink water",
        repeat_kind: "none",
        sound: "normal",
      })
    );
    expect(notify).toHaveBeenCalledWith("⚡ Reminder fired!");
    expect(refreshAlertsDomain).toHaveBeenCalled();

    await act(async () => {
      await result.current.handleToggleDnd();
    });
    expect(settingsApi.set).toHaveBeenCalledWith("reminders.paused_until", expect.any(String));
    expect(notify).toHaveBeenCalledWith("Do Not Disturb enabled for 1h.");

    rerender({ dndUntil: new Date(Date.now() + 60_000).toISOString() });
    await act(async () => {
      await result.current.handleToggleDnd();
    });
    expect(settingsApi.set).toHaveBeenCalledWith("reminders.paused_until", null);
    expect(notify).toHaveBeenCalledWith("Do Not Disturb turned off.");
  });

  it("handles routine, proposal, alert, and reminder mutations plus errors", async () => {
    const notify = vi.fn();
    const setSettingsMap = vi.fn();
    const refreshAlertsDomain = vi.fn(async () => {});
    const refreshAll = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useAlertsController({
        dndUntil: null,
        setSettingsMap,
        refreshAlertsDomain,
        refreshAll,
        notify,
      })
    );

    await act(async () => {
      await result.current.handleToggleRoutine("rt1", false);
      await result.current.handleApproveProposal("p1");
      await result.current.handleRejectProposal("p2");
      await result.current.handlePopupResolve("a1");
      await result.current.handlePopupSnooze("a2");
      await result.current.handlePopupDismiss("a3");
      await result.current.handleExceptAlert("a4", "In meeting");
      await result.current.handleSnoozeReminder("r1");
      await result.current.handleDismissReminder("r2");
      await result.current.handleDeleteReminder("r3");
    });

    expect(routinesApi.setEnabled).toHaveBeenCalledWith("rt1", false);
    expect(proposalsApi.approve).toHaveBeenCalledWith("p1");
    expect(proposalsApi.reject).toHaveBeenCalledWith("p2");
    expect(alertsApi.resolve).toHaveBeenCalledWith("a1");
    expect(alertsApi.snooze).toHaveBeenCalledWith("a2");
    expect(alertsApi.dismiss).toHaveBeenCalledWith("a3");
    expect(alertsApi.except).toHaveBeenCalledWith("a4", "In meeting");
    expect(remindersApi.snooze).toHaveBeenCalledWith("r1", 10);
    expect(remindersApi.dismiss).toHaveBeenCalledWith("r2");
    expect(remindersApi.delete).toHaveBeenCalledWith("r3");

    vi.mocked(alertsApi.resolve).mockRejectedValueOnce(new Error("IPC offline"));
    await act(async () => {
      await result.current.handlePopupResolve("a-err");
    });
    expect(notify).toHaveBeenCalledWith("Error: IPC offline", true);
  });
});
