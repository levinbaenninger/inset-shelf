import {
  DIGIT_STROKE,
  digitStrokes,
  PIN_BOX,
  PIN_HALO,
  PIN_HALO_ALPHA,
  PIN_HEIGHT,
  PIN_OUTLINE,
  pinPath,
} from "@shared/pin-shape";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

const PATH = pinPath();

const VIEW_BOX = `${PIN_BOX.x} ${PIN_BOX.y} ${PIN_BOX.width} ${PIN_BOX.height}`;

/** Where the tip sits in the SVG's box, as a share of its size. */
const TIP_X = `${(-PIN_BOX.x / PIN_BOX.width) * 100}%`;
const TIP_Y = `${(-PIN_BOX.y / PIN_BOX.height) * 100}%`;

/** The SVG of one numbered pin, `height` CSS pixels from tip to top; the same shape exports draw (src/main/pin-mark.ts). */
export const PinGlyph = ({
  className,
  height = PIN_HEIGHT,
  number,
  style,
}: {
  readonly number: number;
  readonly height?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}) => {
  const scale = height / PIN_HEIGHT;

  return (
    <svg
      aria-hidden="true"
      className={cn("block shrink-0 overflow-visible", className)}
      height={PIN_BOX.height * scale}
      style={style}
      viewBox={VIEW_BOX}
      width={PIN_BOX.width * scale}
    >
      <path
        d={PATH}
        fill="none"
        stroke={`rgb(0 0 0 / ${PIN_HALO_ALPHA})`}
        strokeLinejoin="round"
        strokeWidth={2 * (PIN_OUTLINE + PIN_HALO)}
      />
      <path
        d={PATH}
        fill="var(--color-pin)"
        paintOrder="stroke"
        stroke="var(--color-pin-outline)"
        strokeLinejoin="round"
        strokeWidth={2 * PIN_OUTLINE}
      />
      {digitStrokes(number).map((line) => (
        <polyline
          fill="none"
          key={line.map((p) => `${p.x},${p.y}`).join(" ")}
          points={line.map((p) => `${p.x},${p.y}`).join(" ")}
          stroke="var(--color-pin-outline)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={DIGIT_STROKE}
        />
      ))}
    </svg>
  );
};

export interface PinMarkerProps {
  /** Where the tip goes, as a share of the image (e.g. "40%"). */
  readonly left: string;
  readonly top: string;
  readonly number: number;
  /** Tip to top in CSS pixels. */
  readonly height?: number;
  readonly selected?: boolean;
  /** A preview whose frame clips: a pin at its edge moves in just far enough to show whole. */
  readonly inset?: boolean;
}

/** `place`, kept between `low` and the far edge less `high` pixels. */
const within = (place: string, low: number, high: number): string =>
  `clamp(${low}px, ${place}, calc(100% - ${high}px))`;

/** A numbered map pin over an image, its tip exactly on the point (or, `inset`, as near it as shows the whole pin). */
export const PinMarker = ({
  height = PIN_HEIGHT,
  inset = false,
  left,
  number,
  selected = false,
  top,
}: PinMarkerProps) => {
  const scale = height / PIN_HEIGHT;
  const half = (PIN_BOX.width * scale) / 2;
  const above = -PIN_BOX.y * scale;
  const below = PIN_BOX.height * scale - above;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-(--pin-y) left-(--pin-x) -translate-x-(--tip-x) -translate-y-(--tip-y)",
        selected && "pin-selected"
      )}
      style={{
        "--pin-x": inset ? within(left, half, half) : left,
        "--pin-y": inset ? within(top, above, below) : top,
        "--tip-x": TIP_X,
        "--tip-y": TIP_Y,
      }}
    >
      <PinGlyph height={height} number={number} />
    </span>
  );
};
