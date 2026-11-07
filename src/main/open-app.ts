import { spawn } from "node:child_process";

/**
 * Brings a Mac app to the front by name, as `open -a` does. Only for the
 * desktop apps the shelf knows (desktopApp in src/shared/web-source.ts).
 */
export const openApp = (name: string): void => {
  spawn("/usr/bin/open", ["-a", name], {
    detached: true,
    stdio: "ignore",
  }).unref();
};

/** Brings a Mac app to the front by its bundle, read from the system when a window was linked. */
export const openAppAt = (bundle: string): void => {
  spawn("/usr/bin/open", [bundle], {
    detached: true,
    stdio: "ignore",
  }).unref();
};
