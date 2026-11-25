# Inset landing page

The public page for Inset: a Next.js static export with Tailwind and the app's shadcn setup (`components.json`, the same tokens as `src/renderer/styles.css`). It installs on its own, apart from the app.

```sh
pnpm install
pnpm dev       # http://localhost:3000
pnpm build     # writes the static site to out/
pnpm preview   # serves out/ with wrangler, as Cloudflare will
```

Cloudflare serves `out/` as Workers static assets (`wrangler.jsonc`, no Worker script). Workers Builds: root directory `site`, build command `pnpm install && pnpm build`, deploy command `pnpm exec wrangler deploy`.

The screenshots in `public/img` are shots of the real renderer (`pnpm screens` at the repository root), set on the brand's light blue. `.taste-skill/` holds the design checker's history and waivers.
