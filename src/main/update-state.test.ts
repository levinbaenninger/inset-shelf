import { setImmediate as tick } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import {
  INITIAL_UPDATE_STATE,
  settleCheck,
  updateMenuItem,
  updateNotice,
  updateTransition,
} from "./update-state";
import type { UpdateEvent, UpdateState } from "./update-state";

const run = (
  events: readonly UpdateEvent[],
  from = INITIAL_UPDATE_STATE
): UpdateState => {
  let state = from;

  for (const event of events) {
    state = updateTransition(state, event);
  }

  return state;
};

const checking = (manual: boolean): UpdateState => ({
  kind: "checking",
  manual,
});

const downloaded: UpdateState = { kind: "ready", version: "0.1.901" };

describe(updateTransition, () => {
  it("walks a found update from check to ready", () => {
    expect(
      run([
        { manual: false, type: "check" },
        { type: "found", version: "0.1.901" },
        { percent: 41.6, type: "progress" },
        { type: "downloaded" },
      ])
    ).toStrictEqual({ kind: "ready", version: "0.1.901" });
  });

  it("reports the rounded download progress", () => {
    expect(
      run([
        { manual: false, type: "check" },
        { type: "found", version: "0.1.901" },
        { percent: 41.6, type: "progress" },
      ])
    ).toStrictEqual({ kind: "downloading", percent: 42, version: "0.1.901" });
  });

  it("is up to date when the feed has nothing newer", () => {
    expect(
      run([{ manual: true, type: "check" }, { type: "notFound" }])
    ).toStrictEqual({ kind: "upToDate" });
  });

  it("checks again after an answer or a failure", () => {
    expect(
      run([{ manual: true, type: "check" }], { kind: "upToDate" })
    ).toStrictEqual({ kind: "checking", manual: true });
    expect(
      run([{ manual: false, type: "check" }], { kind: "error", message: "x" })
    ).toStrictEqual({ kind: "checking", manual: false });
  });

  it("ignores a check while busy or once an update is ready", () => {
    const busy: UpdateState = {
      kind: "downloading",
      percent: 10,
      version: "0.1.901",
    };

    expect(run([{ manual: true, type: "check" }], busy)).toBe(busy);
    expect(run([{ manual: true, type: "check" }], downloaded)).toBe(downloaded);
  });

  it("keeps a ready update when a later step fails", () => {
    expect(run([{ message: "offline", type: "failed" }], downloaded)).toBe(
      downloaded
    );
  });

  it("shows a failure while checking or downloading", () => {
    expect(
      run([
        { manual: false, type: "check" },
        { type: "found", version: "0.1.901" },
        { message: "Code signature did not match", type: "failed" },
      ])
    ).toStrictEqual({ kind: "error", message: "Code signature did not match" });
  });

  it("ignores a finished download it never asked for", () => {
    expect(run([{ type: "downloaded" }])).toStrictEqual({ kind: "idle" });
  });
});

describe(updateMenuItem, () => {
  it.each<[UpdateState, string, string | null]>([
    [{ kind: "idle" }, "Check for Updates…", "checkForUpdates"],
    [{ kind: "upToDate" }, "Check for Updates…", "checkForUpdates"],
    [{ kind: "error", message: "x" }, "Check for Updates…", "checkForUpdates"],
    [{ kind: "checking", manual: true }, "Checking for Updates…", null],
    [{ kind: "available", version: "0.1.901" }, "Downloading v0.1.901…", null],
    [
      { kind: "downloading", percent: 42, version: "0.1.901" },
      "Downloading v0.1.901… 42%",
      null,
    ],
    [downloaded, "Restart to Update to v0.1.901", "restartToUpdate"],
  ])("for %o shows %s", (state, label, action) => {
    expect(updateMenuItem(state)).toStrictEqual({ action, label });
  });
});

describe(updateNotice, () => {
  it("tells once that an update is ready", () => {
    expect(
      updateNotice(
        { kind: "downloading", percent: 99, version: "0.1.901" },
        downloaded
      )
    ).toBe("Version 0.1.901 is ready. Restart Inset Shelf to update.");
    expect(updateNotice(downloaded, downloaded)).toBeNull();
  });

  it("answers a check the user asked for", () => {
    expect(updateNotice(checking(true), { kind: "upToDate" })).toBe(
      "Inset Shelf is up to date."
    );
    expect(
      updateNotice(checking(true), { kind: "available", version: "0.1.901" })
    ).toBe("Downloading version 0.1.901…");
    expect(
      updateNotice(checking(true), { kind: "error", message: "offline" })
    ).toBe("Couldn’t check for updates: offline");
  });

  it("stays quiet about background checks", () => {
    expect(updateNotice(checking(false), { kind: "upToDate" })).toBeNull();
    expect(
      updateNotice(checking(false), { kind: "error", message: "offline" })
    ).toBeNull();
  });
});

describe(settleCheck, () => {
  it("consumes a download that fails after the check succeeds", async () => {
    const unhandled: Error[] = [];

    const record = (reason: Error): void => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", record);
    await settleCheck(async () => {
      await tick();

      return {
        downloadPromise: Promise.reject(new Error("download connection reset")),
      };
    });
    await tick();
    process.off("unhandledRejection", record);

    expect(unhandled).toStrictEqual([]);
  });
});
