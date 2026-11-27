import { describe, expect, it } from "vite-plus/test";

import { noticeFate } from "./notice-fate";

const ADDED = "Added 1 of 2. Quotes is a folder, not a file.";

describe(noticeFate, () => {
  it("is shown once the page or toast window showed those exact words", () => {
    expect(
      noticeFate(
        [
          { event: "noticeSent", text: ADDED, via: "shelf" },
          { event: "noticeShown", text: ADDED, via: "shelf" },
        ],
        ADDED
      )
    ).toStrictEqual({ kind: "shown", via: "shelf" });
  });

  it("is sent but not shown when main sent it and nothing showed it", () => {
    expect(
      noticeFate([{ event: "noticeSent", text: ADDED, via: "toast" }], ADDED)
    ).toStrictEqual({ kind: "sentNotShown", via: "toast" });
  });

  it("is not sent when no notice had those words, naming the ones that were", () => {
    expect(
      noticeFate(
        [
          { event: "itemAdded" },
          { event: "noticeSent", text: "The disk is full.", via: "shelf" },
        ],
        ADDED
      )
    ).toStrictEqual({ kind: "notSent", sent: ["The disk is full."] });
  });

  it("counts only the exact words, not a notice that starts the same", () => {
    expect(
      noticeFate(
        [
          { event: "noticeSent", text: "Added 1 of 2.", via: "shelf" },
          { event: "noticeShown", text: "Added 1 of 2.", via: "shelf" },
        ],
        ADDED
      )
    ).toStrictEqual({ kind: "notSent", sent: ["Added 1 of 2."] });
  });
});
