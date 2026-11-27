import { describe, expect, it, vi } from "vite-plus/test";

import { gatedLookups } from "./chat-lookups";

const fakes = () => ({
  chatGptLink: vi.fn<(title: string | null) => Promise<string | null>>(
    async () => await Promise.resolve("codex://threads/x")
  ),
  t3Title: vi.fn<(thread: string) => Promise<string | null>>(
    async () => await Promise.resolve("A title")
  ),
});

describe(gatedLookups, () => {
  it("reads nothing while chat lookups are off", async () => {
    const real = fakes();
    const lookups = gatedLookups(false, real);

    await expect(lookups.t3Title("thread")).resolves.toBeNull();
    await expect(lookups.chatGptLink("Title")).resolves.toBeNull();
    expect(real.t3Title).not.toHaveBeenCalled();
    expect(real.chatGptLink).not.toHaveBeenCalled();
  });

  it("looks up titles and links once they are on", async () => {
    const real = fakes();
    const lookups = gatedLookups(true, real);

    await expect(lookups.t3Title("thread")).resolves.toBe("A title");
    await expect(lookups.chatGptLink("Title")).resolves.toBe(
      "codex://threads/x"
    );
  });
});
