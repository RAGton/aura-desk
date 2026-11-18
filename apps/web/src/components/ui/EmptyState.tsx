import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-aura-lg border border-dashed border-aura-border/40 bg-aura-surface/40 px-6 py-10 text-center",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-aura-muted/40 text-aura-text-muted"
        >
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-aura-primary">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-aura-text-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
