// The Shelf mark, the app's icon (scripts/generate-icons.ts), beside the name set in Inter.
export function Logo({ className, lazy = false }: { className?: string; lazy?: boolean }) {
  return (
    <a href="/" className={className}>
      <span className="flex items-center gap-2.5">
        <img
          src="/brand/shelf-mark.svg"
          alt=""
          width={32}
          height={32}
          loading={lazy ? "lazy" : undefined}
          className="size-8 sm:size-9"
        />
        <span className="text-xl font-semibold tracking-tight sm:text-[22px]">Inset Shelf</span>
      </span>
    </a>
  );
}
