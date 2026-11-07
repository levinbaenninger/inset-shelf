# Inset Shelf

Inset Shelf is a small side window that docks next to the window you are working in and keeps what you want to come back to. You can save selected text from any app, drag over part of the screen, pin a spot, draw a sketch, attach files, or write a note or a prompt for later. Each item remembers the app, window and web page it came from. It can be checked off, copied back into another app, or dragged out.

It is the third Inset prototype. [Inset Context Pin](https://github.com/levinbaenninger/inset-pin) tests one pinned thought per capture in a popover. Inset Shelf tests a running list that you build up while you work.

[IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) lists what was tested, on which system, and what is still open.

## Install a test build

Install once, then the app updates itself. Download a build from the [Releases page](https://github.com/levinbaenninger/inset-shelf/releases). The **Preview build** release holds the latest commit on `main`. Each pull request also uploads builds as workflow artifacts on its CI run.

The builds are not signed with a developer certificate, so each system warns once, at the first install.

### macOS

1. Download `inset-shelf-<version>-mac-arm64.dmg` for Apple silicon, or `-mac-x64.dmg` for an Intel Mac.
2. Open the disk image and drag **Inset Shelf** to **Applications**.
3. Open the app. macOS blocks it the first time. Open **System Settings > Privacy & Security** and click **Open Anyway**. If you prefer the terminal, run `xattr -dr com.apple.quarantine "/Applications/Inset Shelf.app"` and open the app again.
4. Grant the permissions you want:
   - **Accessibility**, for double Shift and for a browser page's address. The shelf shows **Double Shift is off** with a button that opens the right settings page. Turn on **Inset Shelf** there. The app checks again every few seconds, so it should start listening without a restart.
   - **Screen & System Audio Recording**, for the title of the window an item came from. The app never asks for it. Turn on **Inset Shelf** in that settings page (add it with **+** if it isn't listed), then quit and reopen the app.
   - **Automation**, once per browser, the first time an item is saved from Safari, Chrome, Edge, Brave, Arc or another Chromium browser. It lets the app read the address of the page in front. Firefox, Zen and apps built on web views are read through Accessibility instead and don't ask.

The app has a Dock icon, a menu bar and the Shelf mark (a rounded frame with a list in its open corner) in the menu bar's status area. **Settings…** (`⌘,`) can hide either icon.

### Updates

The app checks the **Preview build** release when it starts and every four hours, and downloads a newer build in the background. When the download is ready, it says so once, and the menu bar icon's menu and the **Inset Shelf** menu offer **Restart to Update to v…**. If you don't restart, the update installs when you quit. The menu bar icon's menu always shows the running version and **Check for Updates…**.

On macOS every build is signed with the same self-signed certificate, so the update keeps your permissions and macOS checks that the new build comes from the same signer. A build that shows version 0.1.0 has an ad-hoc signature that can't accept a signed update. Install the current build by hand once, as above, and grant the permissions again. After that it updates itself.

On Windows only the installer (`.exe`) updates itself. The portable `.zip` copies can't. To update one, download the new zip.

### Windows

1. Download `inset-shelf-<version>-win-x64.exe` for the installer, or `-win-x64.zip` to run it without installing. Use `-win-arm64.zip` on an Arm device.
2. If SmartScreen shows **Windows protected your PC**, click **More info**, then **Run anyway**.
3. Look for the Shelf mark (a rounded frame with a list in its open corner) in the notification area of the taskbar. Windows may put it behind the **^** (Show hidden icons) arrow; drag it onto the taskbar to keep it in view. Click it to show or hide the shelf, and right-click it for its menu. Starting the app again from Start shows the shelf.

The Windows build has been run on Windows 11; [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) lists what was checked. The keys added in the feedback round (`Ctrl+Shift+N` with a note field focused, `Ctrl+Shift+L`, `Ctrl+Alt+C` and the field keys) have not been tried on Windows yet. On Windows the shortcuts use `Ctrl` where the Mac uses `⌘`, and there is no menu bar: **Settings…** is in the tray icon's menu, in the shelf's top **⋯** menu and on `Ctrl+,`, and that **⋯** menu also holds **Float on Top** and **Inset Shelf Help**. Double Shift copies the selection with `Ctrl+Insert`, not `Ctrl+C`, which would stop a running program in a terminal.

## Use it

| Keys | What happens |
| --- | --- |
| `⇧ ⇧` (tap Shift twice) with text selected | Saves the selection, with the app, window and page it came from, and the links inside it. A short notice confirms it when the shelf is hidden. Your clipboard is put back as it was. |
| `⇧ ⇧` with nothing selected | Shows or hides the shelf. |
| `⌃⌥S` (`Ctrl+Alt+S` on Windows) | Shows the shelf, or hides it when it is already in front. |

The shelf opens beside the window in front, centred on its height and up to 620 points tall. When there is no room beside it, it opens inside the window's right edge. Without a window it opens at the right of the screen, centred. It floats above other windows, on every Space and over full-screen apps, until you hide it with `Esc`, the **×** at the top or the shortcut.

Inside the shelf (an empty shelf lists the ways to start):

- Jot down a note or a prompt and press `Return`. Notes are Markdown, formatted as you type: `**bold**`, `*italic*`, `` `code` ``, `- ` or `1. ` lists, `> ` quotes and links turn into their formatting at once, and pasted formatting is kept. `⇧↩` starts a new line or list item (twice leaves a list), and `⌘↩` adds the note too. Notes are still stored as Markdown, and links in them open in the browser. A single line starting with `# ` makes a section: it stays plain text, and a chip at the end of the field says **↩ New section ‘Name’** (or **Go to section** when it exists). The **+** in the note field attaches files, opens a new drawing or a new window link. You can also drop files on the shelf or paste an image.
- The list shows every section as a group, empty ones too. Click a section's name to fold it away. The dots at the right of the section names show where new items go: the filled one. Click another section's dot to send new items there. A section's **⋯**, or a right-click on its name, renames it, clears its checked items or deletes it; both ask first when items would be deleted. **New Section** in the **⋯** at the top (or a right-click on empty space), or `# Name` and `Return` in the note field, makes a section. The **View** menu and `⌘1` to `⌘9` also pick the section for new items.
- Drag an item onto another section to move it there. Dragging a text item into another app drops its words; dragging an image or file out drops the file.
- The search field (`⌘F`) narrows the list by text, title, note, description, steps, pin labels, file name, app, window title or address, and marks the words it found. `due:today`, `due:overdue`, `due:week` (overdue included), `due:any` and `due:none` filter by Due; the filter button at the end of the field picks them for you, and while you type `due:` the shelf lists the filters with what each one means (`Return` takes the first).
- Long items show two lines; select one to read all of it, with the links it holds. The line under an item says where it came from: a GitHub pull request or issue, a ChatGPT or Claude chat, a post on X or a YouTube video by name, other pages by their site and title. Click it (or press `⌘O`) to open the page, or the desktop app it came from: a ChatGPT thread, a Claude chat or project and a Notion page open right where they were; Figma, Slack and Linear come to the front. ChatGPT threads are found by their title in `~/.codex/session_index.jsonl`. On Windows, the page of a selection copied from Chrome, Edge, Firefox or an app built on Chromium is the one the browser noted with the copy, and a desktop app opens only at a chat or page it has a link for (a Claude chat, a Notion page); other items open their page.
- **Details.** Every item can also hold a **Description**, **Next steps** (a checklist), a **Due** date and **linked windows**; images and files can have a **Title**, which shows in place of the caption (the note copied with them). None of it is asked for when you capture. Up to three small badges on the item's source line show the Due chip (**Overdue · date** in red, blue when due today; dates follow your system's language), step progress, linked windows and pins. The Due chip always shows whole: in a narrow shelf the source and the other badges give way first. Selecting an item shows its description, steps you can tick and its windows (click one to reopen it). `→` (or **Details** in the open item) opens the details view: everything about the item, with one **Add** menu for the fields it doesn't have yet, and when it was added at the foot. `⌘D` adds or focuses the description, `⇧⌘S` the next steps (also inside a note: it no longer strikes text through, `~~text~~` still does) and `⇧⌘D` the Due picker (Today, Tomorrow, This weekend, Next week, Pick a date…, Clear), from the list too. **Pick a date…** opens a calendar: the arrow keys move the day, `Return` picks it and `Esc` closes it. The × in the chip clears it. In a step, `Return` adds the next one and `⌫` in an empty one removes it; Click a linked window's description (or **+ Description**) to edit it; `Return` keeps it and `Esc` puts back what it said. `⌘Z` puts back a removed step or window, or a pin's label as it was before you last edited it. `←`, the back button or `Esc` returns to the list where you left it. Edits save as you type.
- **Window links.** **File > New Window Link…** (`⇧⌘L`, or **+** in the note field) opens a picker with the open windows; pick some, in order, and they become a note named after them, which you can retitle at once. **Link Window…** in details adds windows to any item. Each window keeps its picture, app, page or file and an optional description; **Open page**, **Open file** or **Bring app forward** (**Open app** on Windows) reopens it, and **Reopen all** reopens every one. macOS needs Screen Recording for the picker.
- Each item's **⋯** button, or a right-click, opens its menu: **Copy**, **Copy with Details** (`⌥⌘C`, when it has a link or details), **Copy with Link**, **Details**, **Annotate** for an image or **Open Page** / **Open in …** for the rest, **Edit**, **Check Off**, **Move to**, the colours and **Delete**. While the menu is open, the keys it shows (`⌘C`, `⌥⌘C`, `⌘O`, `→`, `⌫`, and `⇧⌘C` for several picked items) act on the item you right-clicked, whichever entry is highlighted. `↑` and `↓` move the highlight, `Return` or `Space` choose the highlighted entry (on the **Move to** list too, which `→` opens), and other shortcuts, the menu bar's included, do nothing until the menu closes. When the menu closes, focus goes back to that item. Deleting an item doesn't ask: a notice with **Undo** appears for each one, and `⌘Z` brings back the last. The last ten deletions can be undone. A colour shows as a bar along the item's left edge. Images and files take a note under them; selecting one shows it large, and `Return` or a double-click on the note edits it.
- Double-click an image to see it large. Draw on it with the drawing tools and **Save** to replace it on the shelf. The **Pin** tool (`P`) places numbered map pins: click to drop pin 1, 2, 3…, drag one to move it, `1`–`9` select one, the arrow keys nudge it (`⇧` for 10 px; one `⌘Z` undoes a held key), `⌫` removes it and the rest renumber, and `⇧P` drops one at the pointer. Moving focus to the toolbar lets go of the selected pin. Pins stay editable beside the image; their labels are set in details. The pen moved to `B`.
- `↑` and `↓` move through the items. `Space` checks one off, `Return` edits it (or an image's or file's note), `⌘C` copies it, `⌥⌘C` copies it with its link and details (as in every Inset app), `⌘O` opens it (an image to draw on, anything else where it came from), `⌥⌘↑` and `⌥⌘↓` move it to the section above or below, and `⌫` deletes it (only from the item itself, not from a step's checkbox, a window or a button in it). `⌘Z` brings back the last deleted item. The **Item** menu in the menu bar lists these keys. `Esc` hides the shelf; while you type a note, a search or an edit, the first `Esc` clears or ends it. A note under an image or file saves as you type, so `Esc` there hides the shelf at once.
- `⌘`-click picks several items and `⇧`-click a range; `⌘A` picks every item shown, and `Esc` lets go. **Copy as List** (`⇧⌘C`, or `⌘C` with several picked) copies them as a numbered list with their links. The first image goes inside the list's formatting, so apps that paste formatting (Teams, Outlook) show the picture with the words, and apps that paste plain text (T3 Code, a terminal) get the words. A list of images alone copies the first image. With nothing picked it copies the open items of the current section. `Space`, `⌫`, **Move to** and dragging act on all picked items.
- Short notices confirm what you can't see happen: files added, items moved, lists copied, checked items cleared.
- Copying a saved selection puts it back as the app copied it, so its links and formatting paste too. Copying an image puts the image, with its pins drawn in, and its note on the clipboard. **Copy with Link**, **Copy with Details** and **Copy as List** add the description, the steps as a `- [ ]` checklist, `Due:` and the linked windows when an item has them; an item without them copies exactly as before. Copying a file puts the file itself on the clipboard. Every copy of shelf items first saves an edit you are still typing, waits until the shelf is saved to disk, and then copies the items as they were when you copied: words typed during that wait are not copied. Words you type into an item reach the app as you type, so nothing waits for you to leave the field. When the shelf can't be saved, the **Not saved to disk** notice says why in plain words (for example "The disk is full."), and each item whose changes aren't on disk says **Not saved** on its row and in its details, with **Retry** and **Discard changes**. Discard changes puts back only that item as it was last saved, without writing anything: a save still on its way is dropped, or the shelf file from before it (`shelf.json.prev`) is renamed back, so it works on a full disk too. A new capture that was never saved offers **Delete** instead. Copying an item that isn't saved copies nothing and offers **Retry**; once Retry has saved it, copy again. A copy whose changes you discard while it waits copies nothing either. Retry and copies give up after 3 seconds if the disk doesn't answer, and say so. Quitting, or restarting to update, first waits up to 3 seconds for the shelf, an edit you are still typing, and a drawing with marks. When something still isn't saved, the app stays open and the shelf asks, with the reason in plain words (the drawing's too): **Retry** saves it (the drawing too) and then quits, **Quit without saving** quits without it, and **Cancel** keeps the app running with the drawing open as it was. A drawing saved by Retry stays open until the shelf file holds it, and Retry never adds it twice. While the quit waits or asks, the drawing window is locked, and so is the drawing while its own save is on its way. Return always means Retry, Esc means Cancel, and Space presses the button that has focus. If the shelf window doesn't answer in time while it holds an edit, or it crashed or reloaded holding one, a system dialog asks instead: **Wait**, **Quit anyway** or **Cancel**. The same dialog takes over, with the same number of changes, when the shelf window crashes, reloads or stops answering while it asks. The screenshot card's **Copy** and a new drawing's **Copy and Save** carry their own picture, so they copy even then; the drawing says if it could not be saved. When the shelf file couldn't be opened at launch, nothing is saved that session (a notice says so) and copies work as usual. Drag an image or a file out of the shelf to drop it into another app.

**Screenshots**: take one as usual, and a card with it appears beside the shelf. On macOS that is a screenshot to the clipboard or to a file. On Windows it is one that Snipping Tool (`Win+Shift+S`, or `PrtScn`) or `Win+PrtScn` saves to the Screenshots folder, which Snipping Tool does unless **Automatically save screenshots** is off; a screenshot that only goes to the clipboard (`Alt+PrtScn`) shows no card. Hover it to **Copy** it or **Add to Shelf**; the corners dismiss it, keep it on screen, annotate it or save it to Downloads. Drag it into another app to drop it as a file. Unless kept, it goes away on its own after a few seconds. **Settings** turns the cards off. Screenshots saved to a file show once macOS has written them, which is after its own floating thumbnail is gone.

**File > New Drawing…** (`⌥⌘N`, or **+** in the note field) opens a drawing window with pen, line, arrow, rectangle, ellipse and text tools. The tick at the end of its toolbar (**Save**, `⌘↩`) adds the drawing to the shelf, on a dark page in the dark theme and a white one in the light theme. The copy button before it (**Copy and Save**) also puts it on the clipboard. While a drawing has unsaved marks, **New Drawing…** and opening another image bring it to the front instead of replacing it, and it says so. Closing it with marks asks first, and says whether the shelf already has the drawing.

**Keyboard Shortcuts** (`⌘/`, `Ctrl+/` on Windows, or **Help**, the tray menu or **⋯**) lists every key for your system.

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
| `pnpm screens` | Builds, then renders the shelf, the window-link picker and the drawing window in their main states, light and dark, in Playwright's Chromium with a fake preload bridge and sample data. Writes PNGs to `release/screens/` and fails a scene that overflows at 360×620 or whose check fails (the `#` section, layered `Esc`, `⌘Z` after removing a step). `SCREENS=details` renders only the scenes with that word in their name. |

To build installers on your machine, run `pnpm package:mac` on macOS or `pnpm package:win` on Windows. The files land in `release/`.

### Verify on the real macOS desktop

`scripts/e2e/verify-macos.ts` drives the real app from outside with real Shift taps, clicks and drags, and with the real clipboard. It opens its own small text app as "the app in front" and sends keys only while that app is in front.

```sh
node scripts/e2e/verify-macos.ts dev       # builds, then tests out/ with Electron
pnpm package:dir && node scripts/e2e/verify-macos.ts packaged
```

The script takes over the mouse and keyboard for about three minutes and overwrites the clipboard. At the end it puts back plain text it found there, but not images or files. The terminal needs **Accessibility** access, Xcode command line tools must be installed for `swiftc`, and the app under test needs **Screen & System Audio Recording** access. It writes every result and the event log to a temporary folder and prints the path.

## Release

`.github/workflows/release.yml` publishes builds to GitHub Releases.

A push to `main` updates the **Preview build** prerelease in place, and installed apps update from it. Each preview build gets the version `<major>.<minor>.<run number>`: the major and minor numbers come from `version` in `package.json`, the last number from the workflow's run number, so every build is newer than the one before. The new files are uploaded first, then `latest-mac.yml` and `latest.yml`, which tell the apps what is new. The update files the previous `latest*.yml` named stay for one more build, so an app that read it just before the switch can still download them. Older files are removed.

To cut a versioned release, set `version` in `package.json` (for example `0.2.0`), merge it to `main`, then push a matching tag: `git tag v0.2.0 && git push origin v0.2.0`. The tag build keeps that version as it is and publishes a separate release. Raising the minor or major number also moves the preview builds that follow to `0.2.<run number>`.

The macOS job signs with the shared certificate from the `MAC_SIGNING_P12_BASE64` and `MAC_SIGNING_P12_PASSWORD` secrets, through `scripts/import-signing-key.sh` and the `scripts/sign-mac.ts` hook, and fails without them. The CI workflow has no secrets and signs ad hoc. A local `pnpm package:mac` signs with the certificate when its keychain (`~/Library/Keychains/inset-signing.keychain-db`) is on the machine, and ad hoc otherwise.
