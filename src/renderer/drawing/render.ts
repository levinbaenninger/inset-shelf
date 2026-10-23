import {
  arrowhead,
  EXPORT_SCALE,
  exportFrame,
  fontFor,
  TEXT_LEADING,
} from "./sketch";
import type {
  Color,
  MeasureText,
  PenMark,
  Point,
  SegmentMark,
  Mark,
  TextMark,
} from "./sketch";

/** The page draws on a canvas element; exports draw offscreen. */
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type Palette = Readonly<Record<Color, string>>;

/** Also used for every export, which always has a white background. */
export const LIGHT_PALETTE: Palette = {
  blue: "#0284c7",
  green: "#16a34a",
  ink: "#171717",
  orange: "#ea580c",
  red: "#dc2626",
};

export const DARK_PALETTE: Palette = {
  blue: "#38bdf8",
  green: "#4ade80",
  ink: "#f5f5f5",
  orange: "#fb923c",
  red: "#f87171",
};

export const paletteFor = (dark: boolean): Palette =>
  dark ? DARK_PALETTE : LIGHT_PALETTE;

/** The colour a swatch or the text field shows for an ink, matching the canvas. */
export const inkColor = (color: Color, dark: boolean): string =>
  paletteFor(dark)[color];

export interface RenderOptions {
  readonly palette: Palette;
  /** The page point drawn at the canvas's top-left corner. */
  readonly origin?: Point;
  /** Leaves the canvas transparent when omitted. */
  readonly background?: string;
}

/** A transparent canvas in the light palette, for callers that only pass a scale. */
const LIGHT_PAGE: RenderOptions = { palette: LIGHT_PALETTE };

const drawPen = (ctx: Context2D, mark: PenMark): void => {
  const [first, ...rest] = mark.points;

  if (first === undefined) {
    return;
  }

  if (rest.length === 0) {
    ctx.beginPath();
    ctx.arc(first.x, first.y, mark.width / 2, 0, Math.PI * 2);
    ctx.fill();

    return;
  }

  // Curves through the midpoints smooth out the pointer's sampling.
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  for (const [index, point] of rest.entries()) {
    const next = rest[index + 1];

    if (next === undefined) {
      ctx.lineTo(point.x, point.y);
    } else {
      ctx.quadraticCurveTo(
        point.x,
        point.y,
        (point.x + next.x) / 2,
        (point.y + next.y) / 2
      );
    }
  }

  ctx.stroke();
};

const drawArrow = (ctx: Context2D, mark: SegmentMark): void => {
  const head = arrowhead(mark.from, mark.to, mark.width);

  if (head === null) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(mark.from.x, mark.from.y);
  ctx.lineTo(head.base.x, head.base.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(head.tip.x, head.tip.y);
  ctx.lineTo(head.left.x, head.left.y);
  ctx.lineTo(head.right.x, head.right.y);
  ctx.closePath();
  ctx.fill();
};

const drawSegment = (ctx: Context2D, mark: SegmentMark): void => {
  const { from, to } = mark;

  if (mark.kind === "arrow") {
    drawArrow(ctx, mark);

    return;
  }

  ctx.beginPath();

  if (mark.kind === "line") {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  } else if (mark.kind === "rect") {
    ctx.rect(from.x, from.y, to.x - from.x, to.y - from.y);
  } else {
    ctx.ellipse(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
      Math.abs(to.x - from.x) / 2,
      Math.abs(to.y - from.y) / 2,
      0,
      0,
      Math.PI * 2
    );
  }

  ctx.stroke();
};

/** Puts the baseline where a CSS line box of the same height would, so text lands where it was typed. */
const drawText = (ctx: Context2D, mark: TextMark): void => {
  ctx.font = fontFor(mark.size);
  ctx.textBaseline = "alphabetic";

  const lineHeight = mark.size * TEXT_LEADING;
  const metrics = ctx.measureText(mark.text);
  const ascent = metrics.fontBoundingBoxAscent;
  const content = ascent + metrics.fontBoundingBoxDescent;
  const baseline = (lineHeight - content) / 2 + ascent;

  for (const [index, line] of mark.text.split("\n").entries()) {
    ctx.fillText(line, mark.at.x, mark.at.y + index * lineHeight + baseline);
  }
};

const drawMark = (ctx: Context2D, mark: Mark, palette: Palette): void => {
  const color = palette[mark.color];

  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  if (mark.kind === "text") {
    drawText(ctx, mark);

    return;
  }

  ctx.lineWidth = mark.width;

  if (mark.kind === "pen") {
    drawPen(ctx, mark);
  } else {
    drawSegment(ctx, mark);
  }
};

/** Paints the marks onto the whole canvas, `scale` device pixels per page pixel. */
export const renderSketch = (
  ctx: Context2D,
  marks: readonly Mark[],
  scale: number,
  options: RenderOptions = LIGHT_PAGE
): void => {
  const origin = options.origin ?? { x: 0, y: 0 };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (options.background !== undefined) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  ctx.setTransform(scale, 0, 0, scale, -origin.x * scale, -origin.y * scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const mark of marks) {
    drawMark(ctx, mark, options.palette);
  }
};

let measuring: OffscreenCanvasRenderingContext2D | null = null;

/** Measures with an offscreen canvas in the font the page draws text with. */
export const measureText: MeasureText = (text, size) => {
  measuring ??= new OffscreenCanvas(1, 1).getContext("2d");

  if (measuring === null) {
    return text.length * size * 0.6;
  }

  measuring.font = fontFor(size);

  return measuring.measureText(text).width;
};

/** Text drawn before its font has loaded would fall back to another face. */
const loadFonts = async (marks: readonly Mark[]): Promise<void> => {
  const sizes = new Set(
    marks.flatMap((mark) => (mark.kind === "text" ? [mark.size] : []))
  );

  await Promise.all(
    [...sizes].map(async (size) => await document.fonts.load(fontFor(size)))
  );
};

/** A PNG of everything drawn, trimmed with padding, at twice the page's size on white; null when nothing is drawn. */
export const exportPng = async (
  marks: readonly Mark[]
): Promise<Uint8Array<ArrayBuffer> | null> => {
  await loadFonts(marks);

  const frame = exportFrame(marks, measureText);

  if (frame === null) {
    return null;
  }

  const canvas = new OffscreenCanvas(frame.pixelWidth, frame.pixelHeight);
  const ctx = canvas.getContext("2d");

  if (ctx === null) {
    throw new Error("The drawing could not be turned into an image.");
  }

  renderSketch(ctx, marks, EXPORT_SCALE, {
    background: "#ffffff",
    origin: frame.origin,
    palette: LIGHT_PALETTE,
  });

  const blob = await canvas.convertToBlob({ type: "image/png" });

  return new Uint8Array(await blob.arrayBuffer());
};

export interface AnnotatedImage {
  /** The image's PNG, as main has it. */
  readonly png: Uint8Array<ArrayBuffer>;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelsPerDip: number;
}

/**
 * The image with the marks drawn into it, at its own size, so a pin stays
 * where it was. Marks are in the image's DIP and keep the colours shown.
 */
export const exportAnnotated = async (
  marks: readonly Mark[],
  image: AnnotatedImage
): Promise<Uint8Array<ArrayBuffer>> => {
  await loadFonts(marks);

  const picture = await createImageBitmap(
    new Blob([image.png], { type: "image/png" })
  );

  const canvas = new OffscreenCanvas(image.widthPx, image.heightPx);
  const layer = new OffscreenCanvas(image.widthPx, image.heightPx);
  const ctx = canvas.getContext("2d");
  const layerCtx = layer.getContext("2d");

  if (ctx === null || layerCtx === null) {
    throw new Error("The image could not be drawn on.");
  }

  ctx.drawImage(picture, 0, 0, image.widthPx, image.heightPx);
  picture.close();
  renderSketch(layerCtx, marks, image.pixelsPerDip, {
    palette: LIGHT_PALETTE,
  });
  ctx.drawImage(layer, 0, 0);

  const blob = await canvas.convertToBlob({ type: "image/png" });

  return new Uint8Array(await blob.arrayBuffer());
};
