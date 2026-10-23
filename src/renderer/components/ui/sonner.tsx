import { Toaster as Sonner } from "sonner";
import type { ToasterProps } from "sonner";

/** shadcn's Toaster: Sonner in the popover's colours, following the system theme. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={{
        "--border-radius": "var(--radius)",
        "--normal-bg": "var(--popover)",
        "--normal-border": "var(--border)",
        "--normal-text": "var(--popover-foreground)",
      }}
      theme="system"
      {...props}
    />
  );
}

export { Toaster };
