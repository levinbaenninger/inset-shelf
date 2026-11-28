import { cn } from "@inset/ui/lib/utils";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

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
    "Keep selected text, screenshots, and notes beside your active window on macOS and Windows. Jump back to the app or page where you found them.",
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" } },
  openGraph: {
    type: "website",
    title: TITLE,
    description:
      "Tap Shift twice to keep selected text with the app and page it came from. Available for macOS and Windows 11.",
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

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html
    lang="en"
    className={cn(GeistSans.variable, GeistMono.variable, inter.variable)}
  >
    <body>{children}</body>
  </html>
);

export default RootLayout;
