import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { SITE_URL } from "@/lib/site";

import "./globals.css";

// Inter is the brand's one face (Inset design system, section 3).
const inter = localFont({ src: "./fonts/InterVariable.woff2", variable: "--font-inter", display: "swap" });

const TITLE = "Inset: a capture shelf for Mac and Windows";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description:
    "A small side window that docks beside the window you work in and keeps selected text, screenshots and notes with the page they came from. Free test build.",
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" } },
  openGraph: {
    type: "website",
    title: TITLE,
    description:
      "Tap Shift twice to keep selected text with the app and page it came from. A free test build for macOS and Windows 11.",
    images: ["/share.jpg"],
  },
  twitter: { card: "summary_large_image" },
  // The page's kind, read by the design checker (tasteskill).
  other: { "site-kind": "software", "page-type": "software" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

// Set before the first paint, so the hero's entrance runs once and a page without script never waits for it.
const ENTRANCE = "document.documentElement.classList.add('m-enter')";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-type="software" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ENTRANCE }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
