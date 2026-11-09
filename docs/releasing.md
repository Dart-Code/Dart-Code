# Releasing Dart-Code & Flutter Extensions (Step-by-Step Guide)

This document provides the step-by-step instructions for performing a pre-release, stable release, or patch release.

> **Related Documentation:**
> - **[Release Process (Technical Details)](release-process.md)**: Explains how the release workflow, versioning scheme, safety guards, and Trusted Publishing work under the hood.
> - **[`.github/workflows/release.yml`](../.github/workflows/release.yml)**: The GitHub Actions workflow that implements the release process.
>
> **Important:** Any changes to the release workflow or process must be kept in sync across this file, [`docs/release-process.md`](release-process.md), and [`.github/workflows/release.yml`](../.github/workflows/release.yml).

---

> **Important:**
> - **Trigger and approve one release at a time.** Because all runs share the `release` concurrency group and environment, queuing multiple unapproved runs at once will cause newer waiting runs to cancel older waiting runs.
> - **Uncheck `Dry run` when publishing a real release.** The **Dry run** option defaults to `true` (which runs all steps except publishing to the VS Code Marketplace and Open VSX). You must uncheck **Dry run** to publish to the marketplaces.

## 1. Publishing a Pre-Release

1. Go to **Actions → Release → Run workflow** on `master`:
   - **Release type**: `pre-release`
   - **Version**: Leave blank to auto-calculate `X.(Y-1).YYYYMMDD` from `package.json` (or enter an explicit `X.Y.Z` with an odd minor version).
   - **Skip CI check**: Leave unchecked (`false`) unless overriding a known CI flake.
   - **Dry run**: Uncheck (`false`) to publish to the VS Code Marketplace and Open VSX.
2. Open the triggered workflow run and click **Review deployments → Approve and deploy** for the `release` environment.
3. Once completed, verify the pre-release version appears on the VS Code Marketplace and Open VSX, and tag `vX.Y.YYYYMMDD` exists in the repository.

---

## 2. Publishing a Stable Minor Release (`X.Y.0`)

At the end of a release cycle (for example, when `package.json` on `master` is `3.148.0-dev`):

1. **Publish the stable release (`3.148.0`)**:
   - Go to **Actions → Release → Run workflow** on `master`:
     - **Release type**: `stable`
     - **Version**: `3.148.0` (must be explicitly provided)
     - **Skip CI check**: Leave unchecked (`false`) unless overriding a known CI flake.
     - **Dry run**: Uncheck (`false`) to publish to the VS Code Marketplace and Open VSX.
   - Approve the `release` environment deployment when prompted.
   - Wait for the workflow to complete. It will publish `3.148.0` to the VS Code Marketplace and Open VSX, push tag `v3.148.0`, create the GitHub Release, trigger the full test suite on `v3.148.0`, and open a Pull Request titled **`Set version to 3.150.0-dev`**.
2. **Merge the `Set version to 3.150.0-dev` PR**:
   - Open the newly created **`Set version to 3.150.0-dev`** PR (`version-bump/3.150.0-dev`).
   - Click **Approve and run** to allow the PR's `Run Tests` workflow to run (required because GitHub treats `github-actions[bot]` PRs as requiring contributor workflow approval).
   - Queue the PR in the Merge Queue (**Merge when ready**) and wait for it to merge into `master` and for the resulting `Run Tests` push build on `master` to finish.
3. **Publish the first pre-release of the next cycle (`3.149.YYYYMMDD`)**:
   - So that there is always a newer pre-release version than the latest stable version on the VS Code Marketplace and Open VSX (which is required for VS Code to display the **"Switch to Pre-Release Version"** button on the extension page), publish a new `3.149.YYYYMMDD` pre-release:
   - Once the `Set version to 3.150.0-dev` PR has merged and `Run Tests` on `master` has passed, go to **Actions → Release → Run workflow** on `master`:
     - **Release type**: `pre-release`
     - **Version**: Leave blank (auto-calculates `3.149.YYYYMMDD` from `3.150.0-dev`).
     - **Skip CI check**: Leave unchecked (`false`).
     - **Dry run**: Uncheck (`false`) to publish to the VS Code Marketplace and Open VSX.
   - *(Tip: If you don't want to wait for the `3.150.0-dev` PR to finish merging first, you can trigger the `pre-release` workflow immediately by typing the explicit version `3.149.YYYYMMDD` into the **Version** input.)*

*(Repeat the same steps in **`Dart-Code/Flutter`** so both extensions stay on matching version numbers.)*

---

## 3. Publishing a Patch Release (`X.Y.Z` where `Z > 0`)

To publish a hotfix/patch release (for example, `3.148.1`) without including newer `master` changes:

1. **Create and push a `patch-*` branch from the stable release tag**:
   - **Important:** The branch name **must** begin with `patch-` (for example, `patch-3-148-1`) so that `.github/workflows/build-and-test.yml` automatically triggers CI on the branch push.
   ```bash
   git fetch upstream --tags
   git checkout -b patch-3-148-1 v3.148.0
   git cherry-pick <commit-sha>
   git push -u upstream patch-3-148-1
   ```
2. **Wait for CI on the `patch-*` branch**:
   - Pushing a branch starting with `patch-` automatically triggers `Run Tests` (`build-and-test.yml`). Wait for this run to complete and pass (required by the release workflow's CI status check).
3. **Run the `Release` workflow from the `patch-*` branch**:
   - Go to **Actions → Release → Run workflow**.
   - Select **`patch-3-148-1`** from the **Use workflow from** branch dropdown.
   - Set **Release type** to `stable`, **Version** to `3.148.1`, and uncheck **Dry run** (`false`).
   - Approve the `release` environment deployment.
4. **Clean up**:
   - The workflow will publish `3.148.1` to the VS Code Marketplace and Open VSX, push tag `v3.148.1`, create the GitHub Release, and trigger the full test suite on `v3.148.1`. (No `-dev` version-bump PR is opened for patch releases.)
   - Once finished, the `patch-3-148-1` branch can be safely deleted (`v3.148.1` permanently retains the commit history).

---

## 4. Recovering from a Failed Release Run

- **If the workflow fails *before* `Publish to VS Code Marketplace`**:
  - Nothing has been published or pushed. Fix the underlying issue (or wait for CI / Merge Queue) and either click **Re-run failed jobs** or trigger a new workflow run.
- **If the workflow fails *during or after* publishing to the VS Code Marketplace / Open VSX**:
  - Because both publish steps (`vsce publish` and `ovsx publish`) ignore duplicate versions (`--skip-duplicate`), **it is safe to re-run the workflow job** — any registry where the version was already published will be skipped on retry.
  - Clicking **Re-run failed jobs** will package and tag the exact same commit that was originally triggered, even if new commits have landed on the branch in the meantime.
  - If the failure happened *after* `Commit and push tag` (or `Create GitHub Release`) already ran, delete the partial GitHub Release and/or remote tag first so the duplicate-tag check passes on retry:
    ```bash
    gh release delete v<VERSION> --yes
    git push --delete upstream v<VERSION>
    ```
    Then click **Re-run failed jobs** on the workflow run.
