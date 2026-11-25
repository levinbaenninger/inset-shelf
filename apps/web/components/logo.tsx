import { cn } from "@inset/ui/lib/utils";

// The Shelf mark, the app's icon (scripts/generate-icons.ts), drawn inline so no page preloads it.
export const ShelfMark = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 64 64"
    aria-hidden="true"
    className={cn("size-[26px] shrink-0", className)}
  >
    <g
      fill="none"
      stroke="#0069a8"
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M26 58H14A8 8 0 0 1 6 50V14A8 8 0 0 1 14 6H50A8 8 0 0 1 58 14V34" />
      <path d="M34 42H58M34 50H58M34 58H58" />
    </g>
  </svg>
);

export const Logo = ({ className }: { className?: string }) => (
  <a
    href="/"
    className={cn(
      "flex items-center gap-2 rounded-md text-[17px] font-semibold tracking-[-0.025em]",
      className
    )}
  >
    <ShelfMark />
    Inset Shelf
  </a>
);
