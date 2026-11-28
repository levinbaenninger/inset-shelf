import path from "node:path";

import { APP_ORIGIN, insetUrl, originOf } from "@shared/inset-url";
import type { PageName } from "@shared/inset-url";
import { app, session } from "electron";
import type { WebContents, WebPreferences } from "electron";

/** Sent by protocol.ts with every inset://app page. */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' inset: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Development only: Vite injects an inline React Refresh preamble and connects over a websocket. */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' inset: data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

/** Ignored in a packaged app so the environment cannot redirect it. */
const devServerUrl = (): string | null => {
  const url = process.env.ELECTRON_RENDERER_URL;

  return app.isPackaged || url === undefined || url === "" ? null : url;
};

export const appOrigin = (): string => {
  const dev = devServerUrl();

  return dev === null ? APP_ORIGIN : (originOf(dev) ?? APP_ORIGIN);
};

export const pageUrl = (name: PageName): string => {
  const dev = devServerUrl();

  return dev === null ? insetUrl.page(name) : `${dev}/${name}.html`;
};

export const preloadPath = (name: PageName): string =>
  path.join(import.meta.dirname, "../preload", `${name}.cjs`);

export const rendererRoot = (): string =>
  path.join(import.meta.dirname, "../renderer");

/** Marks a development run for the preload, which tells its page (see src/preload/shelf.ts). */
export const DEV_FLAG = "--inset-dev";

export const secureWebPreferences = (preload: string): WebPreferences => ({
  additionalArguments: app.isPackaged ? [] : [DEV_FLAG],
  contextIsolation: true,
  devTools: !app.isPackaged,
  nodeIntegration: false,
  preload,
  sandbox: true,
  // The system checker on macOS only; elsewhere Chromium would download dictionaries from Google.
  spellcheck: process.platform === "darwin",
  webSecurity: true,
});

/** No window opens, no page navigates or redirects away, no webview attaches. */
const denyNavigation = (contents: WebContents): void => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  contents.on("will-redirect", (event) => {
    event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
};

/**
 * Applies the denials to every webContents the app ever creates, so a window
 * that forgets harden() (or a future one) is still locked down. Call once,
 * before the first window.
 */
export const hardenEveryWebContents = (): void => {
  app.on("web-contents-created", (_event, contents) => {
    denyNavigation(contents);
  });
};

export const harden = (contents: WebContents, name: string): void => {
  denyNavigation(contents);
  contents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[${name}] failed to load ${url}: ${code} ${description}`);
  });
  contents.on("preload-error", (_event, preload, error) => {
    console.error(`[${name}] preload ${preload} failed:`, error);
  });
  contents.on("render-process-gone", (_event, details) => {
    console.error(`[${name}] renderer gone: ${details.reason}`);
  });

  if (!app.isPackaged) {
    contents.on("console-message", (event) => {
      console.info(`[${name}] ${event.level}: ${event.message}`);
    });
  }
};

export const secureSession = (): void => {
  if (process.platform !== "darwin") {
    session.defaultSession.setSpellCheckerEnabled(false);
  }

  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, respond) => {
      respond(false);
    }
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  const dev = devServerUrl();

  if (dev !== null) {
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: [`${dev}/*`] },
      (details, respond) => {
        respond({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [DEV_CSP],
          },
        });
      }
    );
  }
};
