import type { Metadata } from "next";

import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Page not found · Inset Shelf",
  robots: { index: false },
};

// Exported as 404.html; Cloudflare serves it for any address the site does not have.
const NotFound = () => (
  <main className="rails gutter grid min-h-svh content-center justify-items-start gap-6">
    <Logo />
    <h1 className="text-title">This page is not on the shelf</h1>
    <p className="text-muted-foreground">
      The address may be old.{" "}
      <a href="/" className="text-brand underline underline-offset-4">
        Go to the Inset Shelf home page
      </a>
      .
    </p>
  </main>
);

export default NotFound;
