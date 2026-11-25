import { cn } from "@inset/ui/lib/utils";

// The Shelf mark, the app's icon (scripts/generate-icons.ts), beside the name.
export const Logo = ({ className }: { className?: string }) => (
  <a
    href="/"
    className={cn(
      "flex items-center gap-2 rounded-md text-[17px] font-semibold tracking-[-0.025em]",
      className
    )}
  >
    <img
      src="/brand/shelf-mark.svg"
      alt=""
      width={26}
      height={26}
      className="size-[26px]"
    />
    Inset Shelf
  </a>
);
