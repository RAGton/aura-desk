import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export interface SwitchProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "onChange" | "role" | "aria-checked"
  > {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  size?: "sm" | "md";
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked,
      onCheckedChange,
      disabled,
      size = "md",
      className,
      onClick,
      ...props
    },
    ref,
  ) => {
    const isSm = size === "sm";
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented && !disabled) {
            onCheckedChange(!checked);
          }
        }}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors cursor-pointer touch-manipulation after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus focus-visible:ring-offset-2 focus-visible:ring-offset-aura-canvas disabled:cursor-not-allowed disabled:opacity-50",
          isSm ? "h-5 w-9" : "h-6 w-11",
          checked ? "bg-aura-accent" : "bg-aura-muted",
          className,
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none block rounded-full bg-white shadow-sm transition-transform",
            isSm ? "h-4 w-4" : "h-5 w-5",
            checked
              ? isSm
                ? "translate-x-4"
                : "translate-x-5"
              : "translate-x-0.5",
          )}
        />
      </button>
    );
  },
);

Switch.displayName = "Switch";
