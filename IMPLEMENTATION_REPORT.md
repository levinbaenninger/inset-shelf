# Implementation report

## What the prototype does

Inset Shelf runs as a menu-bar or tray utility with no window at launch. Its one window is a 360 × 560 DIP panel that floats above other windows until it is hidden. The panel holds a checklist of items in sections: notes and prompts typed into it, text saved from a selection in another app, screen areas, pinned spots and pasted images.

- **Double Shift** with text selected copies the selection of the app in front, puts the clipboard back, and adds the text to the current section. With nothing selected it shows or hides the shelf.
- **`Control+Alt+A`** captures the display under the pointer and shows it frozen over the whole display. A drag keeps that area. A click keeps a 480 × 300 DIP crop around the point, with a pin on it, like Inset Context Pin.
- **`Control+Alt+S`** shows the shelf, or hides it when it is in front.

The idea follows [Copper](https://shadcn.com/copper) by shadcn. Copper's public page, shadcn's posts about it on X, and Stash, a community re-creation built from Copper's demos, were the references. They describe double Shift for selections, a prompt queue that is copied with `⌘C` and checked off, `# Name` sections with an active section, attachments, local storage and focus returning to the last app when the window hides. Inset Shelf adds area capture and the pin, which none of them describe.

## Architecture in brief

- The main process owns the shelf document. The window sends validated operations, and a pure function, `applyOp` in `src/shared/shelf.ts`, applies them. The same function is unit-tested.
- The document is one JSON file, written to a temporary file, synced, and renamed into place. While one write runs, later saves collapse into one write of the newest document. Note edits are written after a 400 ms pause; everything else is written at once. Images are separate PNG files, and a deleted image's file is removed only after the document without it has been saved. Files no item names are deleted at launch.
- `uiohook-napi` 1.5.5 watches the keyboard and sends the synthetic `⌘C`. A pure state machine, `stepTap` in `src/shared/double-tap.ts`, decides what counts as a double tap. The native module is unpacked from the asar in the packaged app.
- The clipboard is read and restored item by item, with every format Electron reports, including macOS's own pasteboard types. It is cleared before the copy, so "nothing was copied" is told apart from "the selection equals what was on the clipboard".
- The renderers run with context isolation and the sandbox on, and with Node integration off. IPC goes through declared contracts that check the sender and validate every input with Zod.

## Design choices under test

| Choice | Value | Where |
| --- | --- | --- |
| Double tap | Two presses of Shift alone, each at most 250 ms, released at most 400 ms apart. Either Shift key counts. | `TAP_MAX_MS`, `GAP_MAX_MS` |
| Double Shift with nothing selected | Shows or hides the shelf. Inside the shelf it only hides it. | `onDoubleTap` in `src/main/index.ts` |
| Selection capture on Windows | Off; double Shift only shows and hides the shelf | `selectionCapture` |
| Shortcuts | `Control+Alt+S` for the shelf, `Control+Alt+A` for an area. Control+Option leaves the macOS input-source keys alone. | `src/shared/shortcut.ts` |
| Shelf window | 360 × 560 DIP at the top right of the work area. Floating level, all Spaces and full-screen apps, never hidden on blur. It reopens where it was moved. | `src/main/shelf-window.ts`, `placeShelf` |
| Click versus drag | Under 4 DIP of movement is a click and pins | `CLICK_SLOP_DIP` |
| Pinned crop | 480 × 300 DIP around the point | `DEFAULT_CROP_DIP` |
| Item order | Oldest first, new items at the bottom next to the note field | `applyOp` |
| Images in the list | A thumbnail beside the note; full width when selected | `src/renderer/shelf/item-row.tsx` |
| Saved selections | A quote bar sets them apart from typed notes | same |
| Undo | The last deletion only, with `⌘Z` or the undo bar | `applyOp`, `undoRemove` |
| Copying an image | The PNG with the pin drawn in, plus the note as text | `copyItem` in `src/main/index.ts` |

## What was tested

### Test system

- macOS 27.0.1 (build 26A434) on Apple silicon (arm64), Electron 45.0.0.
- An external Dell U3425WE at 3440 × 1440, scale 1, as the main display. The built-in display was not used in the desktop runs.
- Every run was started from a terminal host that already had Accessibility and Screen Recording access.

### Key monitor spike

Before the app existed, a throwaway Electron script tested `uiohook-napi` with real input events and a small native test app:

- Double Shift was detected with left and with right Shift. Typing capitals, Shift with an arrow to extend a selection, a held Shift, and taps 600 ms apart were not counted.
- The synthetic `⌘C` copied the selection from a native AppKit text view and from a Chromium page in a second Electron process. The copy took about 70 to 90 ms in single observations.
- The clipboard came back as it was: plain text, and a PNG with its TIFF companion.
- With nothing selected, nothing was copied, and the clipboard was still restored.
- AppleScript's `key down shift` posts no modifier event, so the hook never sees it. The test therefore posts real flag-change events from a Swift helper.

### Automated tests

`pnpm test` runs 95 Vitest tests in 13 files:

- The double-tap state machine, including capitals, held keys, both Shift keys at once and a triple tap.
- Every shelf operation, sections, undo, clearing checked items, and that each result is a valid document.
- The store with a real temporary folder: coalesced writes, no leftover temporary files, an unreadable file set aside, a failed write that keeps the old file, and attachment cleanup.
- The controller's write timing, deleting a file only after the document without it is saved, and how a failed save is shown.
- Selection capture against a fake clipboard, area and pin geometry, URL parsing, the IPC kit, the tray menu, export file names and drawing the pin into an exported image.

### Real desktop runs

`scripts/e2e/verify-macos.ts` passed 25 of 25 checks against the dev build and again against the packaged, ad-hoc signed `Inset Shelf.app`:

- Launch opens no window, and double Shift is listening.
- The tray opens the shelf. When another app comes to the front, the shelf stays on screen at window layer 3, above the other app's layer 0, and is not hidden.
- In the note field, `Return` adds a typed note and `# Prompts` makes that section active.
- Double Shift saves the selected text of the test app, and the clipboard holds the test's own text again afterwards. Right Shift works the same way.
- Typing capitals is not taken for a double Shift. With nothing selected, double Shift toggles the shelf and adds nothing.
- The area overlay covers the whole display from (0, 0), menu bar included. A drag of 480 × 300 DIP was kept as an image of 480 × 300 to 482 × 301 px at scale 1, depending on the run. A click kept a crop with the pin at its centre. `Esc` closed the overlay without adding anything.
- **Copy** put an item on the clipboard.
- Quitting from the tray exits, and the items are there after a restart.
- With a write failure forced, the shelf shows **Not saved to disk**, keeps the new item on screen, and leaves the file as it was.

Getting the suite stable took three changes to the test itself, not the app. Chromium's accessibility tree is now enabled once per launch, because setting it again rebuilds the tree. The test clicks the last matching button, which is in view. It retries reads while the tree fills in after a restart.

Screenshots of the real shelf, the area overlay and the capture notice were checked by eye on the external display. The light theme and the banners were checked in a browser preview with a stubbed bridge, because the test Mac was in dark mode.

## What was not tested

- **Windows.** CI builds it, but nobody has started it on Windows. That leaves untested the key hook, the tray, the overlay over the taskbar, and the pin's colour in copied images (the drawing assumes the BGRA byte order measured on macOS).
- **Intel Macs.** The x64 build is produced but was not run.
- **The first-run permission grants.** Every run inherited Accessibility and Screen Recording from the terminal. The **Double Shift is off** banner, the polling that starts the key hook once access is granted, and the grant prompt of a downloaded app were not observed.
- **Re-granting after an update.** That an ad-hoc signed update needs the permissions again is expected from how macOS ties grants to signatures, not observed.
- **Other source apps.** Selection capture was tested with a native AppKit text view and a Chromium page. Safari, VS Code, Cursor, Terminal, Microsoft Office and password fields were not tried. Editors that copy the whole line when nothing is selected will save that line.
- **Clipboard formats beyond text and images.** Files copied in Finder, rich text from Pages, and app-specific formats should come back through Electron's raw pasteboard types, but were not tested.
- **Several displays.** The overlay was tested on one display. On a second display it should cover the display under the pointer, but that was not observed.
- **Dragging an image out and pasting a copied image** into a real receiving app. The clipboard was checked; a drop into another app was not.
- **Pasting an image into the note field, keyboard navigation in the list, `⌘K`, undo and Clear done items** in the real app. They were exercised only in a browser preview, or not at all.
- **Screen readers.**

## Limitations and how they affect the experiment

- **Unsigned builds.** macOS and Windows both warn on first launch, and macOS needs **Open Anyway**. Count this as setup effort in a session, separate from capture effort.
- **Two permissions on macOS.** A session needs both Accessibility and Screen Recording granted before it starts, and an updated build may need them again.
- **Synthetic copy.** Double Shift works by pressing `⌘C` for the user. That is visible to clipboard history tools, and in some editors a missing selection saves the current line.
- **No source identity.** An item does not record the app, document or URL it came from. An area or a pin names only the display.
