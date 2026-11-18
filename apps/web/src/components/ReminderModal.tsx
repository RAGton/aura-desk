import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlarmClock, BellRing, Clock, Droplets, ShieldAlert } from "lucide-react";

import type { Alert } from "../lib/ipc";
import { playNotificationChime } from "../lib/sound";
import { Badge, Button } from "./ui";

export interface ReminderModalProps {
  alert: Alert | null;
  onResolve: (id: string) => void | Promise<void>;
  onSnooze: (id: string) => void | Promise<void>;
  onDismiss: (id: string) => void | Promise<void>;
  /**
   * When true, renders in PC-lock confirmation mode: requires checking the
   * "I read this alert" confirmation box before unlock actions can execute.
   */
  locked?: boolean;
  /** Controls optional Web Audio notification chime (respects `reminders.sound`). */
  playSound?: boolean;
  /**
   * When true, fills an external standalone popup OS window cleanly instead of
   * rendering a full-viewport translucent backdrop around a centered card.
   */
  inline?: boolean;
  /** Total pending alerts in queue, shown as a subtle badge when > 1. */
  pendingCount?: number;
}

function isWaterAlert(alert: Alert): boolean {
  if (alert.kind !== "routine") return false;
  const lower = alert.title.toLowerCase();
  return (
    lower.includes("água") ||
    lower.includes("agua") ||
    lower.includes("water") ||
    lower.includes("hidrata")
  );
}

function formatAlertTime(locale: string, iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function ReminderModal({
  alert,
  onResolve,
  onSnooze,
  onDismiss,
  locked = false,
  playSound = true,
  inline = false,
  pendingCount = 1,
}: ReminderModalProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const resolveBtnRef = useRef<HTMLButtonElement>(null);
  const prevAlertIdRef = useRef<string | undefined>(alert?.id);
  const [confirmedRead, setConfirmedRead] = useState(false);

  // Reset confirmation only when switching to a different alert (avoids clobbering
  // user input if the initial passive effect flushes after render).
  useEffect(() => {
    if (prevAlertIdRef.current !== alert?.id) {
      prevAlertIdRef.current = alert?.id;
      setConfirmedRead(false);
    }
    if (alert && playSound) {
      playNotificationChime(alert.severity === "urgent" ? "urgent" : "normal");
    }
  }, [alert?.id, playSound]);

  // Move keyboard focus inside the modal when it opens.
  useEffect(() => {
    if (!alert) return;
    if (locked && confirmRef.current) {
      confirmRef.current.focus();
    } else {
      resolveBtnRef.current?.focus();
    }
  }, [alert?.id, locked]);

  // Persistent alert dialog: block Escape and trap Tab focus within the modal.
  useEffect(() => {
    if (!alert) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (!active || active === first || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [alert, confirmedRead]);

  if (!alert) return null;

  const isWater = isWaterAlert(alert);
  const isUrgent = alert.severity === "urgent" || locked;
  const actionsDisabled = locked && !confirmedRead;
  const firedAt = formatAlertTime(i18n.language, alert.created_at);
  const kindLabel =
    alert.kind === "routine" ? t("reminders.kindRoutine") : t("reminders.kindReminder");
  const severityLabel =
    alert.severity === "urgent" ? t("reminders.severityUrgent") : t("reminders.severityNormal");

  return (
    <div
      data-testid="reminder-modal"
      data-locked={locked ? "true" : "false"}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={
        inline
          ? "flex min-h-screen w-full items-stretch justify-center aura-bg"
          : `fixed inset-0 z-50 flex items-center justify-center p-4 ${
              locked ? "bg-slate-950/90 backdrop-blur-xl" : "bg-slate-950/70 backdrop-blur-md"
            }`
      }
    >
      <div
        ref={dialogRef}
        className={
          inline
            ? `flex w-full flex-col justify-between aura-glass-elevated p-5 space-y-4 overscroll-contain border-t-4 ${
                isUrgent ? "border-rose-500" : "border-amber-400"
              }`
            : `w-full max-w-md max-h-[92vh] overflow-y-auto overscroll-contain aura-scrollbar rounded-2xl aura-glass-elevated p-6 shadow-2xl space-y-4 ring-2 ${
                isUrgent
                  ? "ring-rose-500/80 shadow-rose-500/20"
                  : "ring-amber-500/60 shadow-amber-500/15"
              }`
        }
      >
        {/* Top Metadata Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral" className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
              {kindLabel}
            </Badge>
            <Badge
              variant={alert.severity === "urgent" ? "danger" : "warning"}
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            >
              {severityLabel}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            {pendingCount > 1 && (
              <Badge variant="info" className="rounded-full px-2 py-0.5 text-[11px] font-semibold">
                {t("reminders.queueBadge", { count: pendingCount })}
              </Badge>
            )}
            {firedAt && (
              <span className="inline-flex items-center gap-1 font-medium text-slate-300">
                <Clock className="h-3 w-3 text-slate-400" />
                {firedAt}
              </span>
            )}
          </div>
        </div>

        {locked && (
          <div className="flex items-start gap-2.5 rounded-xl bg-rose-500/15 px-3.5 py-2.5 ring-1 ring-rose-500/40 text-xs text-rose-200">
            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
            <div>
              <div className="font-bold text-rose-100">{t("reminders.lockTitle")}</div>
              <p className="text-rose-200/90 mt-0.5">{t("reminders.lockBanner")}</p>
            </div>
          </div>
        )}

        {/* Main Alert Content */}
        <div className="flex items-start gap-3.5">
          <div
            className={`rounded-2xl p-3 ring-1 shrink-0 ${
              isWater
                ? "bg-sky-500/15 ring-sky-400/40"
                : isUrgent
                  ? "bg-rose-500/15 ring-rose-400/40"
                  : "bg-amber-500/15 ring-amber-400/40"
            }`}
          >
            {isWater ? (
              <Droplets className="h-6 w-6 text-sky-400" />
            ) : (
              <BellRing
                className={`h-6 w-6 animate-pulse ${isUrgent ? "text-rose-400" : "text-amber-400"}`}
              />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <h2 id={titleId} className="text-lg font-bold text-slate-50 leading-snug break-words">
              {alert.title}
            </h2>
            {alert.body && (
              <div className="rounded-xl bg-slate-950/55 px-3.5 py-2.5 ring-1 ring-slate-800/80">
                <p className="text-sm text-slate-200 whitespace-pre-line break-words leading-relaxed">
                  {alert.body}
                </p>
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-400 border-t border-slate-800/80 pt-3">
          {t("reminders.modalMustResolve")}
        </p>

        {locked && (
          <label className="flex items-center gap-2.5 rounded-xl bg-slate-950/80 px-3.5 py-3 ring-1 ring-rose-500/35 hover:ring-rose-400/60 cursor-pointer select-none transition-colors">
            <input
              ref={confirmRef}
              type="checkbox"
              data-testid="confirm-read-checkbox"
              checked={confirmedRead}
              onChange={(e) => setConfirmedRead(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-sky-500"
            />
            <span className="text-xs font-semibold text-slate-100">
              {t("reminders.confirmReadLabel")}
            </span>
          </label>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button
            ref={resolveBtnRef}
            size="md"
            variant="primary"
            disabled={actionsDisabled}
            onClick={() => void onResolve(alert.id)}
            className="bg-aura-success text-aura-inverse shadow-sm hover:bg-aura-success/90 text-xs font-bold"
          >
            ✓ {t("reminders.resolve")}
          </Button>
          <Button
            size="md"
            variant="secondary"
            disabled={actionsDisabled}
            onClick={() => void onSnooze(alert.id)}
            className="text-xs font-semibold"
          >
            <AlarmClock className="h-3.5 w-3.5 text-sky-400" />
            {t("reminders.snooze")}
          </Button>
          <Button
            size="md"
            variant="ghost"
            disabled={actionsDisabled}
            onClick={() => void onDismiss(alert.id)}
            className="text-xs font-semibold"
          >
            {t("reminders.dismiss")}
          </Button>
        </div>
      </div>
    </div>
  );
}
