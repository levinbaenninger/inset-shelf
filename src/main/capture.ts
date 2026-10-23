import { pixelsPerDip, pt, size } from "@shared/geometry";
import type { DisplaySnapshot, Point, Size } from "@shared/geometry";
import { desktopCapturer, screen, systemPreferences } from "electron";
import type { NativeImage } from "electron";

import {
  matchSource,
  snapshotDisplay,
  thumbnailSizeFor,
} from "./display-source";

export interface Anchor {
  readonly display: DisplaySnapshot;
  readonly point: Point<"screen">;
}

export type CaptureProblem =
  | {
      readonly kind: "screenPermission";
      readonly status:
        | "denied"
        | "restricted"
        | "not-determined"
        | "granted-but-empty";
    }
  | { readonly kind: "displayNotMatched" }
  | { readonly kind: "failed"; readonly message: string };

export interface CapturedFrame {
  readonly image: NativeImage;
  readonly size: Size<"image">;
  readonly ppd: number;
}

export type CaptureResult =
  | { readonly ok: true; readonly frame: CapturedFrame }
  | { readonly ok: false; readonly problem: CaptureProblem };

/** Call synchronously in the shortcut callback, before any Inset window moves. */
export const sampleAnchor = (): Anchor => {
  const cursor = screen.getCursorScreenPoint();

  return {
    display: snapshotDisplay(screen.getDisplayNearestPoint(cursor)),
    point: pt(cursor.x, cursor.y),
  };
};

const macScreenStatus = (): ReturnType<
  typeof systemPreferences.getMediaAccessStatus
> | null =>
  process.platform === "darwin"
    ? systemPreferences.getMediaAccessStatus("screen")
    : null;

/**
 * Without permission macOS still returns an image showing only the wallpaper,
 * and a reported grant can still deliver an empty image.
 */
const permissionProblem = (imageEmpty: boolean): CaptureProblem | null => {
  const status = macScreenStatus();

  if (
    status === "denied" ||
    status === "restricted" ||
    status === "not-determined"
  ) {
    return { kind: "screenPermission", status };
  }

  if (!imageEmpty) {
    return null;
  }

  return status === "granted"
    ? { kind: "screenPermission", status: "granted-but-empty" }
    : { kind: "failed", message: "The screen image was empty." };
};

/** The size is read from the delivered image, never assumed from bounds × scaleFactor. */
export const captureDisplay = async (
  display: DisplaySnapshot
): Promise<CaptureResult> => {
  const before = macScreenStatus();

  if (before === "denied" || before === "restricted") {
    return { ok: false, problem: { kind: "screenPermission", status: before } };
  }

  const sources = await desktopCapturer.getSources({
    fetchWindowIcons: false,
    thumbnailSize: thumbnailSizeFor(display),
    types: ["screen"],
  });

  const index = matchSource(
    sources,
    display.id,
    screen.getAllDisplays().length
  );

  const image = index === null ? undefined : sources[index]?.thumbnail;

  if (image === undefined) {
    return { ok: false, problem: { kind: "displayNotMatched" } };
  }

  const problem = permissionProblem(image.isEmpty());

  if (problem !== null) {
    return { ok: false, problem };
  }

  const imageSize = image.getSize();

  return {
    frame: {
      image,
      ppd: pixelsPerDip(display.bounds, imageSize),
      size: size(imageSize.width, imageSize.height),
    },
    ok: true,
  };
};
