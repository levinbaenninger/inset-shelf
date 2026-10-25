import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Attachment01Icon,
  CheckmarkCircle02Icon,
  CleanIcon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  FolderAddIcon,
  FolderExportIcon,
  InboxDownloadIcon,
  Link01Icon,
  PaintBrush01Icon,
  PencilEdit02Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { COLOR_HEX } from "@shared/colors";
import {
  COLOR_NAMES,
  itemMenu,
  pickedMenu,
  sectionMenu,
  shelfMenu,
} from "@shared/menus";
import type { MenuChoice, MenuEntry, MenuIcon } from "@shared/menus";
import { COLORS } from "@shared/shelf";
import type { ItemId, SectionId, ShelfDoc } from "@shared/shelf";
import { keyText } from "@shared/shortcut";
import { useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSwatchItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isMac } from "@/shared/platform";

type ColorsEntry = Extract<MenuEntry, { readonly kind: "colors" }>;

type GroupEntry = Extract<MenuEntry, { readonly kind: "group" }>;

const ICONS: Record<MenuIcon, typeof Copy01Icon> = {
  addHere: InboxDownloadIcon,
  annotate: PaintBrush01Icon,
  check: CheckmarkCircle02Icon,
  clear: CleanIcon,
  copy: Copy01Icon,
  delete: Delete02Icon,
  edit: PencilEdit02Icon,
  link: Link01Icon,
  move: FolderExportIcon,
  newSection: FolderAddIcon,
  open: ArrowUpRight01Icon,
  settings: Settings02Icon,
};

const EntryIcon = ({ icon }: { readonly icon?: MenuIcon }) =>
  icon === undefined ? null : <HugeiconsIcon icon={ICONS[icon]} />;

const Shortcut = ({ accelerator }: { readonly accelerator?: string }) =>
  accelerator === undefined ? null : (
    <DropdownMenuShortcut>{keyText(accelerator, isMac)}</DropdownMenuShortcut>
  );

/** The colours as one row of swatches, without a heading; the item's own is ringed. */
const ColorRow = ({
  entry,
  onChoose,
}: {
  readonly entry: ColorsEntry;
  readonly onChoose: (choice: MenuChoice) => void;
}) => (
  // The swatches speak for themselves; the label is for assistive technology.
  <DropdownMenuGroup aria-label={entry.label}>
    <div className="flex items-center justify-between px-1 py-0.5">
      {COLORS.map((color) => (
        <DropdownMenuSwatchItem
          aria-label={COLOR_NAMES[color]}
          key={color}
          onSelect={() => {
            onChoose({ color, id: entry.id, kind: "setColor" });
          }}
          title={COLOR_NAMES[color]}
        >
          <span
            className={cn(
              "size-3.5 rounded-full bg-(--swatch)",
              entry.current === color &&
                "ring-foreground ring-offset-popover ring-2 ring-offset-1"
            )}
            style={{ "--swatch": COLOR_HEX[color] }}
          />
        </DropdownMenuSwatchItem>
      ))}
      <DropdownMenuSwatchItem
        aria-label="No Colour"
        onSelect={() => {
          onChoose({ color: null, id: entry.id, kind: "setColor" });
        }}
        title="No Colour"
      >
        <span
          className={cn(
            "border-muted-foreground size-3.5 rounded-full border border-dashed",
            entry.current === null &&
              "ring-foreground ring-offset-popover ring-2 ring-offset-1"
          )}
        />
      </DropdownMenuSwatchItem>
    </div>
  </DropdownMenuGroup>
);

/**
 * A menu's entries. A group (the sections to move to) is one entry that
 * turns the menu into its list, since a submenu has no room beside the shelf.
 */
const Entries = ({
  entries,
  onChoose,
  onOpenGroup,
}: {
  readonly entries: readonly MenuEntry[];
  readonly onChoose: (choice: MenuChoice) => void;
  readonly onOpenGroup: (group: GroupEntry) => void;
}): ReactNode =>
  entries.map((entry, index) => {
    switch (entry.kind) {
      case "separator": {
        // Separators have no identity of their own; their place is stable.
        // oxlint-disable-next-line react/no-array-index-key
        return <DropdownMenuSeparator key={`separator-${index}`} />;
      }

      case "group": {
        return (
          <DropdownMenuItem
            key={entry.label}
            onSelect={(event) => {
              // The menu stays open and shows the group's entries instead.
              event.preventDefault();
              onOpenGroup(entry);
            }}
          >
            <EntryIcon icon={entry.icon} />
            {entry.label}
            <HugeiconsIcon className="ml-auto" icon={ArrowRight01Icon} />
          </DropdownMenuItem>
        );
      }

      case "colors": {
        return <ColorRow entry={entry} key="colors" onChoose={onChoose} />;
      }

      case "choice": {
        return (
          <DropdownMenuItem
            disabled={!entry.enabled}
            key={entry.label}
            onSelect={() => {
              onChoose(entry.choice);
            }}
            variant={entry.destructive === true ? "destructive" : "default"}
          >
            <EntryIcon icon={entry.icon} />
            <span className="truncate">{entry.label}</span>
            <Shortcut accelerator={entry.accelerator} />
          </DropdownMenuItem>
        );
      }

      default: {
        return null;
      }
    }
  });

/** Focus stays where a choice put it (a note being edited, the note field), never back on the button with its ring. */
const keepFocus = (event: Event): void => {
  event.preventDefault();
};

/** A menu's content, showing one group's entries in place when it is opened. */
const MenuContent = ({
  entries,
  onChoose,
  ...props
}: {
  readonly entries: readonly MenuEntry[];
  readonly onChoose: (choice: MenuChoice) => void;
} & Omit<ComponentProps<typeof DropdownMenuContent>, "children">) => {
  const [group, setGroup] = useState<GroupEntry | null>(null);

  return (
    <DropdownMenuContent
      // Each page places itself again, so a taller page never ends up clipped.
      key={group?.label ?? ""}
      onCloseAutoFocus={keepFocus}
      {...props}
    >
      {group === null ? (
        <Entries entries={entries} onChoose={onChoose} onOpenGroup={setGroup} />
      ) : (
        <>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setGroup(null);
            }}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} />
            Back
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
          <Entries
            entries={group.entries}
            onChoose={onChoose}
            onOpenGroup={setGroup}
          />
        </>
      )}
    </DropdownMenuContent>
  );
};

/** Where a menu opens: under a ⋯ button, or at the pointer for a right-click (no size). */
export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly align: "start" | "end";
}

/** What a right-click was on. */
export type MenuTarget =
  | { readonly kind: "item"; readonly id: ItemId }
  | { readonly kind: "items"; readonly ids: readonly ItemId[] }
  | { readonly kind: "section"; readonly id: SectionId }
  | { readonly kind: "shelf" };

export interface OpenMenu extends MenuAnchor {
  readonly target: MenuTarget;
}

/** The entries for a target, or null once it is gone. */
const entriesFor = (
  target: MenuTarget,
  doc: ShelfDoc
): readonly MenuEntry[] | null => {
  if (target.kind === "shelf") {
    return shelfMenu();
  }

  if (target.kind === "items") {
    const items = doc.items.filter((item) => target.ids.includes(item.id));

    return items.length === 0 ? null : pickedMenu(items, doc);
  }

  if (target.kind === "section") {
    const section = doc.sections.find(
      (candidate) => candidate.id === target.id
    );

    return section === undefined ? null : sectionMenu(section, doc);
  }

  const item = doc.items.find((candidate) => candidate.id === target.id);

  return item === undefined ? null : itemMenu(item, doc);
};

/**
 * One menu for every right-click and every item's ⋯, opened at an anchor the
 * shelf reports. Not modal, so a dialog it opens (deleting a section) never
 * leaves the page unclickable.
 */
export const PointerMenu = ({
  doc,
  menu,
  onChoose,
  onClose,
}: {
  readonly menu: OpenMenu | null;
  readonly doc: ShelfDoc;
  readonly onChoose: (choice: MenuChoice) => void;
  readonly onClose: () => void;
}) => {
  const entries = menu === null ? null : entriesFor(menu.target, doc);

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={entries !== null}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed top-(--y) left-(--x) h-(--h) w-(--w)"
          style={{
            "--h": `${menu?.height ?? 0}px`,
            "--w": `${menu?.width ?? 0}px`,
            "--x": `${menu?.x ?? 0}px`,
            "--y": `${menu?.y ?? 0}px`,
          }}
        />
      </DropdownMenuTrigger>
      {entries === null ? null : (
        <MenuContent
          align={menu?.align ?? "start"}
          entries={entries}
          // A new target starts on the first page of its menu.
          key={
            menu === null
              ? ""
              : `${menu.target.kind}-${"id" in menu.target ? menu.target.id : ""}-${menu.x}-${menu.y}`
          }
          onChoose={onChoose}
          sideOffset={menu?.height === 0 ? 2 : 4}
        />
      )}
    </DropdownMenu>
  );
};

/** The ⋯ at the top: start a section, Settings. */
export const ShelfMenu = ({
  children,
  onChoose,
}: {
  readonly children: ReactNode;
  readonly onChoose: (choice: MenuChoice) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <MenuContent align="end" entries={shelfMenu()} onChoose={onChoose} />
  </DropdownMenu>
);

export interface AddActions {
  readonly attachFiles: () => void;
  readonly newDrawing: () => void;
}

/** The "+" in the note field opens upward, above the field, so it never covers it; closing it goes back to the field. */
export const AddMenu = ({
  actions,
  children,
  onClosed,
}: {
  readonly actions: AddActions;
  readonly children: ReactNode;
  readonly onClosed: () => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent
      align="start"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onClosed();
      }}
      side="top"
    >
      <DropdownMenuItem
        onSelect={() => {
          actions.attachFiles();
        }}
      >
        <HugeiconsIcon icon={Attachment01Icon} />
        Attach Files
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          actions.newDrawing();
        }}
      >
        <HugeiconsIcon icon={Edit02Icon} />
        New Drawing
        <Shortcut accelerator="Alt+CommandOrControl+N" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
