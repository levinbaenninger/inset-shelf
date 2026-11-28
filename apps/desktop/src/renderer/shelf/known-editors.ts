import { CODE_EDITORS } from "@shared/code-editors";
import type { CodeEditor } from "@shared/code-editors";
import { createContext } from "react";

/** The code editors main knows, from the shelf's view: only their items open a file on a click. */
export const KnownEditors = createContext<readonly CodeEditor[]>(CODE_EDITORS);
