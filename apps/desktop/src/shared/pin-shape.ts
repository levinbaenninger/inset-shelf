/**
 * The numbered map pin, as geometry both renderers share: the SVG on screen
 * (src/renderer/shared/pin-marker.tsx) and the pixels drawn into copied and
 * dragged images (src/main/pin-mark.ts). Units are DIP, with the tip at the
 * origin and the head above it (y grows downward, as on screen).
 */

export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** The pin colour (sky 600), the same in both themes and in exports; --color-pin in styles.css. */
export const PIN_RGB = [0, 132, 209] as const;

export const PIN_HEAD_RADIUS = 8;

/** From the tip up to the centre of the head. */
export const PIN_HEAD_Y = -13;

/** The pin is this tall, tip to top of the head. */
export const PIN_HEIGHT = PIN_HEAD_RADIUS - PIN_HEAD_Y;

/** The white outline outside the shape, so the pin reads on dark content. */
export const PIN_OUTLINE = 1.5;

/** A soft dark edge outside the outline, so it reads on white content too. */
export const PIN_HALO = 1;
export const PIN_HALO_ALPHA = 0.3;
export const DIGIT_STROKE = 1.6;

/** The box an SVG of the pin needs around the tip, outline and halo included. */
export const PIN_BOX = {
  height: PIN_HEIGHT + 2 * (PIN_OUTLINE + PIN_HALO),
  width: 2 * (PIN_HEAD_RADIUS + PIN_OUTLINE + PIN_HALO),
  x: -(PIN_HEAD_RADIUS + PIN_OUTLINE + PIN_HALO),
  y: PIN_HEAD_Y - PIN_HEAD_RADIUS - PIN_OUTLINE - PIN_HALO,
} as const;

/** Where the tail meets the head: the tangents from the tip to the head's circle. */
const tangentPoints = (): readonly [Vec, Vec] => {
  const distance = -PIN_HEAD_Y;
  const angle = Math.acos(PIN_HEAD_RADIUS / distance);
  const dx = PIN_HEAD_RADIUS * Math.sin(angle);
  const y = PIN_HEAD_Y + PIN_HEAD_RADIUS * Math.cos(angle);

  return [
    { x: dx, y },
    { x: -dx, y },
  ];
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** The teardrop as an SVG path: tip, up the right tangent, over the head, back down. */
export const pinPath = (): string => {
  const [right, left] = tangentPoints();

  return `M 0 0 L ${round(right.x)} ${round(right.y)} A ${PIN_HEAD_RADIUS} ${PIN_HEAD_RADIUS} 0 1 0 ${round(left.x)} ${round(left.y)} Z`;
};

const length = (v: Vec): number => Math.hypot(v.x, v.y);

/** Distance from p to the segment ab. */
export const segmentDistance = (p: Vec, a: Vec, b: Vec): number => {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const span = ab.x * ab.x + ab.y * ab.y;

  const t =
    span === 0
      ? 0
      : Math.min(Math.max((ap.x * ab.x + ap.y * ab.y) / span, 0), 1);

  return length({ x: ap.x - ab.x * t, y: ap.y - ab.y * t });
};

const cross = (a: Vec, b: Vec, p: Vec): number =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

/**
 * Signed distance from p to the teardrop: negative inside. The union of the
 * head's circle and the triangle from the tip to the tangent points.
 */
export const pinDistance = (p: Vec): number => {
  const circle = length({ x: p.x, y: p.y - PIN_HEAD_Y }) - PIN_HEAD_RADIUS;

  const [right, left] = tangentPoints();
  const tip = { x: 0, y: 0 };

  const edge = Math.min(
    segmentDistance(p, tip, right),
    segmentDistance(p, right, left),
    segmentDistance(p, left, tip)
  );

  const sides = [
    cross(tip, right, p),
    cross(right, left, p),
    cross(left, tip, p),
  ];

  const inside =
    sides.every((side) => side >= 0) || sides.every((side) => side <= 0);

  const triangle = inside ? -edge : edge;

  return Math.min(circle, triangle);
};

type Polyline = readonly Vec[];

const ellipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  steps = 16
): Polyline =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;

    return { x: cx + rx * Math.sin(angle), y: cy - ry * Math.cos(angle) };
  });

const points = (...coords: readonly (readonly [number, number])[]): Polyline =>
  coords.map(([x, y]) => ({ x, y }));

const SIX = points(
  [0.85, 0.06],
  [0.55, 0],
  [0.25, 0.12],
  [0.06, 0.42],
  [0.04, 0.72],
  [0.2, 0.95],
  [0.5, 1],
  [0.82, 0.92],
  [0.98, 0.68],
  [0.84, 0.46],
  [0.52, 0.39],
  [0.22, 0.47],
  [0.05, 0.62]
);

/** Strokes for each digit in a unit box (0–1 across, 0–1 down), drawn with round ends. */
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

const DIGITS: Readonly<Record<Digit, readonly Polyline[]>> = {
  "0": [ellipse(0.5, 0.5, 0.48, 0.5)],
  "1": [points([0.2, 0.22], [0.6, 0], [0.6, 1])],
  "2": [
    points(
      [0.04, 0.24],
      [0.22, 0.05],
      [0.52, 0],
      [0.82, 0.08],
      [0.96, 0.3],
      [0.84, 0.52],
      [0, 1],
      [1, 1]
    ),
  ],
  "3": [
    points(
      [0.04, 0.1],
      [0.4, 0],
      [0.8, 0.06],
      [0.94, 0.25],
      [0.78, 0.44],
      [0.42, 0.5],
      [0.8, 0.56],
      [0.98, 0.76],
      [0.84, 0.95],
      [0.44, 1],
      [0.04, 0.9]
    ),
  ],
  "4": [points([0.78, 1], [0.78, 0], [0, 0.68], [1, 0.68])],
  "5": [
    points(
      [0.92, 0],
      [0.16, 0],
      [0.08, 0.46],
      [0.46, 0.38],
      [0.84, 0.47],
      [1, 0.72],
      [0.86, 0.93],
      [0.46, 1],
      [0.04, 0.9]
    ),
  ],
  "6": [SIX],
  "7": [points([0, 0], [1, 0], [0.36, 1])],
  "8": [ellipse(0.5, 0.24, 0.4, 0.24), ellipse(0.5, 0.73, 0.48, 0.27)],
  "9": [SIX.map((p) => ({ x: 1 - p.x, y: 1 - p.y }))],
};

const isDigit = (char: string): char is Digit => Object.hasOwn(DIGITS, char);

const ONE_DIGIT = { gap: 0, height: 7, width: 4.4 } as const;
const TWO_DIGITS = { gap: 1.3, height: 6.2, width: 3.2 } as const;

/**
 * A pin's number as strokes, centred in the head, in DIP from the tip. Two
 * digits fit side by side; past 99 only the last two show (PINS_MAX is 99).
 */
export const digitStrokes = (number: number): readonly Polyline[] => {
  const text = String(Math.max(0, Math.trunc(number)) % 100);
  const box = text.length === 1 ? ONE_DIGIT : TWO_DIGITS;
  const total = text.length * box.width + (text.length - 1) * box.gap;
  const left = -total / 2;
  const top = PIN_HEAD_Y - box.height / 2;

  return text.split("").flatMap((digit, index) => {
    const x0 = left + index * (box.width + box.gap);

    return (isDigit(digit) ? DIGITS[digit] : []).map((line) =>
      line.map((p) => ({
        x: round(x0 + p.x * box.width),
        y: round(top + p.y * box.height),
      }))
    );
  });
};

/** Distance from p to the nearest stroke of a pin's number. */
export const digitDistance = (p: Vec, strokes: readonly Polyline[]): number => {
  let nearest = Number.POSITIVE_INFINITY;

  for (const line of strokes) {
    for (let index = 1; index < line.length; index += 1) {
      const a = line[index - 1];
      const b = line[index];

      if (a !== undefined && b !== undefined) {
        nearest = Math.min(nearest, segmentDistance(p, a, b));
      }
    }
  }

  return nearest;
};
