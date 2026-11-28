import { isPageAddress } from "@shared/web-source";

/** What reopening a ChatGPT thread by its title asks of the system; main passes Electron's. */
export interface ThreadSystem {
  /** The codex:// link of the one thread with this title; null when none or two have it. */
  readonly find: (title: string) => Promise<string | null>;
  /** Whether an app on this computer takes the address's scheme. */
  readonly registered: (address: string) => boolean;
  readonly open: (address: string) => Promise<void>;
}

/**
 * Opens the ChatGPT thread an item kept without a link to it is found by:
 * its saved `title`. When no single thread has the title, or no app takes
 * its link, the item's own `page` opens instead. With neither it rejects,
 * so the shelf says it couldn't open where the item came from.
 */
export const openThreadByTitle = async (
  title: string,
  page: string | null,
  system: ThreadSystem
): Promise<void> => {
  const thread = await system.find(title);

  if (thread !== null && system.registered(thread)) {
    await system.open(thread);
  } else if (page !== null && isPageAddress(page)) {
    await system.open(page);
  } else {
    throw new Error(`ChatGPT has no thread or page to open for “${title}”`);
  }
};
