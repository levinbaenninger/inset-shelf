import { describe, expect, it } from "vite-plus/test";

import { openThreadByTitle } from "./open-thread";
import type { ThreadSystem } from "./open-thread";

const THREAD = "codex://threads/7";
const PAGE = "https://chatgpt.com/c/7";

/** A system where `found` is what the title finds and `handled` says whether ChatGPT takes codex:// links; it records what opened. */
const system = (
  found: string | null,
  handled: boolean
): ThreadSystem & { readonly opened: string[] } => {
  const opened: string[] = [];

  return {
    find: async () => await Promise.resolve(found),
    open: async (address) => {
      opened.push(address);
      await Promise.resolve();
    },
    opened,
    registered: () => handled,
  };
};

describe(openThreadByTitle, () => {
  it("opens the thread the title finds", async () => {
    const found = system(THREAD, true);

    await openThreadByTitle("Plan", PAGE, found);

    expect(found.opened).toStrictEqual([THREAD]);
  });

  it("opens the item's page when no single thread has the title, or no app takes its link", async () => {
    const none = system(null, true);
    const unhandled = system(THREAD, false);

    await openThreadByTitle("Plan", PAGE, none);
    await openThreadByTitle("Plan", PAGE, unhandled);

    expect(none.opened).toStrictEqual([PAGE]);
    expect(unhandled.opened).toStrictEqual([PAGE]);
  });

  it("fails, so the shelf says so, when neither a thread nor a page opens", async () => {
    const none = system(null, true);
    const unhandled = system(THREAD, false);
    const notPage = system(null, true);

    await expect(openThreadByTitle("Plan", null, none)).rejects.toThrow(
      "no thread or page"
    );
    await expect(openThreadByTitle("Plan", null, unhandled)).rejects.toThrow(
      "no thread or page"
    );
    await expect(
      openThreadByTitle("Plan", "codex://threads/8", notPage)
    ).rejects.toThrow("no thread or page");

    expect([
      ...none.opened,
      ...unhandled.opened,
      ...notPage.opened,
    ]).toHaveLength(0);
  });
});
