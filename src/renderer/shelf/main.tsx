import "@/shared/zod-jitless";
import "@/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { isMac } from "@/shared/platform";
import { followSystemTheme } from "@/shared/theme";

import { ShelfApp } from "./shelf-app";

followSystemTheme();

// macOS draws the window's sidebar material behind a transparent page.
document.documentElement.dataset.platform = isMac ? "mac" : "other";

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider delayDuration={400}>
        <ShelfApp />
      </TooltipProvider>
    </StrictMode>
  );
}
