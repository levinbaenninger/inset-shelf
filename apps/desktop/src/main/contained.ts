/**
 * Runs what a click in a page started. A throw or a rejection ends in
 * `failed`, which says so in the shelf, and never in main unhandled: the
 * page sent the click and waits for nothing, so nobody else would hear it.
 */
export const contained = async (
  run: () => void | Promise<void>,
  failed: () => void
): Promise<void> => {
  try {
    await run();
  } catch {
    try {
      failed();
    } catch {
      // Nothing is left to say it with.
    }
  }
};
