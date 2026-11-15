import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlarmClock,
  BellOff,
  BellRing,
  CalendarClock,
  CheckCheck,
  Clock,
  Coffee,
  Droplets,
  Repeat,
  Sparkles,
  Trash2,
  Volume2,
  Zap,
} from "lucide-react";

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

function isWaterTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return (
    lower.includes("água") ||
    lower.includes("agua") ||
    lower.includes("water") ||
    lower.includes("hidrata")
  );
}

function normalizeSoundKey(sound: string): "normal" | "urgent" | "none" {
  if (sound === "urgent") return "urgent";
  if (sound === "none") return "none";
  return "normal";
}

function formatShortTime(iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  const [resolvingAll, setResolvingAll] = useState(false);

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

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customDateTime) {
      const parsed = new Date(customDateTime);
      if (!Number.isNaN(parsed.getTime())) {
        void submitWithOptions(1, parsed.toISOString());
        return;
      }
    }
    void submitWithOptions(1);
  };

  const handleResolveAll = async () => {
    if (resolvingAll || alerts.length === 0) return;
    setResolvingAll(true);
    try {
      for (const item of alerts) {
        await onResolveAlert(item.id);
      }
    } finally {
      setResolvingAll(false);
    }
  };

  const templates: Array<{
    key: string;
    label: string;
    sound: ReminderSound;
    icon: typeof Droplets;
  }> = [
    { key: "water", label: t("reminders.tplWater"), sound: "normal", icon: Droplets },
    { key: "stretch", label: t("reminders.tplStretch"), sound: "normal", icon: Sparkles },
    { key: "break", label: t("reminders.tplBreak"), sound: "normal", icon: Coffee },
    { key: "meeting", label: t("reminders.tplMeeting"), sound: "urgent", icon: CalendarClock },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Reminder Composer */}
      <div className="rounded-2xl aura-glass p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-lg font-bold text-slate-50">{t("reminders.title")}</h2>
              {alerts.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/35">
                  <BellRing className="h-3 w-3" />
                  {t("reminders.queueBadge", { count: alerts.length })}
                </span>
              )}
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
            <p className="text-xs text-slate-400">{t("reminders.subtitle")}</p>
          </div>
          {onToggleDnd && (
            <button
              type="button"
              onClick={() => void onToggleDnd()}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold cursor-pointer transition-colors ${
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

        <form onSubmit={handleFormSubmit} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={newReminderTitle}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder={t("reminders.newPlaceholder")}
              className="flex-1 min-w-[240px] rounded-xl bg-slate-950/70 px-3.5 py-2 text-sm text-slate-100 ring-1 ring-slate-800 outline-none focus:ring-sky-500"
            />
            <button
              type="button"
              onClick={() => void submitWithOptions(0)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-sm shadow-amber-500/25 hover:bg-amber-400 cursor-pointer transition-colors"
            >
              <Zap className="h-3.5 w-3.5" />
              {t("reminders.addNow")}
            </button>
            <button
              type="button"
              onClick={() => void submitWithOptions(1)}
              className="rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-sm shadow-sky-500/25 hover:bg-sky-400 cursor-pointer transition-colors"
            >
              + {t("reminders.addIn1Min")}
            </button>
            <button
              type="button"
              onClick={() => void submitWithOptions(5)}
              className="rounded-xl aura-glass-pill px-3 py-2 text-xs font-semibold text-slate-200 hover:text-sky-300 cursor-pointer transition-colors"
            >
              + {t("reminders.addIn5Min")}
            </button>
            <button
              type="button"
              onClick={() => void submitWithOptions(15)}
              className="rounded-xl aura-glass-pill px-3 py-2 text-xs font-semibold text-slate-200 hover:text-sky-300 cursor-pointer transition-colors"
            >
              + {t("reminders.addIn15Min")}
            </button>
            <button
              type="button"
              onClick={() => void submitWithOptions(60)}
              className="rounded-xl aura-glass-pill px-3 py-2 text-xs font-semibold text-slate-200 hover:text-sky-300 cursor-pointer transition-colors"
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
              className="flex-1 min-w-[200px] rounded-xl bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800 outline-none focus:ring-sky-500"
            />
            <label className="inline-flex items-center gap-1.5 text-slate-400">
              <span>{t("reminders.soundLabel")}</span>
              <select
                value={sound}
                onChange={(e) => setSound(e.target.value as ReminderSound)}
                className="rounded-xl bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800"
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
                className="rounded-xl bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-800"
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
                className="rounded-xl bg-slate-950/70 px-2.5 py-1 text-xs text-slate-200 ring-1 ring-slate-800"
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
                className="inline-flex items-center gap-1 rounded-xl bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-500/40 hover:bg-sky-500/30 cursor-pointer"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {t("reminders.scheduleCustom")}
              </button>
            )}
          </div>
        </form>

        {/* Quick Template Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/60">
          <span className="text-[11px] font-medium text-slate-400">
            {t("reminders.quickTemplates")}
          </span>
          {templates.map((tpl) => {
            const Icon = tpl.icon;
            return (
              <button
                key={tpl.key}
                type="button"
                onClick={() => {
                  onChangeTitle(tpl.label);
                  setSound(tpl.sound);
                }}
                className="inline-flex items-center gap-1.5 rounded-full aura-glass-pill px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-sky-300 cursor-pointer transition-colors"
              >
                <Icon className="h-3 w-3 text-sky-400" />
                {tpl.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pending Alerts */}
      <div className="rounded-2xl aura-glass p-5 space-y-3">
        <section className="flex flex-wrap items-center justify-between gap-2">
          <section className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-300">{t("reminders.activeAlerts")}</h3>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-500/30">
              {alerts.length}
            </span>
          </section>
          {alerts.length > 1 && (
            <button
              type="button"
              disabled={resolvingAll}
              onClick={() => void handleResolveAll()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-50 cursor-pointer transition-colors"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t("reminders.resolveAll")}
            </button>
          )}
        </section>
        {alerts.length === 0 ? (
          <p className="text-xs text-slate-500">{t("reminders.noAlerts")}</p>
        ) : (
          <div className="space-y-2.5">
            {alerts.map((a) => {
              const water = a.kind === "routine" && isWaterTitle(a.title);
              const isUrgent = a.severity === "urgent";
              const createdTime = formatShortTime(a.created_at);
              return (
                <div
                  key={a.id}
                  className={`rounded-2xl aura-glass-elevated p-4 ring-1 space-y-2.5 ${
                    isUrgent ? "ring-rose-500/45" : "ring-amber-500/35"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className={`rounded-xl p-2.5 ring-1 shrink-0 ${
                          water
                            ? "bg-sky-500/15 ring-sky-400/35"
                            : isUrgent
                              ? "bg-rose-500/15 ring-rose-400/35"
                              : "bg-amber-500/15 ring-amber-400/35"
                        }`}
                      >
                        {water ? (
                          <Droplets className="h-4 w-4 text-sky-400" />
                        ) : (
                          <BellRing
                            className={`h-4 w-4 animate-pulse ${
                              isUrgent ? "text-rose-400" : "text-amber-400"
                            }`}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-slate-100 break-words">
                            {a.title}
                          </span>
                          <span className="rounded-full aura-glass-pill px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                            {a.kind === "routine"
                              ? t("reminders.kindRoutine")
                              : t("reminders.kindReminder")}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                              isUrgent
                                ? "bg-rose-500/15 text-rose-300 ring-rose-500/35"
                                : "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                            }`}
                          >
                            {isUrgent
                              ? t("reminders.severityUrgent")
                              : t("reminders.severityNormal")}
                          </span>
                          {createdTime && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                              <Clock className="h-3 w-3" />
                              {createdTime}
                            </span>
                          )}
                        </div>
                        {a.body && <div className="text-xs text-slate-300 break-words">{a.body}</div>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void onResolveAlert(a.id)}
                        className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer transition-colors"
                      >
                        ✓ {t("reminders.resolve")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onSnoozeAlert(a.id)}
                        className="inline-flex items-center gap-1 rounded-xl bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-slate-700/60 hover:bg-slate-700 cursor-pointer"
                      >
                        <AlarmClock className="h-3 w-3 text-sky-400" />
                        {t("reminders.snooze")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setExceptAlertId(exceptAlertId === a.id ? null : a.id)}
                        className="rounded-xl bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-slate-700/60 hover:bg-slate-700 cursor-pointer"
                      >
                        {t("reminders.except")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDismissAlert(a.id)}
                        className="rounded-xl bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-400 ring-1 ring-slate-700/60 hover:text-slate-200 cursor-pointer"
                      >
                        {t("reminders.dismiss")}
                      </button>
                    </div>
                  </div>
                  {exceptAlertId === a.id && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!exceptNote.trim()) return;
                        await onExceptAlert(a.id, exceptNote.trim());
                        setExceptAlertId(null);
                        setExceptNote("");
                      }}
                      className="flex gap-2 pt-2 border-t border-slate-800/70"
                    >
                      <input
                        type="text"
                        value={exceptNote}
                        onChange={(e) => setExceptNote(e.target.value)}
                        placeholder={t("reminders.exceptPlaceholder")}
                        className="flex-1 rounded-xl bg-slate-950/70 px-3 py-1.5 text-xs text-slate-100 ring-1 ring-slate-700 outline-none focus:ring-amber-400"
                      />
                      <button
                        type="submit"
                        className="rounded-xl bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
                      >
                        {t("kanban.save")}
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reminders List */}
      <div className="rounded-2xl aura-glass p-5 space-y-3">
        <section className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-sky-400" />
          <h3 className="text-sm font-semibold text-slate-200">{t("reminders.upcoming")}</h3>
          <span className="rounded-full aura-glass-pill px-2 py-0.5 text-[11px] font-semibold text-slate-300">
            {reminders.length}
          </span>
        </section>
        {reminders.length === 0 ? (
          <p className="text-xs text-slate-500">{t("reminders.noReminders")}</p>
        ) : (
          <div className="space-y-2">
            {reminders.map((r) => {
              const statusLabel =
                r.status === "snoozed"
                  ? t("reminders.statusSnoozed")
                  : t("reminders.statusPending");
              const soundKey = normalizeSoundKey(r.sound);
              return (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl aura-glass-pill p-3.5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-100 break-words">
                        {r.title}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                          r.status === "snoozed"
                            ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                            : "bg-sky-500/15 text-sky-300 ring-sky-500/30"
                        }`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    {r.body && <div className="text-xs text-slate-400 truncate">{r.body}</div>}
                    <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-500" />
                        {new Date(r.fire_at).toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Volume2 className="h-3 w-3 text-slate-500" />
                        {t(`reminders.sounds.${soundKey}`)}
                      </span>
                      {r.repeat_kind !== "none" && (
                        <span className="inline-flex items-center gap-1 text-sky-300">
                          <Repeat className="h-3 w-3" />
                          {t(`reminders.repeats.${r.repeat_kind}`)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void onSnoozeReminder(r.id)}
                      className="inline-flex items-center gap-1 rounded-xl bg-slate-800/90 px-2.5 py-1.5 text-xs text-slate-300 ring-1 ring-slate-700/60 hover:bg-slate-700 cursor-pointer"
                    >
                      <AlarmClock className="h-3 w-3 text-sky-400" />
                      {t("reminders.snooze")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDismissReminder(r.id)}
                      className="rounded-xl bg-slate-800/90 px-2.5 py-1.5 text-xs text-slate-300 ring-1 ring-slate-700/60 hover:bg-slate-700 cursor-pointer"
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
                        className="rounded-xl bg-red-500/20 px-2.5 py-1.5 text-xs font-semibold text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/30 cursor-pointer"
                      >
                        {t("reminders.confirmDelete")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={t("kanban.delete")}
                        onClick={() => setConfirmDeleteId(r.id)}
                        className="rounded-xl bg-slate-800/90 p-1.5 text-xs text-slate-400 ring-1 ring-slate-700/60 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
