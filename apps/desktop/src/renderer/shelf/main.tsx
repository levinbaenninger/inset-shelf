import "@/shared/zod-jitless";
import "@/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markPlatform } from "@/shared/platform";
import { followSystemTheme } from "@/shared/theme";

import { ShelfApp } from "./shelf-app";

followSystemTheme();

markPlatform();

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
