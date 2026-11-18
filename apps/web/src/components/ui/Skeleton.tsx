import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export function Skeleton({ className, lines, ...props }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div aria-hidden="true" className="space-y-2" {...props}>
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className={cn(
              "h-4 animate-pulse rounded-aura-md bg-aura-muted/40",
              index === lines - 1 ? "w-3/4" : "w-full",
              className,
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "h-4 w-full animate-pulse rounded-aura-md bg-aura-muted/40",
        className,
      )}
      {...props}
    />
  );
}
