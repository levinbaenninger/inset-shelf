import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const renderer = path.resolve(import.meta.dirname, "src/renderer");
const shared = path.resolve(import.meta.dirname, "src/shared");
const preload = path.resolve(import.meta.dirname, "src/preload");

export default defineConfig({
  main: {
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
          overlay: path.resolve(preload, "overlay.ts"),
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
      rolldownOptions: {
        input: {
          drawing: path.resolve(renderer, "drawing.html"),
          overlay: path.resolve(renderer, "overlay.html"),
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
