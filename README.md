# Inset Shelf

Inset Shelf is a small side window that docks next to the window you are working in and keeps what you want to come back to. You can save selected text from any app, drag over part of the screen, pin a spot, draw a sketch, attach files, or write a note or a prompt for later. Each item remembers the app, window and web page it came from. It can be checked off, copied back into another app, or dragged out.

It is the third Inset prototype. [Inset Context Pin](https://github.com/levinbaenninger/inset-pin) tests one pinned thought per capture in a popover. Inset Shelf tests a running list that you build up while you work. The idea follows [Copper](https://shadcn.com/copper) by shadcn, which combines a to-do list, a clipboard and a scratchpad. Inset Shelf is an independent prototype and is not affiliated with Copper.

[IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) lists what was tested, on which system, and what is still open.

## Install a test build

Download a build from the [Releases page](https://github.com/levinbaenninger/inset-shelf/releases). The **Preview build** release holds the latest commit on `main`. Each pull request also uploads builds as workflow artifacts on its CI run.

The builds are not signed with a developer certificate, so each system warns once.

### macOS

1. Download `inset-shelf-<version>-mac-arm64.dmg` for Apple silicon, or `-mac-x64.dmg` for an Intel Mac.
2. Open the disk image and drag **Inset Shelf** to **Applications**.
3. Open the app. macOS blocks it the first time. Open **System Settings > Privacy & Security** and click **Open Anyway**. If you prefer the terminal, run `xattr -dr com.apple.quarantine "/Applications/Inset Shelf.app"` and open the app again.
4. Grant the permissions you want:
   - **Accessibility**, for double Shift and for a browser page's address. The shelf shows **Double Shift is off** with a button that opens the right settings page. Turn on **Inset Shelf** there. The app checks again every few seconds, so it should start listening without a restart.
   - **Screen & System Audio Recording**, for area capture and for the title of the window an item came from. Press `⌃⌥A` once. If capture is refused, turn on **Inset Shelf** in that settings page, then quit and reopen the app.
   - **Automation**, once per browser, the first time an item is saved from it. It lets the app read the address of the page in front.

The app has a Dock icon, a menu bar and an Inset mark in the menu bar's status area. **Settings…** (`⌘,`) can hide either icon.

macOS ties the grants to the app's signature. These builds have an ad-hoc signature that changes with every build, so after installing a newer build you may have to turn the permissions off and on again.

### Windows

1. Download `inset-shelf-<version>-win-x64.exe` for the installer, or `-win-x64.zip` to run it without installing. Use `-win-arm64.zip` on an Arm device.
2. If SmartScreen shows **Windows protected your PC**, click **More info**, then **Run anyway**.
3. Look for the Inset mark in the notification area of the taskbar.

The Windows build compiles and packages in CI. Nobody has run it on Windows yet. On Windows, double Shift only shows and hides the shelf: copying the selection would send `Ctrl+C`, which stops a running program in a terminal.

## Use it

| Keys | What happens |
| --- | --- |
| `⇧ ⇧` (tap Shift twice) with text selected | Saves the selection, with the app, window and page it came from. A short notice confirms it when the shelf is hidden. Your clipboard is put back as it was. |
| `⇧ ⇧` with nothing selected | Shows or hides the shelf. |
| `⌃⌥S` (`Ctrl+Alt+S` on Windows) | Shows the shelf, or hides it when it is already in front. |
| `⌃⌥A` (`Ctrl+Alt+A`) | Freezes the screen under the pointer. Drag to keep an area, or click once to pin a spot with some context around it. `Esc` cancels. |

The shelf opens beside the window in front, at its top and up to 620 points tall. When there is no room beside it, it opens inside the window's right edge. It floats above other windows, on every Space and over full-screen apps, until you hide it.

Inside the shelf:

- Jot down a note or a prompt and press `Return`. `⇧↩` adds a line. The **+** in the note field captures an area, attaches files or opens a new drawing. You can also drop files on the shelf or paste an image.
- The list shows every section as a group. Type `# Name` and press `Return` to make a section or switch to one. New items go to the current section. The **⋯** button at the top, the **View** menu and `⌘1` to `⌘9` switch sections.
- The search field (`⌘F`) narrows the list by text, note, file name, app, window title or address.
- Each item's **⋯** button, or a right-click, opens its menu: **Copy**, **Copy with Link**, **Edit**, **Mark as Done**, **Move to**, **Colour** and **Delete**.
- `↑` and `↓` move through the items. `Space` checks one off, `Return` edits it, `⌘C` copies it, and `⌫` deletes it. `⌘Z` brings back the last deleted item. `Esc` hides the shelf.
- **Edit > Copy Section as List** (`⇧⌘C`) copies the open items of the current section as a Markdown list, with their links.
- Copying an image puts the image, with its pin drawn in, and its note on the clipboard. Copying a file puts the file itself on the clipboard. Drag an image or a file out of the shelf to drop it into another app.

**File > New Drawing…** (`⌥⌘N`) opens a drawing window with pen, line, arrow, rectangle, ellipse and text tools. **Save** (`⌘↩`) adds the drawing to the shelf. **Copy and Save** also puts it on the clipboard.

**Settings…** (`⌘,`) turns on Open at Login, chooses whether the app's icon shows in the Dock, the menu bar or both, and can mark items as done when they are copied.

The shelf is stored in one file, `shelf.json`, with images and files in an `attachments` folder and the settings in `settings.json` next to it:

- macOS: `~/Library/Application Support/Inset Shelf`
- Windows: `%APPDATA%\Inset Shelf`

### Things to know about double Shift

- The app copies your selection by sending `⌘C` to the app in front, then puts the clipboard back. Clipboard history tools may still record that copy.
- In VS Code, Cursor and some other editors, `⌘C` with nothing selected copies the whole line. Double Shift then saves that line instead of showing the shelf.
- Double Shift inside the shelf only hides it, so the shelf never saves its own text.

## Develop

You need Node 24 and pnpm 12. On a machine managed by Vite+, use its `node` and `pnpm`.

```sh
pnpm install
pnpm dev
```

| Command | What it does |
| --- | --- |
| `pnpm check` | Runs Ultracite: Oxlint with type-aware rules and the React, TanStack, Vitest, shadcn and anti-slop presets, plus an Oxfmt format check. |
| `pnpm typecheck` | Type-checks the main, preload and renderer code in strict mode. |
| `pnpm test` | Runs the Vitest suite. |
| `pnpm build` | Builds the app into `out/` with electron-vite. |
| `pnpm fix` | Formats the code and applies safe lint fixes. |

To build installers on your machine, run `pnpm package:mac` on macOS or `pnpm package:win` on Windows. The files land in `release/`.

### Verify on the real macOS desktop

`scripts/e2e/verify-macos.ts` drives the real app from outside with real Shift taps, clicks and drags, and with the real clipboard. It opens its own small text app as "the app in front" and sends keys only while that app is in front.

```sh
node scripts/e2e/verify-macos.ts dev       # builds, then tests out/ with Electron
pnpm package:dir && node scripts/e2e/verify-macos.ts packaged
```

The script takes over the mouse and keyboard for about three minutes and overwrites the clipboard. At the end it puts back plain text it found there, but not images or files. The terminal needs **Accessibility** access, Xcode command line tools must be installed for `swiftc`, and the app under test needs **Screen & System Audio Recording** access. It writes every result and the event log to a temporary folder and prints the path.

## Release

`.github/workflows/release.yml` publishes builds to GitHub Releases. It has not run yet. A push to `main` replaces the **Preview build** prerelease with fresh macOS and Windows builds. A tag such as `v0.2.0` publishes a versioned release; the tag must match `version` in `package.json`.
