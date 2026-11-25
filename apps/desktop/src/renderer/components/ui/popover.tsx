"use client";

import { cn } from "cn";
import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/** `fit` wraps content that brings its own padding, such as a Calendar. */
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  collisionPadding = 6,
  size = "default",
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  size?: "default" | "fit";
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        collisionPadding={collisionPadding}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-50 flex origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 rounded-lg text-sm shadow-md ring-1 outline-hidden duration-100",
          size === "fit" ? "w-auto p-0" : "w-72 p-2.5",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverContent };
