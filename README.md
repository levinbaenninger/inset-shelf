# Inset Shelf

Inset Shelf is a small side window that docks next to the window you are working in and keeps what you want to come back to. Select text in any app and tap Shift twice, and it lands on the shelf with the app, window and web page it came from. You can also keep screenshots, sketches, files, notes and prompts. Each item can be checked off, copied back into another app, or dragged out.

It is the third Inset prototype. [Inset Context Pin](https://github.com/levinbaenninger/inset-pin) tests one pinned thought per capture in a popover. Inset Shelf tests a running list that you build up while you work.

**[Read the docs](https://inset-shelf.levexis.workers.dev/docs)** for everything the app does.

## Install

Download a build from the [latest release](https://github.com/levinbaenninger/inset-shelf/releases/latest): a `.dmg` for macOS (Apple silicon or Intel), an installer or a portable `.zip` for Windows 11. Install once, then the app updates itself.

The builds are not signed with a developer certificate, so macOS and Windows each warn once. [Install](https://inset-shelf.levexis.workers.dev/docs/install) shows how to get past the warning and which permissions the app asks for.

## Use it

| Keys | What happens |
| --- | --- |
| `⇧ ⇧` with text selected | Saves the selection with the app, window and page it came from. |
| `⇧ ⇧` again while the notice shows | Opens a one-line field to say why it matters. `Return` saves it. |
| `⇧ ⇧` with nothing selected | Shows or hides the shelf. |
| `⌃⌥S` (`Ctrl+Alt+S` on Windows) | Shows the shelf, or hides it when it is in front. |

In the shelf, type a note and press `Return`. Take a screenshot and a card offers to add it. Select an item to read all of it, click its words to edit them, and press `→` for its details: a description, next steps, a due date, linked windows and up to 12 attachments. When you come back to a window that open items came from, a small pill says so.

`⌘/` (`Ctrl+/` on Windows) lists every key. The shelf is stored in `shelf.json`, with its pictures and files beside it, in `~/Library/Application Support/Inset Shelf` on macOS and `%APPDATA%\Inset Shelf` on Windows.

## Develop

One pnpm workspace, run with [Vite+](https://viteplus.dev) (`vp`), which also provides Node and pnpm:

- `apps/desktop`: the Electron app.
- `apps/web`: the landing page and the docs.
- `packages/ui`: the button, `cn` and the theme both apps import.

```sh
vp install
cd apps/desktop
vp run dev
```

| Command | Where | What it does |
| --- | --- | --- |
| `vp check` | root | Checks formatting and lints. `--fix` applies safe fixes. |
| `vp run typecheck` | root | Type-checks every package. |
| `vp test` | root | Runs the Vitest suite. |
| `vp run build` | root | Builds the app and the site. |
| `vp run screens` | `apps/desktop` | Renders every window in its main states, light and dark, to `release/screens/`, and fails a scene that overflows. |
| `vp run package:mac`, `package:win` | `apps/desktop` | Builds installers into `release/`. |
| `node scripts/e2e/verify-macos.ts dev` | `apps/desktop` | Drives the real app on macOS with real keys, clicks and the clipboard. Add a trial's name to run only that one. |

The macOS check takes over the mouse and keyboard for a few minutes and overwrites the clipboard. The terminal needs Accessibility access, and the app under test needs Screen Recording.

## Release

A push to `main` publishes a release through `.github/workflows/release.yml` and marks it **Latest**. Its version is `<major>.<minor>.<run number>`, with major and minor from `version` in `apps/desktop/package.json`. Installed apps update from that release.

To cut a versioned release, set `version`, merge to `main`, then push a matching tag such as `v0.2.0`.

The macOS job signs with the shared certificate from the `MAC_SIGNING_P12_BASE64` and `MAC_SIGNING_P12_PASSWORD` secrets. CI and local builds without that certificate sign ad hoc.
