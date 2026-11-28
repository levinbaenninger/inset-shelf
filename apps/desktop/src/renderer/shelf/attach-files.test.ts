import type { AttachResult } from "@shared/contracts";
import { shelfContract } from "@shared/contracts";
import { AttachmentIdSchema, TextItemSchema } from "@shared/shelf";
import type { ItemId } from "@shared/shelf";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vite-plus/test";

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const note = TextItemSchema.parse({
  attachments: [],
  color: null,
  context: null,
  createdAt: "2026-11-25T10:00:00.000Z",
  description: "",
  done: false,
  due: null,
  id: uuid(1),
  kind: "text",
  sectionId: uuid(900),
  steps: [],
  text: "Quote from the movers",
  via: "typed",
  windows: [],
});

/** What reached main's addFilesTo handler: only input its contract accepts, as ipc-kit.ts checks it. */
const reached: unknown[] = [];

// The shelf window's preload, as src/preload/expose.ts gives it: main refuses input its contract doesn't accept, and the invoke rejects.
vi.stubGlobal("window", {
  insetFiles: { pathFor: (file: File) => `/Users/anna/Photos/${file.name}` },
  insetShelf: {
    addFilesTo: async (input: {
      readonly id: ItemId;
      readonly paths: readonly string[];
    }): Promise<AttachResult> => {
      await Promise.resolve();

      if (!shelfContract.methods.addFilesTo.input.safeParse(input).success) {
        throw new Error(
          "Error invoking remote method 'shelf:addFilesTo': shelf.addFilesTo rejected: invalid input"
        );
      }

      reached.push(input);

      return {
        attached: [AttachmentIdSchema.parse(uuid(50))],
        message: null,
      };
    },
  },
});

const { attachDropped } = await import("./attach-files");

const photos = (count: number): File[] =>
  Array.from({ length: count }, (_, n) => new File([], `photo-${n}.png`));

/** The toasts the shelf showed since `from`: what each said, and how. */
const toastsSince = (from: number) =>
  toast
    .getHistory()
    .slice(from)
    .flatMap((each) =>
      "dismiss" in each ? [] : [{ title: each.title, type: each.type }]
    );

describe("files dropped on an open item", () => {
  it("says how many files one drop can bring, and asks main for nothing, when more are dropped", async () => {
    const from = toast.getHistory().length;

    reached.length = 0;

    await expect(attachDropped(note, photos(51))).resolves.toBeUndefined();
    expect({ reached, toasts: toastsSince(from) }).toStrictEqual({
      reached: [],
      toasts: [
        {
          title:
            "Nothing was attached. Drop or paste up to 50 files at a time.",
          type: "error",
        },
      ],
    });
  });

  it("hands main a drop of as many files as one can bring", async () => {
    reached.length = 0;

    await attachDropped(note, photos(50));
    expect(reached).toHaveLength(1);
  });
});
