# Inset landing page

The public page for Inset: a Next.js static export with Tailwind and the app's shadcn setup (`components.json`, the same tokens as `src/renderer/styles.css`). It installs on its own, apart from the app.

```sh
pnpm install
pnpm dev       # http://localhost:3000
pnpm build     # writes the static site to out/
pnpm preview   # serves out/ with wrangler, as Cloudflare will
```

Cloudflare serves `out/` as Workers static assets (`wrangler.jsonc`, no Worker script). Workers Builds: root directory `site`, build command `pnpm install && pnpm build`, deploy command `pnpm exec wrangler deploy`.

The app windows on the page are drawn in HTML with the renderer's own classes and light theme (`components/app-ui.tsx`); compare them with `pnpm screens` at the repository root. `components/react-bits/` holds the free [React Bits](https://reactbits.dev) components the page uses (Grainient, ScrollReveal, LogoLoop), installed from its shadcn registry.
