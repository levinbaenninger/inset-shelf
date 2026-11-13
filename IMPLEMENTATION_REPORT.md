# Implementation report

## What the prototype does

Inset Shelf is a regular app with a Dock icon, a menu bar and a status-bar icon. Its main window, the shelf, opens at launch beside the window in front and floats above other windows until it is hidden. The shelf is one list of items grouped by section: notes and prompts typed into it, text saved from a selection in another app, screenshots, pasted images, drawings and attached files. Each captured item keeps the app, window title and web page it came from, where the system lets the app read them.

- **Double Shift** with text selected copies the selection of the app in front, puts the clipboard back, and adds the text to the current section. With nothing selected it shows or hides the shelf.
- **Screenshots** taken with the system's own keys show on a card beside the shelf, to copy, keep, annotate or add to the shelf. This replaced an earlier `Control+Alt+A` area capture with its own screen overlay and pin; items captured with it still show their pin.
- **`Control+Alt+S`** shows the shelf, or hides it when it is in front.
- **File > New Drawing…** opens a drawing window whose result is saved as an image item.
- **Settings…** sets Open at Login, where the app's icon shows, and whether copying an item checks it off.
- A small **setup window** opens on macOS's first run, in place of the shelf. It has three pages, Welcome, **Allow access** and Done, with **Back** on each page after Welcome, one dot per page, and **Not now**.
  - Allow access shows both permissions on one page and leaves out what is already granted.
  - Done hands over to the shelf: **Start Using Inset Shelf**, or **Show Me Around**.
  - **Set Up Permissions…** in the app menu and the tray menu opens it at Allow access. So do the shelf's **Double Shift is off** banner and the window-link picker's Screen Recording state, with their permission picked out.
  - On Windows it only writes the first-run flag.
- The **in-app tutorial** teaches the shelf in the shelf, on macOS and Windows:
  - A **Getting started** checklist of five tasks ticks itself off as the user really does them.
  - **One-time tips** appear beside real controls the first time they show: the window-link picker, a screenshot card, a new drawing, and the Add menu in details.
  - **Show Me Around** is a spotlight walkthrough of six steps.
  - The first run adds four **example items**, each a thing to try.
  - **Help > Getting Started** and **Help > Show Me Around** bring them back. So does the tray menu, which also covers the menu-bar-only mode without a Help menu, and the shelf's **⋯** on Windows. **Settings > Tips** has **Show tips** and **Reset Tutorial**.

## Architecture in brief

- The main process owns the shelf document. The window sends validated operations, and a pure function, `applyOp` in `src/shared/shelf.ts`, applies them. The same function is unit-tested.
- The document is one JSON file, written to a temporary file, synced, and renamed into place. While one write runs, later saves collapse into one write of the newest document. Note edits are written after a 400 ms pause; everything else is written at once. Images are separate PNG files, and a deleted image's file is removed only after the document without it has been saved. Files no item names are deleted at launch.
- `uiohook-napi` 1.5.5 watches the keyboard and sends the synthetic `⌘C`. A pure state machine, `stepTap` in `src/shared/double-tap.ts`, decides what counts as a double tap. The native module is unpacked from the asar in the packaged app.
- The clipboard is read and restored item by item, with every format Electron reports, including macOS's own pasteboard types. It is cleared before the copy, so "nothing was copied" is told apart from "the selection equals what was on the clipboard".
- `get-windows` 9.3.0 reads the window in front before the shelf takes focus: its bounds for docking, and its app, title and page address for the item's source. It is called only with the permissions that are already granted, so it never prompts on its own. Addresses other than http and https are dropped.
- Attachments are stored as `<uuid>.<ext>` files. Image items stay PNG only, and the `inset://attachment` URLs serve only PNGs. Version 1 documents are migrated to version 2, which adds the source, the colour tag and file items.
- Two kits are meant to be copied into Inset Pin and Inset Window Links. Each is app-agnostic, driven by plain data and tested like the rest:
  - **Permission onboarding.** `src/main/permissions/` holds the checks, pane links, system prompts, bundle path and drag tile, the shared poll, the safe relaunch, the three-page state machine and `onboarding.json`. `src/renderer/onboarding/` holds the page and `src/shared/onboarding.ts` the view types.
  - **In-app tutorial.** `src/main/tutorial/` holds the state: tasks done, hints seen, the one-bubble queue across windows, the walkthrough flag, examples and tips, kept in `tutorial.json`. `src/renderer/tutorial/` holds the checklist, the bubble, the hint layer, the spotlight, anchor lookup and bubble placement. `src/shared/tutorial.ts` holds the data types and the validated page actions. Real controls are marked `data-coach="<id>"`.
  - Neither main-process half imports Electron or the rest of the app; both reach them through injected callbacks.
  - Inset Shelf's part:
    - `src/main/shelf-onboarding.ts` and `src/main/shelf-tutorial.ts`: its words, tasks, hints, steps and examples, with keys from the same tables as the menus.
    - `src/main/onboarding-window.ts`.
    - `src/renderer/onboarding/main.tsx`.
    - The anchors in the shelf, picker, drawing and screenshot pages.
    - The tutorial methods spread into those four contracts.
    - A block in `src/main/index.ts`.
- The renderers run with context isolation- The renderers run with context isolation and the sandbox on, and with Node integration off. IPC goes through declared contracts that check the sender and validate every input with Zod.

## Design choices under test

| Choice | Value | Where |
| --- | --- | --- |
| Double tap | Two presses of Shift alone, each at most 250 ms, released at most 400 ms apart. Either Shift key counts. | `TAP_MAX_MS`, `GAP_MAX_MS` |
| Double Shift with nothing selected | Shows or hides the shelf. Inside the shelf it only hides it. | `onDoubleTap` in `src/main/index.ts` |
| Selection capture on Windows | Sends `Ctrl+Insert`, not `Ctrl+C`, which would stop a program running in a terminal. Not on Linux. | `copy` in `src/main/key-monitor.ts`, `selectionCapture` |
| Shortcuts | `Control+Alt+S` for the shelf. Control+Option leaves the macOS input-source keys alone. | `src/shared/shortcut.ts` |
| Shelf window | 340 DIP wide. Beside the right edge of the window in front, else its left edge, else inside its right edge, centred on the window's height. Its height follows the window between 360 and 620 DIP. Without a window, at the right of the screen, centred. Floating level, all Spaces and full-screen apps, never hidden on blur. | `src/main/shelf-window.ts`, `dockShelf` |
| App identity | A regular app with a Dock icon and a menu bar of File, Edit, View, Window and Help. Settings can drop the Dock icon, which makes the app an accessory without its own menu bar, or drop the status-bar icon. | `src/main/app-menu.ts`, `placeIcon` |
| Item order | Oldest first, new items at the bottom next to the note field | `applyOp` |
| Items in the list | One bordered card per item, with a round checkbox and a **⋯** menu. Images and drawings show a thumbnail. | `src/renderer/shelf/item-row.tsx` |
| Item actions | A menu drawn in the shelf: Copy, Copy with Link, View and Annotate… (images), Edit, Mark as Done, Move to (listed inline, the window is too narrow for a submenu), a row of colour swatches, Delete. The **+** menu opens above the note field. | `itemMenu` in `src/shared/menus.ts`, `src/renderer/shelf/menus.tsx` |
| Undo | The last deletion only, with `⌘Z` or the undo bar | `applyOp`, `undoRemove` |
| Copying an image | The PNG with the pin drawn in, plus the note as text | `copyItem` in `src/main/index.ts` |
| Copying a file | A named copy of the file as a file URL, plus its name as text | same |
| Copy as List | Picked items, else the section's open items, as a numbered list with links (text and HTML). The first image is inside the HTML, not a separate image on the clipboard: apps that take an image file paste it in place of the words (T3 Code), and apps that paste HTML ignore a separate image (Teams). A list of images alone copies the first image. | `itemsAsList`, `listHtmlWithImage`, `copyList` |
| Setup window | 460 DIP wide, as tall as its page (`fitHeight`). Allow access floats one level above the shelf, on every Space and over full-screen apps. **Allow** shows macOS's prompt (`isTrustedAccessibilityClient(true)`, or a 1 × 1 `desktopCapturer` grab for Screen Recording) and opens the exact pane, twice in case System Settings starts cold. The window then moves to the right edge of the work area and shows without taking focus. In development, outside a bundle, for Electron.app and for a translocated copy, it has no drag tile. | `src/main/permissions/`, `src/main/onboarding-window.ts` |
| Accessibility poll | One poll, every 3 s until Double Shift is listening and every 500 ms while the onboarding shows the Accessibility row. The row turns green, and 0.7 s later the flow moves on. | `createPoller`, `ADVANCE_MS` |
| Screen Recording reopen | `getMediaAccessStatus` keeps its launch value, so the row offers **Reopen to finish**. That quits through the quit hold, and `app.relaunch()` runs only at the real exit of that quit. A cancelled quit disarms it, and a plain Quit that replaces it doesn't relaunch. The step is saved before the quit, so the app comes back on it, shows it as allowed and moves on. | `createSafeRelaunch`, `reopen` |
| Tutorial bubbles | One bubble at a time across every window, granted by main to the page whose control is on screen, never while the walkthrough runs or a menu, dialog or drag is open. A hidden window lets go of its bubble. A tip is seen once drawn and never comes back; `Esc`, a click elsewhere or using the control puts it away. The walkthrough skips a step whose control isn't on screen and takes every key while it runs. Bubbles and the dimmer animate only without reduced motion. | `src/main/tutorial/`, `src/renderer/tutorial/` |
| Tutorial tasks | Ticked off where the app does the thing: a selection saved with double Shift, a screenshot added from its card, a drawing saved, windows linked, an item checked off or copied. Clicking a task only shows how. | `SHELF_TASK_IDS` in `src/main/index.ts` |
| Deferred screenshot watcher | The screenshot cards start once the setup window is done or skipped, so macOS's Desktop and Documents folder prompts don't come first. | `startScreenshots` |
| Screenshot card | A new screenshot shows on a card beside the shelf. macOS: an image-only clipboard, or a file macOS marks as a screen capture. Windows: a new image in the Screenshots folder (its known-folder entry, else `Pictures\Screenshots`), read once it decodes; the card takes clicks without taking the keyboard (`focusable: false`). | `src/main/screenshot-watcher.ts`, `src/main/screenshot-window.ts` |
| Drawing export | Trimmed to the marks with 24 px of padding, on white, at twice its size | `src/renderer/drawing/sketch.ts` |
| Annotating an image | Opens in the drawing window at up to its own size. The marks are drawn into the image at its pixel size and replace it; the pin, note and source stay. | `exportAnnotated`, `replaceImage` |
| Windows window chrome | The app menu holds the shortcuts but is never shown. The shelf's window is transparent and the page draws an 18 px rounded panel, concentric with the fields 8 px inside it (Windows rounds real windows by 8 px at most); it has no system shadow. Settings and the drawing window have no title bar, only the caption buttons over the page's header, which names the window at its left. Hiding a window hands the keyboard to the window below, or back to the shelf. A floating window that has the keyboard back after Snipping Tool's overlay is put back in the topmost band. The shelf's **⋯** holds Float on Top and Help. A click on the tray icon shows or hides the shelf at the right of the screen; a right-click opens its menu. | `appMenuTemplate`, `captionButtons`, `hideWindow`, `keepOnTop`, `shelfMenu`, `styles.css` |
| Dialogs | Discarding a drawing asks in the page (an alert dialog in the app's theme). On Windows About is a line in Settings. The file picker and the start-up error stay native. | `drawing-app.tsx`, `settings-app.tsx` |

## What was tested

### Test system

- macOS 27.0.1 (build 26A434) on Apple silicon (arm64), Electron 45.0.0.
- Earlier runs used an external Dell U3425WE at 3440 × 1440, scale 1, as the main display. The last run used the built-in Retina display at scale 2 alone.
- Every run was started from a terminal host that already had Accessibility and Screen Recording access.

### Key monitor spike

Before the app existed, a throwaway Electron script tested `uiohook-napi` with real input events and a small native test app:

- Double Shift was detected with left and with right Shift. Typing capitals, Shift with an arrow to extend a selection, a held Shift, and taps 600 ms apart were not counted.
- The synthetic `⌘C` copied the selection from a native AppKit text view and from a Chromium page in a second Electron process. The copy took about 70 to 90 ms in single observations.
- The clipboard came back as it was: plain text, and a PNG with its TIFF companion.
- With nothing selected, nothing was copied, and the clipboard was still restored.
- AppleScript's `key down shift` posts no modifier event, so the hook never sees it. The test therefore posts real flag-change events from a Swift helper.

### Automated tests

`pnpm test` runs 590 Vitest tests in 52 files:

- The double-tap state machine, including capitals, held keys, both Shift keys at once and a triple tap.
- Every shelf operation, sections, moving and colouring items, undo, clearing checked items, grouping and search, the list export, the v1 to v2 migration, and that each result is a valid document.
- The store with a real temporary folder: coalesced writes, no leftover temporary files, an unreadable file set aside, a failed write that keeps the old file, and attachment cleanup.
- The controller's write timing, deleting a file only after the document without it is saved, and how a failed save is shown.
- Docking the shelf beside, before or inside the window in front.
- The drawing model: undo history, arrowheads, bounds of each mark and the export trim.
- Settings with missing, unknown or damaged values, and the settings file.
- Selection capture against a fake clipboard, docking geometry, URL parsing, the IPC kit, the app, tray and item menus, colour swatches, added-file checks, export file names and drawing the pin into an exported image.
- The permission kit, with fake `systemPreferences`, `shell`, `desktopCapturer`, clock, store and quit path. The tests cover:
  - The flow is Welcome, Allow access and Done. Allow access is left out when nothing is missing, and Back goes a page back.
  - Allow picks out its row. The page comes to Done a beat after the last permission turns green.
  - The first run shows Welcome. An install from before the flow and every Windows launch only write the flag.
  - A quit resumes the flow where it was.
  - After the Screen Recording reopen, the app lands on that step, shows it as allowed and moves on 0.7 s later.
  - A cancelled reopen never relaunches, not even at a later quit, and neither does a plain Quit that replaces it.
  - The poll checks at once, runs at 3 s or 500 ms with a single timer, and stops and starts again.
  - The pane links, the macOS 27 list name, the bundle path (helpers, Electron.app, App Translocation) and the drag tile.
  - A flow opened again from the menu comes back at the next launch only from Allow access.
- The tutorial kit, with a fake store, examples and windows. The tests cover:
  - Tasks tick off only through `complete`, and stay done across restarts.
  - The checklist says once that everything is done, then stays away, and Getting Started brings it back.
  - One bubble shows at a time, across pages, and a tip drawn once never comes back.
  - A window hidden before its bubble was drawn lets go of it, so it blocks no other.
  - Hints are refused for a hidden window, for another page, while the walkthrough runs, and with tips off.
  - A task's how-to points at its control or its row, and doing the task takes it and its hint away.
  - Examples are added on the very first run only, never after they are removed, after an earlier install or after a damaged file. One deleted by hand stops being tagged.
  - Reset starts the checklist and hints over and keeps the examples.
  - The walkthrough's step resolver skips steps without an anchor, and bubble placement goes below, above or inside an anchor, inside the window.
  - Inset Shelf's data uses only real keys (macOS and Windows) and only anchors the pages mark, and its hints tie to tasks it has.

### Setup window and tutorial

- `pnpm screens` renders the setup window and the tutorial in light and dark. 224 screenshots in the whole run, all passing.
  - **Setup window:**
    - Every page, sized to its content.
    - Welcome and Done are no taller than 300 px, and the dots read "Step n of 3", or "Step 2 of 2" with nothing missing.
    - Allow sends `allow` and Back sends `back`.
    - Waiting shows the drag tile and stops its pulse under reduced motion. Reopen to finish shows too.
    - Show Me Around sends `finish("showAround")`.
    - `←` and `Return` move through the pages, and `→` and `⇧←` do nothing on Done.
  - **Tutorial:**
    - The checklist at 0 of 5 with the four tagged examples, also at the narrowest shelf (300 px, layout-checked).
    - 3 of 5, where clicking a task sends only `taskHint`.
    - A task's how-to bubble at **+**.
    - Done.
    - The picker's tip, which reports `hintShown`.
    - The picker asking for its tip once its first window shows.
    - Details asking for the Add tip, then showing it.
    - Walkthrough steps 1 and 2. With an item picked, Space, ⌫ and ↓ during the walkthrough send nothing to the shelf and keep the pick; Space presses the bubble's focused Next. After it, Space checks the item off, so the check can fail.
    - Focus on the bubble's Next at steps 1 and 2, although the note field takes focus as the page loads. This check failed before the fix.
    - The shelf opening on the checklist whichever of the shelf and the tutorial loads first, on a list long enough to scroll. The tutorial-first order failed before the fix, 228 px down the list.
- The built app ran on macOS 27.2 with an empty data folder, driven by Playwright's Electron mode.
  - The setup window opened alone at 460 × 236.
  - Both permissions were inherited from the host, so **Get Started** went straight to Done.
  - **Show Me Around** closed it, brought up the shelf and started the walkthrough at "1 of 6". `Esc` ended it.
  - The checklist showed 0 of 5, and the four examples were on the shelf and in `tutorial.json`.
  - A first **New Drawing** showed the Pin tip at the Pin tool, recorded as seen.
  - **Remove Examples** deleted all four.
- Earlier runs of the same permission code, before the three-page layout, showed:
  - The window floats on every Space at Allow access and not on the other pages.
  - A saved Allow access with Screen Recording granted moves on by itself.
  - **Reopen to finish** quits through the quit hold, and `app.relaunch()` starts a second instance that comes back on the page.
  - **Edit > Copy** routes to the setup window when it is in front.
- `pnpm package:dir` built `release/mac-arm64/Inset Shelf.app`, signed with the shared identity. The bundle-path helper, run on its executable, returned the `.app`.

### Real desktop runs

`scripts/e2e/verify-macos.ts` passed 35 of 35 checks against the dev build and again against the packaged, ad-hoc signed `Inset Shelf.app`. The run covers:

- Launch opens the shelf, the app has a regular menu bar, and double Shift is listening.
- The shelf docks beside the test app's window, at its top. When another app comes to the front, the shelf stays on screen at window layer 3, above the other app's layer 0.
- In the note field, `Return` adds a typed note and `# Prompts` makes that section active.
- Double Shift saves the selected text of the test app with its app and window title, and the clipboard holds the test's own text again afterwards. Right Shift works the same way.
- Typing capitals is not taken for a double Shift. With nothing selected, double Shift toggles the shelf and adds nothing.
- Search narrows the list, and **Edit > Copy** puts the selected item on the clipboard.
- **File > New Drawing…** opens the editor above the shelf; a stroke and `⌘↩` save it as a drawing item and close the editor.
- **Settings…** opens above the shelf, and `⌘W` closes it while the shelf stays open.
- Quitting from the tray exits, and the items are there after a restart.
- With a write failure forced, the shelf shows **Not saved to disk**, keeps the new item on screen, and leaves the file as it was.

Some things were checked by hand against a test data folder: switching the icon to the menu bar only (the app becomes a UI element without a Dock icon) and back to the Dock only (the status-bar icon goes away), that toggling **Mark as done when copied** writes `settings.json`, that `⌘Z` in the drawing undoes one mark, that drawn text keeps its position when committed and in the exported PNG, and that closing a drawing with marks asks first. In Menu Bar Only mode, typing into the note field and `⌘C` still reached the shelf. A file copied in Finder pasted into the shelf as a file item, and copying that item put a file URL on the clipboard.

Getting the suite stable took three changes to the test itself, not the app. Chromium's accessibility tree is now enabled once per launch, because setting it again rebuilds the tree. The test clicks the last matching button, which is in view. It retries reads while the tree fills in after a restart.

Screenshots of the real shelf and the capture notice were checked by eye on the external display. The light theme and the banners were checked in a browser preview with a stubbed bridge, because the test Mac was in dark mode.

### Windows run

The packaged `win-unpacked` build ran on Windows 11 Enterprise (26100), with a Swiss German keyboard, dark mode, 100% scaling and two to three displays. It was driven with real keyboard and mouse input from a small Win32 helper and inspected through Playwright. What was checked:

- Double Shift (by hand and injected), `Ctrl+Alt+S` and `Esc` show and hide the shelf. Hiding hands the keyboard back to the app in front; closing Settings or a drawing hands it back to the shelf.
- Double Shift over a selection, which sends `Ctrl+Insert`: a paragraph in Chrome and a line selected in Windows Terminal were saved with their app and window title, and the clipboard came back with the same text and formats. With nothing selected the shelf showed, and a `ping -t` in Windows Terminal kept running. With the shelf hidden, the notice appeared.
- Docking: a 7 px visible gap beside a window (Windows reports an invisible 7 px border), inside the right edge of a maximized window with 8 px at the top and right, and back beside the last window after a capture or a drawing.
- `Ctrl+C`, `Ctrl+Z` after a delete, `Ctrl+F`, `Ctrl+1`/`Ctrl+2`, `Ctrl+Shift+C`, `Ctrl+,`, `Ctrl+W` and `Ctrl+Alt+N`. `Ctrl+R` no longer reloads the page. `Ctrl+Z` and `Ctrl+C` in a text field still act on the text, once. AltGr types `#@€`.
- The pin is RGB(0, 132, 209) in an image pasted into Windows, and the colour swatches show the right colours.
- Copying a file puts a file drop list on the clipboard; it pasted into an Explorer folder. Files and images dragged out to Explorer and a PNG dropped in from Explorer.
- Notes on files are saved. An image opened by double-click, drawn on and saved replaced the item's image, deleted the old file and kept the pin.
- The in-shelf menus, Settings (caption button only, no Dock choice, About line; before the parity pass below), the drawing window's caption buttons and in-page discard dialog, undo and redo in a drawing (`Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`, one step each, on a QWERTZ layout), annotating a 2× drawing and a capture shown at 0.78 scale (arrow and text land where drawn, at the image's own size), the file dialog opening above the shelf, the white tray icon in the hidden-icons flyout, a second launch showing the shelf, Open at Login writing and removing its `Run` entry, Exit from the tray, and the items surviving a restart.

### Windows parity pass

A later pass compared the Windows build with the macOS behaviour. It ran the built app (`out/`, Electron 45) on the same Windows 11 machine with three displays at 100% scaling, against a separate data folder. It drove the app with real input from a SendInput helper, over DevTools, and through the main process's inspector, and checked the windows in desktop screenshots. What it found and changed:

- **Page addresses.** `get-windows` reads no page address on Windows, so selections from browsers had no link, no Copy with Link and no Open Page. Chromium (Chrome, Edge, Brave and apps built on it) notes the page beside copied text in its own clipboard format, and Firefox in `text/x-moz-url-priv`. Double Shift now reads it with the copy. A paragraph selected in Chrome on a GitHub issue was saved with `https://github.com/electron/electron/issues/1`, labelled "GitHub · electron/electron #1", and Copy with Link put the text and the address on the clipboard. Firefox's format was read from one real Firefox copy, in a popup window, where it held the site's address.
- **Window titles.** Windows titles end in the app's name ("… - Google Chrome", "… — Mozilla Firefox"), which hid GitHub, ChatGPT and other sites from the source label. The name is now taken off at capture and when a label is shown.
- **Open in an app.** The item menu offered "Open in Slack" and the like on Windows, but nothing happened, because only macOS can bring an app forward by name. On Windows the entry now shows only when there is a link to open at (a Claude chat, a Notion page, a T3 Code thread); otherwise the page opens. A link is kept at capture only when Windows has an app for its scheme: here `claude:`, `codex:` and `t3code:` had one, `notion:` and `t3code-dev:` did not.
- **Screenshot cards** were macOS only. Snipping Tool (`Win+Shift+S`) puts the PNG on the clipboard and saves the same file to the Screenshots folder. The card now follows that folder. A real snip showed the card left of the shelf; **Add to Shelf** added it and the browser in front kept the keyboard. Its page was opaque behind the rounded card and is now transparent. Settings shows the switch, and the empty shelf names `Win+Shift+S`. Save to Downloads now names the file the way Windows names its own ("Screenshot 2026-10-26 120554.png"), but was not tried.
- **The shelf fell behind other windows** after Snipping Tool's overlay closed while the shelf had the keyboard. Electron then reported it as no longer on top, and setting the same level again did nothing. A WinForms topmost window kept its place, so this is Chromium's doing. The shelf, Settings and the drawing window now leave and re-enter the band once they have the keyboard back. A repeat of the overlay left the shelf topmost.
- **Commands without a menu bar.** Float on Top and Help were only in the hidden app menu. They are now in the shelf's **⋯** on Windows, and Float on Top was toggled off and on there.
- **Tray.** A click opened the menu, and its **Hide Inset Shelf** could not hide the shelf, because the open menu takes the keyboard from it. A click now shows or hides the shelf, and the menu is on a right-click. Opened from the tray or over the desktop, the shelf no longer docks to the taskbar, the hidden-icons flyout or the desktop ("Program Manager", as wide as all displays). It opens at the right of the screen under the pointer.
- **New Section from the ⋯ menu** left the name field without the keyboard, so `Esc` hid the shelf and left the field open. The menu is now non-modal like the right-click menu; the field has the keyboard and `Esc` closes it.
- **Copy as List** put the text, the HTML and the image on the clipboard side by side. Teams pasted the HTML without the image, and T3 Code pasted only the image. The image is now inside the HTML. A paste into a Chromium rich-text field showed the list and the 400 × 260 picture.
- **Smaller things.** The drawing window's centred title ran into its buttons next to the caption buttons. Its title is now at the left, and Save and Copy and Save are icon buttons at the end of the toolbar, which needs a window at least 600 wide. Settings had a shorter title strip with no rule and no title; it now has the drawing window's header, one component for both: 48 points, the title at the left (centred on macOS), the caption buttons over it and a rule below. The item menu shows `Del` for Delete, and the drawing's key is `Ctrl+Enter`.

Typecheck, lint and the Vitest suite pass, and the changed files pass the format check.

### Tutorial on Windows

The built app (`out/`) ran on Windows 11 on a fresh data folder, driven through Playwright with desktop screenshots. Every check passed:

- The first launch opened the shelf with "Getting started · 0 of 5" and four examples, with keys in their Windows forms (`Shift Shift`, `Win+Shift+S`, `Ctrl+Alt+N`, `Ctrl+Shift+L`).
- The **⋯** menu held Getting Started and Show Me Around.
- Show Me Around ran all six steps; Space on a selected item did nothing meanwhile.
- All five tasks ticked off from real actions:
  - a check-off;
  - a drawing with pins;
  - a window link;
  - a PNG saved to the Screenshots folder, then **Add to Shelf**;
  - double Shift over a line in Notepad, sent with real key presses.
- All four tips showed once each.
- The done message, Remove Examples across a relaunch, **Show tips** and **Reset Tutorial** behaved as on macOS.

The run found these problems, now fixed:

- **Screenshot tip.** It covered the card's Copy and Add to Shelf until **Got it**. It now goes away once the pointer moves onto the card.
- **Walkthrough focus.** Focus stayed on the page instead of the bubble. The bubble waited for its place hidden, and its buttons' own transition kept them hidden, and unable to take focus, for a moment after. It now waits off screen, and takes focus back from anything that grabs it while the walk runs.
- **First-launch scroll.** The shelf sometimes opened scrolled to its newest example, below the checklist. That happened when the tutorial loaded before the shelf. The shelf now opens on the checklist either way, and Getting Started scrolls back to it.
- **Window-link how-to.** It said "in order" where the picker says "in any order".
- **⋯ menu icons.** Getting Started and Show Me Around had none, so they didn't line up with the other items.
- **Dark dimmer.** The walkthrough's dimmer was barely visible in dark mode.
- **Line endings.** Two unit tests failed on a CRLF checkout, and one expected a POSIX file URL. The repo now has `.gitattributes` with LF line endings, and the tests accept either.

## What was not tested

- **Windows, partly.** The NSIS installer, the Arm64 build, SmartScreen, displays above 100% scaling (bounds from `get-windows` are converted from physical pixels, but this was not observed), and a capture on a display left of the primary. Edge was not installed, so its window titles (its name has a zero-width space; it may add a profile name and "and N more pages") are handled from what is known, not observed. Pasting a copied list into Teams itself, and opening a Claude, Notion or T3 Code link from the item menu, were not tried. Neither was a double-Shift capture in Firefox, or whether Firefox's note holds the full page address on an ordinary page. A screenshot that only goes to the clipboard (`Alt+PrtScn`, or Snipping Tool with automatic saving off) shows no card. The macOS build was not run after the parity pass, which also changed shared code: the drawing toolbar, the non-modal **⋯** menu, Copy as List (no separate image on the clipboard there either), the source labels, and the tray menu's Hide, which now goes by whether the shelf is on screen.
- **The in-shelf menus and the top gap on macOS.** The item, section and **+** menus moved from native menus into the page, and a shelf inside a full-screen window now keeps a gap from its top. Both were checked on Windows only.
- **Intel Macs.** The x64 build is produced but was not run.
- **The first-run permission grants.** Every run inherited Accessibility and Screen Recording from its host, so none of the following was observed:
  - The real **Allow** prompts.
  - A row turning green and the flow moving on.
  - The window moving beside System Settings without taking focus.
  - Whether `?Privacy_Accessibility` still opens the right pane on macOS 27, where the list is called Device Control and Data Access.
  - **Reopen to finish**, and the app coming back on the step.
  - macOS's own Quit & Reopen.
  - The **Double Shift is off** banner.
- **Dragging the tile into System Settings.** `webContents.startDrag` with the `.app` bundle as the file was never dropped into a Privacy & Security list on a real machine.
- **The tutorial's keys on a real Windows keyboard.** The Windows run sent `Ctrl+Alt+N`, `Ctrl+Shift+L` and `Ctrl+,` as Electron input events; only double Shift came from real key presses. On the Swiss German layout `Ctrl+Alt` is AltGr, which was not tried.
- **Tasks ticking off on macOS in a driven run**, apart from a check-off. A person did all five in the dev build, and `tutorial.json` recorded each one.
- **Reduced motion in the real app.** Bubbles and the dimmer animate through `motion-safe:` classes; macOS's **Reduce motion** switch was not tried.
- **`scripts/e2e/verify-macos.ts`** now writes a finished `onboarding.json` and a closed, tip-less `tutorial.json` into its data folder before launch. It was not run after these changes, so its 35 of 35 above dates from before them.
- **Re-granting after an update.** That an ad-hoc signed update needs the permissions again is expected from how macOS ties grants to signatures, not observed.
- **Other source apps.** Selection capture was tested with a native AppKit text view and a Chromium page on macOS, and with Chrome and Windows Terminal on Windows. Safari, VS Code, Cursor, Terminal, Microsoft Office, the classic Windows console and password fields were not tried. Editors that copy the whole line when nothing is selected will save that line. PowerShell's line editor binds `Ctrl+Insert` to the same whole-line copy, so a typed but unsent command would be saved; this was not tried.
- **Clipboard formats beyond text and images.** Files copied in Finder, rich text from Pages, and app-specific formats should come back through Electron's raw pasteboard types, but were not tested.
- **Dragging an image out and pasting a copied image** into a real receiving app. The clipboard was checked; a drop into another app was not.
- **Pasting an image into the note field, keyboard navigation in the list, undo and Clear Checked Items** in the real app. They were exercised only in a browser preview, or not at all.
- **Browser addresses.** Reading the page address needs the Automation consent for each browser. No browser was used in the tests, so no item with an address and no Automation prompt was observed. Saved selections from ChatGPT or another web app should carry the chat's title and address, but that was not observed either.
- **Files.** Pasting one Finder file and copying it back out were checked by hand, as above. Attaching with the file dialog, dropping files, dragging a file out, and pasting the copied file into Finder or Mail were not tried. The copied file lives in a temporary folder that is emptied when the app quits.
- **Copy and Save** in the drawing window, and **Copy with Link**, **Move to** and **Colour** in the real app.
- **Open at Login.** The switch calls the system's login item API, but it was never turned on in a test.
- **Screen readers.**

## Limitations and how they affect the experiment

- **Unsigned builds.** macOS and Windows both warn on first launch, and macOS needs **Open Anyway**. Count this as setup effort in a session, separate from capture effort.
- **Several permissions on macOS.** The first-run setup asks for Accessibility and Screen Recording, and Screen Recording takes a reopen. Automation is still asked by macOS for each browser, the first time an address is read. An updated build may need the permissions again.
- **Synthetic copy.** Double Shift works by pressing `⌘C` (`Ctrl+Insert` on Windows) for the user. That is visible to clipboard history tools, and in some editors a missing selection saves the current line.
- **Partial source identity.** An item records the app, window title and page address only when the matching permission is granted. Without Screen Recording there is no title, and without Accessibility and Automation there is no address. Native apps give no document path.
