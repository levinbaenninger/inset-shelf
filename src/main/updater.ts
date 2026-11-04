import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

import { app, autoUpdater as squirrel, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";

import {
  INITIAL_UPDATE_STATE,
  settleCheck,
  updateTransition,
} from "./update-state";
import type { UpdateEvent, UpdateState } from "./update-state";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const PRODUCT_NAME = "Inset Shelf";

type Listener = (next: UpdateState, previous: UpdateState) => void;

const ignore = (): void => undefined;

export interface Updater {
  readonly subscribe: (next: Listener) => void;
  /** Checks now and every few hours, downloading what it finds. */
  readonly start: () => void;
  readonly state: () => UpdateState;
  /** A check the user asked for, answered with a notice. */
  readonly check: () => void;
  readonly restart: () => void;
}

const cannotUpdate = (): string | null => {
  if (!app.isPackaged) {
    return "updates only run in the installed app";
  }

  // Only the Setup install has an uninstaller; the zip copies have nothing to update in place.
  if (
    process.platform === "win32" &&
    !existsSync(
      path.join(path.dirname(process.execPath), `Uninstall ${PRODUCT_NAME}.exe`)
    )
  ) {
    return "this copy came from a zip. Install it with the Setup file to get updates";
  }

  return null;
};

/** Squirrel's errors run to many lines; the menu and notices show the first. */
const firstLine = (error: Error): string =>
  error.message.split("\n")[0] ?? "unknown error";

export const createUpdater = (): Updater => {
  const { autoUpdater } = electronUpdater;
  const logFile = path.join(app.getPath("userData"), "updater.log");

  const log = (level: string, message: string): void => {
    try {
      appendFileSync(
        logFile,
        `${new Date().toISOString()} ${level} ${message}\n`
      );
    } catch {
      // A missing log never stops an update.
    }
  };

  let state = INITIAL_UPDATE_STATE;
  let listener: Listener = ignore;

  const dispatch = (event: UpdateEvent): void => {
    const previous = state;
    const next = updateTransition(previous, event);

    if (
      next === previous ||
      (next.kind === "downloading" &&
        previous.kind === "downloading" &&
        next.percent === previous.percent)
    ) {
      return;
    }

    state = next;
    log("state", JSON.stringify(next));
    listener(next, previous);
  };

  const blocked = cannotUpdate();

  const check = (manual: boolean): void => {
    const before = state;

    dispatch({ manual, type: "check" });

    if (state === before) {
      return;
    }

    if (blocked !== null) {
      dispatch({ message: blocked, type: "failed" });

      return;
    }

    void settleCheck(async () => await autoUpdater.checkForUpdates());
  };

  const start = (): void => {
    if (blocked !== null) {
      return;
    }

    autoUpdater.logger = {
      debug: (message: string) => {
        log("debug", message);
      },
      error: (message: string) => {
        log("error", message);
      },
      info: (message: string) => {
        log("info", message);
      },
      warn: (message: string) => {
        log("warn", message);
      },
    };

    const feed = process.env.INSET_UPDATE_FEED_URL;

    if (feed !== undefined && feed !== "") {
      autoUpdater.setFeedURL({ provider: "generic", url: feed });
    }

    autoUpdater.on("update-available", (info) => {
      dispatch({ type: "found", version: info.version });
    });
    autoUpdater.on("update-not-available", () => {
      dispatch({ type: "notFound" });
    });
    autoUpdater.on("download-progress", (progress) => {
      dispatch({ percent: progress.percent, type: "progress" });
    });
    autoUpdater.on("error", (error) => {
      dispatch({ message: firstLine(error), type: "failed" });
    });

    // On macOS the download is only installable once Squirrel has fetched and checked its signature.
    if (process.platform === "darwin") {
      squirrel.on("update-downloaded", () => {
        dispatch({ type: "downloaded" });
      });
    } else {
      autoUpdater.on("update-downloaded", () => {
        dispatch({ type: "downloaded" });
      });
    }

    check(false);
    setInterval(() => {
      check(false);
    }, CHECK_EVERY_MS).unref();
  };

  return {
    check: () => {
      check(true);
    },
    restart: () => {
      if (state.kind !== "ready") {
        return;
      }

      log("info", `restarting to install ${state.version}`);

      // The installer waits for every window to close, and the app's windows only hide when asked to.
      for (const window of BrowserWindow.getAllWindows()) {
        window.destroy();
      }

      autoUpdater.quitAndInstall(true, true);
    },
    start,
    state: () => state,
    subscribe: (next) => {
      listener = next;
    },
  };
};
