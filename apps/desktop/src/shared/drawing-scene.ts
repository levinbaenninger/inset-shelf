/**
 * The marks of a saved drawing, kept beside its picture so Annotate can open
 * them again to edit (feedback round 13). They are in the picture's DIP: an
 * image's own, or for a drawing made on a blank page, its saved pixels / 2.
 * Pins are not among them; the item keeps those, in its picture's pixels.
 */
import { z } from "zod";

import type { Pin } from "./shelf";

export const DRAWING_COLORS = [
  "ink",
  "red",
  "blue",
  "green",
  "orange",
] as const;

const Coordinate = z.number().min(-1_000_000).max(1_000_000);
const Size = z.number().positive().max(10_000);

const PointSchema = z.object({ x: Coordinate, y: Coordinate });

const ColorSchema = z.enum(DRAWING_COLORS);

export const MARKS_MAX = 10_000;
const POINTS_MAX = 100_000;
const TEXT_MAX = 20_000;

/** A pen stroke, line, arrow, box, ellipse or text; never a pin. */
export const StrokeMarkSchema = z.discriminatedUnion("kind", [
  z.object({
    color: ColorSchema,
    kind: z.literal("pen"),
    points: z.array(PointSchema).max(POINTS_MAX).readonly(),
    width: Size,
  }),
  z.object({
    color: ColorSchema,
    from: PointSchema,
    kind: z.enum(["line", "arrow", "rect", "ellipse"]),
    to: PointSchema,
    width: Size,
  }),
  z.object({
    at: PointSchema,
    color: ColorSchema,
    kind: z.literal("text"),
    size: Size,
    text: z.string().max(TEXT_MAX),
  }),
]);

export type StrokeMark = z.output<typeof StrokeMarkSchema>;

export const StrokeMarksSchema = z
  .array(StrokeMarkSchema)
  .max(MARKS_MAX)
  .readonly();

/** A pin as the page holds it: in the picture's DIP, numbered by its place. */
export interface PinAt {
  readonly kind: "pin";
  readonly at: { readonly x: number; readonly y: number };
  readonly label?: string;
}

export type DrawingMark = StrokeMark | PinAt;

/** The scene file: a version, so a later format can tell it apart. */
const SceneFileSchema = z.object({
  marks: StrokeMarksSchema,
  version: z.literal(1),
});

export const sceneFileText = (marks: readonly StrokeMark[]): string =>
  JSON.stringify({ marks, version: 1 });

/** The marks in a scene file; null when it isn't one. */
export const parseSceneFile = (
  bytes: Uint8Array
): readonly StrokeMark[] | null => {
  try {
    const parsed = SceneFileSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes))
    );

    return parsed.success ? parsed.data.marks : null;
  } catch {
    return null;
  }
};

/** What the page opens with: the kept marks, then the item's pins moved from its pixels into DIP. */
export const openedMarks = (
  marks: readonly StrokeMark[],
  pins: readonly Pin[],
  pixelsPerDip: number
): readonly DrawingMark[] => [
  ...marks,
  ...pins.map((pin): PinAt => {
    const at = { x: pin.x / pixelsPerDip, y: pin.y / pixelsPerDip };

    return pin.label === undefined
      ? { at, kind: "pin" }
      : { at, kind: "pin", label: pin.label };
  }),
];
