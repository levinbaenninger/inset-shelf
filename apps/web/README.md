# Inset landing page

The public page for Inset: a Next.js static export with Tailwind and shadcn. It shares the button, `cn` and the app's theme with the desktop app through `@inset/ui` (`packages/ui`), and sets its own colours over that theme in `app/globals.css`.

```sh
vp install     # at the repository root
vp run dev     # http://localhost:3000
vp run build   # writes the static site to out/
vp run preview # serves out/ with wrangler, as Cloudflare will
```

Cloudflare serves `out/` as Workers static assets (`wrangler.jsonc`, no Worker script). Workers Builds installs only this app and `@inset/ui`, so it never fetches the desktop app's Electron or native modules:

- Root directory: `apps/web`
- Build variable: `SKIP_DEPENDENCY_INSTALL=1`
- Build command: `pnpm install --frozen-lockfile --filter @inset/web... && pnpm run build`
- Deploy command: `npx wrangler deploy`
- Build watch paths, if set: `apps/web/**`, `packages/ui/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`

The app windows on the page are drawn in HTML with the renderer's own classes and light theme (`components/app-ui.tsx`); compare them with `vp run screens` in `apps/desktop`. `components/react-bits/` holds the free [React Bits](https://reactbits.dev) components the page uses (Grainient, ScrollReveal, LogoLoop), installed from its shadcn registry.
