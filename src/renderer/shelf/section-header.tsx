import {
  ArrowDown01Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SECTION_NAME_MAX } from "@shared/shelf";
import type { Section, SectionId } from "@shared/shelf";
import { useEffect, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { MenuAnchor } from "./menus";

const COLLAPSED_KEY = "inset-shelf.collapsed-sections";

const readCollapsed = (): ReadonlySet<SectionId> => {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(COLLAPSED_KEY) ?? "[]"
    );

    return new Set(
      Array.isArray(stored)
        ? stored.filter((id): id is SectionId => typeof id === "string")
        : []
    );
  } catch {
    return new Set();
  }
};

/** The sections folded away, kept across launches. */
export const useCollapsedSections = () => {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);

  const setOpen = (id: SectionId, open: boolean): void => {
    setCollapsed((current) => {
      if (current.has(id) !== open) {
        return current;
      }

      const next = new Set(current);

      if (open) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  return { collapsed, setOpen };
};

/** A one-line field for a section's name: Return saves, Escape keeps the old name. */
export const SectionNameField = ({
  initial,
  label,
  onCancel,
  onSave,
}: {
  readonly initial: string;
  readonly label: string;
  readonly onSave: (name: string) => void;
  readonly onCancel: () => void;
}) => {
  const [name, setName] = useState(initial);

  const finish = (): void => {
    if (name.trim() === "" || name.trim() === initial) {
      onCancel();
    } else {
      onSave(name.trim());
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      finish();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <input
      aria-label={label}
      autoFocus
      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-7 w-full min-w-0 rounded-md border bg-transparent px-2 text-xs font-medium outline-none focus-visible:ring-3"
      maxLength={SECTION_NAME_MAX}
      onBlur={finish}
      onChange={(event) => {
        setName(event.target.value);
      }}
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      onKeyDown={onKeyDown}
      placeholder="Section name"
      value={name}
    />
  );
};

/** Where a right-click or a button's menu opens. */
const anchorAt = (event: MouseEvent): MenuAnchor => ({
  align: "start",
  height: 0,
  width: 0,
  x: event.clientX,
  y: event.clientY,
});

const anchorUnder = (element: Element): MenuAnchor => {
  const box = element.getBoundingClientRect();

  return {
    align: "end",
    height: box.height,
    width: box.width,
    x: box.left,
    y: box.top,
  };
};

/**
 * Marks the section new items go to with a filled dot. The other sections
 * show an empty ring in the same place, and one click on it sends new items
 * there.
 */
const TargetDot = ({
  active,
  name,
  onMakeActive,
}: {
  readonly active: boolean;
  readonly name: string;
  readonly onMakeActive: () => void;
}) => {
  if (active) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex size-7 shrink-0 items-center justify-center">
            <span className="bg-pin size-2 rounded-full" />
            <span className="sr-only">New items go to {name}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">New items go here</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={`Add new items to ${name}`}
          className="group/dot focus-visible:ring-ring/50 flex size-7 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-3"
          onClick={onMakeActive}
          type="button"
        >
          <span className="border-muted-foreground/60 group-hover/dot:border-pin group-hover/dot:bg-pin/30 size-2 rounded-full border transition-colors" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">Add new items here</TooltipContent>
    </Tooltip>
  );
};

/**
 * A section's heading: a click on the name folds it away or opens it again,
 * the dot at the right picks where new items go, and ⋯ or a right-click opens
 * the section's menu.
 */
export const SectionHeader = ({
  active,
  collapsed,
  onMakeActive,
  onOpenMenu,
  onRename,
  onStopRenaming,
  onToggle,
  renaming,
  section,
}: {
  readonly section: Section;
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly renaming: boolean;
  readonly onToggle: () => void;
  readonly onMakeActive: () => void;
  readonly onRename: (name: string) => void;
  readonly onStopRenaming: () => void;
  readonly onOpenMenu: (anchor: MenuAnchor) => void;
}) => (
  <div
    className="group/section flex h-9 items-center gap-0.5 pt-1"
    onContextMenu={(event) => {
      event.preventDefault();
      onOpenMenu(anchorAt(event));
    }}
  >
    {renaming ? (
      <SectionNameField
        initial={section.name}
        label={`Rename ${section.name}`}
        onCancel={onStopRenaming}
        onSave={(name) => {
          onRename(name);
          onStopRenaming();
        }}
      />
    ) : (
      <>
        <button
          aria-expanded={!collapsed}
          className={cn(
            "hover:bg-foreground/5 focus-visible:ring-ring/50 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-medium outline-none focus-visible:ring-3",
            active ? "text-foreground" : "text-muted-foreground"
          )}
          onClick={onToggle}
          title={collapsed ? "Show this section" : "Fold this section away"}
          type="button"
        >
          <HugeiconsIcon
            className={cn(
              "text-muted-foreground shrink-0 transition-transform",
              collapsed && "-rotate-90"
            )}
            icon={ArrowDown01Icon}
            size={14}
          />
          <span className="truncate">{section.name}</span>
          {/* A hairline runs from the name to the dot, so each section reads as its own group. */}
          <span
            aria-hidden="true"
            className="bg-foreground/10 ml-1 h-px min-w-4 flex-1"
          />
        </button>
        {/* The ⋯ takes no room until the pointer is on the heading or the button has focus. */}
        <span className="w-0 shrink-0 overflow-hidden group-hover/section:w-7 focus-within:w-7">
          <Button
            aria-label={`${section.name} Actions`}
            onClick={(event) => {
              onOpenMenu(anchorUnder(event.currentTarget));
            }}
            size="icon-sm"
            variant="ghost"
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} />
          </Button>
        </span>
        <TargetDot
          active={active}
          name={section.name}
          onMakeActive={onMakeActive}
        />
      </>
    )}
  </div>
);
