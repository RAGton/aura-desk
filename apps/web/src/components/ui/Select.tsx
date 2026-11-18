import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      containerClassName,
      label,
      hint,
      error,
      id,
      "aria-describedby": ariaDescribedBy,
      children,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const hintId = hint ? `${selectId}-hint` : undefined;
    const errorId = error ? `${selectId}-error` : undefined;

    const describedBy = [ariaDescribedBy, hintId, errorId]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label
            htmlFor={selectId}
            className="text-xs font-medium text-aura-secondary"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            "w-full rounded-aura-md border bg-aura-surface px-3 py-2 text-sm text-aura-primary transition-colors touch-manipulation focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
            error
              ? "border-aura-danger/70 focus-visible:ring-aura-danger"
              : "border-aura-border/40 focus-visible:border-aura-focus focus-visible:ring-aura-focus",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        {hint && !error && (
          <p id={hintId} className="text-xs text-aura-text-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-xs text-aura-danger">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Select.displayName = "Select";
