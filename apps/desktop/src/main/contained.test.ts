import { describe, expect, it } from "vite-plus/test";

import { contained } from "./contained";

describe(contained, () => {
  it.each([
    [
      "throws at once",
      () => {
        throw new URIError("URI malformed");
      },
    ],
    [
      "rejects later",
      async () => {
        await Promise.reject(new Error("no handler"));
      },
    ],
  ])(
    "says so once, and never rejects, when what a click started %s",
    async (_, run) => {
      const said: string[] = [];

      await expect(
        contained(run, () => {
          said.push("failed");
        })
      ).resolves.toBeUndefined();
      expect(said).toStrictEqual(["failed"]);
    }
  );

  it("says nothing when it goes well", async () => {
    const said: string[] = [];

    await contained(
      async () => {
        await Promise.resolve();
      },
      () => {
        said.push("failed");
      }
    );

    expect(said).toStrictEqual([]);
  });

  it("never rejects even when saying so fails too", async () => {
    await expect(
      contained(
        () => {
          throw new Error("first");
        },
        () => {
          throw new Error("the shelf is gone");
        }
      )
    ).resolves.toBeUndefined();
  });
});
