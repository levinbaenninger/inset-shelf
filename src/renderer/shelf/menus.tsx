import { COLOR_HEX } from "@shared/colors";
import { COLOR_NAMES, itemMenu, sectionMenu } from "@shared/menus";
import type { MenuChoice, MenuEntry } from "@shared/menus";
import { COLORS } from "@shared/shelf";
import type { ItemId, ShelfDoc } from "@shared/shelf";
import { AREA_ACCELERATOR, keyText } from "@shared/shortcut";
import { useRef } from "react";
import type { ComponentProps, ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSwatchItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { isMac } from "@/shared/platform";

type ChoiceEntry = Extract<MenuEntry, { readonly kind: "choice" }>;

type ColorsEntry = Extract<MenuEntry, { readonly kind: "colors" }>;

/** Runs of checked entries, such as the sections, become one radio group. */
type Block =
  | Exclude<MenuEntry, ChoiceEntry>
  | ChoiceEntry
  | { readonly kind: "radio"; readonly entries: readonly ChoiceEntry[] };

const blocks = (entries: readonly MenuEntry[]): readonly Block[] => {
  const result: Block[] = [];
  let radio: ChoiceEntry[] | null = null;

  for (const entry of entries) {
    if (entry.kind === "choice" && entry.checked !== undefined) {
      if (radio === null) {
        radio = [];
        result.push({ entries: radio, kind: "radio" });
      }

      radio.push(entry);
    } else {
      radio = null;
      result.push(entry);
    }
  }

  return result;
};

const Shortcut = ({ accelerator }: { readonly accelerator?: string }) =>
  accelerator === undefined ? null : (
    <DropdownMenuShortcut>{keyText(accelerator, isMac)}</DropdownMenuShortcut>
  );

/** The colours as one row of swatches; the item's own is ringed. */
const ColorRow = ({
  entry,
  onChoose,
}: {
  readonly entry: ColorsEntry;
  readonly onChoose: (choice: MenuChoice) => void;
}) => (
  <DropdownMenuGroup aria-label={entry.label}>
    <DropdownMenuLabel>{entry.label}</DropdownMenuLabel>
    <div className="flex items-center gap-0.5 px-1 pb-1">
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
        disabled={entry.current === null}
        onSelect={() => {
          onChoose({ color: null, id: entry.id, kind: "setColor" });
        }}
        title="No Colour"
      >
        <span className="border-muted-foreground size-3.5 rounded-full border border-dashed" />
      </DropdownMenuSwatchItem>
    </div>
  </DropdownMenuGroup>
);

const Entries = ({
  entries,
  onChoose,
}: {
  readonly entries: readonly MenuEntry[];
  readonly onChoose: (choice: MenuChoice) => void;
}): ReactNode =>
  blocks(entries).map((block, index) => {
    switch (block.kind) {
      case "separator": {
        // Separators have no identity of their own; their place is stable.
        // oxlint-disable-next-line react/no-array-index-key
        return <DropdownMenuSeparator key={`separator-${index}`} />;
      }

      case "group": {
        return (
          <DropdownMenuGroup aria-label={block.label} key={block.label}>
            <DropdownMenuLabel>{block.label}</DropdownMenuLabel>
            <Entries entries={block.entries} onChoose={onChoose} />
          </DropdownMenuGroup>
        );
      }

      case "colors": {
        return <ColorRow entry={block} key="colors" onChoose={onChoose} />;
      }

      case "radio": {
        const current = block.entries.findIndex(
          (entry) => entry.checked === true
        );

        return (
          <DropdownMenuRadioGroup
            key={`radio-${block.entries[0]?.label ?? ""}`}
            onValueChange={(value) => {
              const entry = block.entries[Number(value)];

              if (entry !== undefined) {
                onChoose(entry.choice);
              }
            }}
            value={String(current)}
          >
            {block.entries.map((entry, position) => (
              <DropdownMenuRadioItem
                disabled={!entry.enabled}
                // The position is the radio value; labels can repeat.
                // oxlint-disable-next-line react/no-array-index-key
                key={position}
                value={String(position)}
              >
                <span className="truncate">{entry.label}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        );
      }

      case "choice": {
        return (
          <DropdownMenuItem
            disabled={!block.enabled}
            key={block.label}
            onSelect={() => {
              onChoose(block.choice);
            }}
          >
            {block.label}
            <Shortcut accelerator={block.accelerator} />
          </DropdownMenuItem>
        );
      }

      default: {
        return null;
      }
    }
  });

/**
 * A menu's content. After a choice, focus stays where the choice put it
 * (a note being edited, the note field) instead of going back to the button.
 */
const MenuContent = ({
  entries,
  onChoose,
  ...props
}: {
  readonly entries: readonly MenuEntry[];
  readonly onChoose: (choice: MenuChoice) => void;
} & Omit<ComponentProps<typeof DropdownMenuContent>, "children">) => {
  const chose = useRef(false);

  return (
    <DropdownMenuContent
      onCloseAutoFocus={(event) => {
        if (chose.current) {
          event.preventDefault();
          chose.current = false;
        }
      }}
      {...props}
    >
      <Entries
        entries={entries}
        onChoose={(choice) => {
          chose.current = true;
          onChoose(choice);
        }}
      />
    </DropdownMenuContent>
  );
};

/** Where an item's menu opens: under its ⋯ button, or at the pointer for a right-click. */
export interface ItemMenuAnchor {
  readonly id: ItemId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly align: "start" | "end";
}

/** One menu for every item, opened at an anchor the row reports. */
export const ItemMenu = ({
  anchor,
  doc,
  onChoose,
  onClose,
}: {
  readonly anchor: ItemMenuAnchor | null;
  readonly doc: ShelfDoc;
  readonly onChoose: (choice: MenuChoice) => void;
  readonly onClose: () => void;
}) => {
  const item =
    anchor === null
      ? undefined
      : doc.items.find((candidate) => candidate.id === anchor.id);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={item !== undefined}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed top-(--y) left-(--x) h-(--h) w-(--w)"
          style={{
            "--h": `${anchor?.height ?? 0}px`,
            "--w": `${anchor?.width ?? 0}px`,
            "--x": `${anchor?.x ?? 0}px`,
            "--y": `${anchor?.y ?? 0}px`,
          }}
        />
      </DropdownMenuTrigger>
      {item === undefined ? null : (
        <MenuContent
          align={anchor?.align ?? "start"}
          entries={itemMenu(item, doc)}
          onChoose={onChoose}
          sideOffset={anchor?.height === 0 ? 2 : 4}
        />
      )}
    </DropdownMenu>
  );
};

/** The ⋯ at the top: switch section, start one, clear checked items, Settings. */
export const SectionMenu = ({
  children,
  doc,
  onChoose,
}: {
  readonly children: ReactNode;
  readonly doc: ShelfDoc;
  readonly onChoose: (choice: MenuChoice) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <MenuContent
      align="end"
      className="max-w-72"
      entries={sectionMenu(doc)}
      onChoose={onChoose}
    />
  </DropdownMenu>
);

export interface AddActions {
  readonly captureArea: () => void;
  readonly attachFiles: () => void;
  readonly newDrawing: () => void;
}

/** The "+" in the note field opens upward, above the field, so it never covers it. */
export const AddMenu = ({
  actions,
  children,
}: {
  readonly actions: AddActions;
  readonly children: ReactNode;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top">
      <DropdownMenuItem
        onSelect={() => {
          actions.captureArea();
        }}
      >
        Capture Area
        <Shortcut accelerator={AREA_ACCELERATOR} />
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          actions.attachFiles();
        }}
      >
        Attach Files…
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          actions.newDrawing();
        }}
      >
        New Drawing…
        <Shortcut accelerator="Alt+CommandOrControl+N" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
