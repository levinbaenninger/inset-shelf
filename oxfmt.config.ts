import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // The landing page is plain HTML with the design kit's own files.
  ignorePatterns: [...(ultracite.ignorePatterns ?? []), "site/**"],
});
