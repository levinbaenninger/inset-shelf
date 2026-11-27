import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { codeEditor } from "@shared/code-editors";
import type { CodeEditor } from "@shared/code-editors";
import type { CodePlace } from "@shared/code-place";
import { describe, expect, it } from "vite-plus/test";

import { fileIsThere, openCode } from "./open-code";
import type { CodeSystem } from "./open-code";

const CODE = codeEditor("Code");

const PLACE: CodePlace = {
  file: "/Users/anna/My Code/proj/a.ts",
  line: 12,
  root: "/Users/anna/My Code/proj",
};

/** What the system was asked to do, in order. */
const system = (
  there: boolean,
  schemes: readonly string[]
): CodeSystem & { readonly asked: string[] } => {
  const asked: string[] = [];

  return {
    asked,
    bringForward: async (address) => {
      asked.push(`forward ${address}`);
      await Promise.resolve();
    },
    fileIsThere: async () => await Promise.resolve(there),
    notify: (message) => {
      asked.push(`say ${message}`);
    },
    open: async (address) => {
      asked.push(`open ${address}`);
      await Promise.resolve();
    },
    registered: (address) =>
      schemes.some((scheme) => address.startsWith(`${scheme}:`)),
    reveal: (file) => {
      asked.push(`reveal ${file}`);
    },
  };
};

describe(openCode, () => {
  it("opens the file in its editor at its line", async () => {
    const mac = system(true, ["vscode"]);

    await openCode(CODE, PLACE, mac);

    expect(mac.asked).toStrictEqual([
      "open vscode://file/Users/anna/My%20Code/proj/a.ts:12",
    ]);
  });

  it("opens the file alone when no line is stored", async () => {
    const mac = system(true, ["vscode"]);

    await openCode(CODE, { ...PLACE, line: null }, mac);

    expect(mac.asked).toStrictEqual([
      "open vscode://file/Users/anna/My%20Code/proj/a.ts",
    ]);
  });

  it("shows the file in its folder when no app on this computer takes the editor's address", async () => {
    const mac = system(true, []);

    await openCode(CODE, PLACE, mac);

    expect(mac.asked).toStrictEqual([`reveal ${PLACE.file}`]);
  });

  it.each([
    ["an editor the shelf no longer knows", undefined],
    ["an editor with no known way to open a file", codeEditor("Cursor")],
  ])(
    "shows the file in its folder for %s",
    async (_, editor: CodeEditor | undefined) => {
      const mac = system(true, ["vscode", "cursor"]);

      await openCode(editor, PLACE, mac);

      expect(mac.asked).toStrictEqual([`reveal ${PLACE.file}`]);
    }
  );

  it("says a file that is gone is gone, and brings its editor forward", async () => {
    const mac = system(false, ["vscode"]);

    await openCode(CODE, PLACE, mac);

    expect(mac.asked).toStrictEqual([
      "say a.ts is no longer at this path",
      "forward vscode://file/Users/anna/My%20Code/proj/a.ts:12",
    ]);
  });

  it("only says a file is gone when no app takes the editor's address", async () => {
    const mac = system(false, []);

    await openCode(CODE, PLACE, mac);

    expect(mac.asked).toStrictEqual(["say a.ts is no longer at this path"]);
  });
});

describe(fileIsThere, () => {
  const folder = mkdtempSync(path.join(tmpdir(), "open-code-"));
  const file = path.join(folder, "a.ts");

  writeFileSync(file, "export {};\n");
  mkdirSync(path.join(folder, "src"));

  it("finds a file at its path", async () => {
    await expect(fileIsThere(file)).resolves.toBeTruthy();
  });

  it.each([
    ["nothing", path.join(folder, "b.ts")],
    ["a folder", path.join(folder, "src")],
    ["a path through a file", path.join(file, "c.ts")],
  ])("finds no file where %s is", async (_, gone) => {
    await expect(fileIsThere(gone)).resolves.toBeFalsy();
  });

  it("does not call a file gone when the system only refuses to say", async () => {
    const refused = Object.assign(new Error("not permitted"), {
      code: "EPERM",
    });

    await expect(
      fileIsThere(file, async () => await Promise.reject(refused))
    ).resolves.toBeTruthy();
  });
});
