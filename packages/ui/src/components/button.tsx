import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import * as React from "react";

const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        /** A toggle that is on, tinted in both themes: the search's "from here" chip while its filter is on. */
        pressed:
          "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary dark:bg-primary/30 dark:text-foreground dark:hover:bg-primary/40 dark:hover:text-foreground",
        /** A ghost button in the secondary text colour: actions beside a field's label, Details in an open row. */
        quiet:
          "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        /** White on a picture, whatever the theme: the screenshot card's controls. Focus draws a dark ring inside a white one, which shows on light and dark pictures alike. */
        overlay:
          "bg-white text-neutral-900 shadow-md hover:bg-neutral-100 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100",
        /** A remove badge on a tile's corner: dark glass with a light rim, which shows on a white picture and in the dark theme alike. */
        "overlay-badge":
          "bg-black/70 text-white ring-1 ring-white/80 hover:bg-black/85 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900",
        /** The screenshot card's second line: small white words on the picture's darkened foot, underlined under the pointer, with no pill of their own. */
        "overlay-text":
          "font-normal tracking-tight text-white/90 text-shadow-black/60 text-shadow-xs hover:text-white hover:underline hover:underline-offset-2 focus-visible:border-transparent focus-visible:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900",
        /** Translucent white over a coloured surface, beside a default button: the web page's sky frames and tiles. */
        light:
          "text-foreground bg-white/80 shadow-[0_1px_2px_rgb(0_0_0/0.05)] ring-1 ring-black/8 backdrop-blur-sm hover:bg-white",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        /** A strip's “+N”: sm with a 4px inset. With -ml-1 in a gap-1.5 strip its words start one gap after the last tile. */
        count: "h-7 rounded-[min(var(--radius-md),12px)] px-1 text-[0.8rem]",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
        /** Fully rounded, for buttons set on a picture. */
        pill: "h-8 gap-1.5 rounded-full px-4",
        /** The screenshot card's main action, a step larger than its others. */
        "pill-sm":
          "h-7 gap-1 rounded-full px-3.5 text-[0.8125rem] font-semibold",
        /** A line of words, as tall as its text, on one line or two: the screenshot card's second line. */
        line: "h-auto gap-0 rounded-md px-0.5 py-0.5 text-xs leading-4",
        "icon-round": "size-8 rounded-full",
        /** The screenshot card's Copy, beside its main action and smaller. */
        "icon-round-xs":
          "size-6 rounded-full [&_svg:not([class*='size-'])]:size-3.5",
        /** A badge on a tile's corner. */
        "icon-badge":
          "size-4.5 rounded-full [&_svg:not([class*='size-'])]:size-2.5",
        /** A large call to action: the web page's downloads. */
        cta: "h-11 gap-2 rounded-[10px] px-5 text-[15px] tracking-[-0.01em] [&_svg:not([class*='size-'])]:size-[18px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
