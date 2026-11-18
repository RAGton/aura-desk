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

import { Badge, Button, EmptyState, Input, Select } from "../components/ui";
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

function formatShortTime(locale: string, iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
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
  const { t, i18n } = useTranslation();
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
                <Badge variant="warning" className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                  <BellRing className="h-3 w-3" />
                  {t("reminders.queueBadge", { count: alerts.length })}
                </Badge>
              )}
              {dndActive && dndUntil && (
                <Badge variant="warning" className="rounded-full px-2.5 py-0.5 text-[11px] font-medium">
                  <BellOff className="h-3 w-3" aria-hidden="true" />
                  {t("reminders.dndActiveUntil", {
                    time: new Date(dndUntil).toLocaleTimeString(i18n.language, {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })}
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-400">{t("reminders.subtitle")}</p>
          </div>
          {onToggleDnd && (
            <Button
              size="sm"
              variant={dndActive ? "outline" : "secondary"}
              onClick={() => void onToggleDnd()}
              className={`rounded-xl text-xs font-semibold ${
                dndActive ? "bg-amber-500/20 text-amber-200 border-amber-500/40" : ""
              }`}
            >
              <BellOff className="h-3.5 w-3.5" />
              {dndActive ? t("reminders.dndDisable") : t("reminders.dndEnable")}
            </Button>
          )}
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              containerClassName="flex-1 min-w-[200px]"
              type="text"
              aria-label={t("reminders.titleLabel")}
              value={newReminderTitle}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder={t("reminders.newPlaceholder")}
              className="px-3.5 py-2 text-sm"
            />
            <Button
              size="md"
              variant="primary"
              onClick={() => void submitWithOptions(0)}
              className="rounded-xl bg-aura-warning text-xs font-bold text-aura-inverse shadow-sm hover:bg-aura-warning/90"
            >
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              {t("reminders.addNow")}
            </Button>
            <Button
              size="md"
              variant="primary"
              onClick={() => void submitWithOptions(1)}
              className="rounded-xl text-xs font-bold shadow-sm"
            >
              + {t("reminders.addIn1Min")}
            </Button>
            <Button
              size="md"
              variant="secondary"
              onClick={() => void submitWithOptions(5)}
              className="rounded-xl text-xs font-semibold"
            >
              + {t("reminders.addIn5Min")}
            </Button>
            <Button
              size="md"
              variant="secondary"
              onClick={() => void submitWithOptions(15)}
              className="rounded-xl text-xs font-semibold"
            >
              + {t("reminders.addIn15Min")}
            </Button>
            <Button
              size="md"
              variant="secondary"
              onClick={() => void submitWithOptions(60)}
              className="rounded-xl text-xs font-semibold"
            >
              + {t("reminders.addIn1Hour")}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Input
              containerClassName="flex-1 min-w-[200px]"
              type="text"
              aria-label={t("reminders.bodyLabel")}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("reminders.bodyPlaceholder")}
              className="py-1.5 text-xs"
            />
            <label className="inline-flex items-center gap-1.5 text-slate-400">
              <span>{t("reminders.soundLabel")}</span>
              <Select
                containerClassName="w-auto"
                value={sound}
                onChange={(e) => setSound(e.target.value as ReminderSound)}
                className="rounded-xl py-1.5 text-xs"
              >
                <option value="normal">{t("reminders.sounds.normal")}</option>
                <option value="urgent">{t("reminders.sounds.urgent")}</option>
                <option value="none">{t("reminders.sounds.none")}</option>
              </Select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-400">
              <span>{t("reminders.repeatLabel")}</span>
              <Select
                containerClassName="w-auto"
                value={repeatKind}
                onChange={(e) => setRepeatKind(e.target.value as RepeatKind)}
                className="rounded-xl py-1.5 text-xs"
              >
                <option value="none">{t("reminders.repeats.none")}</option>
                <option value="daily">{t("reminders.repeats.daily")}</option>
                <option value="weekly">{t("reminders.repeats.weekly")}</option>
                <option value="monthly">{t("reminders.repeats.monthly")}</option>
              </Select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-400">
              <span>{t("reminders.customDateTime")}</span>
              <Input
                containerClassName="w-auto"
                type="datetime-local"
                value={customDateTime}
                onChange={(e) => setCustomDateTime(e.target.value)}
                className="rounded-xl px-2.5 py-1 text-xs"
              />
            </label>
            {customDateTime && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const parsed = new Date(customDateTime);
                  if (!Number.isNaN(parsed.getTime())) {
                    void submitWithOptions(1, parsed.toISOString());
                  }
                }}
                className="rounded-xl bg-sky-500/20 text-xs font-semibold text-sky-300 border-sky-500/40 hover:bg-sky-500/30"
              >
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                {t("reminders.scheduleCustom")}
              </Button>
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
              <Button
                key={tpl.key}
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChangeTitle(tpl.label);
                  setSound(tpl.sound);
                }}
                className="h-7 rounded-full aura-glass-pill px-2.5 text-[11px] font-medium text-slate-300 hover:text-aura-accent"
              >
                <Icon className="h-3 w-3 text-aura-accent" aria-hidden="true" />
                {tpl.label}
              </Button>
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
            <Badge variant="warning" className="rounded-full px-2 py-0.5 text-[11px] font-semibold">
              {alerts.length}
            </Badge>
          </section>
          {alerts.length > 1 && (
            <Button
              size="sm"
              variant="outline"
              disabled={resolvingAll}
              loading={resolvingAll}
              onClick={() => void handleResolveAll()}
              className="rounded-xl bg-emerald-500/20 text-xs font-semibold text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t("reminders.resolveAll")}
            </Button>
          )}
        </section>
        {alerts.length === 0 ? (
          <EmptyState title={t("reminders.noAlerts")} className="py-6" />
        ) : (
          <div className="space-y-2.5">
            {alerts.map((a) => {
              const water = a.kind === "routine" && isWaterTitle(a.title);
              const isUrgent = a.severity === "urgent";
              const createdTime = formatShortTime(i18n.language, a.created_at);
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
                          <Badge variant="neutral" className="rounded-full px-2 py-0.5 text-[10px] font-semibold">
                            {a.kind === "routine"
                              ? t("reminders.kindRoutine")
                              : t("reminders.kindReminder")}
                          </Badge>
                          <Badge
                            variant={isUrgent ? "danger" : "warning"}
                            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          >
                            {isUrgent
                              ? t("reminders.severityUrgent")
                              : t("reminders.severityNormal")}
                          </Badge>
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
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void onResolveAlert(a.id)}
                        className="rounded-xl bg-aura-success text-xs font-bold text-aura-inverse hover:bg-aura-success/90"
                      >
                        ✓ {t("reminders.resolve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void onSnoozeAlert(a.id)}
                        className="rounded-xl text-xs font-medium"
                      >
                        <AlarmClock className="h-3 w-3 text-sky-400" />
                        {t("reminders.snooze")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setExceptAlertId(exceptAlertId === a.id ? null : a.id)}
                        className="rounded-xl text-xs font-medium text-amber-300"
                      >
                        {t("reminders.except")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void onDismissAlert(a.id)}
                        className="rounded-xl text-xs font-medium"
                      >
                        {t("reminders.dismiss")}
                      </Button>
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
                      <Input
                        containerClassName="flex-1"
                        type="text"
                        aria-label={t("reminders.exceptNoteLabel")}
                        value={exceptNote}
                        onChange={(e) => setExceptNote(e.target.value)}
                        placeholder={t("reminders.exceptPlaceholder")}
                        className="py-1.5 text-xs"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="primary"
                        className="rounded-xl bg-aura-warning text-xs font-semibold text-aura-inverse hover:bg-aura-warning/90"
                      >
                        {t("kanban.save")}
                      </Button>
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
          <Badge variant="neutral" className="rounded-full px-2 py-0.5 text-[11px] font-semibold">
            {reminders.length}
          </Badge>
        </section>
        {reminders.length === 0 ? (
          <EmptyState title={t("reminders.noReminders")} className="py-6" />
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
                      <Badge
                        variant={r.status === "snoozed" ? "warning" : "info"}
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      >
                        {statusLabel}
                      </Badge>
                    </div>
                    {r.body && <div className="text-xs text-slate-400 truncate">{r.body}</div>}
                    <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Clock className="h-3 w-3 text-slate-500" aria-hidden="true" />
                        {new Date(r.fire_at).toLocaleString(i18n.language)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Volume2 className="h-3 w-3 text-slate-500" aria-hidden="true" />
                        {t(`reminders.sounds.${soundKey}`)}
                      </span>
                      {r.repeat_kind !== "none" && (
                        <span className="inline-flex items-center gap-1 text-sky-300">
                          <Repeat className="h-3 w-3" aria-hidden="true" />
                          {t(`reminders.repeats.${r.repeat_kind}`)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void onSnoozeReminder(r.id)}
                      className="rounded-xl text-xs"
                    >
                      <AlarmClock className="h-3 w-3 text-sky-400" aria-hidden="true" />
                      {t("reminders.snooze")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void onDismissReminder(r.id)}
                      className="rounded-xl text-xs"
                    >
                      {t("reminders.dismiss")}
                    </Button>
                    {confirmDeleteId === r.id ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          void onDeleteReminder(r.id);
                        }}
                        className="rounded-xl text-xs font-semibold"
                      >
                        {t("reminders.confirmDelete")}
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="secondary"
                        aria-label={t("kanban.delete")}
                        title={t("kanban.delete")}
                        onClick={() => setConfirmDeleteId(r.id)}
                        className="h-8 w-8 rounded-xl text-slate-400 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
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
