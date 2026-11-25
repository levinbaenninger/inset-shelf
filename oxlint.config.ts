import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  env: core.env,
  extends: [core, react, tanstack, vitest, shadcn, antiSlop],
  ignorePatterns: [
    ...core.ignorePatterns,
    "apps/desktop/src/renderer/components/ui/**",
    "packages/ui/src/components/**",
    "apps/web/**",
  ],
  jsPlugins: shadcn.jsPlugins,
  options: { typeAware: true },
  overrides: [
    {
      // Plain JavaScript the screens harness injects into a page: untyped by nature.
      files: ["apps/desktop/scripts/fixtures/**"],
      rules: {
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/promise-function-async": "off",
        "typescript/strict-boolean-expressions": "off",
      },
    },
    {
      files: ["apps/desktop/src/shared/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                message:
                  "src/shared is imported by every process; keep Electron out.",
                name: "electron",
              },
            ],
          },
        ],
      },
    },
  ],
});
