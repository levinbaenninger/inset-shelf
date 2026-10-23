# Implementation report

## What the prototype does

Inset Shelf is a regular app with a Dock icon, a menu bar and a status-bar icon. Its main window, the shelf, opens at launch beside the window in front and floats above other windows until it is hidden. The shelf is one list of items grouped by section: notes and prompts typed into it, text saved from a selection in another app, screen areas, pinned spots, pasted images, drawings and attached files. Each captured item keeps the app, window title and web page it came from, where the system lets the app read them.

- **Double Shift** with text selected copies the selection of the app in front, puts the clipboard back, and adds the text to the current section. With nothing selected it shows or hides the shelf.
- **`Control+Alt+A`** captures the display under the pointer and shows it frozen over the whole display. A drag keeps that area. A click keeps a 480 × 300 DIP crop around the point, with a pin on it, like Inset Context Pin.
- **`Control+Alt+S`** shows the shelf, or hides it when it is in front.
- **File > New Drawing…** opens a drawing window whose result is saved as an image item.
- **Settings…** sets Open at Login, where the app's icon shows, and whether copying an item checks it off.

The idea follows [Copper](https://shadcn.com/copper) by shadcn. Copper's public page and settings, shadcn's posts about it on X, and Stash, a community re-creation built from Copper's demos, were the references. They describe double Shift for selections, a prompt queue that is copied with `⌘C` and checked off, `# Name` sections in one grouped list, search, colour tags, Copy as List, attachments, drawings, local storage and focus returning to the last app when the window hides. Inset Shelf adds area capture, the pin, and the source of each item. One video shadcn posted on X could not be opened, so it was not used.

## Architecture in brief

- The main process owns the shelf document. The window sends validated operations, and a pure function, `applyOp` in `src/shared/shelf.ts`, applies them. The same function is unit-tested.
- The document is one JSON file, written to a temporary file, synced, and renamed into place. While one write runs, later saves collapse into one write of the newest document. Note edits are written after a 400 ms pause; everything else is written at once. Images are separate PNG files, and a deleted image's file is removed only after the document without it has been saved. Files no item names are deleted at launch.
- `uiohook-napi` 1.5.5 watches the keyboard and sends the synthetic `⌘C`. A pure state machine, `stepTap` in `src/shared/double-tap.ts`, decides what counts as a double tap. The native module is unpacked from the asar in the packaged app.
- The clipboard is read and restored item by item, with every format Electron reports, including macOS's own pasteboard types. It is cleared before the copy, so "nothing was copied" is told apart from "the selection equals what was on the clipboard".
- `get-windows` 9.3.0 reads the window in front before the shelf takes focus: its bounds for docking, and its app, title and page address for the item's source. It is called only with the permissions that are already granted, so it never prompts on its own. Addresses other than http and https are dropped.
- Attachments are stored as `<uuid>.<ext>` files. Image items stay PNG only, and the `inset://attachment` URLs serve only PNGs. Version 1 documents are migrated to version 2, which adds the source, the colour tag and file items.
- The renderers run with context isolation and the sandbox on, and with Node integration off. IPC goes through declared contracts that check the sender and validate every input with Zod.

## Design choices under test

| Choice | Value | Where |
| --- | --- | --- |
| Double tap | Two presses of Shift alone, each at most 250 ms, released at most 400 ms apart. Either Shift key counts. | `TAP_MAX_MS`, `GAP_MAX_MS` |
| Double Shift with nothing selected | Shows or hides the shelf. Inside the shelf it only hides it. | `onDoubleTap` in `src/main/index.ts` |
| Selection capture on Windows | Sends `Ctrl+Insert`, not `Ctrl+C`, which would stop a program running in a terminal. Not on Linux. | `copy` in `src/main/key-monitor.ts`, `selectionCapture` |
| Shortcuts | `Control+Alt+S` for the shelf, `Control+Alt+A` for an area. Control+Option leaves the macOS input-source keys alone. | `src/shared/shortcut.ts` |
| Shelf window | 340 DIP wide. Beside the right edge of the window in front, else its left edge, else inside its right edge, at the window's top. Its height follows the window between 360 and 620 DIP. Floating level, all Spaces and full-screen apps, never hidden on blur. | `src/main/shelf-window.ts`, `dockShelf` |
| App identity | A regular app with a Dock icon and a menu bar of File, Edit, View, Window and Help. Settings can drop the Dock icon, which makes the app an accessory without its own menu bar, or drop the status-bar icon. | `src/main/app-menu.ts`, `placeIcon` |
| Click versus drag | Under 4 DIP of movement is a click and pins | `CLICK_SLOP_DIP` |
| Pinned crop | 480 × 300 DIP around the point | `DEFAULT_CROP_DIP` |
| Item order | Oldest first, new items at the bottom next to the note field | `applyOp` |
| Items in the list | One bordered card per item, with a round checkbox and a **⋯** menu. Images and drawings show a thumbnail. | `src/renderer/shelf/item-row.tsx` |
| Item actions | A menu drawn in the shelf: Copy, Copy with Link, View and Annotate… (images), Edit, Mark as Done, Move to (listed inline, the window is too narrow for a submenu), a row of colour swatches, Delete. The **+** menu opens above the note field. | `itemMenu` in `src/shared/menus.ts`, `src/renderer/shelf/menus.tsx` |
| Undo | The last deletion only, with `⌘Z` or the undo bar | `applyOp`, `undoRemove` |
| Copying an image | The PNG with the pin drawn in, plus the note as text | `copyItem` in `src/main/index.ts` |
| Copying a file | A named copy of the file as a file URL, plus its name as text | same |
| Copy Section as List | The section's open items as a Markdown list, each with its link | `itemsAsList` |
| Drawing export | Trimmed to the marks with 24 px of padding, on white, at twice its size | `src/renderer/drawing/sketch.ts` |
| Annotating an image | Opens in the drawing window at up to its own size. The marks are drawn into the image at its pixel size and replace it; the pin, note and source stay. | `exportAnnotated`, `replaceImage` |
| Windows window chrome | The app menu holds the shortcuts but is never shown. The shelf's window is transparent and the page draws an 18 px rounded panel, concentric with the fields 8 px inside it (Windows rounds real windows by 8 px at most); it has no system shadow. Settings and the drawing window have no title bar, only the caption buttons over the page's header. Hiding a window hands the keyboard to the window below, or back to the shelf. | `appMenuTemplate`, `captionButtons`, `hideWindow`, `styles.css` |
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

`pnpm test` runs 153 Vitest tests in 20 files:

- The double-tap state machine, including capitals, held keys, both Shift keys at once and a triple tap.
- Every shelf operation, sections, moving and colouring items, undo, clearing checked items, grouping and search, the list export, the v1 to v2 migration, and that each result is a valid document.
- The store with a real temporary folder: coalesced writes, no leftover temporary files, an unreadable file set aside, a failed write that keeps the old file, and attachment cleanup.
- The controller's write timing, deleting a file only after the document without it is saved, and how a failed save is shown.
- Docking the shelf beside, before or inside the window in front.
- The drawing model: undo history, arrowheads, bounds of each mark and the export trim.
- Settings with missing, unknown or damaged values, and the settings file.
- Selection capture against a fake clipboard, area and pin geometry, URL parsing, the IPC kit, the app, tray and item menus, colour swatches, added-file checks, export file names and drawing the pin into an exported image.

### Real desktop runs

`scripts/e2e/verify-macos.ts` passed 35 of 35 checks against the dev build and again against the packaged, ad-hoc signed `Inset Shelf.app`. The run covers:

- Launch opens the shelf, the app has a regular menu bar, and double Shift is listening.
- The shelf docks beside the test app's window, at its top. When another app comes to the front, the shelf stays on screen at window layer 3, above the other app's layer 0.
- In the note field, `Return` adds a typed note and `# Prompts` makes that section active.
- Double Shift saves the selected text of the test app with its app and window title, and the clipboard holds the test's own text again afterwards. Right Shift works the same way.
- Typing capitals is not taken for a double Shift. With nothing selected, double Shift toggles the shelf and adds nothing.
- The area overlay covers the whole display from (0, 0), menu bar included. A drag keeps that area, and a click keeps a crop with the pin at its centre. `Esc` closes the overlay without adding anything.
- Search narrows the list, and **Edit > Copy** puts the selected item on the clipboard.
- **File > New Drawing…** opens the editor above the shelf; a stroke and `⌘↩` save it as a drawing item and close the editor.
- **Settings…** opens above the shelf, and `⌘W` closes it while the shelf stays open.
- Quitting from the tray exits, and the items are there after a restart.
- With a write failure forced, the shelf shows **Not saved to disk**, keeps the new item on screen, and leaves the file as it was.

Some things were checked by hand against a test data folder: switching the icon to the menu bar only (the app becomes a UI element without a Dock icon) and back to the Dock only (the status-bar icon goes away), that toggling **Mark as done when copied** writes `settings.json`, that `⌘Z` in the drawing undoes one mark, that drawn text keeps its position when committed and in the exported PNG, and that closing a drawing with marks asks first. In Menu Bar Only mode, typing into the note field and `⌘C` still reached the shelf. A file copied in Finder pasted into the shelf as a file item, and copying that item put a file URL on the clipboard.

Getting the suite stable took three changes to the test itself, not the app. Chromium's accessibility tree is now enabled once per launch, because setting it again rebuilds the tree. The test clicks the last matching button, which is in view. It retries reads while the tree fills in after a restart.

Screenshots of the real shelf, the area overlay and the capture notice were checked by eye on the external display. The light theme and the banners were checked in a browser preview with a stubbed bridge, because the test Mac was in dark mode.

### Windows run

The packaged `win-unpacked` build ran on Windows 11 Enterprise (26100), with a Swiss German keyboard, dark mode, 100% scaling and two to three displays. It was driven with real keyboard and mouse input from a small Win32 helper and inspected through Playwright. What was checked:

- Double Shift (by hand and injected), `Ctrl+Alt+S` and `Esc` show and hide the shelf. Hiding hands the keyboard back to the app in front; closing Settings or a drawing hands it back to the shelf.
- Double Shift over a selection, which sends `Ctrl+Insert`: a paragraph in Chrome and a line selected in Windows Terminal were saved with their app and window title, and the clipboard came back with the same text and formats. With nothing selected the shelf showed, and a `ping -t` in Windows Terminal kept running. With the shelf hidden, the notice appeared.
- Docking: a 7 px visible gap beside a window (Windows reports an invisible 7 px border), inside the right edge of a maximized window with 8 px at the top and right, and back beside the last window after a capture or a drawing.
- `Ctrl+C`, `Ctrl+Z` after a delete, `Ctrl+F`, `Ctrl+1`/`Ctrl+2`, `Ctrl+Shift+C`, `Ctrl+,`, `Ctrl+W` and `Ctrl+Alt+N`. `Ctrl+R` no longer reloads the page. `Ctrl+Z` and `Ctrl+C` in a text field still act on the text, once. AltGr types `#@€`.
- The area overlay on the primary and the lower display, taskbar included: an exact drag crop, a 480 × 300 pin crop, `Esc` and blur cancel.
- The pin is RGB(0, 132, 209) in an image pasted into Windows, and the colour swatches show the right colours.
- Copying a file puts a file drop list on the clipboard; it pasted into an Explorer folder. Files and images dragged out to Explorer and a PNG dropped in from Explorer.
- Notes on files are saved. An image opened by double-click, drawn on and saved replaced the item's image, deleted the old file and kept the pin.
- The in-shelf menus, Settings (caption button only, no Dock choice, About line), the drawing window's caption buttons and in-page discard dialog, undo and redo in a drawing (`Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`, one step each, on a QWERTZ layout), annotating a 2× drawing and a capture shown at 0.78 scale (arrow and text land where drawn, at the image's own size), the file dialog opening above the shelf, the white tray icon in the hidden-icons flyout, a second launch showing the shelf, Open at Login writing and removing its `Run` entry, Exit from the tray, and the items surviving a restart.

## What was not tested

- **Windows, partly.** The NSIS installer, the Arm64 build, SmartScreen, displays above 100% scaling (bounds from `get-windows` are converted from physical pixels, but this was not observed), Copy with Link, and a capture on a display left of the primary.
- **The in-shelf menus and the top gap on macOS.** The item, section and **+** menus moved from native menus into the page, and a shelf inside a full-screen window now keeps a gap from its top. Both were checked on Windows only.
- **Intel Macs.** The x64 build is produced but was not run.
- **The first-run permission grants.** Every run inherited Accessibility and Screen Recording from the terminal. The **Double Shift is off** banner, the polling that starts the key hook once access is granted, and the grant prompt of a downloaded app were not observed.
- **Re-granting after an update.** That an ad-hoc signed update needs the permissions again is expected from how macOS ties grants to signatures, not observed.
- **Other source apps.** Selection capture was tested with a native AppKit text view and a Chromium page on macOS, and with Chrome and Windows Terminal on Windows. Safari, VS Code, Cursor, Terminal, Microsoft Office, the classic Windows console and password fields were not tried. Editors that copy the whole line when nothing is selected will save that line. PowerShell's line editor binds `Ctrl+Insert` to the same whole-line copy, so a typed but unsent command would be saved; this was not tried.
- **Clipboard formats beyond text and images.** Files copied in Finder, rich text from Pages, and app-specific formats should come back through Electron's raw pasteboard types, but were not tested.
- **Several displays.** The overlay was tested on one display. On a second display it should cover the display under the pointer, but that was not observed.
- **Dragging an image out and pasting a copied image** into a real receiving app. The clipboard was checked; a drop into another app was not.
- **Pasting an image into the note field, keyboard navigation in the list, undo and Clear Checked Items** in the real app. They were exercised only in a browser preview, or not at all.
- **Browser addresses.** Reading the page address needs the Automation consent for each browser. No browser was used in the tests, so no item with an address and no Automation prompt was observed. Saved selections from ChatGPT or another web app should carry the chat's title and address, but that was not observed either.
- **Files.** Pasting one Finder file and copying it back out were checked by hand, as above. Attaching with the file dialog, dropping files, dragging a file out, and pasting the copied file into Finder or Mail were not tried. The copied file lives in a temporary folder that is emptied when the app quits.
- **Copy and Save** in the drawing window, and **Copy with Link**, **Move to** and **Colour** in the real app.
- **Open at Login.** The switch calls the system's login item API, but it was never turned on in a test.
- **Screen readers.**

## Limitations and how they affect the experiment

- **Unsigned builds.** macOS and Windows both warn on first launch, and macOS needs **Open Anyway**. Count this as setup effort in a session, separate from capture effort.
- **Several permissions on macOS.** A session needs Accessibility and Screen Recording granted before it starts, plus Automation for each browser whose addresses should be kept. An updated build may need them again.
- **Synthetic copy.** Double Shift works by pressing `⌘C` (`Ctrl+Insert` on Windows) for the user. That is visible to clipboard history tools, and in some editors a missing selection saves the current line.
- **Partial source identity.** An item records the app, window title and page address only when the matching permission is granted. Without Screen Recording there is no title, and without Accessibility and Automation there is no address. Native apps give no document path.
- **Not built.** Copper's multi-select with Merge Notes, Edit in New Window, Expand, custom shortcuts and Markdown rendering were left out of this prototype.
