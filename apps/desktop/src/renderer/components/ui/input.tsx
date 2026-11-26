import { cn } from "cn";
import * as React from "react";

const VARIANT = {
  box: "border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 focus-visible:ring-3 aria-invalid:ring-3",
  /** An always-open field that reads as text: no border, a quiet tint on hover and while typing, the box's spacing so nothing moves. */
  quiet:
    "hover:bg-muted focus-visible:bg-muted dark:hover:bg-muted/50 dark:focus-visible:bg-muted/50 border-transparent",
} as const;

function Input({
  className,
  type,
  variant = "box",
  ...props
}: React.ComponentProps<"input"> & {
  readonly variant?: keyof typeof VARIANT;
}) {
  return (
    <input
      type={type}
      data-slot="input"
      data-variant={variant}
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-sm transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        className
      )}
      {...props}
    />
  );
}

export { Input };
