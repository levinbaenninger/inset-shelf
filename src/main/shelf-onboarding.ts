import type { HandOff } from "@shared/onboarding";

import type { PermissionEntry } from "./permissions/onboarding";

/**
 * Inset Shelf's words for the permission onboarding (src/main/permissions/):
 * what it is, what it asks for and why, and how Done hands over. Another
 * app passes its own.
 */
export const SHELF_TAGLINE =
  "Inset Shelf keeps what you capture in a list beside your work.";

export const SHELF_HANDOFF: HandOff = {
  later:
    "Inset Shelf works without the permissions you skipped. Set Up Permissions… in the Inset Shelf menu or the menu bar icon’s menu asks again.",
  ready:
    "Inset Shelf is ready. A short Getting started list on the shelf shows the rest.",
  showAround: "Show Me Around",
  start: "Start Using Inset Shelf",
};

/** What Inset Shelf asks for, why, and the features each one turns on. */
export const SHELF_PERMISSIONS: readonly PermissionEntry[] = [
  {
    features: ["Double Shift"],
    id: "accessibility",
    purpose:
      "Notices Double Shift and reads the page address of what you save.",
  },
  {
    features: ["window links"],
    id: "screen",
    purpose: "Shows window titles and lets you link windows.",
  },
];

/** The macOS major version, for list names macOS 27 changed. */
export const osMajor = (version: string): number => {
  const major = Math.trunc(Number(version.split(".")[0] ?? ""));

  return Number.isFinite(major) ? major : 0;
};
