import { describe, expect, it } from "vitest";

import { causeText, reportSaveError, saveErrorText } from "./save-error";

describe(saveErrorText, () => {
  it.each([
    ["ENOSPC", "The disk is full."],
    ["EACCES", "Inset can’t write to its data folder."],
    ["EPERM", "Inset can’t write to its data folder."],
    ["EROFS", "The disk is read-only."],
    ["EIO", "Couldn’t save (EIO)."],
    [null, "Couldn’t save (unknown)."],
  ])("says %s as a sentence", (code, sentence) => {
    expect(saveErrorText(code)).toBe(sentence);
  });
});

describe(reportSaveError, () => {
  it("turns a save that throws into a failed result in the same words, and passes any other result on", async () => {
    const full = await reportSaveError(async () => {
      await Promise.resolve();

      throw Object.assign(new Error("ENOSPC: no space left on device"), {
        code: "ENOSPC",
      });
    });

    const saved = await reportSaveError(
      async () => await Promise.resolve({ ok: true })
    );

    expect({ full, saved }).toStrictEqual({
      full: { message: "The disk is full.", ok: false },
      saved: { ok: true },
    });
  });
});

describe(causeText, () => {
  it("says a common disk problem as its sentence and anything else in its own words", () => {
    expect({
      full: causeText("ENOSPC", "ENOSPC: no space left on device, write"),
      none: causeText(null, "The window is gone."),
      other: causeText("ENOENT", "ENOENT: no such file"),
    }).toStrictEqual({
      full: "The disk is full.",
      none: "The window is gone.",
      other: "ENOENT: no such file",
    });
  });
});
