import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";
import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    arrowParens: "always",
    bracketSameLine: false,
    bracketSpacing: true,
    endOfLine: "lf",
    // apps/web joins in the next commit, as a formatting-only change.
    ignorePatterns: [...(core.ignorePatterns ?? []), "apps/web/**"],
    jsxSingleQuote: false,
    printWidth: 80,
    proseWrap: "never",
    quoteProps: "as-needed",
    semi: true,
    singleQuote: false,
    sortImports: { ignoreCase: true, newlinesBetween: true, order: "asc" },
    sortPackageJson: true,
    sortTailwindcss: {
      functions: ["clsx", "cva", "tw", "twMerge", "cn", "twJoin", "tv"],
    },
    tabWidth: 2,
    trailingComma: "es5",
    useTabs: false,
  },
  lint: {
    env: core.env,
    extends: [core, react, tanstack, vitest, shadcn, antiSlop],
    ignorePatterns: [
      ...(core.ignorePatterns ?? []),
      "apps/desktop/src/renderer/components/ui/**",
      "packages/ui/src/components/**",
      "apps/web/**",
    ],
    jsPlugins: [
      ...(shadcn.jsPlugins ?? []),
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
    ],
    // Type checks run per package (vp run -r typecheck), with each tsconfig.
    options: { typeAware: true, typeCheck: false },
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
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
  },
  test: { projects: ["apps/desktop"] },
});
