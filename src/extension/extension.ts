import * as path from "path";
import * as vs from "vscode";
import { Analyzer } from "../shared/analyzer";
import { DartCapabilities } from "../shared/capabilities/dart";
import { DaemonCapabilities, FlutterCapabilities } from "../shared/capabilities/flutter";
import { dartPlatformName, flutterExtensionIdentifier, HAS_LAST_DEBUG_CONFIG, HAS_LAST_TEST_DEBUG_CONFIG, isWin, IS_LSP_CONTEXT, IS_RUNNING_LOCALLY_CONTEXT, platformDisplayName, PUB_OUTDATED_SUPPORTED_CONTEXT } from "../shared/constants";
import { LogCategory } from "../shared/enums";
import { WebClient } from "../shared/fetch";
import { DartWorkspaceContext, FlutterSdks, FlutterWorkspaceContext, IFlutterDaemon, Sdks } from "../shared/interfaces";
import { captureLogs, EmittingLogger, logToConsole, RingLog } from "../shared/logging";
import { PubApi } from "../shared/pub/api";
import { internalApiSymbol } from "../shared/symbols";
import { uniq } from "../shared/utils";
import { fsPath, isWithinPath } from "../shared/utils/fs";
import { FlutterDeviceManager } from "../shared/vscode/device_manager";
import { extensionVersion, isDevExtension } from "../shared/vscode/extension_utils";
import { InternalExtensionApi } from "../shared/vscode/interfaces";
import { DartUriHandler } from "../shared/vscode/uri_handlers/uri_handler";
import { envUtils, getDartWorkspaceFolders, isRunningLocally, warnIfPathCaseMismatch } from "../shared/vscode/utils";
import { Context } from "../shared/vscode/workspace";
import { WorkspaceContext } from "../shared/workspace";
import { DasAnalyzer } from "./analysis/analyzer_das";
import { LspAnalyzer } from "./analysis/analyzer_lsp";
import { AnalyzerStatusReporter } from "./analysis/analyzer_status_reporter";
import { FileChangeHandler } from "./analysis/file_change_handler";
import { Analytics } from "./analytics";
import { DartExtensionApi } from "./api";
import { FlutterDartPadSamplesCodeLensProvider } from "./code_lens/flutter_dartpad_samples";
import { LspFlutterDartPadSamplesCodeLensProvider } from "./code_lens/flutter_dartpad_samples_lsp";
import { MainCodeLensProvider } from "./code_lens/main_code_lens_provider";
import { LspMainCodeLensProvider } from "./code_lens/main_code_lens_provider_lsp";
import { TestCodeLensProvider } from "./code_lens/test_code_lens_provider";
import { LspTestCodeLensProvider } from "./code_lens/test_code_lens_provider_lsp";
import { AnalyzerCommands } from "./commands/analyzer";
import { DebugCommands } from "./commands/debug";
import { EditCommands } from "./commands/edit";
import { DasEditCommands } from "./commands/edit_das";
import { LspEditCommands } from "./commands/edit_lsp";
import { FlutterOutlineCommands } from "./commands/flutter_outline";
import { GoToSuperCommand } from "./commands/go_to_super";
import { LoggingCommands } from "./commands/logging";
import { OpenInOtherEditorCommands } from "./commands/open_in_other_editors";
import { RefactorCommands } from "./commands/refactor";
import { SdkCommands } from "./commands/sdk";
import { cursorIsInTest, DasTestCommands, isInImplementationFile, isInTestFile, LspTestCommands } from "./commands/test";
import { TypeHierarchyCommand } from "./commands/type_hierarchy";
import { config } from "./config";
import { ClosingLabelsDecorations } from "./decorations/closing_labels_decorations";
import { FlutterColorDecorations } from "./decorations/flutter_color_decorations";
import { FlutterIconDecorationsDas } from "./decorations/flutter_icon_decorations_das";
import { FlutterIconDecorationsLsp } from "./decorations/flutter_icon_decorations_lsp";
import { FlutterUiGuideDecorationsDas } from "./decorations/flutter_ui_guides_decorations_das";
import { FlutterUiGuideDecorationsLsp } from "./decorations/flutter_ui_guides_decorations_lsp";
import { setUpDaemonMessageHandler } from "./flutter/daemon_message_handler";
import { FlutterDaemon } from "./flutter/flutter_daemon";
import { DasFlutterOutlineProvider, FlutterOutlineProvider, LspFlutterOutlineProvider } from "./flutter/flutter_outline_view";
import { HotReloadOnSaveHandler } from "./flutter/hot_reload_save_handler";
import { LspAnalyzerStatusReporter } from "./lsp/analyzer_status_reporter";
import { LspClosingLabelsDecorations } from "./lsp/closing_labels_decorations";
import { LspGoToSuperCommand } from "./lsp/go_to_super";
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
import { StatusBarVersionTracker } from "./sdk/status_bar_version_tracker";
import { checkForStandardDartSdkUpdates } from "./sdk/update_check";
import { SdkUtils } from "./sdk/utils";
import { showUserPrompts } from "./user_prompts";
import * as util from "./utils";
import { addToLogHeader, clearLogHeader, getExtensionLogPath, getLogHeader } from "./utils/log";
import { safeToolSpawn } from "./utils/processes";
import { DartPackagesProvider } from "./views/packages_view";
import { TestItemTreeItem, TestResultsProvider } from "./views/test_view";

const DART_MODE = { language: "dart", scheme: "file" };
const HTML_MODE = { language: "html", scheme: "file" };

const DART_PROJECT_LOADED = "dart-code:dartProjectLoaded";
// TODO: Define what this means better. Some commands a general Flutter (eg. Hot
// Reload) and some are more specific (eg. Attach).
const FLUTTER_PROJECT_LOADED = "dart-code:anyFlutterProjectLoaded";
const FLUTTER_MOBILE_PROJECT_LOADED = "dart-code:flutterMobileProjectLoaded";
const WEB_PROJECT_LOADED = "dart-code:WebProjectLoaded";
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
const loggers: Array<{ dispose: () => Promise<void> | void }> = [];
export let isUsingLsp = false;

const logger = new EmittingLogger();

// Keep a running in-memory buffer of last 200 log events we can give to the
// user when something crashed even if they don't have disk-logging enabled.
export const ringLog: RingLog = new RingLog(200);

export async function activate(context: vs.ExtensionContext, isRestart: boolean = false) {
	if (!isRestart) {
		if (isDevExtension)
			logToConsole(logger);

		logger.onLog((message) => ringLog.log(message.toLine(500)));
	}

	vs.commands.executeCommand("setContext", IS_RUNNING_LOCALLY_CONTEXT, isRunningLocally);
	buildLogHeaders();
	setupLog(getExtensionLogPath(), LogCategory.General);

	const extContext = Context.for(context);
	const webClient = new WebClient(extensionVersion);

	util.logTime("Code called activate");

	// Wire up a reload command that will re-initialise everything.
	context.subscriptions.push(vs.commands.registerCommand("_dart.reloadExtension", async (_) => {
		logger.info("Performing silent extension reload...");
		await deactivate(true);
		const toDispose = context.subscriptions.slice();
		context.subscriptions.length = 0;
		for (const sub of toDispose) {
			try {
				sub.dispose();
			} catch (e) {
				logger.error(e);
			}
		}
		await activate(context, true);
		logger.info("Done!");
	}));

	showTodos = config.showTodos;
	previousSettings = getSettingsThatRequireRestart();

	const extensionStartTime = new Date();
	util.logTime();
	const sdkUtils = new SdkUtils(logger);
	const workspaceContextUnverified = await sdkUtils.scanWorkspace();
	util.logTime("initWorkspace");

	// Create log headers and set up all other log files.
	buildLogHeaders(workspaceContextUnverified);
	setupLog(config.analyzerLogFile, LogCategory.Analyzer);
	setupLog(config.flutterDaemonLogFile, LogCategory.FlutterDaemon);
	setupLog(config.devToolsLogFile, LogCategory.DevTools);

	analytics = new Analytics(logger, workspaceContextUnverified);
	if (!workspaceContextUnverified.sdks.dart || (workspaceContextUnverified.hasAnyFlutterProjects && !workspaceContextUnverified.sdks.flutter)) {
		// Don't set anything else up; we can't work like this!
		return sdkUtils.handleMissingSdks(context, analytics, workspaceContextUnverified);
	}

	const workspaceContext = workspaceContextUnverified as DartWorkspaceContext;
	const sdks = workspaceContext.sdks;

	if (sdks.flutterVersion) {
		flutterCapabilities.version = sdks.flutterVersion;
		analytics.flutterSdkVersion = sdks.flutterVersion;
	}

	if (config.previewLsp || process.env.DART_CODE_FORCE_LSP) {
		isUsingLsp = true;
	}
	vs.commands.executeCommand("setContext", IS_LSP_CONTEXT, isUsingLsp);

	// Show the SDK version in the status bar.
	if (sdks.dartVersion) {
		dartCapabilities.version = sdks.dartVersion;
		analytics.sdkVersion = sdks.dartVersion;
		// tslint:disable-next-line: no-floating-promises
		checkForStandardDartSdkUpdates(logger, workspaceContext);
		context.subscriptions.push(new StatusBarVersionTracker(workspaceContext, isUsingLsp));
	}
	vs.commands.executeCommand("setContext", PUB_OUTDATED_SUPPORTED_CONTEXT, dartCapabilities.supportsPubOutdated);

	// Fire up the analyzer process.
	const analyzerStartTime = new Date();

	analyzer = isUsingLsp ? new LspAnalyzer(logger, sdks, dartCapabilities, workspaceContext) : new DasAnalyzer(logger, analytics, sdks, dartCapabilities, workspaceContext);
	const lspAnalyzer = isUsingLsp ? (analyzer as LspAnalyzer) : undefined;
	const dasAnalyzer = isUsingLsp ? undefined : (analyzer as DasAnalyzer);
	const dasClient = dasAnalyzer ? dasAnalyzer.client : undefined;
	const lspClient = dasClient ? undefined : (analyzer as LspAnalyzer).client;
	context.subscriptions.push(analyzer);

	// tslint:disable-next-line: no-floating-promises
	analyzer.onReady.then(() => {
		const analyzerEndTime = new Date();
		analytics.logAnalyzerStartupTime(analyzerEndTime.getTime() - analyzerStartTime.getTime());
	});

	// Log analysis server first analysis completion time when it completes.
	let analysisStartTime: Date;
	const analysisCompleteEvents = analyzer.onAnalysisStatusChange.listen((status) => {
		// Analysis started for the first time.
		if (status.isAnalyzing && !analysisStartTime)
			analysisStartTime = new Date();

		// Analysis ends for the first time.
		if (!status.isAnalyzing && analysisStartTime) {
			const analysisEndTime = new Date();
			analytics.logAnalyzerFirstAnalysisTime(analysisEndTime.getTime() - analysisStartTime.getTime());
			analysisCompleteEvents.dispose();
		}
	});

	// Set up providers.
	// TODO: Do we need to push all these to subscriptions?!

	if (lspClient)
		context.subscriptions.push(new LspClosingLabelsDecorations(lspClient));

	const completionItemProvider = isUsingLsp || !dasClient ? undefined : new DartCompletionItemProvider(logger, dasClient);
	const referenceProvider = isUsingLsp || !dasClient ? undefined : new DartReferenceProvider(dasClient);

	const activeFileFilters: vs.DocumentFilter[] = [DART_MODE];

	// Analyze Angular2 templates, requires the angular_analyzer_plugin.
	if (config.analyzeAngularTemplates) {
		activeFileFilters.push(HTML_MODE);
	}
	// Analyze files supported by plugins.
	for (const ext of uniq(config.additionalAnalyzerFileExtensions)) {
		// We can't check that these don't overlap with the existing language filters
		// because vs.languages.match() won't take an extension, only a TextDocument.
		// So we'll just manually exclude file names we know for sure overlap with them.
		if (ext === "dart" || (config.analyzeAngularTemplates && (ext === "htm" || ext === "html")))
			continue;

		activeFileFilters.push({ scheme: "file", pattern: `**/*.${ext}` });
	}

	// This is registered with VS Code further down, so it's metadata can be collected from all
	// registered providers.
	const rankingCodeActionProvider = new RankingCodeActionProvider();

	const triggerCharacters = ".(${'\"/\\".split("");
	if (!isUsingLsp && dasClient) {
		context.subscriptions.push(vs.languages.registerHoverProvider(activeFileFilters, new DartHoverProvider(logger, dasClient)));
		const formattingEditProvider = new DartFormattingEditProvider(logger, dasClient, extContext);
		context.subscriptions.push(formattingEditProvider);
		formattingEditProvider.registerDocumentFormatter(activeFileFilters);
		// Only for Dart.
		formattingEditProvider.registerTypingFormatter(DART_MODE, "}", ";");
	}
	if (completionItemProvider)
		context.subscriptions.push(vs.languages.registerCompletionItemProvider(activeFileFilters, completionItemProvider, ...triggerCharacters));
	if (referenceProvider) {
		context.subscriptions.push(vs.languages.registerDefinitionProvider(activeFileFilters, referenceProvider));
		context.subscriptions.push(vs.languages.registerReferenceProvider(activeFileFilters, referenceProvider));
	}
	let renameProvider: DartRenameProvider | undefined;
	if (!isUsingLsp && dasClient && dasAnalyzer) {
		context.subscriptions.push(vs.languages.registerDocumentHighlightProvider(activeFileFilters, new DartDocumentHighlightProvider(dasAnalyzer.fileTracker)));
		rankingCodeActionProvider.registerProvider(new AssistCodeActionProvider(logger, activeFileFilters, dasClient));
		rankingCodeActionProvider.registerProvider(new FixCodeActionProvider(logger, activeFileFilters, dasClient));
		rankingCodeActionProvider.registerProvider(new RefactorCodeActionProvider(activeFileFilters, dasClient));

		renameProvider = new DartRenameProvider(dasClient);
		context.subscriptions.push(vs.languages.registerRenameProvider(activeFileFilters, renameProvider));

		// Dart only.
		context.subscriptions.push(vs.languages.registerCodeActionsProvider(DART_MODE, new SourceCodeActionProvider(), SourceCodeActionProvider.metadata));
		context.subscriptions.push(vs.languages.registerImplementationProvider(DART_MODE, new DartImplementationProvider(dasAnalyzer)));

		if (config.showMainCodeLens) {
			const codeLensProvider = new MainCodeLensProvider(logger, dasAnalyzer);
			context.subscriptions.push(codeLensProvider);
			context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
		}
		if (config.showTestCodeLens) {
			const codeLensProvider = new TestCodeLensProvider(logger, dasAnalyzer);
			context.subscriptions.push(codeLensProvider);
			context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
		}
		if (config.showDartPadSampleCodeLens && sdks.flutter) {
			const codeLensProvider = new FlutterDartPadSamplesCodeLensProvider(logger, dasAnalyzer, sdks as FlutterSdks);
			context.subscriptions.push(codeLensProvider);
			context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
		}
	}
	if (isUsingLsp && lspClient && lspAnalyzer) {
		if (config.showMainCodeLens) {
			const codeLensProvider = new LspMainCodeLensProvider(logger, lspAnalyzer);
			context.subscriptions.push(codeLensProvider);
			context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
		}
		if (config.showTestCodeLens) {
			const codeLensProvider = new LspTestCodeLensProvider(logger, lspAnalyzer);
			context.subscriptions.push(codeLensProvider);
			context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
		}
		if (config.showDartPadSampleCodeLens && sdks.flutter) {
			const codeLensProvider = new LspFlutterDartPadSamplesCodeLensProvider(logger, lspAnalyzer, sdks as FlutterSdks);
			context.subscriptions.push(codeLensProvider);
			context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
		}
	}

	rankingCodeActionProvider.registerProvider(new IgnoreLintCodeActionProvider(activeFileFilters));

	// Register the ranking provider from VS Code now that it has all of its delegates.
	context.subscriptions.push(vs.languages.registerCodeActionsProvider(activeFileFilters, rankingCodeActionProvider, rankingCodeActionProvider.metadata));

	// Task handlers.
	if (config.previewBuildRunnerTasks) {
		context.subscriptions.push(vs.tasks.registerTaskProvider("pub", new PubBuildRunnerTaskProvider(sdks)));
	}

	// Snippets are language-specific
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider("snippets/dart.json", (_) => true)));
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider("snippets/flutter.json", (uri) => util.isInsideFlutterProject(uri))));

	context.subscriptions.push(vs.languages.setLanguageConfiguration(DART_MODE.language, new DartLanguageConfiguration()));

	// TODO: Push the differences into the Analyzer classes so we can have one reporter.
	if (lspClient)
		// tslint:disable-next-line: no-unused-expression
		new LspAnalyzerStatusReporter(analyzer);
	if (dasClient)
		// tslint:disable-next-line: no-unused-expression
		new AnalyzerStatusReporter(logger, dasClient, workspaceContext, analytics);

	// Set up diagnostics.
	if (!isUsingLsp && dasClient) {
		const diagnostics = vs.languages.createDiagnosticCollection("dart");
		context.subscriptions.push(diagnostics);
		const diagnosticsProvider = new DartDiagnosticProvider(dasClient, diagnostics);

		// TODO: Currently calculating analysis roots requires the version to check if
		// we need the package workaround. In future if we stop supporting server < 1.20.1 we
		// can unwrap this call so that it'll start sooner.
		const serverConnected = dasClient.registerForServerConnected((sc) => {
			serverConnected.dispose();
			if (vs.workspace.workspaceFolders)
				recalculateAnalysisRoots();

			// Set up a handler to warn the user if they open a Dart file and we
			// never set up the analyzer
			let hasWarnedAboutLooseDartFiles = false;
			const handleOpenFile = (d: vs.TextDocument) => {
				if (!hasWarnedAboutLooseDartFiles && d.languageId === "dart" && d.uri.scheme === "file" && analysisRoots.length === 0) {
					hasWarnedAboutLooseDartFiles = true;
					vs.window.showWarningMessage("For full Dart language support, please open a folder containing your Dart files instead of individual loose files");
				}
			};
			context.subscriptions.push(vs.workspace.onDidOpenTextDocument((d) => handleOpenFile(d)));
			// Fire for editors already visible at the time this code runs.
			vs.window.visibleTextEditors.forEach((e) => handleOpenFile(e.document));
		});

		// Hook editor changes to send updated contents to analyzer.
		context.subscriptions.push(new FileChangeHandler(dasClient));
	}

	// Fire up Flutter daemon if required.
	if (workspaceContext.hasAnyFlutterMobileProjects && sdks.flutter) {
		flutterDaemon = new FlutterDaemon(logger, workspaceContext as FlutterWorkspaceContext);
		deviceManager = new FlutterDeviceManager(logger, flutterDaemon, config);

		context.subscriptions.push(deviceManager);
		context.subscriptions.push(flutterDaemon);

		setUpDaemonMessageHandler(logger, context, flutterDaemon);

		context.subscriptions.push(vs.commands.registerCommand("flutter.selectDevice", deviceManager.showDevicePicker, deviceManager));
		context.subscriptions.push(vs.commands.registerCommand("flutter.launchEmulator", deviceManager.promptForAndLaunchEmulator, deviceManager));
	}

	util.logTime("All other stuff before debugger..");

	const pubApi = new PubApi(webClient);
	const pubGlobal = new PubGlobal(logger, extContext, sdks, pubApi);

	// Set up debug stuff.
	const debugProvider = new DebugConfigProvider(logger, workspaceContext, analytics, pubGlobal, flutterDaemon, deviceManager, dartCapabilities, flutterCapabilities);
	context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", debugProvider));
	context.subscriptions.push(debugProvider);

	if (config.flutterGutterIcons)
		context.subscriptions.push(new FlutterColorDecorations(logger, path.join(context.globalStoragePath, "flutterColors")));

	if (!isUsingLsp && dasClient && dasAnalyzer) {
		if (config.previewFlutterUiGuides)
			context.subscriptions.push(new FlutterUiGuideDecorationsDas(dasAnalyzer));

		if (config.flutterGutterIcons)
			context.subscriptions.push(new FlutterIconDecorationsDas(logger, dasAnalyzer));

		// Setup that requires server version/capabilities.
		const connectedSetup = dasClient.registerForServerConnected(async (sc) => {
			connectedSetup.dispose();

			context.subscriptions.push(new RefactorCommands(logger, context, dasClient));

			if (dasClient.capabilities.supportsClosingLabels && config.closingLabels) {
				context.subscriptions.push(new ClosingLabelsDecorations(dasClient));
			}

			if (dasClient.capabilities.supportsGetDeclerations) {
				context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new DartWorkspaceSymbolProvider(logger, dasClient)));
			} else {
				context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new LegacyDartWorkspaceSymbolProvider(logger, dasClient)));
			}

			if (dasClient.capabilities.supportsCustomFolding && config.analysisServerFolding)
				context.subscriptions.push(vs.languages.registerFoldingRangeProvider(activeFileFilters, new DartFoldingProvider(dasAnalyzer)));

			if (dasClient.capabilities.supportsGetSignature)
				context.subscriptions.push(vs.languages.registerSignatureHelpProvider(
					DART_MODE,
					new DartSignatureHelpProvider(dasClient),
					...(config.triggerSignatureHelpAutomatically ? ["(", ","] : []),
				));

			const documentSymbolProvider = new DartDocumentSymbolProvider(logger, dasAnalyzer.fileTracker);
			activeFileFilters.forEach((filter) => {
				context.subscriptions.push(vs.languages.registerDocumentSymbolProvider(filter, documentSymbolProvider));
			});

			// Set up completions for unimported items.
			if (dasClient.capabilities.supportsAvailableSuggestions && config.autoImportCompletions) {
				await dasClient.completionSetSubscriptions({
					subscriptions: ["AVAILABLE_SUGGESTION_SETS"],
				});
			}
		});
	} else if (isUsingLsp && lspClient && lspAnalyzer) {
		if (config.previewFlutterUiGuides)
			context.subscriptions.push(new FlutterUiGuideDecorationsLsp(lspAnalyzer));

		if (config.flutterGutterIcons)
			context.subscriptions.push(new FlutterIconDecorationsLsp(logger, lspAnalyzer));
	}

	// Handle config changes so we can reanalyze if necessary.
	context.subscriptions.push(vs.workspace.onDidChangeConfiguration(() => handleConfigurationChange(sdks)));

	// Register additional commands.
	const analyzerCommands = new AnalyzerCommands(context, analyzer);
	const sdkCommands = new SdkCommands(logger, context, workspaceContext, sdkUtils, pubGlobal, flutterCapabilities, deviceManager);
	const debugCommands = new DebugCommands(logger, extContext, workspaceContext, analytics, pubGlobal);

	// Wire up handling of Hot Reload on Save.
	context.subscriptions.push(new HotReloadOnSaveHandler(debugCommands));

	// Register URI handler.
	context.subscriptions.push(vs.window.registerUriHandler(new DartUriHandler(flutterCapabilities)));

	context.subscriptions.push(new LoggingCommands(logger, context.logPath));
	context.subscriptions.push(new OpenInOtherEditorCommands(logger, sdks));
	if (dasAnalyzer)
		context.subscriptions.push(new DasTestCommands(logger, dasAnalyzer.fileTracker));
	if (lspAnalyzer)
		context.subscriptions.push(new LspTestCommands(logger, lspAnalyzer.fileTracker));

	if (lspClient && lspAnalyzer) {
		// TODO: LSP equivs of the others...
		// Refactors
		// TypeHierarchyCommand
		context.subscriptions.push(new LspGoToSuperCommand(lspAnalyzer));
	}

	// Set up commands for Dart editors.
	context.subscriptions.push(new EditCommands());
	if (dasClient && dasAnalyzer) {
		context.subscriptions.push(new DasEditCommands(logger, context, dasClient));
		context.subscriptions.push(new TypeHierarchyCommand(logger, dasClient));
		context.subscriptions.push(new GoToSuperCommand(dasAnalyzer));
	} else if (lspClient && lspAnalyzer) {
		context.subscriptions.push(new LspEditCommands(lspAnalyzer));
	}

	// Register our view providers.
	const dartPackagesProvider = new DartPackagesProvider(logger);
	const packagesTreeView = vs.window.createTreeView("dartPackages", { treeDataProvider: dartPackagesProvider });
	context.subscriptions.push(
		dartPackagesProvider,
		packagesTreeView,
	);
	const testTreeProvider = new TestResultsProvider(logger);
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
	if (config.flutterOutline) {
		// TODO: Extract this out - it's become messy since TreeView was added in.

		flutterOutlineTreeProvider = dasAnalyzer ? new DasFlutterOutlineProvider(dasAnalyzer) : new LspFlutterOutlineProvider(lspAnalyzer!);
		const tree = vs.window.createTreeView("dartFlutterOutline", { treeDataProvider: flutterOutlineTreeProvider, showCollapseAll: true });
		tree.onDidChangeSelection(async (e) => {
			// TODO: This should be in a tree, not the data provider.
			await flutterOutlineTreeProvider!.setContexts(e.selection);
		});

		context.subscriptions.push(vs.window.onDidChangeTextEditorSelection((e) => {
			if (e.selections && e.selections.length) {
				const node = flutterOutlineTreeProvider!.getNodeAt(e.textEditor.document.uri, e.selections[0].start);
				if (node && tree.visible)
					tree.reveal(node, { select: true, focus: false, expand: true });
			}
		}));
		context.subscriptions.push(tree);
		context.subscriptions.push(flutterOutlineTreeProvider);
		// TODO: This doesn't work for LSP!!!
		const flutterOutlineCommands = new FlutterOutlineCommands(tree, context);
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
			if (warnIfPathCaseMismatch(logger, fsPath(wf.uri), "the open workspace folder", "re-open the folder using the File Open dialog"))
				break;
		}
	}

	// Prompt user for any special config we might want to set.
	if (!isRestart)
		// tslint:disable-next-line: no-floating-promises
		showUserPrompts(logger, extContext, webClient, workspaceContext);

	// Turn on all the commands.
	setCommandVisiblity(true, workspaceContext);
	vs.commands.executeCommand("setContext", DART_PLATFORM_NAME, dartPlatformName);

	// Prompt for pub get if required
	function checkForPackages() {
		// Don't prompt for package updates in the Fuchsia tree/Dart SDK repo.
		if (workspaceContext.config.disableAutomaticPackageGet)
			return;
		// tslint:disable-next-line: no-floating-promises
		sdkCommands.fetchPackagesOrPrompt(undefined, { alwaysPrompt: true });
	}
	if (!isRestart)
		checkForPackages();

	// Begin activating dependant packages.
	if (workspaceContext.shouldLoadFlutterExtension) {
		const flutterExtension = vs.extensions.getExtension(flutterExtensionIdentifier);
		if (flutterExtension) {
			logger.info(`Activating Flutter extension for ${workspaceContext.workspaceTypeDescription} project...`);
			// Do NOT await this.. the Flutter extension needs to wait for the Dart extension to finish activating
			// so that it can call its exported API, therefore we'll deadlock if we wait for the Flutter extension
			// to finish activating.
			flutterExtension.activate()
				// Then rebuild log because it includes whether we activated Flutter.
				.then(() => buildLogHeaders(workspaceContextUnverified));
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
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders(async (f) => {
		// First check if something changed that will affect our SDK, in which case
		// we'll perform a silent restart so that we do new SDK searches.
		const newWorkspaceContext = await sdkUtils.scanWorkspace();
		if (
			newWorkspaceContext.hasAnyFlutterProjects !== workspaceContext.hasAnyFlutterProjects
			|| newWorkspaceContext.hasProjectsInFuchsiaTree !== workspaceContext.hasProjectsInFuchsiaTree
		) {
			// tslint:disable-next-line: no-floating-promises
			util.promptToReloadExtension();
			return;
		}

		dartPackagesProvider.refresh();
		recalculateAnalysisRoots();
		checkForPackages();
	}));

	return {
		...new DartExtensionApi(),
		[internalApiSymbol]: {
			analyzer,
			analyzerCapabilities: dasClient && dasClient.capabilities,
			cancelAllAnalysisRequests: () => dasClient && dasClient.cancelAllRequests(),
			completionItemProvider,
			context: extContext,
			currentAnalysis: () => analyzer.onCurrentAnalysisComplete,
			daemonCapabilities: flutterDaemon ? flutterDaemon.capabilities : DaemonCapabilities.empty,
			dartCapabilities,
			debugCommands,
			debugProvider,
			envUtils,
			fileTracker: dasAnalyzer ? dasAnalyzer.fileTracker : (lspAnalyzer ? lspAnalyzer.fileTracker : undefined),
			flutterCapabilities,
			flutterOutlineTreeProvider,
			get cursorIsInTest() { return cursorIsInTest; },
			get isInImplementationFile() { return isInImplementationFile; },
			get isInTestFile() { return isInTestFile; },
			getLogHeader,
			initialAnalysis: analyzer.onInitialAnalysis,
			isLsp: isUsingLsp,
			logger,
			nextAnalysis: () => analyzer.onNextAnalysisComplete,
			packagesTreeProvider: dartPackagesProvider,
			pubGlobal,
			renameProvider,
			safeToolSpawn,
			testTreeProvider,
			webClient,
			workspaceContext,
		} as InternalExtensionApi,
	};
}

function setupLog(logFile: string | undefined, category: LogCategory) {
	if (logFile)
		loggers.push(captureLogs(logger, logFile, getLogHeader(), config.maxLogLineLength, [category]));
}

function buildLogHeaders(workspaceContext?: WorkspaceContext) {
	clearLogHeader();
	addToLogHeader(() => `!! PLEASE REVIEW THIS LOG FOR SENSITIVE INFORMATION BEFORE SHARING !!`);
	addToLogHeader(() => ``);
	addToLogHeader(() => `Dart Code extension: ${extensionVersion}`);
	addToLogHeader(() => {
		const ext = vs.extensions.getExtension(flutterExtensionIdentifier)!;
		return `Flutter extension: ${ext.packageJSON.version} (${ext.isActive ? "" : "not "}activated)`;
	});
	addToLogHeader(() => ``);
	addToLogHeader(() => `App: ${vs.env.appName}`);
	if (vs.env.remoteName)
		addToLogHeader(() => `Remote: ${vs.env.remoteName}`);
	addToLogHeader(() => `Version: ${vs.version}`);
	addToLogHeader(() => `Platform: ${platformDisplayName}`);
	if (workspaceContext) {
		addToLogHeader(() => ``);
		addToLogHeader(() => `Workspace type: ${workspaceContext.workspaceTypeDescription}`);
		addToLogHeader(() => `Multi-root?: ${vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length > 1}`);
		const sdks = workspaceContext.sdks;
		addToLogHeader(() => ``);
		addToLogHeader(() => `Dart SDK:\n    Loc: ${sdks.dart}\n    Ver: ${sdks.dartVersion}`);
		addToLogHeader(() => `Flutter SDK:\n    Loc: ${sdks.flutter}\n    Ver: ${sdks.flutterVersion}`);
	}
	addToLogHeader(() => ``);
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
		if (excludedForWorkspace && Array.isArray(excludedForWorkspace)) {
			excludedForWorkspace.forEach((folder) => {
				// Handle both relative and absolute paths.
				if (!path.isAbsolute(folder))
					folder = path.join(workspacePath, folder);
				excludeFolders.push(folder);
			});
		}
	});

	// tslint:disable-next-line: no-floating-promises
	(analyzer as DasAnalyzer).client.analysisSetAnalysisRoots({
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

	if (todoSettingChanged && analyzer instanceof DasAnalyzer) {
		// tslint:disable-next-line: no-floating-promises
		analyzer.client.analysisReanalyze();
	}

	if (settingsChanged) {
		// tslint:disable-next-line: no-floating-promises
		util.promptToReloadExtension();
	}
}

function getSettingsThatRequireRestart() {
	// The return value here is used to detect when any config option changes that requires a project reload.
	// It doesn't matter how these are combined; it just gets called on every config change and compared.
	// Usually these are options that affect the analyzer and need a reload, but config options used at
	// activation time will also need to be included.
	return "CONF-"
		+ config.sdkPath
		+ config.sdkPaths?.length
		+ config.analyzerPath
		+ config.analyzerDiagnosticsPort
		+ config.analyzerVmServicePort
		+ config.analyzerInstrumentationLogFile
		+ config.extensionLogFile
		+ config.analyzerAdditionalArgs
		+ config.flutterSdkPath
		+ config.flutterSdkPaths?.length
		+ config.flutterSelectDeviceWhenConnected
		+ config.closingLabels
		+ config.analyzeAngularTemplates
		+ config.analysisServerFolding
		+ config.showMainCodeLens
		+ config.showTestCodeLens
		+ config.previewBuildRunnerTasks
		+ config.updateImportsOnRename
		+ config.previewBazelWorkspaceCustomScripts
		+ config.flutterOutline
		+ config.triggerSignatureHelpAutomatically
		+ config.flutterAdbConnectOnChromeOs;
}

export async function deactivate(isRestart: boolean = false): Promise<void> {
	setCommandVisiblity(false);
	await analyzer.dispose();
	vs.commands.executeCommand("setContext", FLUTTER_SUPPORTS_ATTACH, false);
	if (!isRestart) {
		vs.commands.executeCommand("setContext", HAS_LAST_DEBUG_CONFIG, false);
		vs.commands.executeCommand("setContext", HAS_LAST_TEST_DEBUG_CONFIG, false);
		await analytics.logExtensionShutdown();
		if (loggers) {
			await Promise.all(loggers.map((logger) => logger.dispose()));
			loggers.length = 0;
		}
	}
}

function setCommandVisiblity(enable: boolean, workspaceContext?: WorkspaceContext) {
	vs.commands.executeCommand("setContext", DART_PROJECT_LOADED, enable);
	// TODO: Make this more specific. Maybe the one above?
	vs.commands.executeCommand("setContext", FLUTTER_PROJECT_LOADED, enable && workspaceContext && workspaceContext.hasAnyFlutterProjects);
	vs.commands.executeCommand("setContext", FLUTTER_MOBILE_PROJECT_LOADED, enable && workspaceContext && workspaceContext.hasAnyFlutterMobileProjects);
	vs.commands.executeCommand("setContext", WEB_PROJECT_LOADED, enable && workspaceContext && workspaceContext.hasAnyWebProjects);
}
