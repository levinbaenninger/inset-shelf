import { describe, expect, it } from "vitest";

import { exportFileName } from "./export-name";

describe(exportFileName, () => {
  it("names the file after the note's first line", () => {
    expect(exportFileName("\n  Total ignores   the discount\nsecond")).toBe(
      "Total ignores the discount.png"
    );
  });

  it("replaces characters a file name can't hold and trims trailing dots", () => {
    expect(exportFileName('Is a/b: "ok"?\u0007...')).toBe("Is a-b- -ok--.png");
  });

  it("falls back when the note gives no name", () => {
    expect(exportFileName("")).toBe("Screen area.png");
    expect(exportFileName("...")).toBe("Screen area.png");
  });
});
