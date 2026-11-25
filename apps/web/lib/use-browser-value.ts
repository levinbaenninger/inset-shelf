import { useSyncExternalStore } from "react";

const subscribe = () => () => {
  // The value is read once after hydration; nothing changes it later.
};

/** A value only the browser knows, such as today's date or the visitor's system; `fallback` in the static HTML. */
export const useBrowserValue = <T>(read: () => T, fallback: T): T =>
  useSyncExternalStore(subscribe, read, () => fallback);
