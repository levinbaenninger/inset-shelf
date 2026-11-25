import type { NextConfig } from "next";

// A static export: `next build` writes the site to out/, which Cloudflare serves as static assets.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // @inset/ui ships TypeScript source, not built files.
  transpilePackages: ["@inset/ui"],
};

export default config;
