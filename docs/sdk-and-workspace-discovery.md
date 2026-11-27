# SDK Discovery and Workspace Classification

This document explains how Dart-Code scans workspace folders, classifies workspace types, determines Dart and Flutter SDK search precedence, initializes Flutter/Snap installations, and handles missing SDKs and reload triggers.

> **Key Implementing Files:**
> - [`src/extension/sdk/utils.ts`](../src/extension/sdk/utils.ts): Workspace scanning, SDK search precedence, symlink/init-script resolution, custom SDK commands, and missing-SDK prompts.
> - [`src/extension/sdk/flutter.ts`](../src/extension/sdk/flutter.ts): Flutter SDK initialization (`flutter --help`).
> - [`src/shared/utils/fs.ts`](../src/shared/utils/fs.ts): Project folder traversal, Flutter `pubspec.yaml`/repo detection, `.dart_tool/package_config.json` extraction, and SDK version reading.
> - [`src/shared/vscode/utils.ts`](../src/shared/vscode/utils.ts): Project folder caching, `analysis_options.yaml` exclusions, and path resolution.
> - [`src/shared/utils/workspace.ts`](../src/shared/utils/workspace.ts): Special workspace configuration overrides (Dart SDK repo, Bazel, Fuchsia).
> - [`src/shared/workspace.ts`](../src/shared/workspace.ts): `WorkspaceContext` model capturing resolved SDKs and workspace classification.
> - [`src/extension/extension.ts`](../src/extension/extension.ts), [`src/extension/flutter/flutter_project_watcher.ts`](../src/extension/flutter/flutter_project_watcher.ts), and [`src/extension/commands/sdk.ts`](../src/extension/commands/sdk.ts): Startup activation gating, terminal `PATH` propagation, SDK version watching, and workspace/project/configuration reload triggers.
>
> **Important:** Any changes to workspace classification, SDK search precedence, initialization ordering, or missing-SDK and reload behavior must be kept in sync between this document and the implementing files above.

---

## 1. Project Scanning, Exclusions, and Caching

Project discovery identifies Dart and Flutter project roots within the open workspace without scanning arbitrary dependency trees or stalling VS Code startup:

- **Bounded breadth-first discovery**: Starting from local (`file:`) workspace folders, Dart-Code walks down to `dart.projectSearchDepth` levels (default `5`, with workspace roots counting as level 1). Filesystem traversal runs with bounded concurrency (8 concurrent operations) so startup does not contend heavily with VS Code or exhaust file descriptors (`EMFILE`). Leaf folders at the depth limit use targeted `stat` checks instead of `readdir`.
- **What counts as a project folder**: Primarily folders containing `pubspec.yaml`. When `pubspec.yaml` is not strictly required (such as during initial workspace scanning), folders containing a `flutter.create` project-creation trigger file or matching a Flutter SDK repository root (`bin/cache/dart-sdk` together with `bin/flutter` or `bin/flutter.bat` on Windows) are also matched.
- **Built-in and configured exclusions**:
  - Traversal prunes child folders starting with `.` (such as `.git`, `.dart_tool`, `.fvm`, `.gradle`), as well as `bin`, `cache`, and `node_modules`. Matching on the child folder name only ensures hidden ancestors *above* a workspace root never exclude the workspace itself.
  - `build/` folders are skipped *unless* they directly contain a `pubspec.yaml`, so generated build outputs are ignored while real Dart packages named `build` (such as `dart-lang/build`) are still discovered.
  - Folders configured in `dart.analysisExcludedFolders` are pruned during traversal.
  - After traversal, `analyzer.exclude` entries from discovered `analysis_options.yaml` files are parsed (whole-folder exclusions only, stripping trailing `/**` and ignoring patterns with remaining wildcards) and used to filter out excluded projects.
- **Slow-scan progress and cancellation**: If scanning takes longer than 2 seconds, a cancellable progress notification is shown. Cancelling skips un-enumerated candidates while preserving already-enumerated shallow folders and roots, and prevents partial results from being cached.
- **Caching and invalidation**:
  - Results are cached in memory for 5 minutes, keyed by workspace folders, `dart.analysisExcludedFolders`, effective search depth, and `onlyWorkspaceRoots` (with `allProjects` and `pubspecProjects` views sharing results from the same scan).
  - Concurrent project searches wait on any in-progress search so parallel callers reuse its cached results rather than repeating disk walks.
  - Caches are cleared on extension activation/reload, whenever any `**/.dart_tool/package_config.json` file changes, and during project creation.

---

## 2. Workspace Classification

During `scanWorkspace()`, Dart-Code determines what kind of workspace is open and builds a `WorkspaceContext` combining the resolved SDKs with `WorkspaceConfig` overrides:

- **Remote SSH short-circuit (`dart.analyzerSshHost`)**: Checked before any local scanning or SDK validation. Because only the analysis server runs over SSH on the remote host (other SDK tooling does not run remotely, and the remote path does not exist locally), Dart-Code skips project scanning and local path validation and returns a minimal `WorkspaceContext` using `dart.sdkPath` directly with no Flutter SDK.
- **Dart vs. Flutter classification**:
  - Discovered project folders are scanned in BFS order to determine `hasAnyFlutterProjects`, `hasAnyStandardDartProjects`, and the first discovered Dart and Flutter project roots (`firstDartProject` and `firstFlutterProject`).
  - A folder is classified as **Flutter** if its `pubspec.yaml` references Flutter packages (`flutter`, `flutter_test`, `flutter_goldens`, or `sky_engine` in `dependencies` or `dev_dependencies`), contains a `flutter.create` trigger file, or is a Flutter SDK repository root (so opening the Flutter SDK checkout activates Flutter support and uses its local SDK).
  - Scanning stops early once both a Flutter project and a standard Dart project (along with their first-seen paths) have been found, avoiding unnecessary synchronous file reads in large monorepos.
  - `hasAnyFlutterProjects` also gates activation of the companion Flutter extension (`Dart-Code.flutter`). Activation is triggered without `await` because the Flutter extension awaits the Dart extension's exported API; awaiting it would deadlock startup.
- **Special repository and build-system workspaces**: Walking upward from each top-level workspace folder (stopping at the first matching workspace folder per type), Dart-Code detects special environments and applies `WorkspaceConfig` overrides:
  - **Dart SDK repository** (a git root containing `README.dart-sdk` and `DEPS`): Disables automatic `pub get` (`disableAutomaticPub`) so the SDK checkout is not mutated.
  - **Bazel workspace** (an ancestor directory containing a `WORKSPACE` file): Disables automatic `pub get`, SDK update checks, and DTD (`disableAutomaticPub`, `disableSdkUpdateChecks`, `disableDartToolingDaemon`). On non-Windows platforms, if `dart/config/ide/flutter.json` exists under the Bazel root, it forces Flutter workspace/debug mode (`forceFlutterWorkspace`, `forceFlutterDebug`), skips standard Flutter initialization (`skipFlutterInitialization`), sets `flutterVersion` to `MAX_VERSION`, configures custom wrapper scripts (`flutterSdkHome`, `defaultDartSdk`, and daemon/run/test/doctor/DevTools/tools scripts), starts DevTools eagerly, and overrides test capabilities (`supportsPackageTest = true`, `supportsDartRunTest = false`).
  - **Fuchsia workspace** (an ancestor directory containing `.jiri_root`): Disables automatic `pub get`, SDK update checks, and DTD, and adds Fuchsia-tree SDK locations to Flutter and Dart SDK searches.
- **Fallback detection without `pubspec.yaml`**:
  - If neither Flutter nor standard Dart projects were found during project scanning (for example, a folder of standalone `.dart` scripts), Dart-Code performs a shallow search (`workspace.findFiles` limited to 1 match across `*.dart`, `lib/*.dart`, `bin/*.dart`, `tool/*.dart`, and `test/*.dart`) to detect standalone Dart code without triggering a slow full-workspace scan.
  - If still no Dart or Flutter project is detected—such as when VS Code activates the extension via a coarse activation event like `onDebugDynamicConfigurations` in an unrelated workspace—Dart-Code suppresses non-relevant background noise by disabling analytics, startup prompts, and SDK update checks (`disableAnalytics`, `disableStartupPrompts`, `disableSdkUpdateChecks`).

---

## 3. SDK Search Precedence and Resolution

### Path Normalization, Symlinks, and Validation

- **Path expansion and `/bin` probing**: Candidate paths expand `~/` to the user's home directory and resolve relative paths against the `.code-workspace` file's directory (for multi-root workspaces) or the first workspace folder. Each path is checked both as-is and with `bin` appended (unless it already ends in `bin` or `sbin`), deduplicated before touching the filesystem.
- **Symlink resolution and package manager init scripts**: Symlinks are resolved on the executable binary itself (`realpath`), and the SDK root is derived by walking up two levels (`<sdk>/bin/<exe>` → `<sdk>`). If resolving a symlink leads to a binary with a different basename (for example, a `flutter` shim pointing to `snap` or `hermit`), Dart-Code records it as an init script rather than treating its parent as a real SDK root.
- **Post-filter marker checks**: Candidate roots must pass marker checks so system directories such as `/usr` (via `/usr/bin/flutter`) are never mistaken for an SDK:
  - **Dart SDK**: `bin/dart` plus either `bin/snapshots/analysis_server.dart.snapshot` or `bin/dartaotruntime`.
  - **Flutter SDK**: `bin/flutter` (or `bin/flutter-dev` when `dart.useFlutterDev` is enabled) plus at least one SDK marker (`analysis_options.yaml`, `bin/flutter.bat`, or `bin/internal/engine.version`).
- **Custom SDK commands (`dart.getFlutterSdkCommand`, `dart.getDartSdkCommand`)**: Executed when a workspace is open (defaulting `cwd` to the `.code-workspace` directory or first workspace folder). Trimmed stdout must point to an existing path; failures display a warning with a shortcut to settings.
- **Invalid configured path warnings**: When `dart.flutterSdkPath` (in a Flutter workspace) or `dart.sdkPath` (in a non-Flutter, non-Fuchsia workspace) is set, a valid SDK is found elsewhere, and the matched SDK did not originate from the configured path, Dart-Code warns the user that the configured setting is not a valid SDK folder.

### Flutter SDK Search Order

When Bazel `flutter.json` sets `forceFlutterWorkspace`, Flutter SDK search is bypassed and `flutterSdkHome` is used directly. Otherwise, Flutter SDK candidates are searched in order:

1. `dart.flutterSdkPath` setting.
2. `dart.getFlutterSdkCommand` output.
3. Fuchsia tree locations (`lib/flutter`, `third_party/dart-pkg/git/flutter`), when in a Fuchsia workspace.
4. Project-local paths relative to `firstFlutterProject`: the project root itself (supporting opening the Flutter SDK repo directly), `.flutter`, and `vendor/flutter`.
5. `PATH` environment entries.
6. `.dart_tool/package_config.json` in `firstFlutterProject` (via `flutterRoot` or the `flutter` package URI).
7. Built-in fallback paths: `FLUTTER_ROOT`, `~/snap/flutter/common/flutter` (Linux only), `~/flutter-sdk`, `/google/flutter`, and `/opt/flutter`.

> **Why `.dart_tool/package_config.json` comes after `PATH`:** Users frequently upgrade or switch the Flutter SDK on `PATH` and expect Dart-Code to follow immediately. Placing `package_config.json` ahead of `PATH` would keep pinning the workspace to an older SDK recorded by an earlier `pub get`. Keeping it after `PATH` still finds the SDK when it is not on `PATH`, while pub status checks separately detect SDK mismatches against `package_config.json` and prompt to re-run `pub get`.

### Dart SDK Search Order

Dart SDK candidates are searched in order:

1. Fuchsia tree prebuilt/source Dart SDK paths, when in a Fuchsia workspace.
2. **Flutter's embedded Dart SDK (`<flutterSdk>/bin/cache/dart-sdk`)** — prioritized ahead of `dart.sdkPath` and `PATH` **only** when a Flutter project was detected (`firstFlutterProject` is set).
3. `dart.sdkPath` setting.
4. `dart.getDartSdkCommand` output.
5. `PATH` environment entries.
6. **Flutter's embedded Dart SDK (`<flutterSdk>/bin/cache/dart-sdk`)** — fallback after `PATH` for non-Flutter workspaces.
7. `workspaceConfig.defaultDartSdk` (from Bazel `flutter.json`, if configured).

> **Why Flutter's embedded Dart SDK appears both before and after `PATH`:**
> - **Before `dart.sdkPath` and `PATH` in Flutter workspaces:** Flutter requires the exact Dart SDK bundled in its own `bin/cache/dart-sdk`; using a separate standalone Dart SDK would break compatibility with `dart:ui`, the analyzer, and Flutter tooling.
> - **After `PATH` in non-Flutter workspaces:** Standard Dart projects should use the user's configured or `PATH` Dart SDK rather than accidentally selecting Flutter's bundled copy. Keeping Flutter's embedded Dart SDK as a post-`PATH` fallback still allows Flutter-only installations (with no standalone Dart SDK) to activate the extension—for example, when running `Flutter: New Project` in an empty workspace or editing standalone Dart scripts.

### Versions and Environment Propagation

- **SDK versions**: Dart versions are read from `<dartSdk>/version`. Flutter versions are read from `<flutterSdk>/bin/cache/flutter.version.json`, falling back to `<flutterSdk>/version` (unless overridden by Bazel). If a Flutter SDK's `version` file is missing (a known condition on `main`/`master` checkouts), Dart-Code uses a high sentinel version (`MISSING_VERSION_FILE_VERSION`) so version-gated capabilities remain enabled.
- **Tool and terminal environment**: On successful activation, Dart-Code sets `FLUTTER_ROOT` in its internal tool environment for Flutter workspaces and, when `dart.addSdkToTerminalPath` is enabled, prepends the active SDK's `bin` directory (`flutter/bin` for Flutter workspaces, `dart/bin` otherwise) to VS Code's integrated terminal `PATH` (clearing the persisted environment collection when disabled).

---

## 4. Flutter and Snap Initialization Ordering

Running `flutter --suppress-analytics --help` causes Flutter to download or refresh its cached Dart SDK (`bin/cache/dart-sdk`) and internal artifacts on a fresh install or after an SDK/channel change. Dart-Code runs this initialization **before** searching for the Dart SDK and spawning background tools (such as the Dart analysis server) so it neither misses `bin/cache/dart-sdk` on first run nor spawns tools from a Dart SDK that Flutter concurrently overwrites.

- **Progress and failure handling**: Initialization shows a cancellable progress notification only if it takes longer than 5 seconds, streaming output to the `flutter initialization` output channel. If initialization fails or is cancelled, Dart-Code notifies the user and proceeds rather than hanging activation.
- **Initialization checkpoints**:
  1. **Uninitialized package manager / Snap shim (during Flutter SDK lookup)**: If no real Flutter SDK is found, but the search encountered a package manager init script (such as an uninitialized Flutter Snap), Dart-Code executes `flutter --help` on that init script and immediately re-runs the Flutter SDK search.
  2. **Flutter workspaces (between Flutter SDK lookup and Dart SDK lookup)**: When `hasAnyFlutterProjects` is true, a Flutter SDK was found, and `skipFlutterInitialization` is not set, Dart-Code initializes Flutter *before* looking up the Dart SDK so `bin/cache/dart-sdk` is populated and up to date.
  3. **Post-lookup fallback for non-Flutter or empty workspaces**: If no Dart SDK was found after searching, a Flutter SDK *was* found, and initialization has not yet run, Dart-Code initializes Flutter and re-checks `<flutterSdk>/bin/cache/dart-sdk`—covering cases like activating via `Flutter: New Project` in an empty workspace against an uninitialized Flutter SDK.

---

## 5. Missing-SDK Behavior (Prompting vs. Suppression)

- **Activation gate**: Extension activation stops early—without starting the analysis server, Flutter daemon, DTD, or language/debug providers—if **either** no Dart SDK was found, **or** the workspace contains Flutter projects (`hasAnyFlutterProjects`) and no Flutter SDK was found.
- **Non-Flutter workspaces without a Flutter SDK**: If a Dart SDK *is* found in a non-Flutter workspace without a Flutter SDK, the extension activates normally; Flutter-specific commands (`flutter.doctor`, `flutter.upgrade`, `flutter.createProject`, `_dart.flutter.createSampleProject`) check for the Flutter SDK on demand and trigger the missing-Flutter prompt when invoked.
- **Prompting vs. suppression when activation stops early**:
  - Dart-Code registers minimal fallback handlers for key entry commands (`flutter.createProject`, `dart.createProject`, `_dart.flutter.createSampleProject`, `flutter.doctor`, `flutter.upgrade`) so running one immediately shows the relevant SDK prompt and re-runs the command once resolved.
  - After a 500 ms delay (giving an activating command time to show its own prompt first), Dart-Code handles startup prompting based on workspace classification:
    - **Flutter project open**: Shows the Flutter missing-SDK prompt—unless a Flutter SDK *was* found and only its embedded Dart SDK is missing, in which case it prompts the user to run `flutter doctor` in the terminal and reload rather than locating or downloading Flutter.
    - **Standard Dart project open**: Shows the Dart missing-SDK prompt.
    - **Neither Dart nor Flutter project detected**: Suppresses the startup prompt and logs an error instead, avoiding disruptive SDK errors in unrelated or empty workspaces.
- **Recovery actions**:
  - **Locate SDK**: Opens a folder picker, validates the selected directory using the Dart/Flutter SDK finder, saves it to global `dart.sdkPath` or `dart.flutterSdkPath`, reloads the extension, and re-runs any pending command.
  - **Download SDK**: Opens the Dart download page for Dart. For Flutter, checks whether `git` is available (via VS Code's Git extension API or `git --version`); if available, clones the Flutter `stable` branch into a user-selected folder, saves `dart.flutterSdkPath`, initializes Flutter, offers to add it to `PATH`, reloads, and re-runs any pending command—falling back to setup instructions if Git is unavailable or cloning fails.
  - **Show Log**: Opens the in-memory ring log to diagnose candidate search paths and failures.

---

## 6. Workspace, Project, and SDK Changes Triggering Reloads

Because SDK selection and enabled services (Flutter daemon, companion Flutter extension, `FLUTTER_ROOT`, analyzer process) are bound at activation time in `WorkspaceContext`, runtime changes that alter workspace classification or SDK selection trigger an extension reload (`_dart.reloadExtension`, which coalesces overlapping reloads, clears caches, shuts down active services, and re-activates):

- **Workspace folder changes (`onDidChangeWorkspaceFolders`)**: Re-scans the workspace. If `hasAnyFlutterProjects` or `hasProjectsInFuchsiaTree` changed, triggers an **automatic silent reload** so SDK discovery and Flutter services re-initialize. Otherwise, avoids reloading and instead fires `onPackageMapChange` (clearing project caches) and re-checks packages.
- **Flutter project added to a Dart-only workspace (`FlutterProjectWatcher`)**: When activated without Flutter projects, watches `**/pubspec.yaml` creations and edits (ignoring hidden folders and `build/`). If a `pubspec.yaml` starts referencing Flutter, prompts the user (at most once per session) to reload and switch to the Flutter SDK.
- **SDK and startup-bound configuration changes (`onDidChangeConfiguration`)**: Changes to restart-requiring settings—including `dart.sdkPath`, `dart.flutterSdkPath`, and `dart.sdkPaths` / `dart.flutterSdkPaths` lengths—are debounced (`configChangeDebounceDelayMs`) and trigger an **automatic silent reload**.
  - Interactive SDK switching (`dart.changeSdk` / `dart.changeFlutterSdk`, surfaced in the language status bar when `dart.sdkPaths` / `dart.flutterSdkPaths` are configured) writes `dart.sdkPath` or `dart.flutterSdkPath` at workspace or global scope per `dart.sdkSwitchingTarget`, flowing through this same reload path.
  - If `dart.sdkPath` or `dart.flutterSdkPath` changes within 1.5 seconds of activation starting, Dart-Code warns the user to review logs and file an issue, since external tools mutating SDK settings during startup cause redundant analyzer restarts and degraded startup performance.
- **In-place SDK upgrades (`SdkCommands` version watcher)**: Watches `<dartSdk>/version` for modification-time (`mtime`) changes rather than trusting raw `fs.watch` events alone (which can fire on file access on Windows) and without requiring timestamps to be recent (since archive extraction preserves older timestamps). When `mtime` actually changes, Dart-Code rate-limits notifications with a 60-second cooldown and prompts the user to reload with the updated SDK.
