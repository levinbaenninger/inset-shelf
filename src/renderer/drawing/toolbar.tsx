import {
  ArrowUpRight01Icon,
  CircleIcon,
  Copy01Icon,
  Delete02Icon,
  SlashIcon,
  PencilIcon,
  Redo02Icon,
  SquareIcon,
  TextIcon,
  Tick02Icon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { inkColor } from "./render";
import { COLORS, TOOLS } from "./sketch";
import type { Color, Stroke, Tool } from "./sketch";
import { REDO_KEYS, SAVE_KEYS, TOOL_KEYS, UNDO_KEYS } from "./use-drawing-keys";

const TOOL_LABEL: Readonly<Record<Tool, string>> = {
  arrow: "Arrow",
  ellipse: "Ellipse",
  line: "Line",
  pen: "Pen",
  rect: "Rectangle",
  text: "Text",
};

const TOOL_ICON: Readonly<Record<Tool, typeof PencilIcon>> = {
  arrow: ArrowUpRight01Icon,
  ellipse: CircleIcon,
  line: SlashIcon,
  pen: PencilIcon,
  rect: SquareIcon,
  text: TextIcon,
};

const COLOR_LABEL: Readonly<Record<Color, string>> = {
  blue: "Blue",
  green: "Green",
  ink: "Ink",
  orange: "Orange",
  red: "Red",
};

export interface ToolbarProps {
  readonly tool: Tool;
  readonly color: Color;
  readonly stroke: Stroke;
  readonly dark: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canClear: boolean;
  /** There is something to save, and no save is under way. */
  readonly canSave: boolean;
  readonly onTool: (tool: Tool) => void;
  readonly onColor: (color: Color) => void;
  readonly onStroke: (stroke: Stroke) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onClear: () => void;
  readonly onSave: () => void;
  readonly onCopyAndSave: () => void;
}

const Tip = ({
  children,
  keys,
  label,
}: {
  readonly label: string;
  readonly keys?: string;
  readonly children: ReactNode;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side="top">
      {label}
      {keys === undefined ? null : <Kbd>{keys}</Kbd>}
    </TooltipContent>
  </Tooltip>
);

const Divider = () => <div aria-hidden className="bg-border mx-1 h-5 w-px" />;

/** The floating pill under the page: tools, inks, stroke, history, and saving to the shelf. */
export const Toolbar = ({
  canClear,
  canRedo,
  canSave,
  canUndo,
  color,
  dark,
  onClear,
  onColor,
  onCopyAndSave,
  onRedo,
  onSave,
  onStroke,
  onTool,
  onUndo,
  stroke,
  tool,
}: ToolbarProps) => (
  <div
    aria-label="Drawing tools"
    className="bg-background flex items-center gap-0.5 rounded-xl border p-1 shadow-sm"
    role="toolbar"
  >
    {TOOLS.map((each) => (
      <Tip key={each} keys={TOOL_KEYS[each]} label={TOOL_LABEL[each]}>
        <Button
          aria-label={TOOL_LABEL[each]}
          aria-pressed={each === tool}
          onClick={() => {
            onTool(each);
          }}
          size="icon-sm"
          variant={each === tool ? "secondary" : "ghost"}
        >
          <HugeiconsIcon icon={TOOL_ICON[each]} />
        </Button>
      </Tip>
    ))}
    <Divider />
    {COLORS.map((each) => (
      <Tip key={each} label={COLOR_LABEL[each]}>
        <Button
          aria-label={COLOR_LABEL[each]}
          aria-pressed={each === color}
          onClick={() => {
            onColor(each);
          }}
          size="icon-sm"
          variant="ghost"
        >
          <span
            className="ring-offset-background group-aria-pressed/button:ring-foreground/40 size-4 rounded-full bg-(--swatch) group-aria-pressed/button:ring-2 group-aria-pressed/button:ring-offset-1"
            style={{ "--swatch": inkColor(each, dark) }}
          />
        </Button>
      </Tip>
    ))}
    <Tip label="Thick stroke">
      <Button
        aria-label="Thick stroke"
        aria-pressed={stroke === "thick"}
        onClick={() => {
          onStroke(stroke === "thick" ? "thin" : "thick");
        }}
        size="icon-sm"
        variant="ghost"
      >
        <span className="bg-foreground h-0.5 w-4 rounded-full group-aria-pressed/button:h-1.5" />
      </Button>
    </Tip>
    <Divider />
    <Tip keys={UNDO_KEYS} label="Undo">
      <Button
        aria-label="Undo"
        disabled={!canUndo}
        onClick={onUndo}
        size="icon-sm"
        variant="ghost"
      >
        <HugeiconsIcon icon={Undo02Icon} />
      </Button>
    </Tip>
    <Tip keys={REDO_KEYS} label="Redo">
      <Button
        aria-label="Redo"
        disabled={!canRedo}
        onClick={onRedo}
        size="icon-sm"
        variant="ghost"
      >
        <HugeiconsIcon icon={Redo02Icon} />
      </Button>
    </Tip>
    <Tip label="Clear">
      <Button
        aria-label="Clear"
        disabled={!canClear}
        onClick={onClear}
        size="icon-sm"
        variant="ghost"
      >
        <HugeiconsIcon icon={Delete02Icon} />
      </Button>
    </Tip>
    <Divider />
    <Tip label="Copy and Save">
      <Button
        aria-label="Copy and Save"
        disabled={!canSave}
        onClick={onCopyAndSave}
        size="icon-sm"
        variant="ghost"
      >
        <HugeiconsIcon icon={Copy01Icon} />
      </Button>
    </Tip>
    <Tip keys={SAVE_KEYS} label="Save">
      <Button
        aria-label="Save"
        disabled={!canSave}
        onClick={onSave}
        size="icon-sm"
      >
        <HugeiconsIcon icon={Tick02Icon} />
      </Button>
    </Tip>
  </div>
);
