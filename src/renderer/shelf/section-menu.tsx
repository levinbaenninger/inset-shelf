import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SectionId, ShelfDoc } from "@shared/shelf";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface SectionMenuProps {
  readonly doc: ShelfDoc;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (id: SectionId) => void;
  readonly onClearDone: () => void;
}

const countIn = (doc: ShelfDoc, id: SectionId): number =>
  doc.items.filter((item) => item.sectionId === id && !item.done).length;

/** Switches the section that captures go to; ⌘K opens it. */
export const SectionMenu = ({
  doc,
  onClearDone,
  onOpenChange,
  onSelect,
  open,
}: SectionMenuProps) => {
  const active = doc.sections.find(
    (section) => section.id === doc.activeSectionId
  );

  const doneHere = doc.items.filter(
    (item) => item.sectionId === doc.activeSectionId && item.done
  ).length;

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger asChild>
        <Button className="max-w-56 justify-start" size="sm" variant="ghost">
          <span className="truncate font-semibold">{active?.name}</span>
          <HugeiconsIcon data-icon="inline-end" icon={ArrowDown01Icon} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Sections</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            const section = doc.sections.find(
              (candidate) => candidate.id === value
            );

            if (section !== undefined) {
              onSelect(section.id);
            }
          }}
          value={doc.activeSectionId}
        >
          {doc.sections.map((section) => (
            <DropdownMenuRadioItem key={section.id} value={section.id}>
              <span className="truncate">{section.name}</span>
              <DropdownMenuShortcut>
                {countIn(doc, section.id)}
              </DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={doneHere === 0} onSelect={onClearDone}>
          Clear done items
          <DropdownMenuShortcut>{doneHere}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="text-muted-foreground px-2 py-1.5 text-xs">
          Type “# Name” in the note field to add a section.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
