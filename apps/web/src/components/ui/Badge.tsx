import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-aura-sm border px-2 py-0.5 text-xs font-medium leading-tight",
  {
    variants: {
      variant: {
        default: "border-aura-accent/35 bg-aura-accent/15 text-aura-accent",
        info: "border-aura-info/35 bg-aura-info/15 text-aura-info",
        success: "border-aura-success/35 bg-aura-success/15 text-aura-success",
        warning: "border-aura-warning/35 bg-aura-warning/15 text-aura-warning",
        danger: "border-aura-danger/35 bg-aura-danger/15 text-aura-danger",
        neutral: "border-aura-border/35 bg-aura-muted/35 text-aura-secondary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
