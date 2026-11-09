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

Each run of [`.github/workflows/release.yml`](../.github/workflows/release.yml) publishes a single release (`pre-release` or `stable`) configured with:

- **GitHub Environment (`release`)**: Configured in repository settings (**Settings → Environments → `release`**) with required reviewers (`DanTup`), so the job pauses for manual approval before running. Deployment branches are unrestricted so both `master` and `patch-*` branches can deploy.
- **Concurrency group (`release`)**: Configured not to cancel in-progress runs so an active release is never interrupted. (Note: GitHub Actions only holds one waiting run per concurrency group, so queuing multiple unapproved runs will cancel older waiting runs.)
- **VS Code Marketplace Trusted Publishing (OIDC)**:
  - The workflow uses GitHub Actions OIDC to exchange a short-lived token with the VS Code Marketplace, avoiding the need to store a long-lived Personal Access Token.
  - On the VS Code Marketplace (**Manage Publishers → `Dart-Code` → Trusted Publishing**), each repository (`Dart-Code/Dart-Code` and `Dart-Code/Flutter`) has a Trusted Publishing policy restricting token exchange to `release.yml` and the `release` environment.
  - Note that Marketplace Trusted Publishing policies are scoped to the **Publisher** (`Dart-Code`), not individual extensions. For this reason, the test repository (`Dart-Code/Test-Extension`) uses a separate Marketplace publisher (`Dart-Code-Testing`) so it cannot publish production extensions.
- **Open VSX Trusted Publishing (OIDC)**:
  - The workflow also uses GitHub Actions OIDC to exchange a short-lived token with the [Open VSX Registry](https://open-vsx.org/) (`ovsx publish --trusted-publishing`), avoiding the need to store a long-lived Personal Access Token.
  - On Open VSX (**Settings → Trusted Publishers** under the `Dart-Code` namespace), each extension (`dart-code` and `flutter`) has a Trusted Publisher policy restricting token exchange to its corresponding repository (`Dart-Code/Dart-Code` or `Dart-Code/Flutter`), workflow (`release.yml`), and environment (`release`).

---

## 3. Workflow Steps (`release.yml`)

When triggered manually and approved in the `release` environment, the workflow performs the following steps in order:

1. **Checkout the target commit**:
   - Checks out the commit that was at the tip of the selected branch when the workflow was triggered (including submodules and full history/tags), rather than the latest branch head at checkout time.
   - This ensures that re-running a failed job always packages and tags the exact same commit, even if new commits have landed on the branch in the meantime.
2. **Compute and validate the release version**:
   - **Pre-releases**: Uses the explicit version input if provided; otherwise derives `X.(Y-1).YYYYMMDD` from `X.Y.0-dev` in `package.json`. Enforces that the minor version is **odd**.
   - **Stable releases**: Requires an explicit `X.Y.Z` version input and enforces that the minor version is **even**.
   - Verifies that the release tag (`vX.Y.Z`) does not already exist in the repository.
   - For `.0` stable releases, also computes the next development version (`X.(Y+2).0-dev`) for the post-release version bump.
3. **Verify the Merge Queue is empty**:
   - Checks that no pull requests are currently queued in the target branch's Merge Queue so a release isn't cut while changes are mid-merge.
4. **Verify CI passed on the target commit**:
   - Unless bypassed via the `skip_ci_check` input, verifies that the test workflow (`build-and-test.yml`) has completed and passed on the target commit.
   - For patch releases, this is why the branch name **must** match `patch-*` (so the test workflow runs automatically when the branch is pushed).
5. **Install dependencies, lint, and package the `.vsix`**:
   - Installs dependencies, runs the linter, updates `package.json` and `package-lock.json` to the release version, and builds the `.vsix` package (flagged as a pre-release when appropriate).
   - Uploads the packaged `.vsix` as a workflow artifact so it is preserved for inspection or manual recovery if a later step fails.
6. **Publish to the VS Code Marketplace**:
   - Publishes the packaged `.vsix` to the VS Code Marketplace using OIDC Trusted Publishing (or skips Marketplace publication when `dry_run` is enabled, which is the default).
   - Duplicate version errors are ignored (`--skip-duplicate`) so that if a later step fails after Marketplace publication succeeds, the job can be safely re-run without failing on the already-published version.
7. **Publish to Open VSX**:
   - Publishes the packaged `.vsix` to the Open VSX Registry using OIDC Trusted Publishing (`--trusted-publishing`), or skips Open VSX publication when `dry_run` is enabled.
   - Because `vsce package` already embeds the `PreRelease` flag into the `.vsix` manifest when `--pre-release` is passed, `ovsx publish` automatically detects whether the pre-packaged `.vsix` is a pre-release or stable build without needing `--pre-release`.
   - Duplicate version errors are ignored (`--skip-duplicate`) so that if a later step fails after Open VSX publication succeeds, the job can be safely re-run.
8. **Commit and push the release tag**:
   - Commits the updated `package.json` and `package-lock.json` as `Publish vX.Y.Z`, creates the git tag `vX.Y.Z`, and pushes the tag to the repository.
   - Because `master` is protected by a Merge Queue, the workflow pushes only the tag rather than pushing directly to the branch. The tag permanently retains the release commit (and any ancestor commits on a `patch-*` branch) in the repository.
9. **Create a GitHub Release (`stable` only)**:
   - Creates a GitHub Release for `vX.Y.Z` with the `.vsix` attached and release notes linking to the VS Code Marketplace and `dartcode.org/releases/vX-Y/`.
10. **Trigger the full test suite on the release tag (`stable` only)**:
    - Because tags pushed by `GITHUB_TOKEN` do not trigger `on: push` workflows automatically, the workflow explicitly dispatches a run of `build-and-test.yml` against the new `vX.Y.Z` tag to run the full test matrix.
11. **Open a pull request for the next `-dev` version (`.0` `stable` releases only)**:
    - Branches `version-bump/X.(Y+2).0-dev` from the commit prior to the `Publish vX.Y.Z` commit, updates `package.json` and `package-lock.json` to the next `-dev` version, and opens a pull request against the base branch (requires **Allow GitHub Actions to create and approve pull requests** in repository settings).
    - Because GitHub treats PRs opened by `github-actions[bot]` as requiring contributor workflow approval when *"Require approval for first-time contributors"* is enabled, a maintainer must click **Approve and run** on the PR for its CI checks to start.
12. **Report recovery instructions on partial failure**:
    - If any step fails after the extension has already been published to the VS Code Marketplace or Open VSX, logs a warning reminding the maintainer that the job can be safely re-run (after cleaning up any partial tag or GitHub Release) because both publish steps ignore duplicate versions.
