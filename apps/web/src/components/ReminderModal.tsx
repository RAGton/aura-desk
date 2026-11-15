import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlarmClock, Bell, Droplets, ShieldAlert } from "lucide-react";

import type { Alert } from "../lib/ipc";

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

function playNotificationChime(severity: string): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(severity === "urgent" ? 880 : 660, now);
    osc.frequency.exponentialRampToValueAtTime(severity === "urgent" ? 1046.5 : 880, now + 0.16);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Web Audio unavailable in headless / restricted environments.
  }
}

export function ReminderModal({
  alert,
  onResolve,
  onSnooze,
  onDismiss,
  locked = false,
  playSound = true,
  inline = false,
}: ReminderModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const resolveBtnRef = useRef<HTMLButtonElement>(null);
  const [confirmedRead, setConfirmedRead] = useState(false);

  // Reset confirmation whenever the active alert changes.
  useEffect(() => {
    setConfirmedRead(false);
    if (alert && playSound) {
      playNotificationChime(alert.severity);
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
  const actionsDisabled = locked && !confirmedRead;

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
            ? `flex w-full flex-col justify-between aura-glass-elevated p-5 space-y-4 border-t-4 ${
                locked ? "border-rose-500" : "border-amber-400"
              }`
            : `w-full max-w-md rounded-2xl aura-glass-elevated p-6 shadow-2xl space-y-5 ring-2 ${
                locked
                  ? "ring-rose-500/80 shadow-rose-500/20"
                  : "ring-amber-500/60 shadow-amber-500/10"
              }`
        }
      >
        {locked && (
          <div className="flex items-start gap-2.5 rounded-xl bg-rose-500/15 px-3.5 py-2.5 ring-1 ring-rose-500/40 text-xs text-rose-200">
            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
            <div>
              <div className="font-bold text-rose-100">{t("reminders.lockTitle")}</div>
              <p className="text-rose-200/90 mt-0.5">{t("reminders.lockBanner")}</p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-3.5">
          <div className="rounded-xl bg-amber-500/15 p-3 ring-1 ring-amber-500/30">
            {isWater ? (
              <Droplets className="h-6 w-6 text-sky-400" />
            ) : (
              <Bell className="h-6 w-6 text-amber-400 animate-pulse" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id={titleId} className="text-lg font-bold text-slate-50 leading-snug">
              {alert.title}
            </h2>
            {alert.body && (
              <p className="text-sm text-slate-300 whitespace-pre-line">{alert.body}</p>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-400 border-t border-slate-800 pt-3">
          {t("reminders.modalMustResolve")}
        </p>

        {locked && (
          <label className="flex items-center gap-2.5 rounded-xl bg-slate-950/80 px-3.5 py-3 ring-1 ring-slate-700 cursor-pointer select-none">
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

        <div className="flex flex-wrap justify-end gap-2">
          <button
            ref={resolveBtnRef}
            type="button"
            disabled={actionsDisabled}
            onClick={() => void onResolve(alert.id)}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            ✓ {t("reminders.resolve")}
          </button>
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={() => void onSnooze(alert.id)}
            className="inline-flex items-center gap-1 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <AlarmClock className="h-3.5 w-3.5" />
            {t("reminders.snooze")}
          </button>
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={() => void onDismiss(alert.id)}
            className="rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {t("reminders.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
