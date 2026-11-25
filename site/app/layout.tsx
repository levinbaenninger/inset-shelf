import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { SITE_URL } from "@/lib/site";

import "./globals.css";

// The app's own face, for the drawn app windows; the page itself is set in Geist.
const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
});

const TITLE = "Inset Shelf: a capture shelf for Mac and Windows";

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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn(GeistSans.variable, GeistMono.variable, inter.variable)}>
      <body>{children}</body>
    </html>
  );
}
