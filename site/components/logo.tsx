// The Inset logo from the brand kit, unchanged (public/brand/inset-logo.svg).
export function Logo({ className, lazy = false }: { className?: string; lazy?: boolean }) {
  return (
    <a href="#top" className={className}>
      <img
        src="/brand/inset-logo.svg"
        alt="Inset"
        width={110}
        height={40}
        loading={lazy ? "lazy" : undefined}
        className="h-9 w-auto sm:h-10"
      />
    </a>
  );
}
