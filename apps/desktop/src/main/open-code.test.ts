import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { CODE_EDITORS } from "@shared/code-editors";
import type { CodePlace } from "@shared/code-place";
import { describe, expect, it } from "vite-plus/test";

import { fileIsThere, openCode } from "./open-code";
import type { CodeSystem } from "./open-code";
import { quietDisk } from "./quiet-disk";

/** What the shelf says when the editor was to open the file and its folder shows it instead. */
const FELL_BACK =
  "say Couldn’t open a.ts in Code, so it is shown in its folder";

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
  it("shows the file in its folder, and says so, when its editor refuses to open it", async () => {
    const mac = system(true, ["vscode"]);

    await openCode("Code", PLACE, CODE_EDITORS, {
      ...mac,
      open: async () => {
        await Promise.reject(new Error("the handler is gone"));
      },
    });

    expect(mac.asked).toStrictEqual([
      FELL_BACK,
      "reveal /Users/anna/My Code/proj/a.ts",
    ]);
  });

  it("still says a file is gone when its editor can't be brought forward", async () => {
    const mac = system(false, ["vscode"]);

    await openCode("Code", PLACE, CODE_EDITORS, {
      ...mac,
      bringForward: async () => {
        await Promise.reject(new Error("no such app"));
      },
    });

    expect(mac.asked).toStrictEqual(["say a.ts is no longer at this path"]);
  });

  it("opens the file in its editor at its line", async () => {
    const mac = system(true, ["vscode"]);

    await openCode("Code", PLACE, CODE_EDITORS, mac);

    expect(mac.asked).toStrictEqual([
      "open vscode://file/Users/anna/My%20Code/proj/a.ts:12",
    ]);
  });

  it("opens the file alone when no line is stored", async () => {
    const mac = system(true, ["vscode"]);

    await openCode("Code", { ...PLACE, line: null }, CODE_EDITORS, mac);

    expect(mac.asked).toStrictEqual([
      "open vscode://file/Users/anna/My%20Code/proj/a.ts",
    ]);
  });

  it("shows the file in its folder, and says so, when no app on this computer takes the editor's address", async () => {
    const mac = system(true, []);

    await openCode("Code", PLACE, CODE_EDITORS, mac);

    expect(mac.asked).toStrictEqual([FELL_BACK, `reveal ${PLACE.file}`]);
  });

  it.each([
    ["a path with a colon", "/Users/anna/My Code/proj/a:12.ts"],
    ["a workspace file", "/Users/anna/My Code/proj/all.code-workspace"],
  ])(
    "shows %s in its folder with no word, as its tooltip said it would",
    async (_, file) => {
      const mac = system(true, ["vscode"]);

      await openCode("Code", { ...PLACE, file }, CODE_EDITORS, mac);

      expect(mac.asked).toStrictEqual([`reveal ${file}`]);
    }
  );

  it.each([
    ["an app the shelf has no row for", "Zed"],
    ["an editor the shelf no longer knows", "Code"],
    ["no app", null],
  ])(
    "does nothing for %s: it does not look for the file, and shows nothing",
    async (_, app) => {
      const mac = system(true, ["vscode", "zed"]);
      const known = app === "Code" ? [] : CODE_EDITORS;

      await openCode(app, PLACE, known, {
        ...mac,
        fileIsThere: async (file) => {
          mac.asked.push(`look ${file}`);

          return await Promise.resolve(true);
        },
      });

      expect(mac.asked).toStrictEqual([]);
    }
  );

  it("says a file that is gone is gone, and brings its editor forward", async () => {
    const mac = system(false, ["vscode"]);

    await openCode("Code", PLACE, CODE_EDITORS, mac);

    expect(mac.asked).toStrictEqual([
      "say a.ts is no longer at this path",
      "forward vscode://file/Users/anna/My%20Code/proj/a.ts:12",
    ]);
  });

  it("only says a file is gone when no app takes the editor's address", async () => {
    const mac = system(false, []);

    await openCode("Code", PLACE, CODE_EDITORS, mac);

    expect(mac.asked).toStrictEqual(["say a.ts is no longer at this path"]);
  });
});

describe(fileIsThere, () => {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), "open-code-")));
  const home = path.join(folder, "home");
  const file = path.join(home, "dev", "a.ts");
  const kept = path.join(home, "Documents", "a.ts");

  mkdirSync(path.join(home, "dev", "src"), { recursive: true });
  mkdirSync(path.dirname(kept));
  writeFileSync(file, "export {};\n");
  writeFileSync(kept, "export {};\n");

  const disk = quietDisk({ home });

  it("finds a file at its path", async () => {
    await expect(fileIsThere(file, disk)).resolves.toBeTruthy();
  });

  it.each([
    ["nothing", path.join(home, "dev", "b.ts")],
    ["a folder", path.join(home, "dev", "src")],
    ["a path through a file", path.join(file, "c.ts")],
  ])("finds no file where %s is", async (_, gone) => {
    await expect(fileIsThere(gone, disk)).resolves.toBeFalsy();
  });

  it.each([
    ["a file", kept],
    ["nothing", path.join(home, "Documents", "b.ts")],
  ])(
    "leaves the editor to try where it may not look, with %s there",
    async (_, unseen) => {
      await expect(fileIsThere(unseen, disk)).resolves.toBeTruthy();
    }
  );
});
