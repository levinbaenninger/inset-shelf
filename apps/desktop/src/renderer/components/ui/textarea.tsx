import { cn } from "cn";
import * as React from "react";

/**
 * Words typed where they are read, in details: no box, the text where it sits
 * at rest, and one cue on hover and while typing, a faint wash of the text's
 * own colour that shows on the window and on a card, light or dark. The words
 * that turn into such a field (a window's description) take the same look.
 */
export const IN_PLACE =
  "hover:bg-foreground/5 focus-visible:bg-foreground/5 min-h-7 cursor-text resize-none rounded-md px-1.5 py-1 text-sm leading-5 transition-colors";

const VARIANT = {
  box: "border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 min-h-16 rounded-lg border px-2.5 py-2 text-sm transition-colors focus-visible:ring-3 aria-invalid:ring-3",
  /** Words typed where they are read: no box and no inset, in the type of the text around it, so nothing moves. Its tint is drawn by what holds it (row-look.ts EDITING). */
  inline: "min-h-0 resize-none p-0",
  inPlace: IN_PLACE,
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
