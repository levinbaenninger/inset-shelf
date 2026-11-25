import { describe, expect, it } from "vitest";

import { pickerContract } from "./contracts";

const choose = pickerContract.methods.choose.input;

describe("the window picker's choose message", () => {
  it("takes the picked windows' ids, in the order picked", () => {
    expect(choose.parse(["b", "a"])).toStrictEqual(["b", "a"]);
  });

  it("refuses no pick, more windows than an item holds, or an odd id", () => {
    expect(choose.safeParse([]).success).toBeFalsy();
    expect(
      choose.safeParse(Array.from({ length: 21 }, (_, n) => String(n))).success
    ).toBeFalsy();
    expect(choose.safeParse(["x".repeat(101)]).success).toBeFalsy();
  });
});
