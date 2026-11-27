import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      containerClassName,
      label,
      hint,
      error,
      id,
      type = "text",
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;

    const describedBy = [ariaDescribedBy, hintId, errorId]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium text-aura-secondary"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            "h-9 w-full rounded-aura-md border bg-aura-surface/80 px-3 py-1.5 text-sm text-aura-primary placeholder:text-aura-text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
            error
              ? "border-aura-danger/70 focus-visible:ring-aura-danger"
              : "border-aura-border/40 focus-visible:border-aura-focus focus-visible:ring-aura-focus",
            className,
          )}
          {...props}
        />
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

Input.displayName = "Input";
