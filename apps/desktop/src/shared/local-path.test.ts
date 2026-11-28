import { describe, expect, it } from "vite-plus/test";

import {
  isAppBundlePath,
  isAppName,
  isLocalAbsolutePath,
  isSafeFileName,
  safeFileName,
} from "./local-path";

/** The values the check wrongly refuses. */
const refused = (check: (value: string) => boolean, values: string[]) =>
  values.filter((value) => !check(value));

/** The values the check wrongly accepts. */
const accepted = (check: (value: string) => boolean, values: string[]) =>
  values.filter((value) => check(value));

describe(isLocalAbsolutePath, () => {
  it("accepts POSIX and drive paths", () => {
    expect(
      refused(isLocalAbsolutePath, [
        "/Users/me/a b.txt",
        String.raw`C:\Users\me\a.txt`,
        "D:/data/a.txt",
      ])
    ).toStrictEqual([]);
  });

  it("rejects network shares and device paths", () => {
    expect(
      accepted(isLocalAbsolutePath, [
        String.raw`\\host\share\a.txt`,
        "//host/share/a.txt",
        String.raw`\\?\C:\a.txt`,
        "file:////host/share",
        "file:///Users/me/a.txt",
      ])
    ).toStrictEqual([]);
  });

  it("rejects relative paths, empty paths and NUL", () => {
    expect(
      accepted(isLocalAbsolutePath, ["relative/a.txt", "./a.txt", "", "/a\0b"])
    ).toStrictEqual([]);
  });
});

describe(isAppBundlePath, () => {
  it("accepts an absolute .app bundle", () => {
    expect(
      refused(isAppBundlePath, [
        "/Applications/Safari.app",
        "/Applications/Safari.app/",
        "/Users/me/Apps/My Tool.APP",
      ])
    ).toStrictEqual([]);
  });

  it("rejects scripts, executables, relative paths and parent segments", () => {
    expect(
      accepted(isAppBundlePath, [
        "/Users/me/run.command",
        "/Applications/Safari.app/Contents/MacOS/Safari",
        "Safari.app",
        "/Applications/../tmp/x.app",
        "//host/share/x.app",
        "/.app",
        "-a",
        "C:/Apps/Foo.app",
        String.raw`C:\Apps\Foo.app`,
        "/Applications/Foo\0.app",
      ])
    ).toStrictEqual([]);
  });
});

describe(isAppName, () => {
  it("accepts display names", () => {
    expect(refused(isAppName, ["T3 Code (Nightly)", "Claude"])).toStrictEqual(
      []
    );
  });

  it("rejects options, paths and control characters", () => {
    expect(
      accepted(isAppName, [
        "-g",
        "/Applications/Safari.app",
        String.raw`C:\x`,
        "a\nb",
        "",
        "..",
      ])
    ).toStrictEqual([]);
  });
});

describe(isSafeFileName, () => {
  it("accepts one plain name", () => {
    expect(refused(isSafeFileName, ["Report.txt", "..hidden"])).toStrictEqual(
      []
    );
  });

  it("rejects separators, NUL and dot names", () => {
    expect(
      accepted(isSafeFileName, ["", ".", "..", "a/b", String.raw`a\b`, "a\0b"])
    ).toStrictEqual([]);
  });
});

describe("Windows file names", () => {
  it("rejects what Windows reads as a drive, a stream or nothing", () => {
    expect(
      accepted(isSafeFileName, [
        "C:notes.txt",
        "foo:bar.txt",
        'a"b',
        "a<b>",
        "a|b",
        "a?b",
        "a*b",
        "a\u0001b",
        "name.",
        "name ",
      ])
    ).toStrictEqual([]);
  });

  it("makes them safe", () => {
    expect([
      safeFileName("C:notes.txt"),
      safeFileName("foo:bar.txt"),
      safeFileName('a<b>c|d?e*f"g'),
      safeFileName("tab\there"),
      safeFileName("name. . "),
      safeFileName("..."),
    ]).toStrictEqual([
      "C_notes.txt",
      "foo_bar.txt",
      "a_b_c_d_e_f_g",
      "tab_here",
      "name",
      "File",
    ]);
  });
});

describe(safeFileName, () => {
  it("replaces separators", () => {
    expect(safeFileName("a/b.txt")).toBe("a_b.txt");
  });

  it("falls back to File and keeps at most 255 characters", () => {
    expect([
      safeFileName(".."),
      safeFileName(""),
      safeFileName("x".repeat(300)).length,
    ]).toStrictEqual(["File", "File", 255]);
  });
});
