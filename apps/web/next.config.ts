import type { NextConfig } from "next";

// A static export: `next build` writes the site to out/, which Cloudflare serves as static assets.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default config;
