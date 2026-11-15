import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellOff, CalendarClock, Trash2, Zap } from "lucide-react";

import type { Alert, Reminder, ReminderSound, RepeatKind } from "../lib/ipc";

export interface CreateReminderOptions {
  body?: string;
  sound?: ReminderSound;
  repeatKind?: RepeatKind;
  fireAtIso?: string;
}

export interface RemindersPageProps {
  reminders: Reminder[];
  alerts: Alert[];
  newReminderTitle: string;
  dndUntil?: string | null;
  onChangeTitle: (v: string) => void;
  onCreateReminder: (delayMinutes: number, opts?: CreateReminderOptions) => void | Promise<void>;
  onToggleDnd?: () => void | Promise<void>;
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
  dndUntil = null,
  onChangeTitle,
  onCreateReminder,
  onToggleDnd,
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
  const [body, setBody] = useState("");
  const [sound, setSound] = useState<ReminderSound>("normal");
  const [repeatKind, setRepeatKind] = useState<RepeatKind>("none");
  const [customDateTime, setCustomDateTime] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = window.setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDeleteId]);

  const dndActive = Boolean(dndUntil && Date.parse(dndUntil) > Date.now());

  const submitWithOptions = async (delayMinutes: number, fireAtIso?: string) => {
    const trimmedTitle = newReminderTitle.trim();
    await onCreateReminder(delayMinutes, {
      body: body.trim() || undefined,
      sound,
      repeatKind,
      fireAtIso,
    });
    if (trimmedTitle) {
      setBody("");
      if (fireAtIso) setCustomDateTime("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl aura-glass p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-bold text-slate-50">{t("reminders.title")}</h2>
            {dndActive && dndUntil && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/30">
                <BellOff className="h-3 w-3" />
                {t("reminders.dndActiveUntil", {
                  time: new Date(dndUntil).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </span>
            )}
          </div>
          {onToggleDnd && (
            <button
              type="button"
              onClick={() => void onToggleDnd()}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                dndActive
                  ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40"
                  : "aura-glass-pill text-slate-200 hover:text-amber-300"
              }`}
            >
              <BellOff className="h-3.5 w-3.5" />
              {dndActive ? t("reminders.dndDisable") : t("reminders.dndEnable")}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={newReminderTitle}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder={t("reminders.newPlaceholder")}
            className="flex-1 min-w-[240px] rounded-lg bg-slate-950/70 px-3.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 outline-none focus:ring-sky-500"
          />
          <button
            type="button"
            onClick={() => void submitWithOptions(0)}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
          >
            <Zap className="h-3.5 w-3.5" />
            {t("reminders.addNow")}
          </button>
          <button
            type="button"
            onClick={() => void submitWithOptions(1)}
            className="rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
          >
            + {t("reminders.addIn1Min")}
          </button>
          <button
            type="button"
            onClick={() => void submitWithOptions(15)}
            className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            + {t("reminders.addIn15Min")}
          </button>
          <button
            type="button"
            onClick={() => void submitWithOptions(60)}
            className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            + {t("reminders.addIn1Hour")}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("reminders.bodyPlaceholder")}
            className="flex-1 min-w-[200px] rounded-lg bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800 outline-none focus:ring-sky-500"
          />
          <label className="inline-flex items-center gap-1.5 text-slate-400">
            <span>{t("reminders.soundLabel")}</span>
            <select
              value={sound}
              onChange={(e) => setSound(e.target.value as ReminderSound)}
              className="rounded-lg bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800"
            >
              <option value="normal">{t("reminders.sounds.normal")}</option>
              <option value="urgent">{t("reminders.sounds.urgent")}</option>
              <option value="none">{t("reminders.sounds.none")}</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-slate-400">
            <span>{t("reminders.repeatLabel")}</span>
            <select
              value={repeatKind}
              onChange={(e) => setRepeatKind(e.target.value as RepeatKind)}
              className="rounded-lg bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800"
            >
              <option value="none">{t("reminders.repeats.none")}</option>
              <option value="daily">{t("reminders.repeats.daily")}</option>
              <option value="weekly">{t("reminders.repeats.weekly")}</option>
              <option value="monthly">{t("reminders.repeats.monthly")}</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-slate-400">
            <span>{t("reminders.customDateTime")}</span>
            <input
              type="datetime-local"
              value={customDateTime}
              onChange={(e) => setCustomDateTime(e.target.value)}
              className="rounded-lg bg-slate-950/70 px-2.5 py-1 text-xs text-slate-200 ring-1 ring-slate-800"
            />
          </label>
          {customDateTime && (
            <button
              type="button"
              onClick={() => {
                const parsed = new Date(customDateTime);
                if (!Number.isNaN(parsed.getTime())) {
                  void submitWithOptions(1, parsed.toISOString());
                }
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-500/40 hover:bg-sky-500/30 cursor-pointer"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              {t("reminders.scheduleCustom")}
            </button>
          )}
        </div>
      </div>

      {/* Pending Alerts */}
      <div className="rounded-2xl aura-glass p-5 space-y-3">
        <h3 className="text-sm font-semibold text-amber-300">{t("reminders.activeAlerts")}</h3>
        {alerts.length === 0 ? (
          <p className="text-xs text-slate-500">{t("reminders.noAlerts")}</p>
        ) : (
          <div className="space-y-2.5">
            {alerts.map((a) => (
              <div
                key={a.id}
                className="rounded-xl bg-amber-500/10 p-3.5 ring-1 ring-amber-500/30 space-y-2"
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
                      className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white cursor-pointer"
                    >
                      ✓ {t("reminders.resolve")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onSnoozeAlert(a.id)}
                      className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 cursor-pointer"
                    >
                      {t("reminders.snooze")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExceptAlertId(exceptAlertId === a.id ? null : a.id)}
                      className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-amber-300 cursor-pointer"
                    >
                      {t("reminders.except")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDismissAlert(a.id)}
                      className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400 cursor-pointer"
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
                      className="flex-1 rounded-lg bg-slate-950/70 px-2.5 py-1 text-xs text-slate-100 ring-1 ring-slate-700"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!exceptNote.trim()) return;
                        await onExceptAlert(a.id, exceptNote.trim());
                        setExceptAlertId(null);
                        setExceptNote("");
                      }}
                      className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-slate-950 cursor-pointer"
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
      <div className="rounded-2xl aura-glass p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">{t("reminders.upcoming")}</h3>
        {reminders.length === 0 ? (
          <p className="text-xs text-slate-500">{t("reminders.noReminders")}</p>
        ) : (
          <div className="space-y-2">
            {reminders.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl aura-glass-pill p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-100">{r.title}</div>
                  {r.body && <div className="text-xs text-slate-400 truncate">{r.body}</div>}
                  <div className="text-xs text-slate-400">
                    {new Date(r.fire_at).toLocaleString()} • {r.status}
                    {r.repeat_kind !== "none" ? ` • ${t(`reminders.repeats.${r.repeat_kind}`)}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void onSnoozeReminder(r.id)}
                    className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  >
                    {t("reminders.snooze")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDismissReminder(r.id)}
                    className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                  >
                    {t("reminders.dismiss")}
                  </button>
                  {confirmDeleteId === r.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeleteId(null);
                        void onDeleteReminder(r.id);
                      }}
                      className="rounded-lg bg-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/30 cursor-pointer"
                    >
                      {t("reminders.confirmDelete")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={t("kanban.delete")}
                      onClick={() => setConfirmDeleteId(r.id)}
                      className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
