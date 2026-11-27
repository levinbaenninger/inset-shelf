import path from "node:path";

import type { Rect } from "@shared/geometry";

export interface FrontWindowInfo {
  readonly title: string;
  readonly ownerPath: string;
  /** In DIP. */
  readonly bounds: Rect<"screen">;
}

export interface DisplayArea {
  readonly bounds: Rect<"screen">;
  /** The display without the taskbar. */
  readonly workArea: Rect<"screen">;
}

/** How far the hidden icons' flyout sits from the taskbar edge, shadow and gap included. */
const EDGE_DIP = 32;

/** The flyout is small: a folder window this large is a window of the user's. */
const FLYOUT_MAX_SHARE = 0.4;

const centreIn = (area: Rect<"screen">, window: Rect<"screen">): boolean => {
  const x = window.x + window.width / 2;
  const y = window.y + window.height / 2;

  return (
    x >= area.x &&
    x < area.x + area.width &&
    y >= area.y &&
    y < area.y + area.height
  );
};

const near = (a: number, b: number): boolean => Math.abs(a - b) <= EDGE_DIP;

/** Whether the window sits against the edge where the taskbar is, as the hidden icons' flyout does. */
const atTaskbarEdge = (
  window: Rect<"screen">,
  { bounds, workArea }: DisplayArea
): boolean => {
  const right = window.x + window.width;
  const bottom = window.y + window.height;
  const areaRight = workArea.x + workArea.width;
  const areaBottom = workArea.y + workArea.height;
  const displayRight = bounds.x + bounds.width;
  const displayBottom = bounds.y + bounds.height;

  const edges = [
    { at: workArea.x, on: workArea.x > bounds.x, window: window.x },
    { at: areaRight, on: areaRight < displayRight, window: right },
    { at: workArea.y, on: workArea.y > bounds.y, window: window.y },
    { at: areaBottom, on: areaBottom < displayBottom, window: bottom },
  ];

  // A taskbar that hides leaves the work area whole: the flyout then sits at the display's own edge.
  if (!edges.some((edge) => edge.on)) {
    return (
      near(window.x, bounds.x) ||
      near(right, displayRight) ||
      near(window.y, bounds.y) ||
      near(bottom, displayBottom)
    );
  }

  return edges.some((edge) => edge.on && near(edge.window, edge.at));
};

/**
 * Windows: whether this window is the taskbar, or the hidden icons' flyout
 * opened from it. Both belong to explorer.exe, as does every folder window,
 * and the flyout's title is in the system's language: so the taskbar is the
 * untitled window, and the flyout a small one against the taskbar's edge. A
 * folder, the desktop and any other app are windows of the user's.
 */
export const isTaskbarWindow = (
  front: FrontWindowInfo,
  displays: readonly DisplayArea[]
): boolean => {
  if (path.win32.basename(front.ownerPath).toLowerCase() !== "explorer.exe") {
    return false;
  }

  if (front.title.trim() === "") {
    return true;
  }

  const display = displays.find((candidate) =>
    centreIn(candidate.bounds, front.bounds)
  );

  return (
    display !== undefined &&
    front.bounds.width <= display.bounds.width * FLYOUT_MAX_SHARE &&
    front.bounds.height <= display.bounds.height * FLYOUT_MAX_SHARE &&
    atTaskbarEdge(front.bounds, display)
  );
};
