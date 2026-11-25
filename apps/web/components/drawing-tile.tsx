"use client";

import {
  ArrowMoveUpRightIcon,
  CircleIcon,
  Cursor01Icon,
  Location01Icon,
  RedoIcon,
  SquareIcon,
  TextFontIcon,
  Tick02Icon,
  UndoIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "@inset/ui/lib/utils";
import { useState } from "react";
import type { MouseEvent, ReactNode } from "react";

import { Icon, PinMark } from "./app-ui";
import type { PinNumber } from "./app-ui";

interface Pin {
  number: PinNumber;
  /** The tip, in the canvas's own pixels. */
  x: number;
  y: number;
}

const MAX_PINS = 6;

const START: Pin[] = [
  { number: 1, x: 170, y: 39 },
  { number: 2, x: 150, y: 123 },
  { number: 3, x: 246, y: 145 },
];

const NUMBERS: PinNumber[] = [1, 2, 3, 4, 5, 6];

// Where each pin lands when the canvas is pressed from the keyboard, with no pointer to place it.
const KEYBOARD_SPOTS = [
  ...START,
  { x: 300, y: 64 },
  { x: 62, y: 150 },
  { x: 214, y: 70 },
];

const DRAW_TOOLS: IconSvgElement[] = [
  SquareIcon,
  CircleIcon,
  ArrowMoveUpRightIcon,
  TextFontIcon,
];

const ToolButton = ({
  label,
  pressed,
  onPress,
  disabled = false,
  className,
  children,
}: {
  label: string;
  pressed?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={pressed}
    disabled={disabled}
    onClick={onPress}
    className={cn(
      "focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-3 focus-visible:outline-none disabled:opacity-40",
      pressed === true ? "bg-accent text-foreground" : "hover:bg-accent/70",
      className
    )}
  >
    {children}
  </button>
);

// The drawing window over a screenshot: a click drops the next numbered pin where it lands, as the Pin tool does.
export const DrawingTile = () => {
  const [pins, setPins] = useState<Pin[]>(START);
  const [tool, setTool] = useState<"select" | "pin">("select");
  const next = NUMBERS[pins.length];
  const full = next === undefined || pins.length >= MAX_PINS;

  const drop = (event: MouseEvent<HTMLButtonElement>) => {
    if (next === undefined) {
      return;
    }

    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    // The tile draws its stage scaled down on a phone; the pins live in the canvas's own pixels.
    const scale = box.width / canvas.offsetWidth;

    const spot =
      event.detail === 0
        ? KEYBOARD_SPOTS[pins.length]
        : {
            x: (event.clientX - box.left) / scale,
            y: (event.clientY - box.top) / scale,
          };

    setTool("pin");
    setPins([...pins, { number: next, x: spot.x, y: spot.y }]);
  };

  return (
    <div className="app-ui light shadow-card absolute top-6 left-1/2 w-[392px] -translate-x-1/2 overflow-hidden rounded-xl bg-white">
      <p className="border-b py-2.5 text-center text-[13px] font-medium">
        Annotate
      </p>
      <div className="relative mx-3 mt-3 h-[178px] overflow-hidden border">
        <button
          type="button"
          aria-label={
            full
              ? "Six pins dropped. Undo removes the last one."
              : `Drop pin ${pins.length + 1} on the screenshot`
          }
          aria-disabled={full}
          onClick={drop}
          className={cn(
            "focus-visible:ring-ring/50 absolute inset-0 flex items-center justify-center bg-[linear-gradient(135deg,#eef2f7,#dfe7f1)] outline-none focus-visible:ring-3 focus-visible:outline-none focus-visible:ring-inset",
            full ? "cursor-not-allowed" : "cursor-crosshair"
          )}
        >
          <span
            aria-hidden="true"
            className="grid w-[176px] gap-1.5 rounded-lg bg-white p-3.5 text-left text-[9px] text-neutral-500 shadow-[0_6px_18px_rgb(15_40_80/0.12)]"
          >
            <b className="text-[13px] leading-none font-bold text-neutral-900">
              Sign in
            </b>
            <span className="mt-1">Email</span>
            <span className="h-[18px] w-[96px] rounded border border-neutral-200" />
            <span className="text-[9px] text-red-600">
              Something went wrong
            </span>
            <span className="mt-1 flex h-[20px] items-center justify-center rounded bg-[#1f6feb] text-[9px] font-medium text-white">
              Sign in
            </span>
          </span>
        </button>
        {pins.map((pin) => (
          <PinMark
            key={pin.number}
            number={pin.number}
            className="pointer-events-none absolute top-[calc(var(--pin-y)-23.5px)] left-[calc(var(--pin-x)-10.5px)]"
            style={{ "--pin-x": `${pin.x}px`, "--pin-y": `${pin.y}px` }}
          />
        ))}
        <p aria-live="polite" className="sr-only">
          {pins.length > START.length && `Pin ${pins.length} dropped`}
        </p>
      </div>
      <div className="flex justify-center px-3 py-3">
        <div className="bg-background flex items-center gap-0.5 rounded-xl border p-1 shadow-sm">
          <ToolButton
            label="Select"
            pressed={tool === "select"}
            onPress={() => {
              setTool("select");
            }}
          >
            <Icon icon={Cursor01Icon} size={14} />
          </ToolButton>
          {DRAW_TOOLS.map((drawTool, index) => (
            <span
              key={index}
              aria-hidden="true"
              className="flex size-6 items-center justify-center"
            >
              <Icon icon={drawTool} size={14} />
            </span>
          ))}
          <ToolButton
            label="Pin"
            pressed={tool === "pin"}
            onPress={() => {
              setTool("pin");
            }}
          >
            <Icon icon={Location01Icon} size={14} />
          </ToolButton>
          <span aria-hidden="true" className="bg-border mx-1 h-4 w-px" />
          <span aria-hidden="true" className="flex items-center gap-1.5 px-1">
            <span className="size-3.5 rounded-full bg-neutral-900" />
            <span className="size-3.5 rounded-full bg-red-600 ring-2 ring-neutral-300 ring-offset-1" />
            <span className="bg-pin size-3.5 rounded-full" />
          </span>
          <span aria-hidden="true" className="bg-border mx-1 h-4 w-px" />
          <ToolButton
            label="Undo"
            disabled={pins.length === 0}
            onPress={() => {
              setPins(pins.slice(0, -1));
            }}
          >
            <Icon icon={UndoIcon} size={14} />
          </ToolButton>
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center opacity-40"
          >
            <Icon icon={RedoIcon} size={14} />
          </span>
          <span
            aria-hidden="true"
            className="bg-primary/50 ml-0.5 flex size-6 items-center justify-center rounded-md text-white"
          >
            <Icon icon={Tick02Icon} size={14} />
          </span>
        </div>
      </div>
    </div>
  );
};
