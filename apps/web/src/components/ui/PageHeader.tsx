import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface PageHeaderProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Shared top banner header for primary application views so spacing,
 * typography scale, icon framing, and action alignment remain identical
 * across Productivity, Intelligence, and System tabs.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  badges,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "rounded-2xl aura-glass p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl aura-glass-elevated ring-1 ring-aura-accent/30 text-aura-accent">
          {icon}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-bold text-aura-primary">{title}</h2>
            {badges}
          </div>
          {subtitle && (
            <p className="text-xs leading-relaxed text-aura-text-muted">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}
