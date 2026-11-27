Test build of Inset Shelf, without a developer certificate. See the README section "Install a test build" for the macOS Gatekeeper and Windows SmartScreen steps. Install once. After that, choose "Check for updates" in the app to update, except for the portable Windows zips. Verify a download against `SHA256SUMS.txt` (attached to this release) with `shasum -a 256 -c --ignore-missing SHA256SUMS.txt`. See SECURITY.md.

| Platform | File |
| --- | --- |
| macOS, Apple silicon | `Inset-Shelf-mac-arm64.dmg` |
| macOS, Intel | `Inset-Shelf-mac-x64.dmg` |
| Windows, x64 | `Inset-Shelf-win-x64.exe` (installer) or `inset-shelf-*-win-x64.zip` (portable) |
| Windows, Arm | `inset-shelf-*-win-arm64.zip` (portable) |

The installers are also attached under their versioned names, `inset-shelf-<version>-mac-arm64.dmg`, `-mac-x64.dmg` and `-win-x64.exe`.

Capture behaviour is verified only on the platforms named in IMPLEMENTATION_REPORT.md. A build for another platform is not evidence that capture works there.
