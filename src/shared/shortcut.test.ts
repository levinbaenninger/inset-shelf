import { describe, expect, it } from "vitest";

import { keyText } from "./shortcut";

describe(keyText, () => {
  it("shows the Mac's symbols", () => {
    expect(keyText("CommandOrControl+C", true)).toBe("⌘C");
    expect(keyText("Alt+CommandOrControl+N", true)).toBe("⌥⌘N");
    expect(keyText("Backspace", true)).toBe("⌫");
    expect(keyText("Enter", true)).toBe("↩");
  });

  it("names the modifiers elsewhere, Ctrl first", () => {
    expect(keyText("CommandOrControl+C", false)).toBe("Ctrl+C");
    expect(keyText("Alt+CommandOrControl+N", false)).toBe("Ctrl+Alt+N");
    expect(keyText("Control+Alt+A", false)).toBe("Ctrl+Alt+A");
    expect(keyText("CommandOrControl+,", false)).toBe("Ctrl+,");
  });

  it("names plain keys elsewhere", () => {
    expect(keyText("Backspace", false)).toBe("Delete");
    expect(keyText("Space", false)).toBe("Space");
  });
});
