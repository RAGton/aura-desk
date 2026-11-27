import { useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import {
  alertsApi,
  proposalsApi,
  remindersApi,
  routinesApi,
  settingsApi,
  type ReminderSound,
  type RepeatKind,
} from "../lib/ipc";
import type { CreateReminderOptions } from "../pages/RemindersPage";

export interface UseAlertsControllerOptions {
  dndUntil: string | null;
  setSettingsMap: Dispatch<SetStateAction<Record<string, unknown>>>;
  refreshAlertsDomain: () => Promise<void>;
  refreshAll: () => Promise<void>;
  notify: (text: string, isError?: boolean) => void;
}

export interface AlertsController {
  newReminderTitle: string;
  setNewReminderTitle: Dispatch<SetStateAction<string>>;
  handleCreateReminder: (delayMinutes: number, opts?: CreateReminderOptions) => Promise<void>;
  handleToggleDnd: () => Promise<void>;
  handleToggleRoutine: (id: string, enabled: boolean) => Promise<void>;
  handleApproveProposal: (id: string) => Promise<void>;
  handleRejectProposal: (id: string) => Promise<void>;
  handlePopupResolve: (id: string) => Promise<void>;
  handlePopupSnooze: (id: string) => Promise<void>;
  handlePopupDismiss: (id: string) => Promise<void>;
  handleExceptAlert: (id: string, note: string) => Promise<void>;
  handleSnoozeReminder: (id: string) => Promise<void>;
  handleDismissReminder: (id: string) => Promise<void>;
  handleDeleteReminder: (id: string) => Promise<void>;
  handleUpdateReminder: (
    id: string,
    patch: {
      title?: string;
      body?: string | null;
      fire_at?: string;
      repeat_kind?: RepeatKind;
      sound?: ReminderSound;
    }
  ) => Promise<void>;
}

/**
 * Encapsulates reminders, alerts, Do-Not-Disturb, routines, and assistant
 * proposal mutations consumed by `AppShell`.
 */
export function useAlertsController({
  dndUntil,
  setSettingsMap,
  refreshAlertsDomain,
  refreshAll,
  notify,
}: UseAlertsControllerOptions): AlertsController {
  const { t } = useTranslation();
  const [newReminderTitle, setNewReminderTitle] = useState("");

  const handleCreateReminder = async (
    delayMinutes: number,
    opts?: CreateReminderOptions
  ) => {
    if (!newReminderTitle.trim()) {
      notify(t("reminders.titleRequired"), true);
      return;
    }
    const fireAt = opts?.fireAtIso ?? new Date(Date.now() + delayMinutes * 60_000).toISOString();
    try {
      await remindersApi.create({
        title: newReminderTitle.trim(),
        body: opts?.body,
        fire_at: fireAt,
        repeat_kind: opts?.repeatKind ?? ("none" as RepeatKind),
        sound: opts?.sound ?? ("normal" as ReminderSound),
      });
      setNewReminderTitle("");
      await refreshAlertsDomain();
      notify(delayMinutes === 0 && !opts?.fireAtIso ? t("reminders.firedNow") : t("reminders.scheduled"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleToggleDnd = async () => {
    const active = Boolean(dndUntil && Date.parse(dndUntil) > Date.now());
    const nextVal = active ? null : new Date(Date.now() + 60 * 60_000).toISOString();
    try {
      await settingsApi.set("reminders.paused_until", nextVal);
      setSettingsMap((prev) => ({ ...prev, "reminders.paused_until": nextVal }));
      await refreshAll();
      notify(active ? t("reminders.dndDisabledToast") : t("reminders.dndEnabledToast"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleToggleRoutine = async (id: string, enabled: boolean) => {
    try {
      await routinesApi.setEnabled(id, enabled);
      await refreshAll();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleApproveProposal = async (id: string) => {
    try {
      await proposalsApi.approve(id);
      await refreshAll();
      notify(t("dashboard.proposalApproved"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleRejectProposal = async (id: string) => {
    try {
      await proposalsApi.reject(id);
      await refreshAll();
      notify(t("dashboard.proposalRejected"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handlePopupResolve = async (id: string) => {
    try {
      await alertsApi.resolve(id);
      await refreshAlertsDomain();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handlePopupSnooze = async (id: string) => {
    try {
      await alertsApi.snooze(id);
      await refreshAlertsDomain();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handlePopupDismiss = async (id: string) => {
    try {
      await alertsApi.dismiss(id);
      await refreshAlertsDomain();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleExceptAlert = async (id: string, note: string) => {
    try {
      await alertsApi.except(id, note);
      await refreshAll();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleSnoozeReminder = async (id: string) => {
    try {
      await remindersApi.snooze(id, 10);
      await refreshAll();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleDismissReminder = async (id: string) => {
    try {
      await remindersApi.dismiss(id);
      await refreshAll();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleDeleteReminder = async (id: string) => {
    try {
      await remindersApi.delete(id);
      await refreshAll();
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleUpdateReminder = async (
    id: string,
    patch: {
      title?: string;
      body?: string | null;
      fire_at?: string;
      repeat_kind?: RepeatKind;
      sound?: ReminderSound;
    }
  ) => {
    try {
      await remindersApi.update(id, patch);
      await refreshAll();
      notify(t("reminders.updated"));
    } catch (err) {
      notify(String(err), true);
    }
  };

  return {
    newReminderTitle,
    setNewReminderTitle,
    handleCreateReminder,
    handleToggleDnd,
    handleToggleRoutine,
    handleApproveProposal,
    handleRejectProposal,
    handlePopupResolve,
    handlePopupSnooze,
    handlePopupDismiss,
    handleExceptAlert,
    handleSnoozeReminder,
    handleDismissReminder,
    handleDeleteReminder,
    handleUpdateReminder,
  };
}
