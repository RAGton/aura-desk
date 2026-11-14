import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";

import type { Alert, Reminder } from "../lib/ipc";

export interface RemindersPageProps {
  reminders: Reminder[];
  alerts: Alert[];
  newReminderTitle: string;
  onChangeTitle: (v: string) => void;
  onCreateReminder: (delayMinutes: number) => void | Promise<void>;
  onResolveAlert: (id: string) => void | Promise<void>;
  onSnoozeAlert: (id: string) => void | Promise<void>;
  onExceptAlert: (id: string, note: string) => void | Promise<void>;
  onDismissAlert: (id: string) => void | Promise<void>;
  onSnoozeReminder: (id: string) => void | Promise<void>;
  onDismissReminder: (id: string) => void | Promise<void>;
  onDeleteReminder: (id: string) => void | Promise<void>;
}

export function RemindersPage({
  reminders,
  alerts,
  newReminderTitle,
  onChangeTitle,
  onCreateReminder,
  onResolveAlert,
  onSnoozeAlert,
  onExceptAlert,
  onDismissAlert,
  onSnoozeReminder,
  onDismissReminder,
  onDeleteReminder,
}: RemindersPageProps) {
  const { t } = useTranslation();
  const [exceptAlertId, setExceptAlertId] = useState<string | null>(null);
  const [exceptNote, setExceptNote] = useState("");

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-4">
        <h2 className="text-lg font-bold text-slate-50">{t("reminders.title")}</h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={newReminderTitle}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder={t("reminders.newPlaceholder")}
            className="flex-1 min-w-[240px] rounded-lg bg-slate-950 px-3.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 outline-none focus:ring-sky-500"
          />
          <button
            type="button"
            onClick={() => void onCreateReminder(0)}
            className="rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
          >
            ⚡ {t("reminders.addNow")}
          </button>
          <button
            type="button"
            onClick={() => void onCreateReminder(1)}
            className="rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
          >
            + {t("reminders.addIn1Min")}
          </button>
          <button
            type="button"
            onClick={() => void onCreateReminder(15)}
            className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            + {t("reminders.addIn15Min")}
          </button>
          <button
            type="button"
            onClick={() => void onCreateReminder(60)}
            className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            + {t("reminders.addIn1Hour")}
          </button>
        </div>
      </div>

      {/* Pending Alerts */}
      <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-3">
        <h3 className="text-sm font-semibold text-amber-300">{t("reminders.activeAlerts")}</h3>
        {alerts.length === 0 ? (
          <p className="text-xs text-slate-500">{t("reminders.noAlerts")}</p>
        ) : (
          <div className="space-y-2.5">
            {alerts.map((a) => (
              <div
                key={a.id}
                className="rounded-lg bg-amber-500/10 p-3.5 ring-1 ring-amber-500/30 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-amber-200">{a.title}</div>
                    {a.body && <div className="text-xs text-amber-300/80">{a.body}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void onResolveAlert(a.id)}
                      className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white cursor-pointer"
                    >
                      ✓ {t("reminders.resolve")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onSnoozeAlert(a.id)}
                      className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 cursor-pointer"
                    >
                      ⏰ {t("reminders.snooze")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExceptAlertId(exceptAlertId === a.id ? null : a.id)}
                      className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-amber-300 cursor-pointer"
                    >
                      {t("reminders.except")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDismissAlert(a.id)}
                      className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400 cursor-pointer"
                    >
                      {t("reminders.dismiss")}
                    </button>
                  </div>
                </div>
                {exceptAlertId === a.id && (
                  <div className="flex gap-2 pt-2">
                    <input
                      type="text"
                      value={exceptNote}
                      onChange={(e) => setExceptNote(e.target.value)}
                      placeholder={t("reminders.exceptPlaceholder")}
                      className="flex-1 rounded bg-slate-950 px-2.5 py-1 text-xs text-slate-100 ring-1 ring-slate-700"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!exceptNote.trim()) return;
                        await onExceptAlert(a.id, exceptNote.trim());
                        setExceptAlertId(null);
                        setExceptNote("");
                      }}
                      className="rounded bg-amber-500 px-3 py-1 text-xs font-semibold text-slate-950 cursor-pointer"
                    >
                      {t("kanban.save")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reminders List */}
      <div className="rounded-xl bg-slate-900/50 p-5 ring-1 ring-slate-800/80 space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">{t("reminders.upcoming")}</h3>
        {reminders.length === 0 ? (
          <p className="text-xs text-slate-500">{t("reminders.noReminders")}</p>
        ) : (
          <div className="space-y-2">
            {reminders.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg bg-slate-950/80 p-3 ring-1 ring-slate-800"
              >
                <div>
                  <div className="text-sm font-medium text-slate-100">{r.title}</div>
                  <div className="text-xs text-slate-400">
                    {new Date(r.fire_at).toLocaleString()} • {r.status}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void onSnoozeReminder(r.id)}
                    className="rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  >
                    {t("reminders.snooze")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDismissReminder(r.id)}
                    className="rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  >
                    {t("reminders.dismiss")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("kanban.delete")}
                    onClick={() => void onDeleteReminder(r.id)}
                    className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
