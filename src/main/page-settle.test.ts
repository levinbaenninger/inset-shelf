import { setImmediate } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { createPageSettle } from "./page-settle";

describe(createPageSettle, () => {
  it("asks the page with a new number each time and resolves when that number comes back", async () => {
    const asked: number[] = [];

    const settle = createPageSettle((seq) => {
      asked.push(seq);
    });

    const first = settle.request();
    const second = settle.request();

    settle.answered(2);

    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      true,
      true,
    ]);
    expect(asked).toStrictEqual([1, 2]);
  });

  it("leaves a later request waiting when an earlier number comes back", async () => {
    const asked: number[] = [];

    const settle = createPageSettle((seq) => {
      asked.push(seq);
    });

    const results: boolean[] = [];

    const record = async (): Promise<void> => {
      results.push(await settle.request());
    };

    void record();
    const later = record();

    settle.answered(1);
    await setImmediate();

    expect(results).toStrictEqual([true]);

    settle.reset();
    await later;

    expect({ asked, results }).toStrictEqual({
      asked: [1, 2],
      results: [true, false],
    });
  });

  it("keeps the page's last count when it reloads or goes away, and says no answer is coming", async () => {
    const asked: number[] = [];

    const settle = createPageSettle((seq) => {
      asked.push(seq);
    });

    settle.setDrafts(2);
    const waiting = settle.request();

    settle.reset();

    await expect(waiting).resolves.toBeFalsy();
    expect({ asked, drafts: settle.drafts() }).toStrictEqual({
      asked: [1],
      drafts: 2,
    });
  });
});
