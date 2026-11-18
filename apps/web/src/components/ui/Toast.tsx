import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastProps {
  open: boolean;
  message: string;
  variant?: ToastVariant;
  onClose?: () => void;
  className?: string;
}

const TOAST_STYLES: Record<ToastVariant, string> = {
  info: "border-aura-info/50 bg-aura-overlay/95 text-aura-info",
  success: "border-aura-success/50 bg-aura-overlay/95 text-aura-success",
  warning: "border-aura-warning/50 bg-aura-overlay/95 text-aura-warning",
  error: "border-aura-danger/55 bg-aura-overlay/95 text-aura-danger",
};

export function Toast({
  open,
  message,
  variant = "info",
  onClose,
  className,
}: ToastProps) {
  const { t } = useTranslation();

  if (!open || !message) {
    return null;
  }

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={cn(
        "inline-flex items-center gap-2 rounded-aura-md border px-3 py-1.5 text-xs font-medium backdrop-blur-md shadow-aura-elevated",
        TOAST_STYLES[variant],
        className,
      )}
    >
      <span>{message}</span>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t("ui.closeNotification")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-aura-sm opacity-80 transition-opacity hover:opacity-100 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
