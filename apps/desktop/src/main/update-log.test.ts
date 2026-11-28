import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { appendCappedLog } from "./update-log";

const dirs: string[] = [];

const logPath = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "inset-log-"));

  dirs.push(dir);

  return path.join(dir, "updater.log");
};

describe(appendCappedLog, () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("appends while under the cap", () => {
    const file = logPath();

    appendCappedLog(file, "a\n", 10);
    appendCappedLog(file, "b\n", 10);

    expect(readFileSync(file, "utf-8")).toBe("a\nb\n");
    expect(existsSync(`${file}.old`)).toBeFalsy();
  });

  it("rotates to .old once the cap is passed, replacing the older copy", () => {
    const file = logPath();

    appendCappedLog(file, "1234567890", 10);
    appendCappedLog(file, "next\n", 10);
    appendCappedLog(file, "x".repeat(10), 10);
    appendCappedLog(file, "last\n", 10);

    expect(readFileSync(file, "utf-8")).toBe("last\n");
    expect(readFileSync(`${file}.old`, "utf-8")).toBe(
      `next\n${"x".repeat(10)}`
    );
  });
});
