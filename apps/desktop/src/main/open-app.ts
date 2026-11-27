import { spawn } from "node:child_process";

/** How a command is started: Node's `spawn`, or a test's stand-in. */
export type Start = (
  command: string,
  args: readonly string[],
  options: { readonly detached: true; readonly stdio: "ignore" }
) => {
  readonly on: (event: "error", heard: (error: Error) => void) => void;
  readonly unref: () => void;
};

/**
 * Asks macOS's `open` for `args`, and nothing anywhere else: the command is
 * the Mac's own. A start that fails is dropped, since the app then only stays
 * where it is, and a child's error nobody hears would end main.
 */
const macOpen = (
  args: readonly string[],
  platform: string,
  start: Start
): void => {
  if (platform !== "darwin") {
    return;
  }

  const child = start("/usr/bin/open", args, {
    detached: true,
    stdio: "ignore",
  });

  child.on("error", () => {
    // Nothing came forward; there is nothing to put back.
  });
  child.unref();
};

/**
 * Brings a Mac app to the front by name, as `open -a` does. Only for the
 * desktop apps the shelf knows (desktopApp in src/shared/web-source.ts).
 */
export const openApp = (
  name: string,
  platform: string = process.platform,
  start: Start = spawn
): void => {
  macOpen(["-a", name], platform, start);
};

/** Brings a Mac app to the front by its bundle, read from the system when a window was linked. */
export const openAppAt = (
  bundle: string,
  platform: string = process.platform,
  start: Start = spawn
): void => {
  macOpen([bundle], platform, start);
};
