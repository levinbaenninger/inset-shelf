# Security policy

## Report a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub private vulnerability reporting: open the [Security tab](https://github.com/levinbaenninger/inset-shelf/security/advisories/new) of the repository and choose **Report a vulnerability**. Include the version, your system, and the steps to reproduce. You can expect a first reply within a week. This is a prototype maintained by a small team, so there is no bug bounty.

## Supported versions

Only the latest [release](https://github.com/levinbaenninger/inset-shelf/releases/latest) receives fixes. Older versions are not patched.

## What the app can access, and why

Inset Shelf is a side window that keeps what you capture while you work. To do that it asks for broad access on your computer. The full list is in [SECURITY_REVIEW.md](SECURITY_REVIEW.md); in short:

| Access | Why it is used |
| --- | --- |
| Accessibility (macOS) | Double Shift is detected with a system-wide key hook. The app synthesises Cmd+C to copy your selection and reads window titles, page addresses and file paths of the app you are in. |
| Screen Recording (macOS) | Thumbnails of other apps' windows, for window links. |
| Apple Events (macOS) | The page address of the browser tab you captured from. |
| Desktop and Documents folders | Screenshot cards watch the screenshot folder (off by default). |
| Clipboard | Read and restored around Double Shift. Items that password managers mark as concealed or transient are skipped. |
| Other apps' data | Chat titles from `~/.codex` and T3 Code's local database, only if you turn that setting on. |
| Login item | Optional, a setting. |

About the key hook: it only acts on the Shift key. Every other key press resets the double-Shift detector and is never stored, logged or sent anywhere.

Every window runs with context isolation and the sandbox on, without Node integration. Navigation, new windows and web views are blocked, and all web permission requests are denied.

## Network use

The app contacts only GitHub Releases, and only when you choose **Check for updates**. Downloading and installing an update are separate actions you start. There is no telemetry, analytics or crash reporting. The documentation site sends no data to third parties.

## Data at rest

Captured items, screenshots and attachments are stored as plain files in the app's `userData` folder. The app does not encrypt them: encryption by the app would not protect against other software running as your user. Rely on full-disk encryption (FileVault on macOS, BitLocker on Windows) and your account's login protection.

## Verify a download

Every release carries `SHA256SUMS.txt`, with the SHA-256 of every file attached to that release. Releases are built and published by GitHub Actions only from `v*` tags.

```sh
# in the folder with the download and SHA256SUMS.txt
shasum -a 256 -c --ignore-missing SHA256SUMS.txt   # macOS
sha256sum -c --ignore-missing SHA256SUMS.txt       # Linux
```

On Windows, compare `Get-FileHash <file> -Algorithm SHA256` with the matching line.

Signing status, so you know what to expect:

- macOS builds are signed with a self-signed certificate and are not notarized, so Gatekeeper asks you to confirm the first launch.
- Windows builds are not code-signed, so SmartScreen warns on first run. Until they are signed, the integrity check for in-app Windows updates is the SHA-512 in GitHub's update feed over HTTPS. Compare against `SHA256SUMS.txt` for a manual check.

A trusted signature needs an Apple Developer ID with notarization and a Windows code-signing certificate. If your organisation requires that, distribute the app through your own MDM or build it from source.
