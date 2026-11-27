# Extension Architecture, Lifecycle, and Background Services

This document describes the high-level process topology, activation and reload lifecycle, and bundle/API boundaries of the Dart-Code extension.

> **Key Implementing Files:**
> - **[`src/extension/extension.ts`](../src/extension/extension.ts)**: Extension `activate()` / `deactivate()`, `_dart.reloadExtension`, configuration-change reload detection, and `privateApi` exposure.
> - **[`src/extension/api/extension_api.ts`](../src/extension/api/extension_api.ts)** & **[`src/shared/vscode/extension_api.ts`](../src/shared/vscode/extension_api.ts)**: Public extension API contract and implementation.
> - **[`src/shared/vscode/interfaces.ts`](../src/shared/vscode/interfaces.ts)**: Test-only `InternalExtensionApi` (`privateApi`) contract.
> - **[`webpack.config.js`](../webpack.config.js)** & **[`eslint.config.js`](../eslint.config.js)**: Bundle entry points and module import/state boundary lint rules.
>
> **Important:** Keep this document and the implementing files above in sync whenever architecture, startup ordering, reload/disposal behavior, or API/bundle boundaries change.

---

## 1. Process Topology and Ownership Boundaries

### SDK vs. TypeScript Extension Boundary

Dart-Code runs as a workspace-host extension (`extensionKind: ["workspace"]` in [`package.json`](../package.json)) and acts as a **coordinator** rather than reimplementing language tooling in TypeScript:

- **Dart and Flutter SDKs own language and runtime tooling**: Parsing, type analysis, diagnostics, completion, refactoring, formatting, DAP debug adapters, the Dart Tooling Daemon (DTD), DevTools, the MCP server, and Flutter build/device commands all live in the SDKs. Keeping them there ensures behavior matches the active SDK version and is shared across editors.
- **TypeScript extension owns IDE integration and orchestration**: Dart-Code discovers workspaces and SDKs, spawns and supervises background processes, wires cross-process endpoints (such as sharing DTD and DevTools URLs), translates protocol events into VS Code UI (editors, status items, Test Explorer, trees, webviews), and handles user prompts and settings.
- **No Dart parsing in TypeScript**: Do not write Dart parsers, lexers, or tokenizers in extension code. Language semantics belong in the Dart analysis server / LSP; if protocol output is ambiguous, prefer updating the SDK server or using a simple documented heuristic.

### Coordinated External Processes

The extension coordinates seven external tool surfaces, sharing [`StdIOService`](../src/shared/services/stdio_service.ts) for custom line-delimited JSON stdio daemons (`FlutterDaemon`, `DartToolingDaemonProcess`, `DevToolsService`, and `FlutterWidgetPreviewServer`):

- **LSP Analysis Server** (`dart language-server --protocol=lsp`, [`src/extension/analysis/analyzer.ts`](../src/extension/analysis/analyzer.ts)): Long-lived stdio language server managed via `vscode-languageclient`. Provides diagnostics, navigation, completions, refactors, outlines, and closing labels, and connects to DTD over WebSocket when LSP-over-DTD is supported.
- **Dart Tooling Daemon (DTD)** (`dart tooling-daemon --machine`, [`src/extension/dart/tooling_daemon.ts`](../src/extension/dart/tooling_daemon.ts), [`src/shared/services/tooling_daemon.ts`](../src/shared/services/tooling_daemon.ts)): Shared WebSocket/JSON-RPC hub spawned by the extension. Dart-Code registers `Editor` services (workspace roots, active editor location, devices, debug sessions, code navigation, hot reload/restart, and DevTools page opening) and VM Service registrations so LSP, DevTools, Widget Preview, MCP clients, and third-party extensions can coordinate through one daemon.
- **DevTools Server** (`dart devtools --machine --allow-embedding`, [`src/extension/sdk/dev_tools/manager.ts`](../src/extension/sdk/dev_tools/manager.ts)): Serves the DevTools web app for embedded editor webviews, sidebar views, and external browsers; receives VM Service registrations and connects to DTD.
- **Flutter Daemon** (`flutter daemon`, [`src/extension/flutter/flutter_daemon.ts`](../src/extension/flutter/flutter_daemon.ts)): Long-lived stdio daemon started only for Flutter workspaces to track devices, emulators, and supported platforms. In remote/custom workspaces, it can attach to a forwarded local daemon port via `nc` (`dart.daemonPort` or a local device-exposer extension) instead of spawning `flutter daemon` remotely.
- **DAP Debug Adapters** (`dart debug_adapter` / `flutter debug_adapter`, [`src/extension/providers/debug_adapter_descriptor_factory.ts`](../src/extension/providers/debug_adapter_descriptor_factory.ts)): Spawned per debug or test session by VS Code. Dart and Flutter sessions (and forced-Flutter workspaces) use the SDK DAP adapters; legacy TypeScript adapters in `src/debug/` (bundled to `out/dist/debug.js`) exist only for remaining non-SDK targets such as Web/WebTest and should not be modified.
- **Dart SDK MCP Server & LM Tools** (`dart mcp-server`, [`src/extension/providers/mcp_server_definition_provider.ts`](../src/extension/providers/mcp_server_definition_provider.ts), [`src/shared/vscode/mcp.ts`](../src/shared/vscode/mcp.ts)): Registered declaratively via `vs.lm.registerMcpServerDefinitionProvider` so VS Code spawns and manages `dart mcp-server` lazily when requested, paired with IDE-integrated Language Model Tools (`get_dart_tooling_daemon_dtd_uri`, `dart_format`, `dart_fix`).
- **Flutter Widget Preview** (`flutter widget-preview start --machine --web-server`, [`src/extension/flutter/widget_preview/widget_preview_manager.ts`](../src/extension/flutter/widget_preview/widget_preview_manager.ts), [`src/extension/flutter/widget_preview_server.ts`](../src/extension/flutter/widget_preview_server.ts)): Optional Flutter web server for embedded or sidebar widget previews; waits for DTD (and DevTools if already starting) before launching.

---

## 2. Activation Ordering and Eager vs. Deferred Startup

VS Code activates Dart-Code from [`package.json`](../package.json) activation events (`pubspec.yaml`, `analysis_options.yaml`, `.dart_tool`, `*.dart`, `dart.create`/`flutter.create` trigger files, Dart/Flutter task types, URI handling, and dynamic debug configuration). Inside `activate()` ([`src/extension/extension.ts`](../src/extension/extension.ts)), initialization follows strict ordering constraints:

1. **Early environment and config wiring before SDK scanning**: Caches are cleared, logging and `_dart.reloadExtension` are registered, `toolEnv` is initialized, and the initial `onDidChangeConfiguration` listener is attached *before* `sdkUtils.scanWorkspace()`. This ensures interactive SDK selection (such as "Locate SDK") reloads `config` and `toolEnv` immediately. If required SDKs are still missing, `activate()` delegates to `sdkUtils.handleMissingSdks()` and returns early without starting background services.
2. **Scoped terminal `PATH` injection**: When `dart.addSdkToTerminalPath` is enabled, only the active SDK's `bin/` directory (`flutter/bin` for Flutter workspaces, otherwise `dart/bin`) is prepended to `context.environmentVariableCollection` (keeping internal `toolEnv` overrides out of user terminals). When disabled, the collection is explicitly cleared because VS Code persists it across reloads.
3. **New-project triggers before starting the analyzer**: On initial activation (`!isRestart`), `await handleNewProjects()` ([`src/extension/user_prompts.ts`](../src/extension/user_prompts.ts)) runs to completion before creating DTD or `LspAnalyzer`. Waiting prevents transient errors during scaffolding/initial `pub get` and avoids startup races such as Dart-Code#2793.
4. **DTD before LSP and downstream consumers**: `VsCodeDartToolingDaemon` is instantiated before `LspAnalyzer`, `DevToolsManager`, `FlutterWidgetPreviewManager`, and `McpTools` so every consumer receives the shared `dtdUri` promise and `extensionApiModel` can publish it. DTD's working directory is set to the first Dart project (or first Dart workspace folder) because DTD uses its CWD as the project root (`dart-lang/sdk#64641`). Because `DebugCommands` depends on `analyzer.fileTracker` and `devTools`, it is created later and handed to DTD asynchronously via `debugCommandsCompleter`.
5. **Eager vs. lazy service startup**:
   - **Eager**: `FlutterDaemon` (in Flutter workspaces), DTD (when supported and not disabled), and `LspAnalyzer`.
   - **DevTools Server (lazy by default, eager when shared)**: Starts on first DevTools launch, unless `workspaceContext.config.startDevToolsServerEagerly` is set—which happens automatically for Flutter workspaces with `dart.shareDevToolsWithFlutter` enabled (so a running DevTools URL can be passed to `flutter run`) and in custom Bazel workspace configurations ([`src/shared/utils/workspace.ts`](../src/shared/utils/workspace.ts)).
   - **Widget Preview (configurable)**: Driven by `dart.flutterWidgetPreview` (`startLazily`, `startEagerly`, or `disabled`). In sidebar mode, the webview container registers immediately and starts the server once resolved (or immediately when `startEagerly` is configured).
   - **MCP & LM Tools (VS Code-managed, feature-detected)**: `DartMcpServerDefinitionProvider` and `McpTools` are guarded by API feature checks and `try`/`catch` blocks so unsupported or older VS Code builds fail gracefully without breaking activation.
6. **Deferred startup `pub` checks**: Initial package checks (`checkForPackages()`) are scheduled via `runWhenReadyOrAfterTimeout(analyzer.onInitialAnalysis, fiveSecondsInMs, ...)` ([`src/shared/utils/promises.ts`](../src/shared/utils/promises.ts)) unless `disableAutomaticPub` is set. Deferring avoids competing with the LSP initialization handshake on startup while guaranteeing checks still run on large workspaces or if initial analysis fails to complete.
7. **Non-awaited companion Flutter extension activation**: When `workspaceContext.shouldLoadFlutterExtension` is true, `flutterExtension.activate()` is triggered without `await`ing it. The Flutter extension awaits Dart-Code's activation to read its exported API, so awaiting Flutter here would cause a mutual activation deadlock.
8. **Post-startup workspace watchers**: Dart-only workspaces register `FlutterProjectWatcher` ([`src/extension/flutter/flutter_project_watcher.ts`](../src/extension/flutter/flutter_project_watcher.ts)) to prompt for a reload if a Flutter `pubspec.yaml` appears. `onDidChangeWorkspaceFolders` rescans and prompts for a reload if Flutter or Fuchsia workspace classification changed (otherwise firing `onPackageMapChange` and re-checking packages), and a `**/.dart_tool/package_config.json` watcher clears caches and fires `onPackageMapChange`.

---

## 3. Internal Reloads, Restarts, and Disposal

### Coalesced Internal Reloads (`_dart.reloadExtension`)

Rather than forcing a full VS Code window reload when SDKs, workspace classification, or startup settings change, Dart-Code supports an in-process restart via `_dart.reloadExtension` ([`src/extension/extension.ts`](../src/extension/extension.ts)):

- **Sequence**: `deactivate(true, reason)` → `disposeAllAsync(context.subscriptions)` → `activate(context, true)`, tagged with an [`ExtensionRestartReason`](../src/shared/constants.ts) for telemetry and analyzer `--start-reason`. User-confirmed restarts route through [`promptToReloadExtension()`](../src/extension/utils.ts).
- **Overlap coalescing**: Concurrent reload requests share a single module-level `reloadPromise` so teardown and re-activation never interleave or spawn duplicate background processes.
- **Unified server restart**: Manual `dart.restartAnalysisServer` ([`src/extension/commands/analyzer.ts`](../src/extension/commands/analyzer.ts)) captures a `ringLog` snapshot and invokes `_dart.reloadExtension` rather than restarting only LSP, keeping DTD, DevTools, and dependent state consistent.

### Reload Triggers and Settings Categories

Configuration changes are debounced (`dart.configChangeDebounceDelayMs`, default 2 seconds) and diffed against `getSettingsThatRequireRestart()` in [`src/extension/extension.ts`](../src/extension/extension.ts). Four categories require an internal reload:

- **SDK paths & discovery**: `sdkPath`, `sdkPaths` (list length), `flutterSdkPath`, `flutterSdkPaths` (list length).
- **Analyzer startup & diagnostics**: `analyzerPath`, `analyzerDiagnosticsPort`, `analyzerVmServicePort`, `analyzerAdditionalArgs`, `analyzerVmAdditionalArgs`.
- **Log file paths**: `extensionLogFile`, `analyzerLogFile`, `analyzerInstrumentationLogFile`, `analyzerSessionLogFile`, `devToolsLogFile`, `flutterDaemonLogFile`, `flutterWidgetPreviewLogFile`, `toolingDaemonLogFile`.
- **Activation-time registrations & device startup**: `closingLabels`, `showMainCodeLens`, `showTestCodeLens`, `flutterSelectDeviceWhenConnected`, `flutterAdbConnectOnChromeOs`.

Settings outside this set (such as `dart.env` / telemetry flags updating `toolEnv`, `dart.showSkippedTests` updating `TestModel`, or `dart.mcpServer*` refreshing MCP definitions) apply dynamically without reloading. If `sdkPath` or `flutterSdkPath` changes within 1.5 seconds of activation, Dart-Code displays a warning with filtered startup logs so users can identify external tools causing restart churn.

Non-configuration events that also trigger `_dart.reloadExtension` (directly or via prompt) include workspace folder Flutter/Fuchsia classification changes, `FlutterProjectWatcher`, SDK `version` file updates on disk, interactive SDK locate/clone/upgrade flows, enabling a new Flutter platform, and unrecoverable daemon failures.

### Crash and Restart Recovery Principles

- **LSP Analysis Server (`DartErrorHandler`)**: Automatically restarts after unexpected post-startup crashes up to `maxRestartCount = 2` times within a 3-minute sliding window, notifying the user with logs. Whenever the client enters `Running`, it reconnects to DTD; whenever it leaves `Running`, it resets `statusItem.busy` and `isAnalyzing` so progress never sticks. It refuses automatic restarts when already disposed, when a crash occurs during startup (`Starting` or `StartFailed`), or when the crash-loop threshold (3 crashes within 3 minutes) is exceeded, prompting the user to reload instead.
- **Flutter Daemon**: Prompts to reload (throttled to 10 minutes) on unclean exit, failed stdin writes, or missed 60-second `daemon.version` pings for remote forwarded (`nc`) daemons. Key startup/discovery calls (`device.enable`, `emulator.getEmulators`, `daemon.getSupportedPlatforms`) wrap requests with `withRecordedTimeout` (20-second caller fallback; 2-minute hang detection logging telemetry and prompting on macOS), and post-exit initialization races settle quietly during shutdown while explicit post-exit user actions still surface the prompt.
- **DTD**: Does not auto-respawn independently because connected tools and extensions hold its ephemeral WebSocket URI and auth secret. WebSocket closure clears the live connection, settles `connected`, rejects pending requests, and waits 5 seconds before showing a reload prompt (10-minute throttle) so process termination takes precedence; on process exit, its status bar item also becomes a manual reload trigger.
- **DevTools & Widget Preview**: DevTools clears `devtoolsUrl`, resets its status bar item, and resets `portToBind` to `0` on non-zero exit so a conflicting reused port does not poison future retries. Widget Preview rejects its `previewUrl` promise on exit so pending webviews fail cleanly.

### Bounded `deactivate()` Cleanup

`deactivate()` ([`src/extension/extension.ts`](../src/extension/extension.ts)) is structured so shutdown and restarts never hang VS Code:

- Cancels `pendingConfigReloadTimer` and `startupPackageCheck`, and clears `previousSettingsObject` immediately so configuration events firing during teardown cannot schedule a new reload.
- Clears `extensionApiModel`, then runs `tryCleanup()` in `Promise.allSettled` across command context resets, `LspAnalyzer.dispose()`, `flutterDaemon.shutdown()` (which races `daemon.shutdown` against `processExit`), and per-category file loggers.
- [`disposeAllAsync()`](../src/shared/utils.ts) bounds async subscription disposal to **3 seconds**. `LspAnalyzer` awaits `clientStartPromise` before calling `client.stop()` while `handleDisposeCleanup()` force-kills the analyzer process after 3 seconds if it has not exited (which also unblocks a stalled startup). `StdIOService.dispose()` terminates tracked `additionalPidsToTerminate` alongside the main child process.
- Waits briefly (100 ms) for log queues to flush; on full shutdown it then closes `logger`, `ringLogger`, and `extensionLog`, whereas on internal restarts (`isRestart = true`) it waits 300 ms before re-activating.

### State Preserved Across Internal Restarts vs. Persistent Storage

During `_dart.reloadExtension` (`isRestart = true`), specific module-level state intentionally survives across `deactivate()`/`activate()`:

- **API and log singletons**: `exportedApi` and `extensionApiModel` keep object identity (live internal references and CodeLens suppressions are cleared on `deactivate()` and repopulated on `activate()`), preserving external extension references and `onSdksChanged`/`onDtdUriChanged` subscriptions. `ringLog` (last 500 events), `ringLogger`, `EmittingLogger`, and the main `extensionLog` (unless `extensionLogFile` changed) also persist.
- **DevTools continuity**: `portToBind` and `devToolsEmbeddedViews` in [`src/extension/sdk/dev_tools/manager.ts`](../src/extension/sdk/dev_tools/manager.ts) persist across restarts so open DevTools browser tabs remain valid on the same port and open embedded panels reload cleanly against the new server/DTD.
- **Session-level flags and initial-only skips**: `extensionTotalSessionStart`, `experiments`, `perSessionWebviewStateKey`, `dartCapabilities`/`flutterCapabilities` singletons (updated in place), and one-shot/rate-limited session guards (`forcedReanalyzeCount`, one-shot TODO/analyzer error flags) persist. `handleNewProjects()`, `showUserPrompts()`, and `analytics.logExtensionActivated()` are skipped when `isRestart` is true.

For durable storage across VS Code sessions, all state goes through the [`Context`](../src/shared/vscode/workspace.ts) wrapper (enforced by the `dart-code/no-extension-context-state` ESLint rule) with explicit scoping: `globalState` (cross-profile user JSON file), `profileState` (active VS Code profile), and `workspaceState` (active workspace).

---

## 4. Bundle and API Boundaries

### Webpack Bundle Split and Import Rules

Build and test compilation deliberately split the codebase along runtime boundaries:

- **Bundled runtime ([`webpack.config.js`](../webpack.config.js))**: Produces two CommonJS bundles in `out/dist/`: `extension.js` (from `src/extension/extension.ts`, referenced by `package.json` `"main"`) and `debug.js` (from `src/debug/debug_entry.ts`, for legacy standalone debug adapters).
- **Unpacked tests ([`tsconfig.build.json`](../tsconfig.build.json))**: `npm run build-tests` compiles `src/shared/` and `src/test/` directly to `out/src/`, explicitly excluding `src/extension/` and `src/debug/`.
- **Enforced import rules ([`eslint.config.js`](../eslint.config.js))**:
  - Code outside `src/extension/` (including `src/test/` and `src/shared/`) cannot import from `src/extension/`.
  - Code outside `src/debug/` (except `src/test/`) cannot import from `src/debug/`.
  - Code in `src/shared/` cannot import `vscode` except inside `vscode/` subfolders (`src/shared/vscode/`), keeping core shared utilities host-agnostic.
- **Dual-load invariant for `src/shared/`**: Because tests execute unpacked (`out/src/shared/`) against the Webpack-bundled extension (`out/dist/extension.js`), every `src/shared/` module is instantiated twice during test runs. Consequently, `src/shared/` must not hold mutable global/singleton state (immutable constants and lazy caches of deterministic environment values such as OS/WSL detection are fine), and `instanceof` must not be used on `src/shared/` classes across the extension/test boundary because constructors differ between the two module graphs.

### Public Extension API (`PublicDartExtensionApi`)

Defined in [`src/shared/vscode/extension_api.ts`](../src/shared/vscode/extension_api.ts) and implemented by `PublicDartExtensionApiImpl` / `extensionApiModel` in [`src/extension/api/extension_api.ts`](../src/extension/api/extension_api.ts), the public API is returned by `activate()` for the companion Flutter extension and third-party extensions:

- **Versioned and immutable**: Exposes `version` (`3`), SDK discovery (`sdks`, `onSdksChanged`), DTD URI (`dtdUri`, `onDtdUriChanged`), `workspace` (`getOutline`, `findProjectFolders`), `sdk` (`runDart`, `runPub`, `startDart`), and `features` (`codeLens.suppress` with stackable disposables). Returned objects and events provide copies/snapshots so callers cannot mutate internal state.
- **Stable across internal reloads**: `exportedApi` is instantiated once at module load and backed by `extensionApiModel`, keeping caller references and event subscriptions valid across `_dart.reloadExtension`.

### Test-Only Private API (`privateApi`)

Defined by [`InternalExtensionApi`](../src/shared/vscode/interfaces.ts) and attached to `exportedApi` under [`internalApiSymbol`](../src/shared/symbols.ts) (`"_privateApi"`) **only when `isDartCodeTestRun` (`DART_CODE_IS_TEST_RUN`) is set**:

- **Cross-bundle test bridge**: Gives tests access to internal extension services without importing `src/extension/` (which would violate ESLint and load duplicate unpacked extension state).
- **String property key**: `internalApiSymbol` uses a string literal rather than a JavaScript `Symbol()` because `src/shared/symbols.ts` is duplicated across the Webpack bundle and unpacked test code, where distinct `Symbol()` instances would not match.
- **Live property attachment**: Copied onto `exportedApi[internalApiSymbol]` with `Object.defineProperties()` so getters and references stay live across internal reloads.
