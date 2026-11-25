import { cn } from "cn";
import * as React from "react";

const VARIANT = {
  box: "border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 min-h-16 rounded-lg border px-2.5 py-2 text-sm transition-colors focus-visible:ring-3 aria-invalid:ring-3",
  /** Words typed where they are read: no box, and the type of the text around it. */
  inline: "min-h-0 resize-none p-0",
  /** An always-open field that reads as text: no border, a quiet tint on hover and while typing, the box's spacing so nothing moves. */
  quiet:
    "hover:bg-muted focus-visible:bg-muted dark:hover:bg-muted/50 dark:focus-visible:bg-muted/50 min-h-16 resize-none rounded-lg border border-transparent px-2.5 py-2 text-sm transition-colors",
  /** `quiet` for a one-line text: an input's height while it fits, and it wraps as it grows instead of hiding its end. */
  quietLine:
    "hover:bg-muted focus-visible:bg-muted dark:hover:bg-muted/50 dark:focus-visible:bg-muted/50 min-h-8 resize-none rounded-lg border border-transparent px-2.5 py-1.25 text-sm transition-colors",
} as const;

function Textarea({
  className,
  variant = "box",
  ...props
}: React.ComponentProps<"textarea"> & {
  readonly variant?: keyof typeof VARIANT;
}) {
  return (
    <textarea
      data-slot="textarea"
      data-variant={variant}
      className={cn(
        "placeholder:text-muted-foreground flex field-sizing-content w-full bg-transparent outline-none disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
