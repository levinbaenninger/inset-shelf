# Inset Shelf security review

Date: 2026-11-27 · Scope: `apps/desktop` (Electron app), `.github` (build and release), `apps/web` (site).

Why: colleagues testing the app were uneasy about the access it asks for and about installing an external app that updates itself. This review lists what the app can reach, what is already sound, what is weak, and what changes in this branch.

## What the app can reach

| Access | Why it's used | Asked for |
| --- | --- | --- |
| Accessibility (macOS) | Double Shift: system-wide key hook (uiohook) sees every key press; synthesises Cmd+C to copy the selection; reads window titles, page URLs and file paths via the accessibility tree (JXA through `osascript`) | Onboarding |
| Screen Recording | Window links: `desktopCapturer` thumbnails of other apps' windows | Onboarding |
| Apple Events | Page address of the capture source | macOS prompt |
| Desktop / Documents folders | Screenshot cards watch the screenshot folder | macOS prompt |
| Clipboard | Reads and restores the whole clipboard around Double Shift; a JXA watcher polls it for screenshots | None (no OS gate) |
| Other apps' private data | Reads `~/.codex/session_index.jsonl` and T3 Code's SQLite (`~/.t3/userdata/*.sqlite`) to find chat titles | None |
| Login item | Optional, user setting | Settings |
| Network | Only the updater: GitHub Releases feed, checked on launch and every 4 h, downloads automatically | None |

No telemetry, analytics or crash reporting was found. All captured data stays in `userData` as plain files.

## Already sound

- Every window: `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity`, devtools off when packaged.
- Navigation, `window.open` and `<webview>` are blocked; all web permission requests are denied.
- Strict CSP on the custom `inset://` scheme; path traversal guarded on the raw URL and on the resolved path.
- IPC: typed contracts, one allowed `webContents` per contract, top-frame origin check, zod-validated input.
- Child processes use `spawn` with argument arrays (no shell); the SQLite query only interpolates a UUID-validated value.
- Links opened from items are limited to addresses already in the item; linked-window targets come from main, not a page.

## Findings

Severity: **High**: a realistic path to code running with the app's grants, or data leaving the machine. **Medium**: weakens a trust boundary or the user's control. **Low**: defence in depth. Rows marked † were added or corrected by the Gemini 4 Neon review.

| # | Severity | Finding | Fix in this branch |
| --- | --- | --- | --- |
| F1 | High | **Silent auto-update.** Checks at launch and every 4 h and downloads without asking; every push to `main` publishes a new Latest release, so every merge reaches every install. Windows builds are unsigned, so nothing but GitHub HTTPS vouches for an update. | Updates only when the user asks: no launch or timer checks, `autoDownload`/`autoInstallOnAppQuit` off; Check → Download → Restart, each a separate user action shown in the tray and app menu. No periodic-check option. † Releases publish only from `v*` tags. |
| F2 | Medium † | **Update feed override.** `INSET_UPDATE_FEED_URL` is read by the updater. Unused anywhere. | Removed. |
| F3 | High † | **Electron fuses not set.** `RunAsNode`, `NODE_OPTIONS`, `--inspect` enabled, no ASAR integrity: any local process can run the app's binary as Node and inherit its Accessibility and Screen Recording grants. | Fuses: RunAsNode, NodeOptions, NodeCliInspect off; embedded ASAR integrity and only-load-from-ASAR on; file-protocol extra privileges off. † Cookie encryption stays off (no cookies; it would add a Keychain prompt). |
| F4 | High † | **macOS hardened runtime off**: `DYLD_*` injection inherits the TCC grants. | Sign with `--options runtime` and entitlements `allow-jit`, `disable-library-validation` (needed while self-signed), `automation.apple-events`. |
| F5 | Medium | **Local files and apps launched from items.** `isPageAddress` accepts `file:` URLs (misses `X.app` without slash, † allows UNC `file:////host/share`); `openLink` passes them to `openExternal`; `reopenWindow` runs `shell.openPath` on a linked window's document (an open `.command`/`.bat` file executes) and, on Windows, on its `appPath`; `open` is called without `--`. | Note links: http(s) only. Local files are revealed in Finder/Explorer, never opened; UNC rejected; "Open file" becomes "Show in Finder/Explorer". `appPath` must be an `.app` bundle (macOS) / is only revealed (Windows); `--` added before paths. |
| F6 | Medium | **Reads other apps' private stores** (`~/.codex` session index, T3 Code's SQLite) at capture and on open, without asking. | Off by default behind a setting, explained in Settings. |
| F7 | Medium † | **Test hooks in released builds.** `INSET_E2E_LOG` appends every captured selection in plain text to any path; `INSET_USER_DATA_DIR` and `INSET_FAIL_NEXT_WRITE` also work. | Compiled out unless built with `INSET_E2E_BUILD=1`; a `package:e2e` script for the E2E run. |
| F8 | Medium | **Release supply chain.** Actions pinned by tag; `contents: write` for the whole workflow including the job running third-party code with the signing key; † `workflow_dispatch` from any branch can sign; † `pullfrog.yml` runs a floating action with `id-token: write` and many API-key secrets; no checksums; no audit. | Pin actions to SHAs, `contents: read` by default and `write` only for publishing, `persist-credentials: false`, signing only for `main`/tags, `SHA256SUMS.txt` per release, dependency audit in CI, Dependabot. |
| F9 † | Medium | **`addFiles` IPC takes any path string** from the page; main copies up to 50 × 200 MB files into the shelf and serves PNGs back. A compromised renderer can read any file the user can. | The preload resolves dropped `File` objects with `webUtils.getPathForFile`; the contract no longer takes raw paths from the page. |
| F10 † | Medium | **Clipboard secrets.** Double Shift snapshots and restores the whole clipboard, and screenshot cards run a permanent `osascript` clipboard poller (EDR-unfriendly), ignoring password-manager concealed/transient markers. | Skip and never re-broadcast items marked concealed/transient (`org.nspasteboard.ConcealedType`, `TransientType`, `ExcludeClipboardContentFromMonitorProcessing`). † Screenshot cards default **off**. |
| F11 † | Low | **Stored file names** may contain `/`, `\` or `..`; `exports.ts` joins them into a staging folder unchecked. | Schema rejects separators and dot names; containment check. |
| F12 † | Low | **Permissive app-link allowlist** (`claude://`, `codex://`, `notion://`, `t3code(-dev)://` with any path). | Exact shapes only; `t3code-dev://` only in dev. |
| F13 † | Low | **Spellcheck downloads dictionaries from Google on Windows**, contradicting "only contacts GitHub". | Spellcheck on macOS only (uses the system checker). |
| F14 | Low | **No transparency in the app** about access, storage and network. | "Privacy & permissions" in Settings; site privacy and docs updated. |
| F15 † | Low | Small gaps: no `will-redirect` / `web-contents-created` guard; keychain password passed in argv in `sign-mac.ts`; `updater.log` unbounded; site serves no security headers. | All fixed. |
| F16 | Low | **Captured data at rest is plain JSON.** | Documented: disk encryption covers it; app-level encryption would not stop malware running as the user. |
| F17 | Info | **No trusted code signing**: self-signed, un-notarized macOS; unsigned Windows. The main reason IT treats the app as untrusted; no code change fixes it. | Recommendation: Apple Developer ID + notarization (then drop `disable-library-validation`), Windows code-signing certificate (then set `publisherName`), or company MDM distribution / build from source. |
| F18 | Info | **No security policy.** | `SECURITY.md`. |

## Decisions

- The key hook stays: Double Shift is the app's core. It only acts on Shift; other keys reset the detector and are never stored. Documented in Settings and `SECURITY.md`.
- No opt-in periodic update check (Gemini): "update only when the user asks" means zero background traffic.
- Windows updates still download in-app; until the build is signed, the docs say the integrity check is the SHA-512 in GitHub's feed and point to `SHA256SUMS.txt`.

## Review log

- Gemini 4 Neon review of the analysis (2026-11-27): corrected F2, F3, F4, F5, F7 severities and scope; added F9–F13, F15 and the CI issues in F8; changed decisions on periodic checks, tag-only releases, cookie encryption and the screenshot-cards default. All accepted.
- Gemini 4 Neon review of the changes: _pending_
