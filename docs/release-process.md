# Release Process (Technical Details)

This document explains how the automated extension release process works under the hood, in case you need to understand or modify it.

> **Related Documentation:**
> - **[Releasing (Step-by-Step Guide)](releasing.md)**: Step-by-step instructions for maintainers performing a pre-release, stable release, or patch release.
> - **[`.github/workflows/release.yml`](../.github/workflows/release.yml)**: The GitHub Actions workflow that implements the release process.
>
> **Important:** Any changes to the release workflow or process must be kept in sync across this file, [`docs/releasing.md`](releasing.md), and [`.github/workflows/release.yml`](../.github/workflows/release.yml).

---

## 1. Versioning Convention

Because the VS Code Marketplace does not support semver pre-release suffixes (such as `-dev` or `-beta`), the extensions use an **odd/even minor version** scheme:

- **`master` branch (`package.json`)**: Always sits at the next **even** minor version with a `-dev` suffix (for example, `3.148.0-dev`).
- **Pre-releases**: Always use **odd** minor versions (`minor - 1` relative to `package.json`) with the UTC date (`YYYYMMDD`) as the patch number (for example, `3.147.20261106`).
- **Stable releases**: Always use **even** minor versions (for example, `3.148.0` for a minor release, or `3.148.1` for a patch release).

When a `.0` stable release is published (such as `3.148.0`), any Marketplace users on the pre-release channel (`3.147.x`) are automatically updated to `3.148.0` because `3.148.0 > 3.147.x`. Publishing a `3.149.YYYYMMDD` pre-release immediately afterwards ensures there is always a newer pre-release than the latest stable release on the Marketplace, which keeps the **"Switch to Pre-Release Version"** button visible in VS Code.

---

## 2. Environment, Concurrency, and Trusted Publishing

Each run of [`.github/workflows/release.yml`](../.github/workflows/release.yml) publishes a single release (`pre-release` or `stable`) inside a single job (`release`) configured with:

- **GitHub Environment (`release`)**: Configured in repository settings (**Settings → Environments → `release`**) with required reviewers (`DanTup`), so the job pauses for manual approval before running. Deployment branches are unrestricted so both `master` and `patch-*` branches can deploy.
- **Concurrency group (`release`)**: Configured with `cancel-in-progress: false` so an in-progress release is never interrupted. (Note: GitHub Actions only holds one pending/waiting run per concurrency group, so queuing multiple unapproved runs will cancel older waiting runs.)
- **VS Code Marketplace Trusted Publishing (`--oidc`)**:
  - Uses `permissions: { id-token: write }` so `@vscode/vsce publish --oidc` can request a GitHub Actions OIDC token and exchange it with the Marketplace for a short-lived (15-minute) session token.
  - On the VS Code Marketplace (**Manage Publishers → `Dart-Code` → Trusted Publishing**), each repository (`Dart-Code/Dart-Code` and `Dart-Code/Flutter`) has a Trusted Publishing policy restricting token exchange to `release.yml` and the `release` environment.
  - Note that Marketplace Trusted Publishing policies are scoped to the **Publisher** (`Dart-Code`), not individual extensions. For this reason, the test repository (`Dart-Code/Test-Extension`) uses a separate Marketplace publisher (`Dart-Code-Testing`) so it cannot publish production extensions.

---

## 3. Workflow Steps (`release.yml`)

When triggered via `workflow_dispatch` and approved in the `release` environment, the `release` job executes the following steps:

1. **Checkout repository**:
   - Uses `actions/checkout@v7` with `fetch-depth: 0` and `submodules: recursive` (without overriding `ref`), which checks out the exact commit SHA (`github.sha`) recorded when the workflow run was triggered.
   - Pinning to `github.sha` guarantees that clicking **Re-run failed jobs** after a partial failure will always package and tag the exact same commit, even if new commits have landed on `master` in the meantime.
2. **Compute and validate version**:
   - For **`pre-release`**: Uses the `version` input if provided, or auto-calculates `X.(Y-1).YYYYMMDD` from `X.Y.0-dev` in `package.json`. Validates that the minor version is **odd**.
   - For **`stable`**: Requires an explicit `version` input (`X.Y.Z`) and validates that the minor version is **even**.
   - Verifies that the git tag `v<VERSION>` does not already exist.
   - For `.0` stable releases (`PATCH == 0`), computes `NEXT_DEV_VERSION` (`X.(Y+2).0-dev`).
3. **Verify Merge Queue is empty**:
   - Queries `mergeQueue(branch: $GITHUB_REF_NAME)` via the GitHub GraphQL API and aborts if any PRs are currently queued.
4. **Verify CI passed on target commit**:
   - Unless `skip_ci_check` is `true`, uses `gh run list --workflow=build-and-test.yml --commit=$TARGET_SHA` (excluding `merge_group` runs) to verify that the `Run Tests` workflow completed with `success` on the target commit.
   - For patch releases, this is why the branch name **must** match `patch-*` (so `build-and-test.yml` runs on the branch push before `release.yml` is triggered).
5. **Install, Lint, and Package VSIX**:
   - Runs `npm ci` and `npm run lint`.
   - Updates `package.json` and `package-lock.json` on disk (`npm version "$VERSION" --no-git-tag-version`).
   - Packages `<name>-<VERSION>.vsix` using `npx @vscode/vsce package` (which runs `vscode:prepublish`; passing `--pre-release` for pre-releases) and uploads the `.vsix` as a workflow run artifact.
6. **Publish to VS Code Marketplace**:
   - Runs `npx @vscode/vsce publish --oidc --skip-duplicate [--pre-release] --packagePath "$VSIX"` (or logs the command in dry-run mode if `dry_run: true`).
   - Passing `--skip-duplicate` allows the workflow job to be safely re-run if a subsequent step fails after Marketplace publication has already succeeded.
7. **Commit and push tag**:
   - Commits `Publish v<VERSION>` locally, tags `v<VERSION>`, and pushes `refs/tags/v<VERSION>` to `origin`.
   - Because `master` is protected by a Merge Queue with squash merges, `GITHUB_TOKEN` cannot push commits directly to `refs/heads/master`, but it can push tags (`refs/tags/*`). The tag permanently retains the `Publish v<VERSION>` commit (and any ancestor commits on a `patch-*` branch) in the repository.
8. **Create GitHub Release (`stable` only)**:
   - Creates GitHub Release `v<VERSION>` with the `.vsix` attached and release notes linking to the Marketplace and `dartcode.org/releases/vX-Y/`.
9. **Trigger full test suite on release tag (`stable` only)**:
   - Because tags pushed with `GITHUB_TOKEN` do not trigger `on: push: tags:` workflows automatically, explicitly dispatches `gh workflow run build-and-test.yml --ref "v$VERSION"` (which requires `actions: write` permission).
   - In `build-and-test.yml`, `workflow_dispatch` matches `no_exclude`, running the full test matrix across Linux, Windows, macOS, stable, and beta.
10. **Open PR for next `-dev` version (`.0` `stable` releases only)**:
    - Creates branch `version-bump/<NEXT_DEV_VERSION>` from `HEAD~1` (the commit on `master` prior to `Publish v<VERSION>`), updates `package.json` and `package-lock.json` to `<NEXT_DEV_VERSION>`, force-pushes the branch, and opens a PR (`Set version to <NEXT_DEV_VERSION>`) via `gh pr create` (which requires **Allow GitHub Actions to create and approve pull requests** in **Settings → Actions → General**).
    - Because GitHub treats PRs opened by `github-actions[bot]` as requiring contributor workflow approval when *"Require approval for first-time contributors"* is enabled, the `pull_request` workflow run on this PR waits in the **"Workflows awaiting approval"** state until a maintainer clicks **Approve and run** on the PR.
11. **Print retry instructions on failure**:
    - If any step after `Publish to VS Code Marketplace` fails (`if: failure() && steps.publish.outcome == 'success'`), emits a warning reminding the maintainer that `vsce publish` uses `--skip-duplicate`, so the job can be safely re-run (after deleting any partial GitHub Release or tag if already created).
