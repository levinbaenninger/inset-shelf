import { setImmediate as tick } from "node:timers/promises";

import { describe, expect, it } from "vite-plus/test";

import {
  INITIAL_UPDATE_STATE,
  settleRequest,
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

const checking: UpdateState = { kind: "checking" };
const available: UpdateState = { kind: "available", version: "0.1.901" };
const downloaded: UpdateState = { kind: "ready", version: "0.1.901" };

describe(updateTransition, () => {
  it("walks a found update through check, download and ready, one user step each", () => {
    expect(run([{ type: "check" }])).toStrictEqual(checking);
    expect(
      run([{ type: "found", version: "0.1.901" }], checking)
    ).toStrictEqual(available);
    expect(run([{ type: "download" }], available)).toStrictEqual({
      kind: "downloading",
      percent: 0,
      version: "0.1.901",
    });
    expect(
      run([
        { type: "check" },
        { type: "found", version: "0.1.901" },
        { type: "download" },
        { type: "downloaded" },
      ])
    ).toStrictEqual(downloaded);
  });

  it("never downloads on its own after finding an update", () => {
    expect(
      run([
        { type: "check" },
        { type: "found", version: "0.1.901" },
        { percent: 10, type: "progress" },
        { type: "downloaded" },
      ])
    ).toStrictEqual(available);
  });

  it("reports the rounded download progress", () => {
    expect(
      run([
        { type: "check" },
        { type: "found", version: "0.1.901" },
        { type: "download" },
        { percent: 41.6, type: "progress" },
      ])
    ).toStrictEqual({ kind: "downloading", percent: 42, version: "0.1.901" });
  });

  it("is up to date when the feed has nothing newer", () => {
    expect(run([{ type: "check" }, { type: "notFound" }])).toStrictEqual({
      kind: "upToDate",
    });
  });

  it("checks again after an answer or a failure", () => {
    expect(run([{ type: "check" }], { kind: "upToDate" })).toStrictEqual(
      checking
    );
    expect(
      run([{ type: "check" }], { kind: "error", message: "x" })
    ).toStrictEqual(checking);
  });

  it("ignores a check while busy, once an update is found or once it is ready", () => {
    const busy: UpdateState = {
      kind: "downloading",
      percent: 10,
      version: "0.1.901",
    };

    expect(run([{ type: "check" }], busy)).toBe(busy);
    expect(run([{ type: "check" }], available)).toBe(available);
    expect(run([{ type: "check" }], downloaded)).toBe(downloaded);
  });

  it("only downloads an update that a check found", () => {
    expect(run([{ type: "download" }])).toStrictEqual({ kind: "idle" });
    expect(run([{ type: "download" }], downloaded)).toBe(downloaded);
  });

  it("drops a ready update that fails to install and says why", () => {
    const failed = updateTransition(downloaded, {
      message: "code signature invalid",
      type: "failed",
    });

    expect(failed).toStrictEqual({
      kind: "error",
      message: "code signature invalid",
    });
    expect(updateNotice(downloaded, failed)).toBe(
      "Couldn’t install the update: code signature invalid"
    );
  });

  it("shows a failure while checking or downloading", () => {
    expect(
      run([
        { type: "check" },
        { type: "found", version: "0.1.901" },
        { type: "download" },
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
    [checking, "Checking for Updates…", null],
    [available, "Download Update to v0.1.901…", "downloadUpdate"],
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

  it("answers a check", () => {
    expect(updateNotice(checking, { kind: "upToDate" })).toBe(
      "Inset Shelf is up to date."
    );
    expect(updateNotice(checking, available)).toBe(
      "Version 0.1.901 is available. Choose Download Update in the menu."
    );
    expect(updateNotice(checking, { kind: "error", message: "offline" })).toBe(
      "Couldn’t check for updates: offline"
    );
  });

  it("reports a failed download", () => {
    expect(
      updateNotice(
        { kind: "downloading", percent: 5, version: "0.1.901" },
        { kind: "error", message: "offline" }
      )
    ).toBe("Couldn’t download the update: offline");
  });

  it("stays quiet about steps that need no answer", () => {
    expect(updateNotice(available, checking)).toBeNull();
    expect(
      updateNotice(available, {
        kind: "downloading",
        percent: 0,
        version: "0.1.901",
      })
    ).toBeNull();
  });
});

describe(settleRequest, () => {
  it("consumes a request that fails", async () => {
    const unhandled: Error[] = [];

    const record = (reason: Error): void => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", record);
    await settleRequest(async () => {
      await tick();

      throw new Error("download connection reset");
    });
    await tick();
    process.off("unhandledRejection", record);

    expect(unhandled).toStrictEqual([]);
  });
});
