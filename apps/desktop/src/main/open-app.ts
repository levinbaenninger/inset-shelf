import { spawn } from "node:child_process";

import { isAppBundlePath, isAppName } from "@shared/local-path";

const detached = (args: readonly string[]): void => {
  spawn("/usr/bin/open", args, {
    detached: true,
    stdio: "ignore",
  }).unref();
};

/**
 * Brings a Mac app to the front by name, as `open -a` does. Only for the
 * desktop apps the shelf knows (desktopApp in src/shared/web-source.ts); a
 * name that is not a plain app name (a path, a leading dash) is ignored.
 */
export const openApp = (name: string): void => {
  if (isAppName(name)) {
    detached(["-a", name]);
  }
};

/**
 * Brings a Mac app to the front by its bundle, read from the system when a
 * window was linked. Only an absolute *.app path is opened; `--` ends the
 * options so the path can never be read as one.
 */
export const openAppAt = (bundle: string): boolean => {
  if (!isAppBundlePath(bundle)) {
    return false;
  }

  detached(["--", bundle]);

  return true;
};
