import { describe, expect, it } from "vitest";

import { fileSizeText } from "./format";

describe(fileSizeText, () => {
  it("names sizes in bytes, kB, MB and GB", () => {
    expect(fileSizeText(512)).toBe("512 bytes");
    expect(fileSizeText(48_000)).toBe("48 kB");
    expect(fileSizeText(2_480_000)).toBe("2.5 MB");
    expect(fileSizeText(2_480_000_000)).toBe("2.5 GB");
  });
});
