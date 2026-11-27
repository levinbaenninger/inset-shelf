import { describe, expect, it } from "vite-plus/test";

import { openApp, openAppAt } from "./open-app";
import type { Start } from "./open-app";

type Child = ReturnType<Start>;

interface Stillborn {
  readonly child: Child;
  /** What Node does with the child's error event: one nobody hears is thrown, which ends main. */
  readonly fail: () => void;
}

/** A child that never started. */
const stillborn = (): Stillborn => {
  const hearing: ((error: Error) => void)[] = [];

  return {
    child: {
      on: (_, heard) => {
        hearing.push(heard);
      },
      unref: (): void => undefined,
    },
    fail: () => {
      const error = new Error("spawn ENOENT");

      if (hearing.length === 0) {
        throw error;
      }

      for (const heard of hearing) {
        heard(error);
      }
    },
  };
};

describe("bringing a Mac app forward", () => {
  it.each([
    [
      "by name",
      (start: Start) => {
        openApp("Code", "darwin", start);
      },
    ],
    [
      "by bundle",
      (start: Start) => {
        openAppAt("/Applications/Code.app", "darwin", start);
      },
    ],
  ])("drops a start that fails, %s", (_, bring) => {
    const { child, fail } = stillborn();

    bring(() => child);

    expect(fail).not.toThrow();
  });

  it.each([
    [
      "by name",
      (start: Start) => {
        openApp("Code", "win32", start);
      },
    ],
    [
      "by bundle",
      (start: Start) => {
        openAppAt("C:\\Code\\Code.exe", "win32", start);
      },
    ],
  ])("starts nothing off macOS, whose command it is, %s", (_, bring) => {
    const started: string[] = [];

    bring((command) => {
      started.push(command);

      return stillborn().child;
    });

    expect(started).toStrictEqual([]);
  });

  it("asks macOS to open the bundle", () => {
    const asked: (readonly string[])[] = [];

    openAppAt("/Applications/Code.app", "darwin", (command, args) => {
      asked.push([command, ...args]);

      return stillborn().child;
    });

    expect(asked).toStrictEqual([["/usr/bin/open", "/Applications/Code.app"]]);
  });
});
