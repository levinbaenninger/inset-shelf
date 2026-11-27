/**
 * The lookups that read other apps' private files: T3 Code's database (~/.t3) for a thread's title, and the
 * ChatGPT desktop app's session index (~/.codex) for a thread's link. They run only when the user turned
 * "Look up chat titles and links" on; with it off, no file of those apps is opened.
 */
export interface ChatLookups {
  readonly t3Title: (thread: string) => Promise<string | null>;
  readonly chatGptLink: (title: string | null) => Promise<string | null>;
}

const none = async (): Promise<null> => await Promise.resolve(null);

/** `lookups`, or lookups that find nothing and read nothing while `enabled` is false. */
export const gatedLookups = (
  enabled: boolean,
  lookups: ChatLookups
): ChatLookups => (enabled ? lookups : { chatGptLink: none, t3Title: none });
