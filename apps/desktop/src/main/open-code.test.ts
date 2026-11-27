import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { CODE_EDITORS } from "@shared/code-editors";
import { textMark } from "@shared/code-place";
import type { CodePlace } from "@shared/code-place";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { fileIsThere, openCode } from "./open-code";
import type { CodeSystem } from "./open-code";
import { quietDisk } from "./quiet-disk";

/** What the shelf says when the editor was to open the file: what it tries next, since a reveal can't report that it failed. */
/** What the system is asked when the item's words are looked for in its file. */
const LOOK = "look for retry(1); in /Users/anna/My Code/proj/a.ts";

const FELL_BACK =
  "say Couldn’t open a.ts in Code, so Inset tries to show it in its folder";

/** The words the item was captured with: on line 12 of its file now. */
const CAPTURED = "retry(1);";

const PLACE: CodePlace = {
  file: "/Users/anna/My Code/proj/a.ts",
  line: null,
  mark: textMark(CAPTURED),
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
    lineOf: async (file, captured) => {
      asked.push(`look for ${captured} in ${file}`);

      return await Promise.resolve(captured === CAPTURED ? 12 : null);
    },
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
  it("tries to show the file in its folder, and says so, when its editor refuses to open it", async () => {
    const mac = system(true, ["vscode"]);

    await openCode("Code", PLACE, CAPTURED, CODE_EDITORS, {
      ...mac,
      open: async () => {
        await Promise.reject(new Error("the handler is gone"));
      },
    });

    expect(mac.asked).toStrictEqual([
      LOOK,
      FELL_BACK,
      "reveal /Users/anna/My Code/proj/a.ts",
    ]);
  });

  it("still says a file is gone when its editor can't be brought forward", async () => {
    const mac = system(false, ["vscode"]);

    await openCode("Code", PLACE, CAPTURED, CODE_EDITORS, {
      ...mac,
      bringForward: async () => {
        await Promise.reject(new Error("no such app"));
      },
    });

    expect(mac.asked).toStrictEqual(["say a.ts is no longer at this path"]);
  });

  it("opens the file in its editor at the line its captured words are on now", async () => {
    const mac = system(true, ["vscode"]);

    await openCode("Code", PLACE, CAPTURED, CODE_EDITORS, mac);

    expect(mac.asked).toStrictEqual([
      LOOK,
      "open vscode://file/Users/anna/My%20Code/proj/a.ts:12",
    ]);
  });

  it.each([
    ["its words were edited since the capture", PLACE, "other();"],
    [
      "it was saved before its words were marked",
      { ...PLACE, mark: undefined },
      CAPTURED,
    ],
    ["it holds no words", PLACE, null],
  ])(
    "opens the file alone, looking for no line, when %s",
    async (_, place, text) => {
      const mac = system(true, ["vscode"]);

      await openCode("Code", place, text, CODE_EDITORS, mac);

      expect(mac.asked).toStrictEqual([
        "open vscode://file/Users/anna/My%20Code/proj/a.ts",
      ]);
    }
  );

  it("opens the file alone when its words are not found once in it", async () => {
    const mac = system(true, ["vscode"]);

    await openCode("Code", PLACE, CAPTURED, CODE_EDITORS, {
      ...mac,
      lineOf: async () => await Promise.resolve(null),
    });

    expect(mac.asked).toStrictEqual([
      "open vscode://file/Users/anna/My%20Code/proj/a.ts",
    ]);
  });

  it("opens the file alone when the look for its line fails", async () => {
    const mac = system(true, ["vscode"]);

    await openCode("Code", PLACE, CAPTURED, CODE_EDITORS, {
      ...mac,
      lineOf: async () => await Promise.reject(new Error("no")),
    });

    expect(mac.asked).toStrictEqual([
      "open vscode://file/Users/anna/My%20Code/proj/a.ts",
    ]);
  });

  it("tries to show the file in its folder, and says so, when no app on this computer takes the editor's address", async () => {
    const mac = system(true, []);

    await openCode("Code", PLACE, CAPTURED, CODE_EDITORS, mac);

    expect(mac.asked).toStrictEqual([FELL_BACK, `reveal ${PLACE.file}`]);
  });

  it.each([
    ["a path with a colon", "/Users/anna/My Code/proj/a:12.ts"],
    ["a workspace file", "/Users/anna/My Code/proj/all.code-workspace"],
  ])(
    "shows %s in its folder with no word, as its tooltip said it would",
    async (_, file) => {
      const mac = system(true, ["vscode"]);

      await openCode("Code", { ...PLACE, file }, CAPTURED, CODE_EDITORS, mac);

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

      await openCode(app, PLACE, CAPTURED, known, {
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

    await openCode("Code", PLACE, CAPTURED, CODE_EDITORS, mac);

    expect(mac.asked).toStrictEqual([
      "say a.ts is no longer at this path",
      "forward vscode://",
    ]);
  });

  it.each([
    ["a path with a colon", "/Users/anna/My Code/proj/a:12.ts", "a:12.ts"],
    [
      "a workspace file",
      "/Users/anna/My Code/proj/all.code-workspace",
      "all.code-workspace",
    ],
  ])(
    "says %s that is gone is gone, and brings its editor forward by its scheme alone",
    async (_, file, name) => {
      const mac = system(false, ["vscode"]);

      await openCode("Code", { ...PLACE, file }, CAPTURED, CODE_EDITORS, mac);

      expect(mac.asked).toStrictEqual([
        `say ${name} is no longer at this path`,
        "forward vscode://",
      ]);
    }
  );

  it("only says a file is gone when no app takes the editor's address", async () => {
    const mac = system(false, []);

    await openCode("Code", PLACE, CAPTURED, CODE_EDITORS, mac);

    expect(mac.asked).toStrictEqual(["say a.ts is no longer at this path"]);
  });
});

describe(fileIsThere, () => {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), "open-code-")));

  afterAll(() => {
    rmSync(folder, { force: true, recursive: true });
  });

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
