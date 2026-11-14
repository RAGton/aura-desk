import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bell, Coffee, Droplets } from "lucide-react";

import type { Alert } from "../lib/ipc";

export interface ReminderModalProps {
  /** The alert currently on screen. `null` renders nothing. */
  alert: Alert | null;
  /** Called when the user resolves the alert (the only way to close it). */
  onResolve: (id: string) => void | Promise<void>;
  /** Called when the user snoozes the alert. */
  onSnooze: (id: string) => void | Promise<void>;
  /** Called when the user dismisses the alert without acting on it. */
  onDismiss: (id: string) => void | Promise<void>;
}

/**
 * Modal popup for pending reminders (hydration, breaks, scheduled tasks).
 *
 * The modal is deliberately *not* dismissible by accident: clicking the
 * backdrop, pressing Escape, or clicking outside does nothing. The only
 * paths out are the explicit actions — resolve, snooze, or dismiss — and
 * the parent closes the modal once the alert leaves the pending list.
 */
export const ReminderModal: React.FC<ReminderModalProps> = ({
  alert,
  onResolve,
  onSnooze,
  onDismiss,
}) => {
  const { t } = useTranslation();
  const resolveButtonRef = useRef<HTMLButtonElement>(null);

  // Move focus into the modal when it opens so keyboard users are not
  // left behind on the page underneath.
  useEffect(() => {
    if (alert) {
      resolveButtonRef.current?.focus();
    }
  }, [alert]);

  // Escape must not close the modal: the alert still needs a decision.
  useEffect(() => {
    if (!alert) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [alert]);

  if (!alert) return null;

  const isWater = alert.kind === "routine" && alert.title.toLowerCase().includes("água");
  const Icon = alert.kind === "routine" ? (isWater ? Droplets : Coffee) : Bell;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminder-modal-title"
      aria-describedby="reminder-modal-body"
      data-testid="reminder-modal"
    >
      <div className="w-full max-w-md rounded-2xl bg-slate-900 ring-1 ring-amber-400/40 shadow-2xl shadow-black/60">
        <div className="flex items-start gap-3 border-b border-slate-800 p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
            <Icon className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="reminder-modal-title"
              className="text-base font-bold text-amber-200"
            >
              {alert.title}
            </h2>
            {alert.body && (
              <p
                id="reminder-modal-body"
                className="mt-1 text-sm leading-relaxed text-slate-300"
              >
                {alert.body}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 p-5">
          <p className="flex items-start gap-2 rounded-lg bg-slate-800/60 p-3 text-xs leading-relaxed text-slate-400">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
              aria-hidden="true"
            />
            <span>{t("reminders.modalMustResolve")}</span>
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              ref={resolveButtonRef}
              type="button"
              onClick={() => void onResolve(alert.id)}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 cursor-pointer"
            >
              ✓ {t("reminders.resolve")}
            </button>
            <button
              type="button"
              onClick={() => void onSnooze(alert.id)}
              className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 cursor-pointer"
            >
              ⏰ {t("reminders.snooze")}
            </button>
            <button
              type="button"
              onClick={() => void onDismiss(alert.id)}
              className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-400 transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 cursor-pointer"
            >
              {t("reminders.dismiss")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
