import "@/shared/zod-jitless";
import "@/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { followSystemTheme } from "@/shared/theme";

import { ToastApp } from "./toast-app";

followSystemTheme();

const root = document.querySelector("#root");

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider delayDuration={400}>
        <ToastApp />
      </TooltipProvider>
    </StrictMode>
  );
}
