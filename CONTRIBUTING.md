# Contributing to Inset Shelf

For a bug, open an issue with the app version, operating system, and the shortest sequence that shows the problem. For a feature, describe what you were trying to do and where the current workflow fell short. Use sample text and files when sharing captures. Report suspected vulnerabilities through the [security policy](SECURITY.md).

## Run the project

Install [Vite+](https://viteplus.dev) and run `vp install` in the repository root. The workspace uses Node 24 and pnpm 12. To start the desktop app, run `vp run dev` in `apps/desktop`. To start the website, run the same command in `apps/web`. Both use the components in `packages/ui`.

## Open a pull request

Only repository collaborators can open pull requests. Anyone can [report a bug or suggest a feature](https://github.com/levinbaenninger/inset-shelf/issues/new/choose).

1. Create a branch from `main` in this repository and make your change.
2. Run the checks from the repository root.

   ```sh
   vp check
   vp run typecheck
   vp test
   vp run build
   ```

3. Open a PR against `main`. Describe the user-visible change, the commands you ran, and which platform you tried. For capture or clipboard changes, the [desktop verification instructions](#verify-on-the-real-macos-desktop) describe the permissions and clipboard effects of the macOS test.
4. Before merge, bring the branch up to date with `main`, resolve review conversations, and obtain one approving review. Pushing code changes dismisses earlier approvals. CI also builds the macOS and Windows packages.

Contributions to the project's own code use the [MIT license](LICENSE). When bringing in third-party code or assets, identify their source and include their license notices. The [code of conduct](CODE_OF_CONDUCT.md) applies to issues and pull requests.

## Test the desktop app

In `apps/desktop`, `vp run screens` builds, then renders the shelf, the window-link picker, the drawing window, the setup window and the tutorial's checklist, tips and walkthrough in their main states, light and dark, in Playwright's Chromium with a fake preload bridge and sample data. It writes PNGs to `apps/desktop/release/screens/` and fails a scene that overflows at 360×620 or whose check fails (the `#` section, layered `Esc`, `⌘Z` after removing a step). `SCREENS=details` renders only the scenes with that word in their name.

To build installers on your machine, run `vp run package:mac` on macOS or `vp run package:win` on Windows in `apps/desktop`. The files land in `apps/desktop/release/`.

### Verify on the real macOS desktop

`apps/desktop/scripts/e2e/verify-macos.ts` drives the real app from outside with real Shift taps, clicks and drags, and with the real clipboard. It opens its own small text app as "the app in front" and sends keys only while that app is in front.

```sh
cd apps/desktop
node scripts/e2e/verify-macos.ts dev       # builds, then tests out/ with Electron
vp run package:dir && node scripts/e2e/verify-macos.ts packaged
```

The script takes over the mouse and keyboard for about three minutes and overwrites the clipboard. At the end it puts back plain text it found there, but not images or files. The terminal needs **Accessibility** access, Xcode command line tools must be installed for `swiftc`, and the app under test needs **Screen & System Audio Recording** access. It writes every result and the event log to a temporary folder and prints the path.

## Release

`.github/workflows/release.yml` publishes builds to GitHub Releases.

A push to `main` publishes a release named after its version, for example `v0.1.17`, and marks it **Latest**. Each build gets the version `<major>.<minor>.<run number>`: the major and minor numbers come from `version` in `apps/desktop/package.json`, the last number from the workflow's run number, so every build is newer than the one before. The release stays a draft until every file is uploaded, so `/releases/latest` never points at a release with files missing. Installed apps read `latest-mac.yml` and `latest.yml` from `/releases/latest/download`. CI rewrites the files they name into full links to their own release, so a feed an app has read stays valid after a newer release replaces it. Each release also carries the installers as `Inset-Shelf-mac-arm64.dmg`, `Inset-Shelf-mac-x64.dmg` and `Inset-Shelf-win-x64.exe`, which `/releases/latest/download/<name>` always serves from the newest release.

Apps installed from a build before these releases still check the `preview` release, now titled **Legacy update feed**. Each push to `main` uploads the same `latest*.yml` there, so those apps update to the newest release and read the new feed from then on. The update files that the previous `latest*.yml` there named by bare name stay for one more build, so an app that read it just before the switch can still download them. Everything else there is removed.

To cut a versioned release, set `version` in `apps/desktop/package.json` (for example `0.2.0`), merge it to `main`, then push a matching tag: `git tag v0.2.0 && git push origin v0.2.0`. The tag build keeps that version as it is and publishes a separate release, which never becomes **Latest**, because `main` already built that commit as a higher `0.2.<run number>`. Raising the minor or major number also moves the `main` builds that follow to `0.2.<run number>`.

The macOS job signs with the shared certificate from the `MAC_SIGNING_P12_BASE64` and `MAC_SIGNING_P12_PASSWORD` secrets, through `apps/desktop/scripts/import-signing-key.sh` and the `apps/desktop/scripts/sign-mac.ts` hook, and fails without them. The CI workflow has no secrets and signs ad hoc. A local `vp run package:mac` signs with the certificate when its keychain (`~/Library/Keychains/inset-signing.keychain-db`) is on the machine, and ad hoc otherwise.
