import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 select-none touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-focus focus-visible:ring-offset-2 focus-visible:ring-offset-aura-canvas disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-aura-accent text-aura-inverse border border-transparent shadow-sm hover:bg-aura-accent/90",
        secondary:
          "bg-aura-elevated text-aura-primary border border-aura-border/40 hover:bg-aura-muted/70",
        ghost:
          "bg-transparent text-aura-secondary border border-transparent hover:bg-aura-muted/40 hover:text-aura-primary",
        danger:
          "bg-aura-danger text-aura-inverse border border-transparent shadow-sm hover:bg-aura-danger/90",
        outline:
          "bg-transparent text-aura-primary border border-aura-border-strong/50 hover:bg-aura-surface/70",
      },
      size: {
        sm: "min-h-8 h-auto px-3 py-1.5 text-xs rounded-aura-sm",
        md: "min-h-9 h-auto px-4 py-1.5 text-sm rounded-aura-md",
        lg: "min-h-10 h-auto px-5 py-2 text-sm rounded-aura-md",
        icon: "h-9 w-9 p-0 rounded-aura-md",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading = false,
      disabled,
      type = "button",
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
