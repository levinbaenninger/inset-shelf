# Inset Shelf

Inset Shelf is a small side window that docks next to the window you are working in and keeps what you want to come back to. You can save selected text from any app, drag over part of the screen, pin a spot, draw a sketch, attach files, or write a note or a prompt for later. Each item remembers the app, window and web page it came from. It can be checked off, copied back into another app, or dragged out.

It is the third Inset prototype. [Inset Context Pin](https://github.com/levinbaenninger/inset-pin) tests one pinned thought per capture in a popover. Inset Shelf tests a running list that you build up while you work.

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
   - **Screen & System Audio Recording**, for the title of the window an item came from. The app never asks for it. Turn on **Inset Shelf** in that settings page (add it with **+** if it isn't listed), then quit and reopen the app.
   - **Automation**, once per browser, the first time an item is saved from Safari, Chrome, Edge, Brave, Arc or another Chromium browser. It lets the app read the address of the page in front. Firefox, Zen and apps built on web views are read through Accessibility instead and don't ask.

The app has a Dock icon, a menu bar and an Inset mark in the menu bar's status area. **Settings…** (`⌘,`) can hide either icon.

macOS ties the grants to the app's signature. These builds have an ad-hoc signature that changes with every build, so after installing a newer build you may have to turn the permissions off and on again.

### Windows

1. Download `inset-shelf-<version>-win-x64.exe` for the installer, or `-win-x64.zip` to run it without installing. Use `-win-arm64.zip` on an Arm device.
2. If SmartScreen shows **Windows protected your PC**, click **More info**, then **Run anyway**.
3. Look for the Inset mark in the notification area of the taskbar. Windows may put it behind the **^** (Show hidden icons) arrow; drag it onto the taskbar to keep it in view. Starting the app again from Start shows the shelf.

The Windows build has been run on Windows 11; [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) lists what was checked. On Windows the shortcuts use `Ctrl` where the Mac uses `⌘`, and there is no menu bar: **Settings…** is in the tray icon's menu, in the shelf's top **⋯** menu and on `Ctrl+,`. Double Shift copies the selection with `Ctrl+Insert`, not `Ctrl+C`, which would stop a running program in a terminal.

## Use it

| Keys | What happens |
| --- | --- |
| `⇧ ⇧` (tap Shift twice) with text selected | Saves the selection, with the app, window and page it came from, and the links inside it. A short notice confirms it when the shelf is hidden. Your clipboard is put back as it was. |
| `⇧ ⇧` with nothing selected | Shows or hides the shelf. |
| `⌃⌥S` (`Ctrl+Alt+S` on Windows) | Shows the shelf, or hides it when it is already in front. |

The shelf opens beside the window in front, centred on its height and up to 620 points tall. When there is no room beside it, it opens inside the window's right edge. Without a window it opens at the right of the screen, centred. It floats above other windows, on every Space and over full-screen apps, until you hide it with `Esc`, the **×** at the top or the shortcut.

Inside the shelf (an empty shelf lists the ways to start):

- Jot down a note or a prompt and press `Return`. Notes are Markdown, formatted as you type: `**bold**`, `*italic*`, `` `code` ``, `- ` or `1. ` lists, `> ` quotes and links turn into their formatting at once, and pasted formatting is kept. `⇧↩` starts a new line or list item (twice leaves a list), and `⌘↩` adds the note too. Notes are still stored as Markdown, and links in them open in the browser. A single line starting with `# ` still makes a section. The **+** in the note field attaches files or opens a new drawing. You can also drop files on the shelf or paste an image.
- The list shows every section as a group, empty ones too. Click a section's name to fold it away. The dots at the right of the section names show where new items go: the filled one. Click another section's dot to send new items there. A section's **⋯**, or a right-click on its name, renames it, clears its checked items or deletes it; both ask first when items would be deleted. **New Section** in the **⋯** at the top (or a right-click on empty space), or `# Name` and `Return` in the note field, makes a section. The **View** menu and `⌘1` to `⌘9` also pick the section for new items.
- Drag an item onto another section to move it there. Dragging a text item into another app drops its words; dragging an image or file out drops the file.
- The search field (`⌘F`) narrows the list by text, note, file name, app, window title or address.
- Long items show two lines; select one to read all of it, with the links it holds. The line under an item says where it came from: a GitHub pull request or issue, a ChatGPT or Claude chat, a post on X or a YouTube video by name, other pages by their site and title. Click it (or press `⌘O`) to open the page, or the desktop app it came from: a ChatGPT thread, a Claude chat or project and a Notion page open right where they were; Figma, Slack and Linear come to the front. ChatGPT threads are found by their title in `~/.codex/session_index.jsonl`.
- Each item's **⋯** button, or a right-click, opens its menu: **Copy**, **Copy with Link**, **Annotate** for an image or **Open Page** / **Open in …** for the rest, **Edit**, **Check Off**, **Move to**, the colours and **Delete**. Deleting an item doesn't ask: a notice with **Undo** appears for each one, and `⌘Z` brings back the last. The last ten deletions can be undone. A colour shows as a bar along the item's left edge. Images and files take a note under them; selecting one shows it large, and `Return` or a double-click on the note edits it.
- Double-click an image to see it large. Draw on it with the drawing tools and **Save** to replace it on the shelf; the pin stays where it was.
- `↑` and `↓` move through the items. `Space` checks one off, `Return` edits it (or an image's or file's note), `⌘C` copies it, `⌥⌘C` copies it with its page link, `⌘O` opens it (an image to draw on, anything else where it came from), `⌥⌘↑` and `⌥⌘↓` move it to the section above or below, and `⌫` deletes it. `⌘Z` brings back the last deleted item. The **Item** menu in the menu bar lists these keys. `Esc` hides the shelf; while you type a note, a search or an edit, the first `Esc` clears or ends it. A note under an image or file saves as you type, so `Esc` there hides the shelf at once.
- `⌘`-click picks several items and `⇧`-click a range; `⌘A` picks every item shown, and `Esc` lets go. **Copy as List** (`⇧⌘C`, or `⌘C` with several picked) copies them as a numbered list with their links, and the first image beside it, so a chat box takes both. With nothing picked it copies the open items of the current section. `Space`, `⌫`, **Move to** and dragging act on all picked items.
- Short notices confirm what you can't see happen: files added, items moved, lists copied, checked items cleared.
- Copying a saved selection puts it back as the app copied it, so its links and formatting paste too. Copying an image puts the image, with its pin drawn in, and its note on the clipboard. Copying a file puts the file itself on the clipboard. Drag an image or a file out of the shelf to drop it into another app.

**Screenshots** (macOS): take one as usual, to the clipboard or to a file, and a card with it appears beside the shelf. Hover it to **Copy** it or **Add to Shelf**; the corners dismiss it, keep it on screen, annotate it or save it to Downloads. Drag it into another app to drop it as a file. Unless kept, it goes away on its own after a few seconds. **Settings** turns the cards off. Screenshots saved to a file show once macOS has written them, which is after its own floating thumbnail is gone.

**File > New Drawing…** (`⌥⌘N`) opens a drawing window with pen, line, arrow, rectangle, ellipse and text tools. **Save** (`⌘↩`) adds the drawing to the shelf, on a dark page in the dark theme and a white one in the light theme. **Copy and Save** also puts it on the clipboard.

**Settings…** (`⌘,`, or **⋯** at the top of the shelf) turns on Open at Login, chooses whether the app's icon shows in the Dock, the menu bar or both (macOS only), and can mark items as done when they are copied.

The shelf is stored in one file, `shelf.json`, with images and files in an `attachments` folder and the settings in `settings.json` next to it:

- macOS: `~/Library/Application Support/Inset Shelf`
- Windows: `%APPDATA%\Inset Shelf`

### Things to know about double Shift

- The app copies your selection by sending `⌘C` (`Ctrl+Insert` on Windows) to the app in front, then puts the clipboard back. Clipboard history tools may still record that copy.
- An app that ignores `Ctrl+Insert` copies nothing, so double Shift only shows or hides the shelf there.
- In VS Code, Cursor and some other editors, copying with nothing selected copies the whole line. Double Shift then saves that line instead of showing the shelf.
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
