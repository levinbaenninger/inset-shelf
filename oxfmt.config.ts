import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // apps/web joins the checks once it follows the same rules.
  ignorePatterns: [...(ultracite.ignorePatterns ?? []), "apps/web/**"],
});
