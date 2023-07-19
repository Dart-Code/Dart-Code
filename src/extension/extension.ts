import * as path from "path";
import * as vs from "vscode";
import { Analyzer } from "../shared/analyzer";
import { DartCapabilities } from "../shared/capabilities/dart";
import { DaemonCapabilities, FlutterCapabilities } from "../shared/capabilities/flutter";
import { vsCodeVersion } from "../shared/capabilities/vscode";
import { HAS_LAST_DEBUG_CONFIG, HAS_LAST_TEST_DEBUG_CONFIG, IS_LSP_CONTEXT, IS_RUNNING_LOCALLY_CONTEXT, PUB_OUTDATED_SUPPORTED_CONTEXT, dartPlatformName, flutterExtensionIdentifier, isMac, isWin, platformDisplayName } from "../shared/constants";
import { LogCategory } from "../shared/enums";
import { WebClient } from "../shared/fetch";
import { DartWorkspaceContext, FlutterSdks, FlutterWorkspaceContext, IAmDisposable, IFlutterDaemon, Logger, Sdks, WritableWorkspaceConfig } from "../shared/interfaces";
import { EmittingLogger, RingLog, captureLogs, logToConsole } from "../shared/logging";
import { PubApi } from "../shared/pub/api";
import { internalApiSymbol } from "../shared/symbols";
import { TestSessionCoordinator } from "../shared/test/coordinator";
import { TestModel } from "../shared/test/test_model";
import { disposeAll, uniq, withTimeout } from "../shared/utils";
import { fsPath, isWithinPath } from "../shared/utils/fs";
import { DART_MODE, HTML_MODE } from "../shared/vscode/constants";
import { FlutterDeviceManager } from "../shared/vscode/device_manager";
import { extensionVersion, isDevExtension } from "../shared/vscode/extension_utils";
import { InternalExtensionApi } from "../shared/vscode/interfaces";
import { DartUriHandler } from "../shared/vscode/uri_handlers/uri_handler";
import { createWatcher, envUtils, getDartWorkspaceFolders, isRunningLocally, warnIfPathCaseMismatch } from "../shared/vscode/utils";
import { Context } from "../shared/vscode/workspace";
import { WorkspaceContext } from "../shared/workspace";
import { DasAnalyzer } from "./analysis/analyzer_das";
import { LspAnalyzer } from "./analysis/analyzer_lsp";
import { AnalyzerStatusReporter } from "./analysis/analyzer_status_reporter";
import { FileChangeHandler } from "./analysis/file_change_handler";
import { FileChangeWarnings } from "./analysis/file_change_warnings";
import { Analytics } from "./analytics";
import { DartExtensionApi } from "./api/extension_api";
import { FlutterDartPadSamplesCodeLensProvider } from "./code_lens/flutter_dartpad_samples";
import { LspFlutterDartPadSamplesCodeLensProvider } from "./code_lens/flutter_dartpad_samples_lsp";
import { MainCodeLensProvider } from "./code_lens/main_code_lens_provider";
import { LspMainCodeLensProvider } from "./code_lens/main_code_lens_provider_lsp";
import { TestCodeLensProvider } from "./code_lens/test_code_lens_provider";
import { LspTestCodeLensProvider } from "./code_lens/test_code_lens_provider_lsp";
import { AddDependencyCommand } from "./commands/add_dependency";
import { AddSdkToPathCommands } from "./commands/add_sdk_to_path";
import { AnalyzerCommands } from "./commands/analyzer";
import { getOutputChannel } from "./commands/channels";
import { DartCommands } from "./commands/dart";
import { DebugCommands, debugSessions } from "./commands/debug";
import { EditCommands } from "./commands/edit";
import { DasEditCommands } from "./commands/edit_das";
import { LspEditCommands } from "./commands/edit_lsp";
import { FlutterCommands } from "./commands/flutter";
import { FlutterOutlineCommands } from "./commands/flutter_outline";
import { GoToSuperCommand } from "./commands/go_to_super";
import { LoggingCommands } from "./commands/logging";
import { OpenInOtherEditorCommands } from "./commands/open_in_other_editors";
import { PackageCommands } from "./commands/packages";
import { RefactorCommands } from "./commands/refactor";
import { SdkCommands } from "./commands/sdk";
import { TestCommands, isInImplementationFileThatCanHaveTest, isInTestFileThatHasImplementation } from "./commands/test";
import { TypeHierarchyCommand } from "./commands/type_hierarchy";
import { config } from "./config";
import { DartTaskProvider } from "./dart/dart_task_provider";
import { HotReloadOnSaveHandler } from "./dart/hot_reload_save_handler";
import { ClosingLabelsDecorations } from "./decorations/closing_labels_decorations";
import { FlutterIconDecorationsDas } from "./decorations/flutter_icon_decorations_das";
import { FlutterIconDecorationsLsp } from "./decorations/flutter_icon_decorations_lsp";
import { FlutterUiGuideDecorationsDas } from "./decorations/flutter_ui_guides_decorations_das";
import { FlutterUiGuideDecorationsLsp } from "./decorations/flutter_ui_guides_decorations_lsp";
import { KnownExperiments, getExperiments } from "./experiments";
import { setUpDaemonMessageHandler } from "./flutter/daemon_message_handler";
import { FlutterDaemon } from "./flutter/flutter_daemon";
import { DasFlutterOutlineProvider, FlutterOutlineProvider, FlutterWidgetItem, LspFlutterOutlineProvider } from "./flutter/flutter_outline_view";
import { FlutterTaskProvider } from "./flutter/flutter_task_provider";
import { GenerateLocalizationsOnSaveHandler } from "./flutter/generate_localizations_on_save_handler";
import { LspAnalyzerStatusReporter } from "./lsp/analyzer_status_reporter";
import { LspClosingLabelsDecorations } from "./lsp/closing_labels_decorations";
import { LspGoToSuperCommand } from "./lsp/go_to_super";
import { TestDiscoverer } from "./lsp/test_discoverer";
import { AddDependencyCodeActionProvider } from "./providers/add_dependency_code_action_provider";
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
import { DartDebugAdapterDescriptorFactory } from "./providers/debug_adapter_descriptor_factory";
import { DartDebugAdapterGlobalEvaluationContextFactory } from "./providers/debug_adapter_global_evaluation_context_factory";
import { DartDebugAdapterHexViewFactory } from "./providers/debug_adapter_hex_view_factory";
import { DartDebugAdapterLoggerFactory } from "./providers/debug_adapter_logger_factory";
import { DebugConfigProvider, DynamicDebugConfigProvider, InitialLaunchJsonDebugConfigProvider } from "./providers/debug_config_provider";
import { FixCodeActionProvider } from "./providers/fix_code_action_provider";
import { LegacyDartWorkspaceSymbolProvider } from "./providers/legacy_dart_workspace_symbol_provider";
import { RankingCodeActionProvider } from "./providers/ranking_code_action_provider";
import { RefactorCodeActionProvider } from "./providers/refactor_code_action_provider";
import { SnippetCompletionItemProvider } from "./providers/snippet_completion_item_provider";
import { SourceCodeActionProvider } from "./providers/source_code_action_provider";
import { PubGlobal } from "./pub/global";
import { DevToolsManager } from "./sdk/dev_tools/manager";
import { StatusBarVersionTracker } from "./sdk/status_bar_version_tracker";
import { checkForStandardDartSdkUpdates } from "./sdk/update_check";
import { SdkUtils } from "./sdk/utils";
import { DartFileUriLinkProvider } from "./terminal/file_uri_link_provider";
import { DartPackageUriLinkProvider } from "./terminal/package_uri_link_provider";
import { VsCodeTestController } from "./test/vs_test_controller";
import { handleNewProjects, showUserPrompts } from "./user_prompts";
import * as util from "./utils";
import { promptToReloadExtension } from "./utils";
import { addToLogHeader, clearLogHeader, getExtensionLogPath, getLogHeader } from "./utils/log";
import { safeToolSpawn } from "./utils/processes";
import { DartPackagesProvider } from "./views/packages_view";

const PROJECT_LOADED = "dart-code:anyProjectLoaded";
const DART_PROJECT_LOADED = "dart-code:anyStandardDartProjectLoaded";
const FLUTTER_PROJECT_LOADED = "dart-code:anyFlutterProjectLoaded";
const WEB_PROJECT_LOADED = "dart-code:WebProjectLoaded";
export const FLUTTER_SUPPORTS_ATTACH = "dart-code:flutterSupportsAttach";
const DART_PLATFORM_NAME = "dart-code:dartPlatformName";
export const SERVICE_EXTENSION_CONTEXT_PREFIX = "dart-code:serviceExtension.";
export const SERVICE_CONTEXT_PREFIX = "dart-code:service.";

let analyzer: Analyzer;
let flutterDaemon: IFlutterDaemon | undefined;
let deviceManager: FlutterDeviceManager | undefined;
const dartCapabilities = DartCapabilities.empty;
const flutterCapabilities = FlutterCapabilities.empty;
let analysisRoots: string[] = [];
let analytics: Analytics;

let showTodos: boolean | string[] | undefined;
let previousSettings: string;

let analyzerShutdown: Promise<void> | undefined;
let experiments: KnownExperiments;

const loggers: IAmDisposable[] = [];
let ringLogger: IAmDisposable | undefined;
const logger = new EmittingLogger();

// Keep a running in-memory buffer of last 200 log events we can give to the
// user when something crashed even if they don't have disk-logging enabled.
export const ringLog: RingLog = new RingLog(200);

export async function activate(context: vs.ExtensionContext, isRestart: boolean = false) {
	// Ring logger is only set up once and presist over silent restarts.
	if (!ringLogger)
		ringLogger = logger.onLog((message) => ringLog.log(message.toLine(500)));

	if (isDevExtension)
		context.subscriptions.push(logToConsole(logger));

	void vs.commands.executeCommand("setContext", IS_RUNNING_LOCALLY_CONTEXT, isRunningLocally);
	buildLogHeaders();
	setupLog(getExtensionLogPath(), LogCategory.General);

	const extContext = Context.for(context);
	const webClient = new WebClient(extensionVersion);

	util.logTime("Code called activate");

	// Wire up a reload command that will re-initialise everything.
	context.subscriptions.push(vs.commands.registerCommand("_dart.reloadExtension", async () => {
		logger.info("Performing silent extension reload...");
		await deactivate(true);
		disposeAll(context.subscriptions);
		await activate(context, true);
		logger.info("Done!");
	}));

	showTodos = config.showTodos;
	previousSettings = getSettingsThatRequireRestart();

	util.logTime();
	analytics = new Analytics(logger);
	const sdkUtils = new SdkUtils(logger, context, analytics);
	const workspaceContextUnverified = await sdkUtils.scanWorkspace();
	analytics.workspaceContext = workspaceContextUnverified;
	util.logTime("initWorkspace");

	// Set up log files.
	setupLog(config.analyzerLogFile, LogCategory.Analyzer);
	setupLog(config.flutterDaemonLogFile, LogCategory.FlutterDaemon);
	setupLog(config.dapLogFile, LogCategory.DAP);
	setupLog(config.devToolsLogFile, LogCategory.DevTools);

	if (!workspaceContextUnverified.sdks.dart || (workspaceContextUnverified.hasAnyFlutterProjects && !workspaceContextUnverified.sdks.flutter)) {
		// Don't set anything else up; we can't work like this!
		return sdkUtils.handleMissingSdks(workspaceContextUnverified);
	}

	const workspaceContext = workspaceContextUnverified as DartWorkspaceContext;
	const sdks = workspaceContext.sdks;
	const writableConfig = workspaceContext.config as WritableWorkspaceConfig;

	// Add the PATHs to the Terminal environment so if the user runs commands
	// there they match the versions (and can be resolved, if not already on PATH).
	if (config.addSdkToTerminalPath) {
		const baseSdk = workspaceContext.hasAnyFlutterProjects
			? sdks.flutter
			: sdks.dart;
		const envPathPrefix = [baseSdk, "bin", path.delimiter].join(path.sep);
		context.environmentVariableCollection.prepend("PATH", envPathPrefix);
	} else {
		// Since the value persists (which we want, so upon reload we don't miss
		// any terminals that were already restored before we activated), we need
		// to explicitly remove the path when the setting is disabled.
		context.environmentVariableCollection.clear();
	}

	// TODO: Move these capabilities into WorkspaceContext.
	if (sdks.dartVersion) {
		dartCapabilities.version = sdks.dartVersion;
		analytics.sdkVersion = sdks.dartVersion;
		void checkForStandardDartSdkUpdates(logger, workspaceContext);
	}

	if (sdks.flutterVersion) {
		flutterCapabilities.version = sdks.flutterVersion;
		analytics.flutterSdkVersion = sdks.flutterVersion;

		// If we're going to pass the DevTools URL to Flutter, we need to eagerly start it
		// so it's already running.
		if (workspaceContext.hasAnyFlutterProjects && config.shareDevToolsWithFlutter && flutterCapabilities.supportsDevToolsServerAddress) {
			writableConfig.startDevToolsServerEagerly = true;
		}
	}

	try {
		if (!experiments)
			experiments = getExperiments(logger, workspaceContext, extContext);
	} catch (e) {
		logger.error(e);
	}

	const isVirtualWorkspace = vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.every((f) => f.uri.scheme !== "file");
	function shouldUseLsp(): boolean {
		// Never use LSP if the LSP client would reject the current VS Code version or the Dart SDK doesn't support it.
		if (!vsCodeVersion.supportsLatestLspClient || !dartCapabilities.canDefaultLsp)
			return false;

		// If DART_CODE_FORCE_LSP is set to true/false it always overrides.
		if (process.env.DART_CODE_FORCE_LSP === "true")
			return true;
		if (process.env.DART_CODE_FORCE_LSP === "false")
			return false;

		// In virtual workspaces, we always use LSP because it will have non-file resources
		// and we only handle them properly in LSP.
		if (isVirtualWorkspace)
			return true;

		return !config.useLegacyAnalyzerProtocol;
	}
	const isUsingLsp = shouldUseLsp();
	writableConfig.useLegacyProtocol = !isUsingLsp;
	void vs.commands.executeCommand("setContext", IS_LSP_CONTEXT, isUsingLsp);

	// Build log headers now we know analyzer type.
	buildLogHeaders(logger, workspaceContextUnverified);

	// Show the SDK version in the status bar.
	if (sdks.dartVersion)
		context.subscriptions.push(new StatusBarVersionTracker(workspaceContext, isUsingLsp));

	if (isVirtualWorkspace && !dartCapabilities.supportsNonFileSchemeWorkspaces) {
		void vs.window.showWarningMessage("Please upgrade to the latest Dart/Flutter SDK to prevent errors in workspaces with virtual folders");
	}

	void vs.commands.executeCommand("setContext", PUB_OUTDATED_SUPPORTED_CONTEXT, dartCapabilities.supportsPubOutdated);

	// Fire up Flutter daemon if required.
	if (workspaceContext.hasAnyFlutterProjects && sdks.flutter) {
		let runIfNoDevices;
		let hasRunNoDevicesMessage = false;
		let portFromLocalExtension;
		if (workspaceContext.config.forceFlutterWorkspace && workspaceContext.config.restartMacDaemonMessage) {
			runIfNoDevices = () => {
				if (!hasRunNoDevicesMessage) {
					const instruction = workspaceContext.config.restartMacDaemonMessage;
					void promptToReloadExtension(`${instruction} (Settings currently expect port: ${config.daemonPort}.)`, `Reopen this workspace`);
					hasRunNoDevicesMessage = true;
				}
			};
		}

		if (workspaceContext.config.forceFlutterWorkspace && !isRunningLocally) {
			let resultFromLocalExtension = null;

			const command = vs.commands.executeCommand<string>("flutter-local-device-exposer.startDaemon", { script: workspaceContext.config.flutterToolsScript?.script, command: "expose_devices", workingDirectory: workspaceContext.config.flutterSdkHome });

			try {
				resultFromLocalExtension = await withTimeout(command, `The local extension to expose devices timed out. ${workspaceContext.config.localDeviceCommandAdviceMessage ?? ""}`, 10);
			} catch (e) {
				// Command won't be available if dartlocaldevice isn't installed.
				logger.error(e);
			}
			if (resultFromLocalExtension !== null) {
				const resultMessage = resultFromLocalExtension.toString();
				const results = resultMessage.match(/Device daemon is available on remote port: (\d+)/i);
				if (results !== null && results?.length > 1) {
					portFromLocalExtension = parseInt(results[1]);
				} else if (resultMessage !== null) {
					const displayError = `The local extension to expose devices failed: ${resultMessage}. ${workspaceContext.config.localDeviceCommandAdviceMessage ?? ""}`;
					void vs.window.showErrorMessage(displayError);
				}
			}
		}

		flutterDaemon = new FlutterDaemon(logger, workspaceContext as FlutterWorkspaceContext, flutterCapabilities, runIfNoDevices, portFromLocalExtension);

		deviceManager = new FlutterDeviceManager(logger, flutterDaemon, config, workspaceContext, extContext, runIfNoDevices, portFromLocalExtension);

		context.subscriptions.push(deviceManager);
		context.subscriptions.push(flutterDaemon);

		setUpDaemonMessageHandler(logger, context, flutterDaemon);

		context.subscriptions.push(vs.commands.registerCommand("flutter.selectDevice", deviceManager.showDevicePicker, deviceManager));
		context.subscriptions.push(vs.commands.registerCommand("flutter.launchEmulator", deviceManager.promptForAndLaunchEmulator, deviceManager));
	}

	if (workspaceContext.config.forceFlutterWorkspace && isRunningLocally && isMac && workspaceContext.config.localMacWarningMessage) {
		void vs.window.showInformationMessage(workspaceContext.config.localMacWarningMessage.toString());
	}

	context.subscriptions.push(new AddSdkToPathCommands(logger, context, workspaceContext, analytics));
	const pubApi = new PubApi(webClient);
	const pubGlobal = new PubGlobal(logger, dartCapabilities, extContext, sdks, pubApi);
	const sdkCommands = new SdkCommands(logger, extContext, workspaceContext, dartCapabilities);
	const dartCommands = new DartCommands(logger, extContext, workspaceContext, sdkUtils, pubGlobal, dartCapabilities, analytics);
	const flutterCommands = new FlutterCommands(logger, extContext, workspaceContext, sdkUtils, dartCapabilities, flutterCapabilities, deviceManager, analytics);
	const packageCommands = new PackageCommands(logger, extContext, workspaceContext, dartCapabilities);
	const addDependencyCommand = new AddDependencyCommand(logger, extContext, workspaceContext, dartCapabilities, pubApi, analytics);
	context.subscriptions.push(sdkCommands);
	context.subscriptions.push(dartCommands);
	context.subscriptions.push(flutterCommands);
	context.subscriptions.push(packageCommands);
	context.subscriptions.push(addDependencyCommand);

	// Handle new projects before creating the analyer to avoid a few issues with
	// showing errors while packages are fetched, plus issues like
	// https://github.com/Dart-Code/Dart-Code/issues/2793 which occur if the analyzer
	// is created too early.
	if (!isRestart)
		await handleNewProjects(logger, extContext);

	// Fire up the analyzer process.
	const analyzerStartTime = new Date();

	analyzer = isUsingLsp
		? new LspAnalyzer(logger, sdks, dartCapabilities, workspaceContext)
		: new DasAnalyzer(logger, analytics, sdks, dartCapabilities, workspaceContext);
	const lspAnalyzer = isUsingLsp ? (analyzer as LspAnalyzer) : undefined;
	const dasAnalyzer = isUsingLsp ? undefined : (analyzer as DasAnalyzer);
	const dasClient = dasAnalyzer ? dasAnalyzer.client : undefined;
	const lspClient = dasClient ? undefined : (analyzer as LspAnalyzer).client;
	context.subscriptions.push(analyzer);

	void analyzer.onReady.then(() => {
		if (config.analyzerVmServicePort) {
			void vs.window.showInformationMessage("The Dart Analysis server is running with the debugger accessible. Unset the dart.analyzerVmServicePort setting when no longer required.");
		}
	});

	// Log analysis server first analysis completion time when it completes.
	let analysisStartTime: Date;
	const analysisCompleteEvents = analyzer.onAnalysisStatusChange((status) => {
		// Analysis started for the first time.
		if (status.isAnalyzing && !analysisStartTime)
			analysisStartTime = new Date();

		// Analysis ends for the first time.
		if (!status.isAnalyzing && analysisStartTime) {
			void analysisCompleteEvents.dispose();
		}
	});

	// Set up providers.
	// TODO: Do we need to push all these to subscriptions?!

	if (lspClient)
		context.subscriptions.push(new LspClosingLabelsDecorations(lspClient));

	const completionItemProvider = isUsingLsp || !dasClient ? undefined : new DartCompletionItemProvider(logger, dasClient);
	const referenceProvider = isUsingLsp || !dasClient || !dasAnalyzer ? undefined : new DartReferenceProvider(dasClient, dasAnalyzer.fileTracker);

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

	rankingCodeActionProvider.registerProvider(new AddDependencyCodeActionProvider(DART_MODE));

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

	// Register the ranking provider from VS Code now that it has all of its delegates.
	context.subscriptions.push(vs.languages.registerCodeActionsProvider(activeFileFilters, rankingCodeActionProvider, rankingCodeActionProvider.metadata));

	const devTools = new DevToolsManager(logger, workspaceContext, analytics, pubGlobal, dartCapabilities, flutterCapabilities, flutterDaemon);
	context.subscriptions.push(devTools);

	// Debug commands.
	const debugCommands = new DebugCommands(logger, lspAnalyzer?.fileTracker, extContext, workspaceContext, dartCapabilities, flutterCapabilities, devTools);
	context.subscriptions.push(debugCommands);

	// Task handlers.
	context.subscriptions.push(vs.tasks.registerTaskProvider(DartTaskProvider.type, new DartTaskProvider(logger, context, sdks, dartCapabilities)));
	context.subscriptions.push(vs.tasks.registerTaskProvider(FlutterTaskProvider.type, new FlutterTaskProvider(logger, context, sdks, flutterCapabilities)));

	// Snippets are language-specific
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider(isUsingLsp, dartCapabilities, "snippets/dart.json", () => true)));
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider(isUsingLsp, dartCapabilities, "snippets/flutter.json", (uri) => util.isInsideFlutterProject(uri))));

	context.subscriptions.push(vs.languages.setLanguageConfiguration(DART_MODE.language, new DartLanguageConfiguration()));

	// TODO: Push the differences into the Analyzer classes so we can have one reporter.
	if (lspClient)
		// tslint:disable-next-line: no-unused-expression
		new LspAnalyzerStatusReporter(analyzer);
	if (dasClient)
		// tslint:disable-next-line: no-unused-expression
		new AnalyzerStatusReporter(logger, dasClient, workspaceContext, analytics);

	context.subscriptions.push(new FileChangeWarnings());

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
				recalculateDasAnalysisRoots();

			// Set up a handler to warn the user if they open a Dart file and we
			// never set up the analyzer
			let hasWarnedAboutLooseDartFiles = false;
			const handleOpenFile = (d: vs.TextDocument) => {
				if (!hasWarnedAboutLooseDartFiles && d.languageId === "dart" && d.uri.scheme === "file" && analysisRoots.length === 0) {
					hasWarnedAboutLooseDartFiles = true;
					void vs.window.showWarningMessage("For full Dart language support, please open a folder containing your Dart files instead of individual loose files");
				}
			};
			context.subscriptions.push(vs.workspace.onDidOpenTextDocument((d) => handleOpenFile(d)));
			// Fire for editors already visible at the time this code runs.
			vs.window.visibleTextEditors.forEach((e) => handleOpenFile(e.document));
		});

		// Hook editor changes to send updated contents to analyzer.
		context.subscriptions.push(new FileChangeHandler(dasClient));
	}

	util.logTime("All other stuff before debugger..");

	const testModel = new TestModel(config, util.isPathInsideFlutterProject);
	const testCoordinator = new TestSessionCoordinator(logger, testModel, lspAnalyzer?.fileTracker);
	context.subscriptions.push(
		testCoordinator,
		vs.debug.onDidReceiveDebugSessionCustomEvent((e) => testCoordinator.handleDebugSessionCustomEvent(e.session.id, e.session.configuration.dartCodeDebugSessionID as string | undefined, e.event, e.body)),
		vs.debug.onDidTerminateDebugSession((session) => testCoordinator.handleDebugSessionEnd(session.id, session.configuration.dartCodeDebugSessionID as string | undefined)),
		vs.workspace.onDidChangeConfiguration((e) => testModel.handleConfigChange()),
	);
	const testDiscoverer = lspAnalyzer ? new TestDiscoverer(logger, lspAnalyzer.fileTracker, testModel) : undefined;
	if (testDiscoverer)
		context.subscriptions.push(testDiscoverer);
	const vsCodeTestController = vs.tests?.createTestController !== undefined // Feature-detect for Theia
		? new VsCodeTestController(logger, testModel, testDiscoverer)
		: undefined;
	if (vsCodeTestController)
		context.subscriptions.push(vsCodeTestController);

	const analyzerCommands = new AnalyzerCommands(context, logger, analyzer, analytics);

	// Set up debug stuff.
	const debugProvider = new DebugConfigProvider(logger, workspaceContext, pubGlobal, testModel, flutterDaemon, deviceManager, devTools, flutterCapabilities);
	context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", debugProvider));
	const debugLogger = new DartDebugAdapterLoggerFactory(logger);
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", debugLogger));
	const globalEvaluationContext = new DartDebugAdapterGlobalEvaluationContextFactory(logger);
	context.subscriptions.push(globalEvaluationContext);
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", globalEvaluationContext));
	const hexFormatter = new DartDebugAdapterHexViewFactory(logger);
	context.subscriptions.push(hexFormatter);
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", hexFormatter));
	const debugAdapterDescriptorFactory = new DartDebugAdapterDescriptorFactory(analytics, sdks, logger, extContext, dartCapabilities, flutterCapabilities, workspaceContext, experiments);
	context.subscriptions.push(vs.debug.registerDebugAdapterDescriptorFactory("dart", debugAdapterDescriptorFactory));
	// Also the providers for the initial configs.
	if (vs.DebugConfigurationProviderTriggerKind) { // Temporary workaround for GitPod/Theia not having this enum.
		context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", new InitialLaunchJsonDebugConfigProvider(logger), vs.DebugConfigurationProviderTriggerKind.Initial));
		context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", new DynamicDebugConfigProvider(logger, deviceManager), vs.DebugConfigurationProviderTriggerKind.Dynamic));
	}

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

	// Wire up handling of On-Save handlers.
	context.subscriptions.push(new HotReloadOnSaveHandler(debugCommands, flutterCapabilities));
	if (workspaceContext.hasAnyFlutterProjects && sdks.flutter) {
		context.subscriptions.push(new GenerateLocalizationsOnSaveHandler());
	}

	// Register URI handler.
	context.subscriptions.push(vs.window.registerUriHandler(new DartUriHandler(flutterCapabilities)));

	context.subscriptions.push(new LoggingCommands(logger, context.logPath));
	context.subscriptions.push(new OpenInOtherEditorCommands(logger, sdks));
	context.subscriptions.push(new TestCommands(logger, testModel, workspaceContext, vsCodeTestController, dartCapabilities, flutterCapabilities));

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

	const packageLinkProvider = new DartPackageUriLinkProvider(logger, workspaceContext);
	const fileLinkProvider = new DartFileUriLinkProvider();
	if (vs.window.registerTerminalLinkProvider) { // Workaround for GitPod/Theia not having this.
		context.subscriptions.push(vs.window.registerTerminalLinkProvider(packageLinkProvider));
		context.subscriptions.push(vs.window.registerTerminalLinkProvider(fileLinkProvider));
	}

	if (vs.languages.registerDocumentLinkProvider) {
		vs.languages.registerDocumentLinkProvider({ scheme: "vscode-test-data" }, packageLinkProvider);
		vs.languages.registerDocumentLinkProvider({ scheme: "vscode-test-data" }, fileLinkProvider);
	}

	// Register our view providers.
	const dartPackagesProvider = new DartPackagesProvider(logger, workspaceContext, dartCapabilities);
	context.subscriptions.push(dartPackagesProvider);
	const packagesTreeView = vs.window.createTreeView("dartDependencyTree", { treeDataProvider: dartPackagesProvider });
	context.subscriptions.push(packagesTreeView);
	let flutterOutlineTreeProvider: FlutterOutlineProvider | undefined;
	if (config.flutterOutline) {
		// TODO: Extract this out - it's become messy since TreeView was added in.

		flutterOutlineTreeProvider = dasAnalyzer ? new DasFlutterOutlineProvider(analytics, dasAnalyzer) : new LspFlutterOutlineProvider(analytics, lspAnalyzer!);
		const tree = vs.window.createTreeView<FlutterWidgetItem>("dartFlutterOutline", { treeDataProvider: flutterOutlineTreeProvider, showCollapseAll: true });
		tree.onDidChangeSelection(async (e) => {
			// TODO: This should be in a tree, not the data provider.
			await flutterOutlineTreeProvider!.setContexts(e.selection);
		});

		context.subscriptions.push(vs.window.onDidChangeTextEditorSelection((e) => {
			if (e.selections && e.selections.length) {
				const node = flutterOutlineTreeProvider!.getNodeAt(e.textEditor.document.uri, e.selections[0].start);
				if (node && tree.visible)
					void tree.reveal(node, { select: true, focus: false, expand: true });
			}
		}));
		context.subscriptions.push(tree);
		context.subscriptions.push(flutterOutlineTreeProvider);


		// TODO: This doesn't work for LSP!
		const flutterOutlineCommands = new FlutterOutlineCommands(tree, context);
	}

	context.subscriptions.push(vs.commands.registerCommand("dart.package.openFile", (filePath: string) => {
		if (!filePath) return;

		vs.workspace.openTextDocument(filePath).then((document) => {
			void vs.window.showTextDocument(document, { preview: true });
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
		void showUserPrompts(logger, extContext, webClient, analytics, workspaceContext);

	// Turn on all the commands.
	setCommandVisiblity(true, workspaceContext);
	void vs.commands.executeCommand("setContext", DART_PLATFORM_NAME, dartPlatformName);

	// Prompt for pub get/upgrade if required
	function checkForPackages() {
		// Don't prompt for package updates in the Fuchsia tree/Dart SDK repo.
		if (workspaceContext.config.disableAutomaticPackageGet)
			return;
		void packageCommands.fetchPackagesOrPrompt(undefined, { alwaysPrompt: true, upgradeOnSdkChange: true });
	}
	checkForPackages();

	// Begin activating dependant packages.
	if (workspaceContext.shouldLoadFlutterExtension) {
		const flutterExtension = vs.extensions.getExtension(flutterExtensionIdentifier);
		if (flutterExtension) {
			logger.info(`Activating Flutter extension for ${workspaceContext.workspaceTypeDescription} project...`);
			// Do NOT await this.. the Flutter extension needs to wait for the Dart extension to finish activating
			// so that it can call its exported API, therefore we'll deadlock if we wait for the Flutter extension
			// to finish activating.
			void flutterExtension.activate()
				// Then rebuild log because it includes whether we activated Flutter.
				.then(() => buildLogHeaders(logger, workspaceContextUnverified));
		}
	}

	if (isRestart) {
		analytics.logExtensionRestart();
	} else {
		analytics.logExtensionActivated();
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
			void util.promptToReloadExtension();
			return;
		}

		workspaceContext.events.onPackageMapChange.fire();
		if (!isUsingLsp)
			recalculateDasAnalysisRoots();
		checkForPackages();
	}));

	context.subscriptions.push(createWatcher("**/.packages", workspaceContext.events.onPackageMapChange));
	context.subscriptions.push(createWatcher("**/.dart_tool/package_config.json", workspaceContext.events.onPackageMapChange));
	workspaceContext.events.onPackageMapChange.fire();

	return {
		...new DartExtensionApi(),
		[internalApiSymbol]: {
			addDependencyCommand,
			analyzer,
			analyzerCapabilities: dasClient && dasClient.capabilities,
			cancelAllAnalysisRequests: () => dasClient && dasClient.cancelAllRequests(),
			completionItemProvider,
			context: extContext,
			currentAnalysis: () => analyzer.onCurrentAnalysisComplete,
			daemonCapabilities: flutterDaemon ? flutterDaemon.capabilities : DaemonCapabilities.empty,
			dartCapabilities,
			debugAdapterDescriptorFactory,
			debugCommands,
			debugProvider,
			debugSessions,
			devTools,
			deviceManager,
			envUtils,
			fileTracker: dasAnalyzer ? dasAnalyzer.fileTracker : (lspAnalyzer ? lspAnalyzer.fileTracker : undefined),
			flutterCapabilities,
			flutterOutlineTreeProvider,
			get isInImplementationFileThatCanHaveTest() { return isInImplementationFileThatCanHaveTest; },
			get isInTestFileThatHasImplementation() { return isInTestFileThatHasImplementation; },
			getLogHeader,
			getOutputChannel,
			initialAnalysis: analyzer.onInitialAnalysis,
			interactiveRefactors: lspAnalyzer?.refactors,
			isLsp: isUsingLsp,
			logger,
			nextAnalysis: () => analyzer.onNextAnalysisComplete,
			packagesTreeProvider: dartPackagesProvider,
			pubGlobal,
			renameProvider,
			safeToolSpawn,
			testController: vsCodeTestController,
			testCoordinator,
			testDiscoverer,
			testModel,
			trackerFactories: [debugLogger, hexFormatter],
			webClient,
			workspaceContext,
		} as InternalExtensionApi,
	};
}

function setupLog(logFile: string | undefined, category: LogCategory) {
	if (logFile)
		loggers.push(captureLogs(logger, logFile, getLogHeader(), config.maxLogLineLength, [category]));
}

function buildLogHeaders(logger?: Logger, workspaceContext?: WorkspaceContext) {
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
		addToLogHeader(() => `Analyzer type: ${workspaceContext.config.useLegacyProtocol ? "DAS" : "LSP"}`);
		addToLogHeader(() => `Multi-root?: ${vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length > 1}`);
		const sdks = workspaceContext.sdks;
		addToLogHeader(() => ``);
		addToLogHeader(() => `Dart SDK:\n    Loc: ${sdks.dart}\n    Ver: ${sdks.dartVersion}`);
		addToLogHeader(() => `Flutter SDK:\n    Loc: ${sdks.flutter}\n    Ver: ${sdks.flutterVersion}`);
	}
	addToLogHeader(() => ``);
	addToLogHeader(() => `HTTP_PROXY: ${process.env.HTTP_PROXY}`);
	addToLogHeader(() => `NO_PROXY: ${process.env.NO_PROXY}`);

	// Any time the log headers are rebuilt, we should re-log them.
	logger?.info(getLogHeader());
}

function recalculateDasAnalysisRoots() {
	const workspaceFolders = getDartWorkspaceFolders();
	analysisRoots = workspaceFolders.map((w) => fsPath(w.uri));

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
	workspaceFolders.forEach((f) => {
		for (const folder of util.getExcludedFolders(f))
			excludeFolders.push(folder);
	});

	void (analyzer as DasAnalyzer).client.analysisSetAnalysisRoots({
		excluded: excludeFolders,
		included: analysisRoots,
	});
}

function handleConfigurationChange(sdks: Sdks) {
	// TODOs
	const newShowTodoSetting = config.showTodos;
	const todoSettingChanged = JSON.stringify(showTodos) !== JSON.stringify(newShowTodoSetting);
	showTodos = newShowTodoSetting;

	// SDK
	const newSettings = getSettingsThatRequireRestart();
	const settingsChanged = previousSettings !== newSettings;
	previousSettings = newSettings;

	if (todoSettingChanged && analyzer instanceof DasAnalyzer) {
		void analyzer.client.analysisReanalyze();
	}

	if (settingsChanged) {
		// Delay the restart slightly, because the config change may be transmitted to the LSP server
		// and shutting the server down too quickly results in that trying to write to a closed
		// stream.
		setTimeout(util.promptToReloadExtension, 50);
	}
}

function getSettingsThatRequireRestart() {
	// The return value here is used to detect when any config option changes that requires a project reload.
	// It doesn't matter how these are combined; it just gets called on every config change and compared.
	// Usually these are options that affect the analyzer and need a reload, but config options used at
	// activation time will also need to be included.
	// eslint-disable-next-line @typescript-eslint/restrict-plus-operands
	return "CONF-"
		+ config.sdkPath
		+ config.sdkPaths?.length
		+ config.analyzerPath
		+ config.analyzerDiagnosticsPort
		+ config.analyzerVmServicePort
		+ config.analyzerInstrumentationLogFile
		+ config.extensionLogFile
		+ config.analyzerAdditionalArgs?.join(",")
		+ config.analyzerVmAdditionalArgs?.join(",")
		+ config.flutterSdkPath
		+ config.flutterSdkPaths?.length
		+ config.flutterSelectDeviceWhenConnected
		+ config.closingLabels
		+ config.analyzeAngularTemplates
		+ config.analysisServerFolding
		+ config.showMainCodeLens
		+ config.showTestCodeLens
		+ config.updateImportsOnRename
		+ config.flutterOutline
		+ config.flutterAdbConnectOnChromeOs;
}

export async function deactivate(isRestart: boolean = false): Promise<void> {
	setCommandVisiblity(false);
	void analyzer?.dispose();
	await flutterDaemon?.shutdown();
	if (loggers) {
		await Promise.all(loggers.map((logger) => logger.dispose()));
		loggers.length = 0;
	}
	void vs.commands.executeCommand("setContext", FLUTTER_SUPPORTS_ATTACH, false);
	if (!isRestart) {
		void vs.commands.executeCommand("setContext", HAS_LAST_DEBUG_CONFIG, false);
		void vs.commands.executeCommand("setContext", HAS_LAST_TEST_DEBUG_CONFIG, false);
		void ringLogger?.dispose();
		logger.dispose();
	}
}

function setCommandVisiblity(enable: boolean, workspaceContext?: WorkspaceContext) {
	void vs.commands.executeCommand("setContext", PROJECT_LOADED, enable);
	void vs.commands.executeCommand("setContext", DART_PROJECT_LOADED, enable && workspaceContext && workspaceContext.hasAnyStandardDartProjects);
	void vs.commands.executeCommand("setContext", FLUTTER_PROJECT_LOADED, enable && workspaceContext && workspaceContext.hasAnyFlutterProjects);
	void vs.commands.executeCommand("setContext", WEB_PROJECT_LOADED, enable && workspaceContext && workspaceContext.hasAnyWebProjects);
}
