import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const renderer = path.resolve(import.meta.dirname, "src/renderer");
const shared = path.resolve(import.meta.dirname, "src/shared");
const preload = path.resolve(import.meta.dirname, "src/preload");

// Only the build packaged for scripts/e2e/verify-macos.ts keeps its test hooks.
const e2eBuild = process.env.INSET_E2E_BUILD === "1";

export default defineConfig({
  main: {
    define: { __INSET_E2E__: JSON.stringify(e2eBuild) },
    resolve: { alias: { "@shared": shared } },
  },
  preload: {
    resolve: { alias: { "@shared": shared } },
    build: {
      // Sandboxed preloads cannot load ESM or node_modules: each entry is one standalone CJS file.
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: {
        input: {
          drawing: path.resolve(preload, "drawing.ts"),
          onboarding: path.resolve(preload, "onboarding.ts"),
          picker: path.resolve(preload, "picker.ts"),
          screenshot: path.resolve(preload, "screenshot.ts"),
          settings: path.resolve(preload, "settings.ts"),
          shelf: path.resolve(preload, "shelf.ts"),
          toast: path.resolve(preload, "toast.ts"),
        },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: renderer,
    resolve: { alias: { "@": renderer, "@shared": shared } },
    build: {
      // Fonts stay files: the pages' policy is font-src 'self', which blocks the data: URLs small ones would be inlined as.
      assetsInlineLimit: (file) =>
        /\.(?:woff2?|ttf|otf)$/u.test(file) ? false : undefined,
      rolldownOptions: {
        input: {
          drawing: path.resolve(renderer, "drawing.html"),
          onboarding: path.resolve(renderer, "onboarding.html"),
          picker: path.resolve(renderer, "picker.html"),
          screenshot: path.resolve(renderer, "screenshot.html"),
          settings: path.resolve(renderer, "settings.html"),
          shelf: path.resolve(renderer, "shelf.html"),
          toast: path.resolve(renderer, "toast.html"),
        },
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
