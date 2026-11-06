import { z } from "zod";

/** The system's code for a failed file operation, such as ENOENT. */
export const FsErrorSchema = z.object({ code: z.string() });

const SENTENCES = new Map([
  ["EACCES", "Inset can't write to its data folder."],
  ["ENOSPC", "The disk is full."],
  ["EPERM", "Inset can't write to its data folder."],
  ["EROFS", "The disk is read-only."],
]);

/**
 * Why a save failed, from the system's code for it (ENOSPC…), as the
 * banner, the quit prompt and a refused copy say it (Round 7). Common
 * causes read as a sentence; anything else names its code.
 */
export const saveErrorText = (code: string | null): string =>
  SENTENCES.get(code ?? "") ?? `Couldn't save (${code ?? "unknown"}).`;

/**
 * A save that throws, such as a picture the disk refused, ends as a failed
 * result that says why in the same words, instead of a rejection whose
 * code never reaches the page.
 */
export const reportSaveError = async <Result>(
  run: () => Promise<Result>
): Promise<Result | { readonly ok: false; readonly message: string }> => {
  try {
    return await run();
  } catch (error) {
    return {
      message: saveErrorText(FsErrorSchema.safeParse(error).data?.code ?? null),
      ok: false,
    };
  }
};

/** Any failed operation's cause: a common disk problem as its sentence, anything else in its own words. */
export const causeText = (code: string | null, message: string): string =>
  SENTENCES.get(code ?? "") ?? message;
