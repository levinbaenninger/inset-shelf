# Contributing to Inset Shelf

For a bug, open an issue with the app version, operating system, and the shortest sequence that shows the problem. For a feature, describe what you were trying to do and where the current workflow fell short. Use sample text and files when sharing captures. Report suspected vulnerabilities through the [security policy](SECURITY.md).

## Run the project

Install [Vite+](https://viteplus.dev) and run `vp install` in the repository root. The workspace uses Node 24 and pnpm 12. To start the desktop app, run `vp run dev` in `apps/desktop`. To start the website, run the same command in `apps/web`. Both use the components in `packages/ui`.

## Open a pull request

1. Fork the repository, create a branch from `main`, and make your change.
2. Run the checks from the repository root.

   ```sh
   vp check
   vp run typecheck
   vp test
   vp run build
   ```

3. Open a PR against `main`. Describe the user-visible change, the commands you ran, and which platform you tried. For capture or clipboard changes, the [desktop verification instructions](README.md#verify-on-the-real-macos-desktop) describe the permissions and clipboard effects of the macOS test.
4. Before merge, bring the branch up to date with `main`, resolve review conversations, and obtain one approving review. Pushing code changes dismisses earlier approvals. CI also builds the macOS and Windows packages.

Contributions to the project's own code use the [MIT license](LICENSE). When bringing in third-party code or assets, identify their source and include their license notices. The [code of conduct](CODE_OF_CONDUCT.md) applies to issues and pull requests.
