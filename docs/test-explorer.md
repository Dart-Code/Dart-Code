# Test Discovery, Test Model, and Test Explorer

This document explains the high-level design, behavioral contracts, and key decisions behind test discovery, the in-memory test tree model, Test Explorer integration, and test coverage.

> **Key Implementing Files:**
> - [`src/shared/test/test_model.ts`](../src/shared/test/test_model.ts): Canonical in-memory test tree (`TestModel`), node hierarchy, merging and re-parenting, counts, status rollup, and pruning.
> - [`src/shared/test/coordinator.ts`](../src/shared/test/coordinator.ts): Translates DAP `dart.testNotification` (`package:test` JSON) events into `TestModel` updates and tracks debug-session suite ownership.
> - [`src/extension/test/vs_test_controller.ts`](../src/extension/test/vs_test_controller.ts): VS Code `TestController` bridge (`VsCodeTestController`) mapping `TestModel` nodes to `TestItem`s, managing `TestRun` lifecycle, run profiles, and coverage reporting.
> - [`src/extension/lsp/test_discoverer.ts`](../src/extension/lsp/test_discoverer.ts): Lazy workspace suite discovery, file watchers, and static test/group discovery from LSP Outline notifications (`TestDiscoverer`).
>
> **Important:** Any changes to test discovery, model behavior, synthetic node handling, debug-session ownership, or coverage integration must be kept in sync with this document.

---

## 1. Architecture & Component Responsibilities

Test Explorer is split across four main components so that the core tree model and protocol handling remain decoupled from VS Code's Testing UI APIs:

- **`TestDiscoverer`**: Lazily discovers test suite files in the workspace, watches for file/folder additions and deletions, and feeds static LSP Outline structures into `TestModel` (`TestSource.Outline`).
- **`TestSessionCoordinator`**: Listens to debug-session lifecycle events and `dart.testNotification` custom DAP events (wrapping `package:test`'s JSON reporter protocol), feeding runtime test/group events into `TestModel` (`TestSource.Result`).
- **`TestModel`**: Lives in `src/shared/` (without VS Code UI dependencies) and acts as the single source of truth for the merged test tree, pass/skip counts, status rollup, staleness, and pruning, firing tree-change and test-lifecycle events to listeners.
- **`VsCodeTestController`**: Mirrors `TestModel` into VS Code's `vs.TestController` (`vs.TestItem` tree), manages `vs.TestRun` output and results, registers Run/Debug/Coverage profiles, and parses LCOV coverage on session exit. Controller creation is feature-detected on `vs.tests?.createTestController` (for hosts such as Theia), using the label `"Dart & Flutter"` when the workspace contains any Flutter projects and `"Dart"` otherwise.

---

## 2. Tree Hierarchy, Labels & Node Identity

- **Node hierarchy**: `WorkspaceFolderNode` → `ProjectNode` → `SuiteNode` → `GroupNode` / `TestNode`. Groups can nest arbitrarily, and dynamically-named outline `GroupNode`s and `TestNode`s can also parent concrete runtime children (`GroupNode` or `TestNode`).
- **Workspace folder elision**:
  - Single-root and no-folder workspaces omit `WorkspaceFolderNode` so `ProjectNode`s sit directly at the root.
  - Multi-root workspaces group projects under their `WorkspaceFolderNode`, *except* when a project's root path equals the workspace folder path itself, avoiding a redundant wrapper level.
- **Suite eligibility & exclusions**: Files ending in `_test.dart` inside `test/`, `integration_test/`, or `test_driver/` (or anywhere when `dart.allowTestsOutsideTestFolder` is enabled) are treated as test suites. Hidden folders (such as `.git` and `.dart_tool`) and `dart.analysisExcludedFolders` are skipped during both initial discovery and file-watcher creation events.
- **Labels**: Suite labels are shown relative to their parent `ProjectNode` or `WorkspaceFolderNode` (or as the file basename if parentless). Group and test labels strip any enclosing ancestor's name prefix so nested items show only their local name.
- **Identity vs. navigation URI**:
  - `VsCodeTestController` keys group and test `TestItem` IDs by `suiteData.path` plus full name rather than the node's own file path. This ensures shared setup/teardown helpers defined in another file remain distinct children of each suite where they run.
  - Each `TestItem`'s `uri` uses the node's own `path` so navigation opens the file where the test or hook is actually defined.
  - When `package:test` reports both `root_url`/`root_line`/`root_column` and `url`/`line`/`column`, normal tests and groups prefer the **root location** (the call site inside the executed suite), whereas synthetic setup/teardown hooks prefer their **actual location** (`url`/`line`/`column`) so failures jump directly to the hook definition.
- **Runnability tags**: `ProjectNode`s and runnable suites, groups, and tests receive `DartRunnableTest` (plus `DartRunnableWithCoverageTest` when the owning `ProjectNode` supports coverage). Synthetic nodes (`(loading)`, `(setUpAll)`, `(tearDownAll)`) and suites in projects without `package:test` support are intentionally untagged so they cannot be invoked directly.

---

## 3. Static vs. Dynamic Discovery, Merging & Pruning

### Lazy Static Discovery (`TestDiscoverer`)

- **On-demand suite discovery**: Suite discovery does not run eagerly at activation. Instead, `VsCodeTestController.resolveHandler` invokes `ensureSuitesDiscovered()` when VS Code first expands the Testing view, and **Run All Tests** also ensures suites are discovered before running. Once initial discovery runs, a workspace file-system watcher tracks newly created test files (traversing newly created or renamed directories) and removes deleted files or folders.
- **Lazy suite expansion**: Suites with no visible children advertise `canResolveChildren = true`. Expanding a suite triggers `discoverTestsForSuite()`, which opens the file and sends a lightweight hover request to force LSP analysis and Outline delivery.
- **Outline debouncing**: The first Outline received for a file is applied immediately for responsiveness; subsequent edits are debounced (`1500ms`) before rebuilding the suite's static tree.

### Scoping & Dynamic-Group Rules in Static Discovery

- **Scoped to top-level `main()`**: `TestDiscoveryVisitor` traverses only the top-level `main()` function and does not recurse into nested local helper functions or other top-level functions.
  - *Why*: Tests and groups defined in helper functions depend on call-site context for their runtime hierarchy and interpolated names. Registering them statically at the suite root creates phantom nodes that never match runtime results and inflate `X/Y passed` counts. They still appear dynamically (`TestSource.Result`) when the suite runs. (By contrast, editor CodeLens uses `TestOutlineVisitor` across the entire file in [`src/shared/utils/outline.ts`](../src/shared/utils/outline.ts) and flags non-`main()` entries so run-by-name omits the `^` anchor and `"auto"` invocation mode prefers running saved files by line.)
- **No static children inside dynamically-named groups**: Because the analyzer Outline falls back to `toSource()` (preserving Dart string quotes) for interpolated descriptions rather than evaluating a constant string, `parseTestNameFromOutline()` in [`src/shared/utils/test.ts`](../src/shared/utils/test.ts) identifies quote-wrapped names containing Dart interpolation syntax (`$ident` or `${...}`) as dynamic (`hasDynamicName`) while keeping constant strings with literal `$` (such as `'price \$5'` or `r'price $5'`) static. *(A constant string whose evaluated value itself starts and ends with quotes and contains `$foo` is indistinguishable in Outline and is intentionally treated as dynamic as a lightweight heuristic rather than parsing Dart in TypeScript.)*
  - *Why*: Static discovery stops recursing into dynamically-named groups because static children would carry unresolved interpolated prefixes and would not match the concrete runtime groups/tests, causing duplicate tree entries. Concrete runtime group instances and their child tests populate beneath the dynamic outline node when the suite runs.

### Dynamic Results from `package:test` via DAP (`TestSessionCoordinator`)

- Processes `suite`, `group`, `testStart`, `testDone`, `print`, and `error` notifications forwarded as `dart.testNotification` custom DAP events.
- **Cross-platform path/URI normalization**: Resolves relative suite paths against the debug session's `cwd` and normalizes Windows path slashes and uppercase drive letters before touching `TestModel`.
- **Phantom unnamed groups**: `package:test` emits unnamed root/wrapper groups; the coordinator omits them from the tree and remaps their IDs through to their real parent ID (or the suite root).
- **Outline range enrichment**: Because `package:test` reports only a 1-based start line and column, the coordinator snapshots the suite's latest LSP Outline when the suite starts so runtime nodes can inherit full source ranges (needed for "Run Test at Cursor"), falling back to a single-line range when unmatched.
- **Noise filtering**: Drops solo-skip print lines (`Skip: does not have "solo"`) and Flutter's boilerplate wrapper error (`Test failed. See exception logs above...`) so Test Error Peek shows the underlying failure.

### Merging, Re-Parenting & Live Range Tracking (`TestModel`)

- **Dual indexing**: Each `SuiteData` indexes groups and tests both by `(sessionID, id)` (preventing numeric ID collisions across concurrent runs) and by full `name` (enabling reuse across runs and between static outline and runtime result sources).
- **Reuse vs. dynamic re-parenting**: When a `TestSource.Result` node arrives:
  - An exact-name match in the suite **reuses** the existing node while preserving its original `testSource` (so `Outline` nodes are not later pruned as `Result` nodes) and updating its parent, path, and range as appropriate.
  - Otherwise (for non-synthetic nodes), `TestModel` searches the parent's children for a `TestSource.Outline` node of the **same kind** (`GroupNode` for groups, `TestNode` for tests) with `hasDynamicName === true` whose wildcarded regex matches the runtime name, with an exact same-kind sibling taking precedence over dynamic matches. Matching concrete runtime nodes are **re-parented under** that dynamic outline node.
- **Live range tracking (`dart.dynamicTestTracking`)**: When enabled (the default), `TestSource.Result` nodes attach a `DocumentRangeTracker` ([`src/shared/vscode/trackers.ts`](../src/shared/vscode/trackers.ts)) to shift their source ranges as the file is edited and remove nodes whose spans are deleted or invalidated by external edits upon reopening. When disabled, updating an `Outline` node propagates range updates to `Result` children that shared its prior range, and `VsCodeTestController` avoids overwriting existing positions with stale result ranges.

### Staleness & Deleted-Node Pruning

- **Outline refresh**: Marks all `TestSource.Outline` nodes in the suite as `isPotentiallyDeleted`, clears the flag on visited nodes and their ancestors, and removes unvisited `Outline` nodes. `TestSource.Result` nodes are untouched so editing a file does not discard dynamic runtime results.
- **Test run start (`flagSuiteStart`)**: [`src/extension/providers/debug_config_provider.ts`](../src/extension/providers/debug_config_provider.ts) determines `isRunningWholeSuite` by checking that neither a `?line=` query on `program` nor `--name`/`--pname` filter arguments are present. All groups and tests in the suite are marked `isStale = true` (cleared individually when a test completes as Passed, Failed, or Skipped). **Only when `isRunningWholeSuite` is `true`** are `TestSource.Result` nodes marked `isPotentiallyDeleted`.
- **Suite end (`suiteDone`)**: Removes only `TestSource.Result` nodes still flagged `isPotentiallyDeleted`.
  - *Why*: Filtered runs must not delete unselected dynamic tests, whereas whole-suite runs clean up renamed or deleted dynamic tests without removing outline-owned nodes.

---

## 4. Synthetic Nodes, Counts, Skipped Tests & Status Rollup

### Synthetic Nodes (`(loading)`, `(setUpAll)`, `(tearDownAll)`)

- `package:test` emits a `loading <path>` test (with no group) while compiling/loading a suite, as well as `(setUpAll)` and `(tearDownAll)` tests (matched via `(setUp...)` / `(tearDown...)` on the unprefixed local label) for suite and group lifecycle hooks.
- The coordinator normalizes `loading <path>` to `(loading)`, which `TestNode` renders as `"Loading..."` while running and `"Failed to load"` on failure.
- **Visibility & `TestRun` isolation for `(loading)`**:
  - `(loading)` is shown in the Test Explorer tree while running, then marked `hidden = true` and removed from the tree when loading succeeds (`evt.hidden`) or is cancelled (`suiteDone`).
  - `VsCodeTestController` intentionally skips enqueuing `(loading)`, skips calling `run.started(item)` up-front, and streams its print/error output at the **run level** (without a `TestItem`).
  - *Why*: VS Code's Testing API permanently retains any `TestItem` passed to `enqueued`, `started`, or `appendOutput` in Test Results even if the item is later removed from the tree. Only if `(loading)` fails does `testDone` call `run.started(item)` and `run.failed`/`run.errored` with the accumulated output as a `TestMessage`, surfacing compile/load errors without cluttering passing test runs.
- **Visibility for `(setUpAll)` / `(tearDownAll)`**: Even when `package:test` emits `evt.hidden = true` on passing hooks, `TestSessionCoordinator` keeps them visible (`hidden` is only honored for `(loading)`) so users retain navigation and gutter/status icons.
- **Out-of-band errors**: If a synthetic test emits an `error` notification after already completing as `Passed` (for example, an unawaited `Future` rejecting later), `package:test` does not emit a second `testDone`, so the coordinator synthesizes a failing `testDone` to surface the error.

### Pass/Total Counts (`X/Y passed`)

- Recomputed bottom-up on `testDone` and top-down on outline rebuilds, suite completion, and configuration changes.
- Only leaf `TestNode`s that are neither `hidden` nor `isSynthetic` contribute to `testCount`, `testCountPass`, and `testCountSkip`.
  - *Why*: Synthetic lifecycle nodes are not user tests and would otherwise distort `X/Y passed` counts.
- Container nodes (suites, groups, and dynamic parent `TestNode`s with concrete children) display `X/Y passed` in their `description` when they have children and a non-zero total; otherwise `description` is empty.

### Skipped Tests (`dart.showSkippedTests`)

- When `true` (default), skipped tests and groups remain visible and count toward `Y`.
- When `false`, skipped `TestNode`s—and `GroupNode`s or dynamic parent `TestNode`s whose children are *all* skipped (`isSkipped`)—are hidden from the Test Explorer tree (suites themselves stay visible), and skipped tests are subtracted from `Y` (`testCount - testCountSkip`).
- Changing `dart.showSkippedTests` calls `handleSkippedTestsConfigChange()`, immediately updating node visibility and count labels across all suites.
- Running a single `TestNode` from Test Explorer (or via CodeLens) passes `--run-skipped` so explicitly executing a skipped test runs it.

### Parent & Suite Status Rollup

- `TestStatus` ([`src/shared/enums.ts`](../src/shared/enums.ts)) is ordered by aggregation precedence from lowest to highest: `Waiting < Skipped < Passed < Unknown < Failed < Running`.
- `getHighestChildStatus(includeSkipped)` aggregates all non-hidden descendant `TestNode`s using `Math.max` (so `Running` and `Failed` take priority over `Unknown`, which takes priority over `Passed`, and so on).
- When `includeSkipped` is `false`, `Skipped` is excluded **except** for a `SuiteNode` whose descendant statuses consist *only* of `Skipped`, preventing an all-skipped suite from displaying as `Unknown`.
- Dynamic parent `TestNode`s with concrete children derive both their `status` (including skipped children) and `isStale` from their children.

---

## 5. Execution Paths, Debug-Session Ownership & Coverage

### Run Profiles & Invocation Paths

- `VsCodeTestController` registers **Run**, **Debug**, and **Run with Coverage** profiles and strips redundant descendants from both include and exclude sets before launching ([`src/extension/commands/test.ts`](../src/extension/commands/test.ts)).
- **Whole-suite fast path**: For non-debug runs where all included and excluded items resolve to whole `SuiteNode`s, `_dart.runAllTestsWithoutDebugging` groups suites by closest project root and by integration (`integration_test/`) vs. non-integration tests, running each group in a single `dart test` / `flutter test` session. When running all tests without exclusions, suite arguments collapse to top-level directories (such as `test`) to avoid Windows command-line length limits. Non-integration projects execute concurrently; integration-test projects execute serially so they do not compete for the target device.
- **Per-suite path**: Debugging or running specific groups or tests launches one debug session per suite, filtering by `--name` regex or `?line=` according to `dart.testInvocationMode` (`"name"`, `"line"`, or `"auto"`, which prefers line mode for saved files when a test name contains `$` or came from outside `main()`, when supported by Flutter or `package:test >= 1.23.1`).

### Debug-Session Ownership, `TestRun` Binding & Cleanup

- Every Dart test launch configuration receives a unique `dartCodeDebugSessionID` during configuration resolution (before VS Code assigns its own session ID, since `onDidStartDebugSession` can fire after early events) to correlate `vs.TestRun`s and isolate per-session protocol ID tables.
- **Test Explorer vs. external launches (`F5` / CodeLens)**:
  - Test-Explorer-initiated runs create a `vs.TestRun` up-front, enqueue non-`(loading)` leaf tests, register the run under each session's `dartCodeDebugSessionID` with `wasStartedByTestRunner: true`, and end the `TestRun` once all sessions complete (allowing a single `TestRun` to span multiple debug sessions).
  - Externally started test sessions lazily create a `vs.TestRun` on the first model event (`wasStartedByTestRunner: false`) and end it when that debug session terminates. On `suiteStarted`, external runs enqueue the suite's items only if `isRunningWholeSuite` is `true` (so `F5` on a test file shows queued state, while filtered external runs do not falsely enqueue the entire suite).
- **Suite ownership & termination cleanup**: `TestSessionCoordinator` records `owningDebugSessions[suitePath] = debugSessionID` when each `suite` notification arrives and calls `suiteDone` for every suite owned by that session in `handleDebugSessionEnd`.
  - *Why*: A test run can terminate early due to cancellation, errors, or crashes without emitting final `testDone`/`done` notifications; ending owned suites on debug-session termination ensures potentially-deleted result nodes are pruned (for whole-suite runs), remaining `Running` tests revert to `Unknown`, and any unfinished `(loading)` node is hidden.

### LCOV Code Coverage Integration

Implemented in [`src/shared/test/coverage.ts`](../src/shared/test/coverage.ts) and [`src/shared/test/version.ts`](../src/shared/test/version.ts):

- **Capability gating**: `ProjectNode.supportsCoverage` is always `true` for Flutter projects and checks `package:test >= 1.27.0` (`supportsLcovCoverage`, read from `.dart_tool/package_graph.json` and time-cached) for Dart projects. Only projects with coverage support receive the `DartRunnableWithCoverageTest` tag.
- **Collection**: Coverage launches allocate a temporary `.lcov` path in `os.tmpdir()` (stored on `launchConfig.coverageFilePath`) and pass `--branch-coverage` and `--coverage-path <file>` (plus `--coverage` for Flutter, and `--coverage-package ^<pkg>$` for each workspace package on Flutter or `package:test >= 1.29.0`).
- **Parsing & reporting**: On debug-session termination (`VsCodeTestController.handleDebugSessionEnd`), `CoverageParser` parses `SF`, `DA`, and `BRDA` records into coverable and covered line sets. It intentionally ignores LCOV `LF`/`LH` summary totals because Dart's branch reporting makes them inaccurate, and treats hit counts as boolean covered/uncovered (zero vs. non-zero). Relative `SF` paths are resolved against the debug session's `cwd`, paths matching `dart.coverageExcludePatterns` globs are excluded, `DartFileCoverage` entries are added to the `vs.TestRun`, and `loadDetailedCoverage` lazily returns per-line `vs.StatementCoverage` entries (converting 1-based LCOV lines to 0-based VS Code positions).
