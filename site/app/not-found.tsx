import type { Metadata } from "next";

import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Page not found · Inset Shelf",
  robots: { index: false },
};

// Exported as 404.html; Cloudflare serves it for any address the site does not have.
export default function NotFound() {
  return (
    <main className="wrap grid min-h-svh content-center gap-6">
      <Logo className="justify-self-start" />
      <h1 className="text-h2 font-medium">This page is not on the shelf</h1>
      <p className="text-muted-foreground">
        The address may be old.{" "}
        <a href="/" className="text-primary underline underline-offset-4">
          Go to the Inset Shelf home page
        </a>
        .
      </p>
    </main>
  );
}
