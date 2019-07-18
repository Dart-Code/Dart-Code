import * as fs from "fs";
import * as path from "path";
import { isArray } from "util";
import * as vs from "vscode";
import { DaemonCapabilities, FlutterCapabilities } from "../shared/capabilities/flutter";
import { analyzerSnapshotPath, dartPlatformName, dartVMPath, flutterExtensionIdentifier, flutterPath, HAS_LAST_DEBUG_CONFIG, isWin, IS_RUNNING_LOCALLY_CONTEXT, platformDisplayName } from "../shared/constants";
import { LogCategory } from "../shared/enums";
import { IFlutterDaemon, Sdks } from "../shared/interfaces";
import { captureLogs, EmittingLogger, logToConsole } from "../shared/logging";
import { internalApiSymbol } from "../shared/symbols";
import { forceWindowsDriveLetterToUppercase, isWithinPath } from "../shared/utils";
import { FlutterDeviceManager } from "../shared/vscode/device_manager";
import { extensionVersion, isDevExtension } from "../shared/vscode/extension_utils";
import { InternalExtensionApi } from "../shared/vscode/interfaces";
import { DartUriHandler } from "../shared/vscode/uri_handlers/uri_handler";
import { fsPath, getDartWorkspaceFolders, isRunningLocally } from "../shared/vscode/utils";
import { Context } from "../shared/vscode/workspace";
import { WorkspaceContext } from "../shared/workspace";
import { Analyzer } from "./analysis/analyzer";
import { AnalyzerStatusReporter } from "./analysis/analyzer_status_reporter";
import { FileChangeHandler } from "./analysis/file_change_handler";
import { openFileTracker } from "./analysis/open_file_tracker";
import { Analytics } from "./analytics";
import { DartExtensionApi } from "./api";
import { TestCodeLensProvider } from "./code_lens/test_code_lens_provider";
import { AnalyzerCommands } from "./commands/analyzer";
import { DebugCommands } from "./commands/debug";
import { EditCommands } from "./commands/edit";
import { FlutterOutlineCommands } from "./commands/flutter_outline";
import { GoToSuperCommand } from "./commands/go_to_super";
import { LoggingCommands } from "./commands/logging";
import { OpenInOtherEditorCommands } from "./commands/open_in_other_editors";
import { RefactorCommands } from "./commands/refactor";
import { SdkCommands } from "./commands/sdk";
import { cursorIsInTest, TestCommands } from "./commands/test";
import { TypeHierarchyCommand } from "./commands/type_hierarchy";
import { config } from "./config";
import { ClosingLabelsDecorations } from "./decorations/closing_labels_decorations";
import { FlutterUiGuideDecorations } from "./decorations/flutter_ui_guides_decorations";
import { HotReloadCoverageDecorations } from "./decorations/hot_reload_coverage_decorations";
import { setUpDaemonMessageHandler } from "./flutter/daemon_message_handler";
import { FlutterDaemon } from "./flutter/flutter_daemon";
import { FlutterOutlineProvider } from "./flutter/flutter_outline_view";
import { setUpHotReloadOnSave } from "./flutter/hot_reload_save_handler";
import { AssistCodeActionProvider } from "./providers/assist_code_action_provider";
import { DartCompletionItemProvider } from "./providers/dart_completion_item_provider";
import { DartDiagnosticProvider } from "./providers/dart_diagnostic_provider";
import { DartDocumentSymbolProvider } from "./providers/dart_document_symbol_provider";
import { DartFoldingProvider } from "./providers/dart_folding_provider";
import { DartFormattingEditProvider } from "./providers/dart_formatting_edit_provider";
import { DartDocumentHighlightProvider } from "./providers/dart_highlighting_provider";
import { DartHoverProvider } from "./providers/dart_hover_provider";
import { DartImplementationProvider } from "./providers/dart_implementation_provider";
import { DartLanguageConfiguration } from "./providers/dart_language_configuration";
import { DartReferenceProvider } from "./providers/dart_reference_provider";
import { DartRenameProvider } from "./providers/dart_rename_provider";
import { DartSignatureHelpProvider } from "./providers/dart_signature_help_provider";
import { DartWorkspaceSymbolProvider } from "./providers/dart_workspace_symbol_provider";
import { DebugConfigProvider } from "./providers/debug_config_provider";
import { FixCodeActionProvider } from "./providers/fix_code_action_provider";
import { IgnoreLintCodeActionProvider } from "./providers/ignore_lint_code_action_provider";
import { LegacyDartWorkspaceSymbolProvider } from "./providers/legacy_dart_workspace_symbol_provider";
import { RankingCodeActionProvider } from "./providers/ranking_code_action_provider";
import { RefactorCodeActionProvider } from "./providers/refactor_code_action_provider";
import { SnippetCompletionItemProvider } from "./providers/snippet_completion_item_provider";
import { SourceCodeActionProvider } from "./providers/source_code_action_provider";
import { PubBuildRunnerTaskProvider } from "./pub/build_runner_task_provider";
import { PubGlobal } from "./pub/global";
import { DartCapabilities } from "./sdk/capabilities";
import { StatusBarVersionTracker } from "./sdk/status_bar_version_tracker";
import { checkForStandardDartSdkUpdates } from "./sdk/update_check";
import { SdkUtils } from "./sdk/utils";
import { showUserPrompts } from "./user_prompts";
import * as util from "./utils";
import { addToLogHeader, clearLogHeader, getExtensionLogPath, getLogHeader } from "./utils/log";
import { safeSpawn } from "./utils/processes";
import { DartPackagesProvider } from "./views/packages_view";
import { TestItemTreeItem, TestResultsProvider } from "./views/test_view";

const DART_MODE: vs.DocumentFilter = { language: "dart", scheme: "file" };
const HTML_MODE: vs.DocumentFilter = { language: "html", scheme: "file" };

const DART_PROJECT_LOADED = "dart-code:dartProjectLoaded";
// TODO: Define what this means better. Some commands a general Flutter (eg. Hot
// Reload) and some are more specific (eg. Attach).
const FLUTTER_PROJECT_LOADED = "dart-code:anyFlutterProjectLoaded";
const FLUTTER_MOBILE_PROJECT_LOADED = "dart-code:flutterMobileProjectLoaded";
const FLUTTER_WEB_PROJECT_LOADED = "dart-code:flutterWebProjectLoaded";
export const FLUTTER_SUPPORTS_ATTACH = "dart-code:flutterSupportsAttach";
const DART_PLATFORM_NAME = "dart-code:dartPlatformName";
export const SERVICE_EXTENSION_CONTEXT_PREFIX = "dart-code:serviceExtension.";
export const SERVICE_CONTEXT_PREFIX = "dart-code:service.";

let analyzer: Analyzer;
let flutterDaemon: IFlutterDaemon;
let deviceManager: FlutterDeviceManager;
const dartCapabilities = DartCapabilities.empty;
const flutterCapabilities = FlutterCapabilities.empty;
let analysisRoots: string[] = [];
let analytics: Analytics;

let showTodos: boolean | undefined;
let previousSettings: string;
let extensionLogger: { dispose: () => Promise<void> | void };

// TODO: If dev mode, subscribe to logs for errors/warnings and surface to UI
// (with dispose calls)
const logger = new EmittingLogger();

export function activate(context: vs.ExtensionContext, isRestart: boolean = false) {
	if (isDevExtension)
		logToConsole(logger);

	vs.commands.executeCommand("setContext", IS_RUNNING_LOCALLY_CONTEXT, isRunningLocally);
	if (!extensionLogger)
		extensionLogger = captureLogs(logger, getExtensionLogPath(), undefined, 4000, [LogCategory.General]);

	const extContext = Context.for(context);

	util.logTime("Code called activate");

	// Wire up a reload command that will re-initialise everything.
	context.subscriptions.push(vs.commands.registerCommand("_dart.reloadExtension", (_) => {
		logger.info("Performing silent extension reload...");
		deactivate(true);
		const toDispose = context.subscriptions.slice();
		context.subscriptions.length = 0;
		for (const sub of toDispose) {
			try {
				sub.dispose();
			} catch (e) {
				logger.error(e);
			}
		}
		activate(context, true);
		logger.info("Done!");
	}));

	showTodos = config.showTodos;
	previousSettings = getSettingsThatRequireRestart();

	const extensionStartTime = new Date();
	util.logTime();
	const sdkUtils = new SdkUtils(logger);
	const workspaceContext = sdkUtils.scanWorkspace();
	util.logTime("initWorkspace");
	const sdks = workspaceContext.sdks;
	buildLogHeaders(workspaceContext);
	analytics = new Analytics(logger, workspaceContext);
	if (!sdks.dart || (workspaceContext.hasAnyFlutterProjects && !sdks.flutter)) {
		// Don't set anything else up; we can't work like this!
		return sdkUtils.handleMissingSdks(context, analytics, workspaceContext);
	}

	if (sdks.flutterVersion) {
		flutterCapabilities.version = sdks.flutterVersion;
		analytics.flutterSdkVersion = sdks.flutterVersion;
	}

	// Show the SDK version in the status bar.
	if (sdks.dartVersion) {
		dartCapabilities.version = sdks.dartVersion;
		analytics.sdkVersion = sdks.dartVersion;
		checkForStandardDartSdkUpdates(logger, workspaceContext);
		context.subscriptions.push(new StatusBarVersionTracker(workspaceContext));
	}

	// Fire up the analyzer process.
	const analyzerStartTime = new Date();
	const analyzerPath = config.analyzerPath || path.join(sdks.dart, analyzerSnapshotPath);
	// If the ssh host is set, then we are running the analyzer on a remote machine, that same analyzer
	// might not exist on the local machine.
	if (!config.analyzerSshHost && !fs.existsSync(analyzerPath)) {
		vs.window.showErrorMessage("Could not find a Dart Analysis Server at " + analyzerPath);
		return;
	}

	analyzer = new Analyzer(logger, path.join(sdks.dart, dartVMPath), analyzerPath);
	context.subscriptions.push(analyzer);

	// Log analysis server startup time when we get the welcome message/version.
	const connectedEvents = analyzer.registerForServerConnected((sc) => {
		analytics.analysisServerVersion = sc.version;
		const analyzerEndTime = new Date();
		analytics.logAnalyzerStartupTime(analyzerEndTime.getTime() - analyzerStartTime.getTime());
		connectedEvents.dispose();
	});

	const nextAnalysis = () =>
		new Promise<void>((resolve, reject) => {
			const disposable = analyzer.registerForServerStatus((ss) => {
				if (ss.analysis && !ss.analysis.isAnalyzing) {
					resolve();
					disposable.dispose();
				}
			});
		});

	// Log analysis server first analysis completion time when it completes.
	let analysisStartTime: Date;
	const initialAnalysis = nextAnalysis();
	const analysisCompleteEvents = analyzer.registerForServerStatus((ss) => {
		// Analysis started for the first time.
		if (ss.analysis && ss.analysis.isAnalyzing && !analysisStartTime)
			analysisStartTime = new Date();

		// Analysis ends for the first time.
		if (ss.analysis && !ss.analysis.isAnalyzing && analysisStartTime) {
			const analysisEndTime = new Date();
			analytics.logAnalyzerFirstAnalysisTime(analysisEndTime.getTime() - analysisStartTime.getTime());
			analysisCompleteEvents.dispose();
		}
	});

	// Set up providers.
	// TODO: Do we need to push all these to subscriptions?!
	const hoverProvider = new DartHoverProvider(logger, analyzer);
	const formattingEditProvider = new DartFormattingEditProvider(logger, analyzer, extContext);
	context.subscriptions.push(formattingEditProvider);
	const completionItemProvider = new DartCompletionItemProvider(logger, analyzer);
	const referenceProvider = new DartReferenceProvider(analyzer);
	const documentHighlightProvider = new DartDocumentHighlightProvider(analyzer);
	const sourceCodeActionProvider = new SourceCodeActionProvider();

	const renameProvider = new DartRenameProvider(analyzer);
	const implementationProvider = new DartImplementationProvider(analyzer);

	const activeFileFilters = [DART_MODE];
	if (config.analyzeAngularTemplates && analyzer.capabilities.supportsAnalyzingHtmlFiles) {
		// Analyze Angular2 templates, requires the angular_analyzer_plugin.
		activeFileFilters.push(HTML_MODE);
	}

	// This is registered with VS Code further down, so it's metadata can be collected from all
	// registered providers.
	const rankingCodeActionProvider = new RankingCodeActionProvider();

	const triggerCharacters = ".(${'\"/\\".split("");
	context.subscriptions.push(vs.languages.registerHoverProvider(activeFileFilters, hoverProvider));
	formattingEditProvider.registerDocumentFormatter(activeFileFilters);
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(activeFileFilters, completionItemProvider, ...triggerCharacters));
	context.subscriptions.push(vs.languages.registerDefinitionProvider(activeFileFilters, referenceProvider));
	context.subscriptions.push(vs.languages.registerReferenceProvider(activeFileFilters, referenceProvider));
	context.subscriptions.push(vs.languages.registerDocumentHighlightProvider(activeFileFilters, documentHighlightProvider));
	rankingCodeActionProvider.registerProvider(new AssistCodeActionProvider(logger, activeFileFilters, analyzer));
	rankingCodeActionProvider.registerProvider(new FixCodeActionProvider(logger, activeFileFilters, analyzer));
	rankingCodeActionProvider.registerProvider(new RefactorCodeActionProvider(activeFileFilters, analyzer));
	context.subscriptions.push(vs.languages.registerRenameProvider(activeFileFilters, renameProvider));

	// Some actions only apply to Dart.
	formattingEditProvider.registerTypingFormatter(DART_MODE, "}", ";");
	context.subscriptions.push(vs.languages.registerCodeActionsProvider(DART_MODE, sourceCodeActionProvider, sourceCodeActionProvider.metadata));

	rankingCodeActionProvider.registerProvider(new IgnoreLintCodeActionProvider(activeFileFilters));
	context.subscriptions.push(vs.languages.registerImplementationProvider(DART_MODE, implementationProvider));
	if (config.showTestCodeLens) {
		const codeLensProvider = new TestCodeLensProvider(logger, analyzer);
		context.subscriptions.push(codeLensProvider);
		context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
	}

	// Register the ranking provider from VS Code now that it has all of its delegates.
	context.subscriptions.push(vs.languages.registerCodeActionsProvider(activeFileFilters, rankingCodeActionProvider, rankingCodeActionProvider.metadata));

	// Task handlers.
	if (config.previewBuildRunnerTasks) {
		context.subscriptions.push(vs.tasks.registerTaskProvider("pub", new PubBuildRunnerTaskProvider(sdks)));
	}

	// Snippets are language-specific
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider("snippets/dart.json", (_) => true)));
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider("snippets/flutter.json", (uri) => util.isInsideFlutterProject(uri) || util.isInsideFlutterWebProject(uri))));

	context.subscriptions.push(vs.languages.setLanguageConfiguration(DART_MODE.language, new DartLanguageConfiguration()));
	const statusReporter = new AnalyzerStatusReporter(logger, analyzer, workspaceContext, analytics);

	// Set up diagnostics.
	const diagnostics = vs.languages.createDiagnosticCollection("dart");
	context.subscriptions.push(diagnostics);
	const diagnosticsProvider = new DartDiagnosticProvider(analyzer, diagnostics);

	// TODO: Currently calculating analysis roots requires the version to check if
	// we need the package workaround. In future if we stop supporting server < 1.20.1 we
	// can unwrap this call so that it'll start sooner.
	const serverConnected = analyzer.registerForServerConnected((sc) => {
		serverConnected.dispose();
		if (vs.workspace.workspaceFolders)
			recalculateAnalysisRoots();
	});

	// Hook editor changes to send updated contents to analyzer.
	context.subscriptions.push(new FileChangeHandler(analyzer));

	// Fire up Flutter daemon if required.
	if (workspaceContext.hasAnyFlutterMobileProjects) {
		flutterDaemon = new FlutterDaemon(logger, path.join(sdks.flutter, flutterPath), sdks.flutter);
		deviceManager = new FlutterDeviceManager(logger, flutterDaemon, config.flutterSelectDeviceWhenConnected);

		context.subscriptions.push(deviceManager);
		context.subscriptions.push(flutterDaemon);

		flutterDaemon.deviceEnable();
		setUpDaemonMessageHandler(logger, context, flutterDaemon);

		context.subscriptions.push(vs.commands.registerCommand("flutter.selectDevice", deviceManager.showDevicePicker, deviceManager));
		context.subscriptions.push(vs.commands.registerCommand("flutter.launchEmulator", deviceManager.promptForAndLaunchEmulator, deviceManager));
	}

	util.logTime("All other stuff before debugger..");

	const pubGlobal = new PubGlobal(logger, extContext, sdks);

	// Set up debug stuff.
	const debugProvider = new DebugConfigProvider(logger, sdks, analytics, pubGlobal, flutterDaemon, deviceManager, flutterCapabilities);
	context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", debugProvider));
	context.subscriptions.push(debugProvider);

	if (config.previewFlutterUiGuides)
		context.subscriptions.push(new FlutterUiGuideDecorations(analyzer));

	// Setup that requires server version/capabilities.
	const connectedSetup = analyzer.registerForServerConnected((sc) => {
		connectedSetup.dispose();

		if (analyzer.capabilities.supportsClosingLabels && config.closingLabels) {
			context.subscriptions.push(new ClosingLabelsDecorations(analyzer));
		}

		if (analyzer.capabilities.supportsGetDeclerations) {
			context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new DartWorkspaceSymbolProvider(logger, analyzer)));
		} else {
			context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new LegacyDartWorkspaceSymbolProvider(logger, analyzer)));
		}

		if (analyzer.capabilities.supportsCustomFolding && config.analysisServerFolding)
			context.subscriptions.push(vs.languages.registerFoldingRangeProvider(DART_MODE, new DartFoldingProvider(analyzer)));

		if (analyzer.capabilities.supportsGetSignature)
			context.subscriptions.push(vs.languages.registerSignatureHelpProvider(
				DART_MODE,
				new DartSignatureHelpProvider(analyzer),
				...(config.triggerSignatureHelpAutomatically ? ["(", ","] : []),
			));

		const documentSymbolProvider = new DartDocumentSymbolProvider(logger, analyzer);
		activeFileFilters.forEach((filter) => {
			context.subscriptions.push(vs.languages.registerDocumentSymbolProvider(filter, documentSymbolProvider));
		});

		context.subscriptions.push(openFileTracker.create(logger, analyzer, workspaceContext));

		// Set up completions for unimported items.
		if (analyzer.capabilities.supportsAvailableSuggestions && config.autoImportCompletions) {
			analyzer.completionSetSubscriptions({
				subscriptions: ["AVAILABLE_SUGGESTION_SETS"],
			});
		}
	});

	// Handle config changes so we can reanalyze if necessary.
	context.subscriptions.push(vs.workspace.onDidChangeConfiguration(() => handleConfigurationChange(sdks)));

	// Register additional commands.
	const analyzerCommands = new AnalyzerCommands(context, analyzer);
	const sdkCommands = new SdkCommands(logger, context, workspaceContext, sdkUtils, pubGlobal, flutterCapabilities, deviceManager);
	const debugCommands = new DebugCommands(logger, extContext, workspaceContext, analytics, pubGlobal);

	// Wire up handling of Hot Reload on Save.
	if (workspaceContext.hasAnyFlutterProjects) {
		setUpHotReloadOnSave(context, diagnostics, debugCommands);
	}

	// Register URI handler.
	context.subscriptions.push(vs.window.registerUriHandler(new DartUriHandler(flutterCapabilities)));

	// Set up commands for Dart editors.
	context.subscriptions.push(new EditCommands(logger, context, analyzer));
	context.subscriptions.push(new RefactorCommands(logger, context, analyzer));

	// Register misc commands.
	context.subscriptions.push(new TypeHierarchyCommand(logger, analyzer));
	context.subscriptions.push(new GoToSuperCommand(analyzer));
	context.subscriptions.push(new LoggingCommands(logger, context.logPath));
	context.subscriptions.push(new OpenInOtherEditorCommands(logger, sdks));
	context.subscriptions.push(new TestCommands(logger));

	// Register our view providers.
	const dartPackagesProvider = new DartPackagesProvider(logger);
	const packagesTreeView = vs.window.createTreeView("dartPackages", { treeDataProvider: dartPackagesProvider });
	context.subscriptions.push(
		dartPackagesProvider,
		packagesTreeView,
	);
	const testTreeProvider = new TestResultsProvider();
	const testTreeView = vs.window.createTreeView("dartTestTree", { treeDataProvider: testTreeProvider });
	context.subscriptions.push(
		testTreeProvider,
		testTreeView,
		testTreeProvider.onDidStartTests((node) => {
			if (config.openTestViewOnStart)
				testTreeView.reveal(node);
		}),
		testTreeProvider.onFirstFailure((node) => {
			if (config.openTestViewOnFailure)
				testTreeView.reveal(node);
		}),
		testTreeView.onDidChangeSelection((e) => {
			testTreeProvider.setSelectedNodes(e.selection && e.selection.length === 1 ? e.selection[0] as TestItemTreeItem : undefined);
		}),
	);
	let flutterOutlineTreeProvider: FlutterOutlineProvider | undefined;
	if (config.previewFlutterOutline) {
		// TODO: Extract this out - it's become messy since TreeView was added in.
		flutterOutlineTreeProvider = new FlutterOutlineProvider(analyzer);
		const tree = vs.window.createTreeView("dartFlutterOutline", { treeDataProvider: flutterOutlineTreeProvider, showCollapseAll: true });
		tree.onDidChangeSelection((e) => {
			// TODO: This should be in a tree, not the data provider.
			flutterOutlineTreeProvider.setContexts(e.selection);
		});

		context.subscriptions.push(vs.window.onDidChangeTextEditorSelection((e) => {
			if (e.selections && e.selections.length) {
				const node = flutterOutlineTreeProvider.getNodeAt(e.textEditor.document.uri, e.selections[0].start);
				if (node && tree.visible)
					tree.reveal(node, { select: true, focus: false, expand: true });
			}
		}));
		context.subscriptions.push(tree);
		context.subscriptions.push(flutterOutlineTreeProvider);
		const flutterOutlineCommands = new FlutterOutlineCommands(tree, context);
	}

	if (workspaceContext.hasAnyFlutterProjects && config.previewHotReloadCoverageMarkers) {
		context.subscriptions.push(new HotReloadCoverageDecorations(logger, debugCommands));
	}

	context.subscriptions.push(vs.commands.registerCommand("dart.package.openFile", (filePath) => {
		if (!filePath) return;

		vs.workspace.openTextDocument(filePath).then((document) => {
			vs.window.showTextDocument(document, { preview: true });
		}, (error) => logger.error(error));
	}));

	// Warn the user if they've opened a folder with mismatched casing.
	if (vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length) {
		for (const wf of vs.workspace.workspaceFolders) {
			const userPath = forceWindowsDriveLetterToUppercase(fsPath(wf.uri));
			const realPath = forceWindowsDriveLetterToUppercase(fs.realpathSync.native(userPath));
			// Since realpathSync.native will resolve symlinks, we'll only show these warnings
			// when there was no symlink (eg. the lowercase version of both paths match).
			if (userPath && realPath && userPath.toLowerCase() === realPath.toLowerCase() && userPath !== realPath) {
				vs.window.showWarningMessage(
					`The casing of the open workspace folder does not match the casing on the underlying disk; please re-open the folder using the File Open dialog. `
					+ `Expected ${realPath} but got ${userPath}`,
				);
				break;
			}
		}
	}

	// Prompt user for any special config we might want to set.
	if (!isRestart)
		showUserPrompts(logger, extContext, workspaceContext);

	// Turn on all the commands.
	setCommandVisiblity(true, workspaceContext);
	vs.commands.executeCommand("setContext", DART_PLATFORM_NAME, dartPlatformName);

	// Prompt for pub get if required
	function checkForPackages() {
		// Don't prompt for package updates in the Fuchsia tree.
		if (workspaceContext.hasProjectsInFuchsiaTree) // TODO: This should be tested per-project.
			return;
		sdkCommands.fetchPackagesOrPrompt(undefined, { alwaysPrompt: true });
	}
	if (!isRestart)
		checkForPackages();

	// Begin activating dependant packages.
	if (workspaceContext.shouldLoadFlutterExtension) {
		const flutterExtension = vs.extensions.getExtension(flutterExtensionIdentifier);
		if (flutterExtension) {
			logger.info(`Activating Flutter extension for ${workspaceContext.workspaceTypeDescription} project...`);
			flutterExtension.activate();
		}
	}

	// Log how long all this startup took.
	const extensionEndTime = new Date();
	if (isRestart) {
		analytics.logExtensionRestart(extensionEndTime.getTime() - extensionStartTime.getTime());
	} else {
		analytics.logExtensionStartup(extensionEndTime.getTime() - extensionStartTime.getTime());
	}

	// Handle changes to the workspace.
	// Set the roots, handling project changes that might affect SDKs.
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => {
		// First check if something changed that will affect our SDK, in which case
		// we'll perform a silent restart so that we do new SDK searches.
		const newWorkspaceContext = sdkUtils.scanWorkspace();
		if (
			newWorkspaceContext.hasOnlyDartProjects !== workspaceContext.hasOnlyDartProjects
			|| newWorkspaceContext.hasAnyFlutterProjects !== workspaceContext.hasAnyFlutterProjects
			|| newWorkspaceContext.hasProjectsInFuchsiaTree !== workspaceContext.hasProjectsInFuchsiaTree
		) {
			util.reloadExtension();
			return;
		}

		dartPackagesProvider.refresh();
		recalculateAnalysisRoots();
		checkForPackages();
	}));

	return {
		...new DartExtensionApi(),
		[internalApiSymbol]: {
			analyzerCapabilities: analyzer.capabilities,
			cancelAllAnalysisRequests: () => analyzer.cancelAllRequests(),
			completionItemProvider,
			context: extContext,
			currentAnalysis: () => analyzer.currentAnalysis,
			get cursorIsInTest() { return cursorIsInTest; },
			daemonCapabilities: flutterDaemon ? flutterDaemon.capabilities : DaemonCapabilities.empty,
			dartCapabilities,
			debugCommands,
			debugProvider,
			fileTracker: openFileTracker,
			flutterCapabilities,
			flutterOutlineTreeProvider,
			getLogHeader,
			initialAnalysis,
			logger,
			nextAnalysis,
			packagesTreeProvider: dartPackagesProvider,
			pubGlobal,
			reanalyze,
			renameProvider,
			safeSpawn,
			testTreeProvider,
			workspaceContext,
		} as InternalExtensionApi,
	};
}

function buildLogHeaders(workspaceContext: WorkspaceContext) {
	clearLogHeader();
	addToLogHeader(() => `!! PLEASE REVIEW THIS LOG FOR SENSITIVE INFORMATION BEFORE SHARING !!`);
	addToLogHeader(() => ``);
	addToLogHeader(() => `Dart Code extension: ${extensionVersion}`);
	addToLogHeader(() => {
		const ext = vs.extensions.getExtension(flutterExtensionIdentifier);
		return `Flutter extension: ${ext.packageJSON.version} (${ext.isActive ? "" : "not "}activated)`;
	});
	addToLogHeader(() => `VS Code: ${vs.version}`);
	addToLogHeader(() => `Platform: ${platformDisplayName}`);
	addToLogHeader(() => `Workspace type: ${workspaceContext.workspaceTypeDescription}`);
	addToLogHeader(() => `Multi-root?: ${vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length > 1}`);
	const sdks = workspaceContext.sdks;
	addToLogHeader(() => `Dart SDK:\n    Loc: ${sdks.dart}\n    Ver: ${util.getSdkVersion(logger, sdks.dart)}`);
	addToLogHeader(() => `Flutter SDK:\n    Loc: ${sdks.flutter}\n    Ver: ${util.getSdkVersion(logger, sdks.flutter)}`);
	addToLogHeader(() => `HTTP_PROXY: ${process.env.HTTP_PROXY}`);
	addToLogHeader(() => `NO_PROXY: ${process.env.NO_PROXY}`);
}

function recalculateAnalysisRoots() {
	analysisRoots = getDartWorkspaceFolders().map((w) => fsPath(w.uri));

	// Sometimes people open their home directories as the workspace root and
	// have all sorts of performance issues because of PubCache and AppData folders
	// so we will exclude them if the user has opened a parent folder (opening a
	// child of these directly will still work).
	const excludeFolders: string[] = [];
	if (isWin) {
		const addExcludeIfRequired = (folder: string | undefined) => {
			if (!folder || !path.isAbsolute(folder))
				return;
			const containingRoot = analysisRoots.find((root: string) => isWithinPath(folder, root));
			if (containingRoot) {
				logger.info(`Excluding folder ${folder} from analysis roots as it is a child of analysis root ${containingRoot} and may cause performance issues.`);
				excludeFolders.push(folder);
			}
		};

		addExcludeIfRequired(process.env.PUB_CACHE);
		addExcludeIfRequired(process.env.APPDATA);
		addExcludeIfRequired(process.env.LOCALAPPDATA);
	}

	// For each workspace, handle excluded folders.
	getDartWorkspaceFolders().forEach((f) => {
		const excludedForWorkspace = config.for(f.uri).analysisExcludedFolders;
		const workspacePath = fsPath(f.uri);
		if (excludedForWorkspace && isArray(excludedForWorkspace)) {
			excludedForWorkspace.forEach((folder) => {
				// Handle both relative and absolute paths.
				if (!path.isAbsolute(folder))
					folder = path.join(workspacePath, folder);
				excludeFolders.push(folder);
			});
		}
	});

	analyzer.analysisSetAnalysisRoots({
		excluded: excludeFolders,
		included: analysisRoots,
	});
}

function handleConfigurationChange(sdks: Sdks) {
	// TODOs
	const newShowTodoSetting = config.showTodos;
	const todoSettingChanged = showTodos !== newShowTodoSetting;
	showTodos = newShowTodoSetting;

	// SDK
	const newSettings = getSettingsThatRequireRestart();
	const settingsChanged = previousSettings !== newSettings;
	previousSettings = newSettings;

	if (todoSettingChanged) {
		reanalyze();
	}

	if (settingsChanged) {
		util.reloadExtension();
	}
}

function reanalyze() {
	analyzer.analysisReanalyze();
}

function getSettingsThatRequireRestart() {
	// The return value here is used to detect when any config option changes that requires a project reload.
	// It doesn't matter how these are combined; it just gets called on every config change and compared.
	// Usually these are options that affect the analyzer and need a reload, but config options used at
	// activation time will also need to be included.
	return "CONF-"
		+ config.sdkPath
		+ config.analyzerPath
		+ config.analyzerDiagnosticsPort
		+ config.analyzerObservatoryPort
		+ config.analyzerInstrumentationLogFile
		+ config.extensionLogFile
		+ config.analyzerAdditionalArgs
		+ config.flutterSdkPath
		+ config.flutterSelectDeviceWhenConnected
		+ config.closingLabels
		+ config.analyzeAngularTemplates
		+ config.analysisServerFolding
		+ config.showTestCodeLens
		+ config.previewHotReloadCoverageMarkers
		+ config.previewBuildRunnerTasks
		+ config.previewFlutterOutline
		+ config.triggerSignatureHelpAutomatically
		+ config.flutterAdbConnectOnChromeOs;
}

export async function deactivate(isRestart: boolean = false): Promise<void> {
	setCommandVisiblity(false);
	vs.commands.executeCommand("setContext", FLUTTER_SUPPORTS_ATTACH, false);
	if (!isRestart) {
		vs.commands.executeCommand("setContext", HAS_LAST_DEBUG_CONFIG, false);
		await analytics.logExtensionShutdown();
		if (extensionLogger)
			await extensionLogger.dispose();
		if (logger)
			await logger.dispose();
	}
}

function setCommandVisiblity(enable: boolean, workspaceContext?: WorkspaceContext) {
	vs.commands.executeCommand("setContext", DART_PROJECT_LOADED, enable);
	// TODO: Make this more specific. Maybe the one above?
	vs.commands.executeCommand("setContext", FLUTTER_PROJECT_LOADED, enable && workspaceContext.hasAnyFlutterProjects);
	vs.commands.executeCommand("setContext", FLUTTER_MOBILE_PROJECT_LOADED, enable && workspaceContext.hasAnyFlutterMobileProjects);
	vs.commands.executeCommand("setContext", FLUTTER_WEB_PROJECT_LOADED, enable && workspaceContext.hasAnyFlutterWebProjects);
}
