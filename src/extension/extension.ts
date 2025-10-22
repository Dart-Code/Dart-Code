import * as path from "path";
import * as process from "process";
import * as vs from "vscode";
import { DartCapabilities } from "../shared/capabilities/dart";
import { DaemonCapabilities, FlutterCapabilities } from "../shared/capabilities/flutter";
import { ExtensionRestartReason, dartCodeConfigurationPathEnvironmentVariableName, dartPlatformName, defaultDartCodeConfigurationPath, flutterExtensionIdentifier, isDartCodeTestRun, isMac, platformDisplayName, setFlutterDev } from "../shared/constants";
import { DART_PLATFORM_NAME, DART_PROJECT_LOADED, FLUTTER_PROJECT_LOADED, FLUTTER_PROPERTY_EDITOR_SUPPORTED_CONTEXT, FLUTTER_SIDEBAR_SUPPORTED_CONTEXT, FLUTTER_SUPPORTS_ATTACH, GO_TO_IMPORTS_SUPPORTED_CONTEXT, IS_RUNNING_LOCALLY_CONTEXT, OBSERVATORY_SUPPORTED_CONTEXT, PROJECT_LOADED, SDK_IS_PRE_RELEASE, WEB_PROJECT_LOADED } from "../shared/constants.contexts";
import { LogCategory } from "../shared/enums";
import { WebClient } from "../shared/fetch";
import { DartWorkspaceContext, FlutterSdks, FlutterWorkspaceContext, IAmDisposable, IFlutterDaemon, Logger, WritableWorkspaceConfig } from "../shared/interfaces";
import { EmittingLogger, RingLog, captureLogs, logToConsole } from "../shared/logging";
import { PubApi } from "../shared/pub/api";
import { internalApiSymbol } from "../shared/symbols";
import { TestSessionCoordinator } from "../shared/test/coordinator";
import { TestModel } from "../shared/test/test_model";
import { disposeAll, uniq, withTimeout } from "../shared/utils";
import { fsPath, getRandomInt, isFlutterProjectFolder } from "../shared/utils/fs";
import { AutoLaunch } from "../shared/vscode/autolaunch";
import { DART_LANGUAGE, DART_MODE, HTML_MODE } from "../shared/vscode/constants";
import { FlutterDeviceManager } from "../shared/vscode/device_manager";
import { extensionVersion, isDevExtension } from "../shared/vscode/extension_utils";
import { InternalExtensionApi } from "../shared/vscode/interfaces";
import { DartFileUriLinkProvider } from "../shared/vscode/terminal/file_uri_link_provider";
import { DartPackageUriLinkProvider } from "../shared/vscode/terminal/package_uri_link_provider";
import { DartUriHandler } from "../shared/vscode/uri_handlers/uri_handler";
import { ProjectFinder, clearCaches, createWatcher, envUtils, hostKind, isRunningLocally, warnIfPathCaseMismatch } from "../shared/vscode/utils";
import { Context } from "../shared/vscode/workspace";
import { WorkspaceContext } from "../shared/workspace";
import { LspAnalyzer } from "./analysis/analyzer";
import { FileChangeWarnings } from "./analysis/file_change_warnings";
import { Analytics } from "./analytics";
import { PublicDartExtensionApiImpl, extensionApiModel } from "./api/extension_api";
import { PublicDartExtensionApi } from "./api/interfaces";
import { FlutterDartPadSamplesCodeLensProvider } from "./code_lens/flutter_dartpad_samples";
import { MainCodeLensProvider } from "./code_lens/main_code_lens_provider";
import { TestCodeLensProvider } from "./code_lens/test_code_lens_provider";
import { AddDependencyCommand } from "./commands/add_dependency";
import { AddSdkToPathCommands } from "./commands/add_sdk_to_path";
import { AnalyzerCommands } from "./commands/analyzer";
import { getOutputChannel } from "./commands/channels";
import { DartCommands } from "./commands/dart";
import { DebugCommands, debugSessions } from "./commands/debug";
import { EditCommands } from "./commands/edit";
import { FlutterCommands } from "./commands/flutter";
import { FlutterOutlineCommands } from "./commands/flutter_outline";
import { LoggingCommands } from "./commands/logging";
import { OpenInOtherEditorCommands } from "./commands/open_in_other_editors";
import { PackageCommands } from "./commands/packages";
import { SdkCommands } from "./commands/sdk";
import { SettingsCommands } from "./commands/settings";
import { TestCommands, isInImplementationFileThatCanHaveTest, isInTestFileThatHasImplementation } from "./commands/test";
import { config } from "./config";
import { DartTaskProvider } from "./dart/dart_task_provider";
import { HotReloadOnSaveHandler } from "./dart/hot_reload_save_handler";
import { VsCodeDartToolingDaemon } from "./dart/tooling_daemon";
import { FlutterIconDecorations } from "./decorations/flutter_icon_decorations";
import { FlutterUiGuideDecorations } from "./decorations/flutter_ui_guides_decorations";
import { DiagnosticReport } from "./diagnostic_report";
import { KnownExperiments, getExperiments } from "./experiments";
import { setUpDaemonMessageHandler } from "./flutter/daemon_message_handler";
import { FlutterDaemon } from "./flutter/flutter_daemon";
import { FlutterOutlineProvider, FlutterWidgetItem } from "./flutter/flutter_outline_view";
import { FlutterProjectWatcher } from "./flutter/flutter_project_watcher";
import { FlutterTaskProvider } from "./flutter/flutter_task_provider";
import { GenerateLocalizationsOnSaveHandler } from "./flutter/generate_localizations_on_save_handler";
import { FlutterWidgetPreviewManager } from "./flutter/widget_preview/widget_preview_manager";
import { LspClosingLabelsDecorations } from "./lsp/closing_labels_decorations";
import { LspGoToAugmentationCommand, LspGoToAugmentedCommand, LspGoToImportsCommand, LspGoToLocationCommand, LspGoToSuperCommand } from "./lsp/go_to";
import { TestDiscoverer } from "./lsp/test_discoverer";
import { locateBestProjectRoot } from "./project";
import { AddDependencyCodeActionProvider } from "./providers/add_dependency_code_action_provider";
import { DartLanguageConfiguration } from "./providers/dart_language_configuration";
import { DartDebugAdapterDescriptorFactory } from "./providers/debug_adapter_descriptor_factory";
import { DartDebugForcedAnsiColorSupportFactory } from "./providers/debug_adapter_forced_ansi_color_support";
import { DartDebugForcedDebugModeFactory } from "./providers/debug_adapter_forced_debug_mode_factory";
import { DartDebugForcedSingleThreadFactory } from "./providers/debug_adapter_forced_single_thread";
import { DartDebugAdapterGlobalEvaluationContextFactory } from "./providers/debug_adapter_global_evaluation_context_factory";
import { DartDebugAdapterHexViewFactory } from "./providers/debug_adapter_hex_view_factory";
import { DartDebugAdapterLaunchStatusFactory } from "./providers/debug_adapter_launch_status_factory";
import { DartDebugAdapterLoggerFactory } from "./providers/debug_adapter_logger_factory";
import { DartDebugAdapterRemoveErrorShowUserFactory } from "./providers/debug_adapter_remove_error_showUser_factory";
import { DartDebugAdapterSupportsUrisFactory } from "./providers/debug_adapter_support_uris_factory";
import { DebugConfigProvider, DynamicDebugConfigProvider, InitialLaunchJsonDebugConfigProvider } from "./providers/debug_config_provider";
import { DartMcpServerDefinitionProvider } from "./providers/mcp_server_definition_provider";
import { RankingCodeActionProvider } from "./providers/ranking_code_action_provider";
import { SnippetCompletionItemProvider } from "./providers/snippet_completion_item_provider";
import { PubGlobal } from "./pub/global";
import { ExtensionRecommentations } from "./recommendations/recommendations";
import { DevToolsManager } from "./sdk/dev_tools/manager";
import { StatusBarVersionTracker } from "./sdk/status_bar_version_tracker";
import { checkForStandardDartSdkUpdates } from "./sdk/update_check";
import { SdkUtils } from "./sdk/utils";
import { VsCodeTestController } from "./test/vs_test_controller";
import { handleNewProjects, showUserPrompts } from "./user_prompts";
import * as util from "./utils";
import { promptToReloadExtension } from "./utils";
import { addToLogHeader, clearLogHeader, getExtensionLogPath, getLogHeader } from "./utils/log";
import { getToolEnv, safeToolSpawn, setFlutterRoot, setupToolEnv } from "./utils/processes";
import { FlutterPostMessageSidebar } from "./views/devtools/legacy_post_message_sidebar/sidebar";
import { PropertyEditor } from "./views/devtools/property_editor";
import { FlutterDtdSidebar } from "./views/devtools/sidebar";
import { DartPackagesProvider } from "./views/packages_view";

let maybeAnalyzer: LspAnalyzer | undefined;
let flutterDaemon: IFlutterDaemon | undefined;
let deviceManager: FlutterDeviceManager | undefined;
const dartCapabilities = DartCapabilities.empty;
const flutterCapabilities = FlutterCapabilities.empty;

let analytics: Analytics;
const extensionTotalSessionStart = Date.now(); // Set for overall session.
let extensionThisSessionStart = extensionTotalSessionStart; // Reset during every activation.

let previousSettings: string;
let experiments: KnownExperiments;

const loggers: IAmDisposable[] = [];
let ringLogger: IAmDisposable | undefined;
const logger = new EmittingLogger();
let extensionLog: IAmDisposable | undefined;
const exportedApi: PublicDartExtensionApi & { [internalApiSymbol]?: any } = new PublicDartExtensionApiImpl();

// Keep a running in-memory buffer of last 500 log events we can give to the
// user when something crashed even if they don't have disk-logging enabled.
export const ringLog: RingLog = new RingLog(500);

// A key used to access state tied to this "session" to work around a possible VS Code bug that persists
// state unexpectedly accross sessions.
//
// https://github.com/microsoft/vscode/issues/240207
export const perSessionWebviewStateKey = `webviewState_${(new Date()).getTime()}_${getRandomInt(1, 1000)}`;

export async function activate(context: vs.ExtensionContext, isRestart = false) {
	extensionThisSessionStart = Date.now();

	// Ring logger is only set up once and presist over silent restarts.
	if (!ringLogger)
		ringLogger = logger.onLog((message) => ringLog.log(message.toLine(800)));

	if (isDevExtension)
		context.subscriptions.push(logToConsole(logger));

	// Clear any caches, for example projects that we detected. We might be reloading because
	// a Flutter project was added to a Dart-only workspace.
	clearCaches();

	void vs.commands.executeCommand("setContext", IS_RUNNING_LOCALLY_CONTEXT, isRunningLocally);
	buildLogHeaders();
	if (!extensionLog)
		extensionLog = setupLog(getExtensionLogPath(), LogCategory.General, false);

	const webClient = new WebClient(extensionVersion);

	util.logTime("Code called activate");

	// Wire up a reload command that will re-initialise everything.
	context.subscriptions.push(vs.commands.registerCommand("_dart.reloadExtension", async (reason?: ExtensionRestartReason) => {
		reason ??= ExtensionRestartReason.Unknown;
		logger.warn(`Performing extension reload (${reason})...`);
		analytics.logExtensionRestart(reason);
		await deactivate(true);
		disposeAll(context.subscriptions);
		await activate(context, true);
		logger.info("Done reloading extension!");
	}));

	// Configure if using flutter-dev.
	setFlutterDev(config.useFlutterDev);

	previousSettings = getSettingsThatRequireRestart();

	util.logTime();
	analytics = new Analytics(logger);
	const sdkUtils = new SdkUtils(logger, context, analytics);
	const workspaceContextUnverified = await sdkUtils.scanWorkspace();
	extensionApiModel.setSdks(workspaceContextUnverified.sdks);
	analytics.workspaceContext = workspaceContextUnverified;
	util.logTime("initWorkspace");

	// Set up log files.
	setupLog(config.analyzerLogFile, LogCategory.Analyzer);
	setupLog(config.flutterDaemonLogFile, LogCategory.FlutterDaemon);
	setupLog(config.flutterWidgetPreviewLogFile, LogCategory.FlutterWidgetPreview);
	setupLog(config.toolingDaemonLogFile, LogCategory.DartToolingDaemon);
	setupLog(config.devToolsLogFile, LogCategory.DevTools);

	if (!workspaceContextUnverified.sdks.dart || (workspaceContextUnverified.hasAnyFlutterProjects && !workspaceContextUnverified.sdks.flutter)) {
		// Don't set anything else up; we can't work like this!
		sdkUtils.handleMissingSdks(workspaceContextUnverified);
		return;
	}

	const workspaceContext = workspaceContextUnverified as DartWorkspaceContext;
	const extContext = Context.for(context, workspaceContext);
	const sdks = workspaceContext.sdks;
	const writableConfig = workspaceContext.config as WritableWorkspaceConfig;

	// Record the Flutter SDK path so we can set FLUTTER_ROOT for spawned processes.
	if (workspaceContext.hasAnyFlutterProjects && workspaceContext.sdks.flutter)
		setFlutterRoot(workspaceContext.sdks.flutter);
	setupToolEnv(config.env);
	void vs.commands.executeCommand("setContext", SDK_IS_PRE_RELEASE, sdks.isPreReleaseSdk);

	const rebuildLogHeaders = () => buildLogHeaders(logger, workspaceContext);

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
		if (workspaceContext.hasAnyFlutterProjects && config.shareDevToolsWithFlutter) {
			writableConfig.startDevToolsServerEagerly = true;
		}
	}

	try {
		if (!experiments)
			experiments = getExperiments(logger, workspaceContext, extContext);
	} catch (e) {
		logger.error(e);
	}


	// Build log headers now we know analyzer type.
	rebuildLogHeaders();

	// Show the SDK version in the status bar.
	if (sdks.dartVersion)
		context.subscriptions.push(new StatusBarVersionTracker(workspaceContext));

	void vs.commands.executeCommand("setContext", GO_TO_IMPORTS_SUPPORTED_CONTEXT, dartCapabilities.supportsGoToImports);
	void vs.commands.executeCommand("setContext", FLUTTER_SIDEBAR_SUPPORTED_CONTEXT, dartCapabilities.supportsFlutterSidebar);
	void vs.commands.executeCommand("setContext", OBSERVATORY_SUPPORTED_CONTEXT, dartCapabilities.supportsObservatory);

	// Fire up Flutter daemon if required.
	if (workspaceContext.hasAnyFlutterProjects && sdks.flutter) {
		let runIfNoDevices;
		let hasRunNoDevicesMessage = false;
		let portFromLocalExtension;
		if (workspaceContext.config.forceFlutterWorkspace && workspaceContext.config.restartMacDaemonMessage) {
			runIfNoDevices = () => {
				if (!hasRunNoDevicesMessage) {
					const instruction = workspaceContext.config.restartMacDaemonMessage;
					void promptToReloadExtension(logger, {
						prompt: `${instruction} (Settings currently expect port: ${config.daemonPort}.)`,
						buttonText: `Reopen this workspace`
					});
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
				const results = /Device daemon is available on remote port: (\d+)/i.exec(resultMessage);
				if (results !== null && results?.length > 1) {
					portFromLocalExtension = parseInt(results[1]);
				} else if (resultMessage !== null) {
					const displayError = `The local extension to expose devices failed: ${resultMessage}. ${workspaceContext.config.localDeviceCommandAdviceMessage ?? ""}`;
					void vs.window.showErrorMessage(displayError);
				}
			}
		}

		flutterDaemon = new FlutterDaemon(logger, analytics, workspaceContext as FlutterWorkspaceContext, flutterCapabilities, runIfNoDevices, portFromLocalExtension);
		deviceManager = new FlutterDeviceManager(logger, flutterDaemon, config, workspaceContext, extContext, runIfNoDevices, portFromLocalExtension);
		context.subscriptions.push(deviceManager);
		context.subscriptions.push(flutterDaemon);

		setUpDaemonMessageHandler(logger, context, flutterDaemon);
		// Exposed for use in user-tasks.
		context.subscriptions.push(vs.commands.registerCommand("flutter.getSelectedDeviceId", () => deviceManager?.currentDevice?.id));

		context.subscriptions.push(vs.commands.registerCommand("flutter.selectDevice", deviceManager.showDevicePicker.bind(deviceManager)));
		context.subscriptions.push(vs.commands.registerCommand("flutter.launchEmulator", deviceManager.promptForAndLaunchEmulator.bind(deviceManager)));
	}

	if (workspaceContext.config.forceFlutterWorkspace && isRunningLocally && isMac && workspaceContext.config.localMacWarningMessage) {
		void vs.window.showInformationMessage(workspaceContext.config.localMacWarningMessage.toString());
	}

	context.subscriptions.push(new AddSdkToPathCommands(logger, context, workspaceContext, analytics));
	const projectFinder = new ProjectFinder(logger, util.getExcludedFolders);
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
		await handleNewProjects(logger);

	// Fire up the analyzer process.
	const analyzer = new LspAnalyzer(logger, sdks, dartCapabilities, workspaceContext);
	maybeAnalyzer = analyzer;
	context.subscriptions.push(analyzer);

	// Set up the extension API.
	extensionApiModel.setAnalyzer(analyzer);
	extensionApiModel.setProjectFinder(projectFinder);
	extensionApiModel.setSdkCommands(sdkCommands);

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
	context.subscriptions.push(new LspClosingLabelsDecorations(analyzer.client));

	const activeFileFilters: vs.DocumentFilter[] = [...DART_MODE];

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

	if (config.showMainCodeLens) {
		const codeLensProvider = new MainCodeLensProvider(logger, analyzer);
		context.subscriptions.push(codeLensProvider);
		context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
	}
	if (config.showTestCodeLens) {
		const codeLensProvider = new TestCodeLensProvider(logger, analyzer);
		context.subscriptions.push(codeLensProvider);
		context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
	}
	if (config.showDartPadSampleCodeLens && sdks.flutter) {
		const codeLensProvider = new FlutterDartPadSamplesCodeLensProvider(logger, analyzer, sdks as FlutterSdks);
		context.subscriptions.push(codeLensProvider);
		context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
	}

	const loggingCommands = new LoggingCommands(logger, context.logPath);
	context.subscriptions.push(loggingCommands);

	// Register the ranking provider from VS Code now that it has all of its delegates.
	context.subscriptions.push(vs.languages.registerCodeActionsProvider(activeFileFilters, rankingCodeActionProvider, rankingCodeActionProvider.metadata));

	const extensionRecommendations = new ExtensionRecommentations(logger, analytics, extContext);

	// Dart Tooling Daemon.
	const dartToolingDaemon = dartCapabilities.supportsToolingDaemon && !workspaceContext.config.disableDartToolingDaemon
		? new VsCodeDartToolingDaemon(context, logger, sdks, dartCapabilities, deviceManager)
		: undefined;
	void dartToolingDaemon?.dtdUri.then((uri) => extensionApiModel.setDtdUri(uri));
	void analyzer.connectToDtd(dartToolingDaemon);

	const devTools = new DevToolsManager(logger, extContext, analytics, dartToolingDaemon, dartCapabilities, flutterCapabilities, extensionRecommendations);
	context.subscriptions.push(devTools);

	// Initialize Widget Preview if enabled+supported.
	const flutterSdk = workspaceContext.sdks.flutter;
	if (
		(
			// Preview enabled and supportsWidgetPreview (3.36)
			(config.experimentalFlutterWidgetPreview && flutterCapabilities.supportsWidgetPreview) ||
			// Or supportsWidgetPreviewByDefault (3.38 beta)
			flutterCapabilities.supportsWidgetPreviewByDefault
		)
		&& flutterSdk
		&& vs.workspace.workspaceFolders?.length) {
		// TODO(dantup): Support multiple projects better.
		// https://github.com/flutter/flutter/issues/173550
		const projectFolders = await projectFinder.findAllProjectFolders({ requirePubspec: true, searchDepth: config.projectSearchDepth });
		const firstFlutterProject = projectFolders.find(isFlutterProjectFolder);
		if (firstFlutterProject)
			context.subscriptions.push(new FlutterWidgetPreviewManager(logger, flutterSdk, dartToolingDaemon?.dtdUri, devTools?.devtoolsUrl, firstFlutterProject, config.flutterWidgetPreviewLocation));
	}

	// Debug commands.
	const debugCommands = new DebugCommands(logger, analyzer.fileTracker, extContext, workspaceContext, dartCapabilities, flutterCapabilities, devTools, loggingCommands);
	context.subscriptions.push(debugCommands);
	dartToolingDaemon?.debugCommandsCompleter.resolve(debugCommands);

	// Task handlers.
	context.subscriptions.push(vs.tasks.registerTaskProvider(DartTaskProvider.type, new DartTaskProvider(logger, context, sdks, dartCapabilities)));
	context.subscriptions.push(vs.tasks.registerTaskProvider(FlutterTaskProvider.type, new FlutterTaskProvider(logger, context, sdks, flutterCapabilities)));

	// Snippets are language-specific
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider(dartCapabilities, "snippets/dart.json", () => true)));
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider(dartCapabilities, "snippets/flutter.json", (uri) => util.isInsideFlutterProject(uri))));

	context.subscriptions.push(vs.languages.setLanguageConfiguration(DART_LANGUAGE, new DartLanguageConfiguration()));

	context.subscriptions.push(new FileChangeWarnings());
	context.subscriptions.push(new DiagnosticReport(logger, workspaceContext, rebuildLogHeaders));

	util.logTime("All other stuff before debugger..");

	const testModel = new TestModel(logger, config, util.isPathInsideFlutterProject);
	const testCoordinator = new TestSessionCoordinator(logger, testModel, analyzer.fileTracker);
	context.subscriptions.push(
		testCoordinator,
		vs.debug.onDidStartDebugSession((session) => testCoordinator.handleDebugSessionStart(session.id, session.configuration.dartCodeDebugSessionID as string | undefined, session.configuration.cwd as string | undefined)),
		vs.debug.onDidReceiveDebugSessionCustomEvent((e) => testCoordinator.handleDebugSessionCustomEvent(e.session.id, e.session.configuration.dartCodeDebugSessionID as string | undefined, e.event, e.body)),
		vs.debug.onDidTerminateDebugSession((session) => testCoordinator.handleDebugSessionEnd(session.id, session.configuration.dartCodeDebugSessionID as string | undefined)),
		vs.workspace.onDidChangeConfiguration(() => testModel.handleConfigChange()),
	);
	const testDiscoverer = new TestDiscoverer(logger, analyzer.fileTracker, testModel);
	context.subscriptions.push(testDiscoverer);
	const vsCodeTestController = vs.tests?.createTestController !== undefined // Feature-detect for Theia
		? new VsCodeTestController(logger, testModel, testDiscoverer)
		: undefined;
	if (vsCodeTestController)
		context.subscriptions.push(vsCodeTestController);

	new AnalyzerCommands(context, logger, analyzer, analytics);

	// Set up debug stuff.
	const debugProvider = new DebugConfigProvider(logger, workspaceContext, pubGlobal, testModel, flutterDaemon, deviceManager, devTools, flutterCapabilities);
	context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", debugProvider));

	// Debug trackers
	const globalEvaluationContext = new DartDebugAdapterGlobalEvaluationContextFactory();
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", globalEvaluationContext));
	const hexFormatter = new DartDebugAdapterHexViewFactory(logger);
	context.subscriptions.push(hexFormatter);
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", hexFormatter));
	const forcedDebugMode = new DartDebugForcedDebugModeFactory();
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", forcedDebugMode));
	const forcedAnsiColors = new DartDebugForcedAnsiColorSupportFactory();
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", forcedAnsiColors));
	const forcedSingleThread = new DartDebugForcedSingleThreadFactory();
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", forcedSingleThread));
	const removeErrorShowUser = new DartDebugAdapterRemoveErrorShowUserFactory();
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", removeErrorShowUser));
	const supportUris = new DartDebugAdapterSupportsUrisFactory(dartCapabilities);
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", supportUris));
	const launchStatus = new DartDebugAdapterLaunchStatusFactory();
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", launchStatus));
	// Logger goes last, so it logs any mutations made by the above.
	const debugLogger = new DartDebugAdapterLoggerFactory(logger);
	context.subscriptions.push(vs.debug.registerDebugAdapterTrackerFactory("dart", debugLogger));
	const trackerFactories = [globalEvaluationContext, hexFormatter, forcedDebugMode, forcedAnsiColors, forcedSingleThread, removeErrorShowUser, supportUris, launchStatus, debugLogger];

	const debugAdapterDescriptorFactory = new DartDebugAdapterDescriptorFactory(analytics, sdks, logger, extContext, dartCapabilities, flutterCapabilities, workspaceContext, experiments);
	context.subscriptions.push(vs.debug.registerDebugAdapterDescriptorFactory("dart", debugAdapterDescriptorFactory));
	// Also the providers for the initial configs.
	if (vs.DebugConfigurationProviderTriggerKind) { // Temporary workaround for GitPod/Theia not having this enum.
		context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", new InitialLaunchJsonDebugConfigProvider(logger), vs.DebugConfigurationProviderTriggerKind.Initial));
		context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", new DynamicDebugConfigProvider(logger, deviceManager), vs.DebugConfigurationProviderTriggerKind.Dynamic));
	}

	if (config.previewFlutterUiGuides)
		context.subscriptions.push(new FlutterUiGuideDecorations(analyzer));

	if (config.flutterGutterIcons)
		context.subscriptions.push(new FlutterIconDecorations(logger, analyzer));

	// Handle config changes so we can reanalyze if necessary.
	context.subscriptions.push(vs.workspace.onDidChangeConfiguration(() => handleConfigurationChange()));

	// Wire up handling of On-Save handlers.
	context.subscriptions.push(new HotReloadOnSaveHandler(debugCommands, flutterCapabilities));
	if (workspaceContext.hasAnyFlutterProjects && sdks.flutter) {
		context.subscriptions.push(new GenerateLocalizationsOnSaveHandler());
	}

	// Register URI handler.
	context.subscriptions.push(vs.window.registerUriHandler(new DartUriHandler(flutterCapabilities)));

	context.subscriptions.push(new OpenInOtherEditorCommands(logger, sdks));
	context.subscriptions.push(new SettingsCommands(logger, workspaceContext));
	context.subscriptions.push(new TestCommands(logger, workspaceContext, vsCodeTestController, dartCapabilities, flutterCapabilities));
	context.subscriptions.push(new LspGoToLocationCommand(analyzer));
	context.subscriptions.push(new LspGoToSuperCommand(analyzer));
	context.subscriptions.push(new LspGoToAugmentedCommand(analyzer));
	context.subscriptions.push(new LspGoToAugmentationCommand(analyzer));
	context.subscriptions.push(new LspGoToImportsCommand(analyzer));

	// Set up commands for Dart editors.
	context.subscriptions.push(new EditCommands());

	const packageLinkProvider = new DartPackageUriLinkProvider(
		logger,
		workspaceContext,
		locateBestProjectRoot,
		util.getExcludedFolders,
		config.projectSearchDepth,
	);
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
	const dartPackagesProvider = new DartPackagesProvider(logger, projectFinder, workspaceContext);
	context.subscriptions.push(dartPackagesProvider);
	const packagesTreeView = vs.window.createTreeView("dartDependencyTree", { treeDataProvider: dartPackagesProvider });
	context.subscriptions.push(packagesTreeView);
	let flutterOutlineTreeProvider: FlutterOutlineProvider | undefined;
	if (config.flutterOutline) {
		// TODO: Extract this out - it's become messy since TreeView was added in.

		flutterOutlineTreeProvider = new FlutterOutlineProvider(analyzer);
		const tree = vs.window.createTreeView<FlutterWidgetItem>("dartFlutterOutline", { treeDataProvider: flutterOutlineTreeProvider, showCollapseAll: true });
		tree.onDidChangeSelection(async (e) => {
			if (flutterOutlineTreeProvider!.numOutstandingSelectionEvents === 0)
				analytics.logFlutterOutlineActivated();
			// TODO: This should be in a tree, not the data provider.
			await flutterOutlineTreeProvider!.handleSelection(e.selection);
		});

		context.subscriptions.push(vs.window.onDidChangeTextEditorSelection(async (e) => {
			if (e.selections?.length) {
				const node = flutterOutlineTreeProvider!.getNodeAt(e.textEditor.document.uri, e.selections[0].start);
				if (node && tree.visible) {
					flutterOutlineTreeProvider!.numOutstandingSelectionEvents++;
					await tree.reveal(node, { select: true, focus: false, expand: true });
					setTimeout(() => flutterOutlineTreeProvider!.numOutstandingSelectionEvents--, 500);
				}
			}
		}));
		context.subscriptions.push(tree);
		context.subscriptions.push(flutterOutlineTreeProvider);


		// TODO: This doesn't work for LSP!
		new FlutterOutlineCommands(tree, context);
	}

	if (dartToolingDaemon && dartCapabilities.supportsDevToolsDtdSidebar)
		context.subscriptions.push(new FlutterDtdSidebar(devTools, dartCapabilities));
	else
		context.subscriptions.push(new FlutterPostMessageSidebar(devTools, deviceManager, dartCapabilities));

	let mcpServerProvider: DartMcpServerDefinitionProvider | undefined;
	if (vs.lm.registerMcpServerDefinitionProvider) {
		try {
			mcpServerProvider = new DartMcpServerDefinitionProvider(sdks, dartCapabilities);
			context.subscriptions.push(mcpServerProvider);
			context.subscriptions.push(vs.lm.registerMcpServerDefinitionProvider("dart-sdk-mcp-servers", mcpServerProvider));
		} catch (e) {
			// This is required to swallow the exception on VS Code v1.100 and prevent failure to activate.
			// https://github.com/Dart-Code/Dart-Code/issues/5573
			logger.warn("Failed to register MCP server provider, ignoring - see https://github.com/Dart-Code/Dart-Code/issues/5573");
			logger.warn(e);
		}
	}
	if (vs.lm.registerTool) {
		try {
			context.subscriptions.push(vs.lm.registerTool("get_dart_tooling_daemon_dtd_uri", {
				invoke: async () => {
					if (!dartCapabilities.supportsToolingDaemon)
						throw new Error("DTD is not available for this version of Flutter/Dart, please upgrade.");
					const dtdUri = await dartToolingDaemon?.dtdUri;
					return dtdUri
						? new vs.LanguageModelToolResult([new vs.LanguageModelTextPart(dtdUri)])
						: undefined;
				},
			}));
		} catch (e) {
			// This is required to swallow the exception on Firebase Studio (older VS Code version)
			// and prevent failure to activate.
			// https://github.com/Dart-Code/Dart-Code/issues/5570
			logger.warn("Failed to register LM Tool, ignoring - see https://github.com/Dart-Code/Dart-Code/issues/5570");
			logger.warn(e);
		}
	}

	if (dartToolingDaemon && (dartCapabilities.supportsDevToolsPropertyEditor || config.experimentalPropertyEditor)) {
		void vs.commands.executeCommand("setContext", FLUTTER_PROPERTY_EDITOR_SUPPORTED_CONTEXT, true);
		context.subscriptions.push(new PropertyEditor(devTools, dartCapabilities));
	} else {
		void vs.commands.executeCommand("setContext", FLUTTER_PROPERTY_EDITOR_SUPPORTED_CONTEXT, false);
	}

	context.subscriptions.push(vs.commands.registerCommand("dart.package.openFile", (filePath: string) => {
		if (!filePath) return;

		vs.workspace.openTextDocument(filePath).then((document) => {
			void vs.window.showTextDocument(document, { preview: true });
		}, (error) => logger.error(error));
	}));

	// Warn the user if they've opened a folder with mismatched casing.
	if (vs.workspace.workspaceFolders?.length) {
		for (const wf of vs.workspace.workspaceFolders) {
			if (warnIfPathCaseMismatch(logger, fsPath(wf.uri), "the open workspace folder", "re-open the folder using the File Open dialog"))
				break;
		}
	}

	// Prompt user for any special config we might want to set.
	if (!isRestart)
		void showUserPrompts(logger, extContext, webClient, analytics, workspaceContext, dartCapabilities, extensionRecommendations);

	// Turn on all the commands.
	setCommandVisiblity(true, workspaceContext);
	void vs.commands.executeCommand("setContext", DART_PLATFORM_NAME, dartPlatformName);

	// Prompt for pub get/upgrade if required
	function checkForPackages() {
		// Don't prompt for package updates in the Fuchsia tree/Dart SDK repo.
		if (workspaceContext.config.disableAutomaticPub)
			return;
		void packageCommands.fetchPackagesOrPrompt(undefined, { alwaysPrompt: true, upgradeOnSdkChange: true });
	}
	checkForPackages();

	// If we're not already in Flutter mode, watch for Flutter projects being added.
	if (!workspaceContext.hasAnyFlutterProjects)
		context.subscriptions.push(new FlutterProjectWatcher(logger, workspaceContext));

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
				.then(() => rebuildLogHeaders());
		}
	}

	if (!isRestart)
		analytics.logExtensionActivated();

	// Handle changes to the workspace.
	// Set the roots, handling project changes that might affect SDKs.
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders(async () => {
		// First check if something changed that will affect our SDK, in which case
		// we'll perform a silent restart so that we do new SDK searches.
		const newWorkspaceContext = await sdkUtils.scanWorkspace();
		if (
			newWorkspaceContext.hasAnyFlutterProjects !== workspaceContext.hasAnyFlutterProjects
			|| newWorkspaceContext.hasProjectsInFuchsiaTree !== workspaceContext.hasProjectsInFuchsiaTree
		) {
			void util.promptToReloadExtension(logger);
			return;
		}

		workspaceContext.events.onPackageMapChange.fire();
		checkForPackages();
	}));

	context.subscriptions.push(createWatcher("**/.packages", workspaceContext.events.onPackageMapChange));
	context.subscriptions.push(createWatcher("**/.dart_tool/package_config.json", workspaceContext.events.onPackageMapChange));
	workspaceContext.events.onPackageMapChange.fire();

	const dartCodeConfigurationPath = process.env[dartCodeConfigurationPathEnvironmentVariableName] || defaultDartCodeConfigurationPath;
	context.subscriptions.push(new AutoLaunch(dartCodeConfigurationPath, logger, deviceManager));

	// TODO(dantup): We should only expose the private API required for testing when in test runs, however
	//  some extensions are currently using this for access to the analyzer. We should provide a replacement
	//  before removing this to avoid breaking them.
	// if (!isDartCodeTestRun) {
	// 	return exportedApi;
	// } else {
	const privateApi = {
		addDependencyCommand,
		analyzer,
		context: extContext,
		currentAnalysis: () => analyzer?.onCurrentAnalysisComplete,
		daemonCapabilities: flutterDaemon ? flutterDaemon.capabilities : DaemonCapabilities.empty,
		dartCapabilities,
		debugAdapterDescriptorFactory,
		debugCommands,
		debugProvider,
		debugSessions,
		devTools,
		deviceManager,
		envUtils,
		fileTracker: analyzer.fileTracker,
		flutterCapabilities,
		flutterOutlineTreeProvider,
		get isInImplementationFileThatCanHaveTest() { return isInImplementationFileThatCanHaveTest; },
		get isInTestFileThatHasImplementation() { return isInTestFileThatHasImplementation; },
		getLogHeader,
		getOutputChannel,
		getToolEnv,
		initialAnalysis: analyzer.onInitialAnalysis,
		interactiveRefactors: analyzer.refactors,
		logger,
		mcpServerProvider: isDartCodeTestRun ? mcpServerProvider : undefined,
		nextAnalysis: () => analyzer?.onNextAnalysisComplete,
		packageCommands,
		packagesTreeProvider: dartPackagesProvider,
		pubGlobal,
		safeToolSpawn,
		sdkUtils: isDartCodeTestRun ? sdkUtils : undefined,
		testController: vsCodeTestController,
		testCoordinator,
		testDiscoverer,
		testModel,
		toolingDaemon: isDartCodeTestRun ? dartToolingDaemon : undefined,
		trackerFactories,
		webClient,
		workspaceContext,
	} as InternalExtensionApi;
	// Copy all fields and getters from privateApi into the existing object so that it works
	// correctly through exports.
	Object.defineProperties(
		(exportedApi as any)[internalApiSymbol] ??= {},
		Object.getOwnPropertyDescriptors(privateApi)
	);

	return exportedApi;
	// }
}

function setupLog(logFile: string | undefined, category: LogCategory, autoDispose = true) {
	if (logFile) {
		const fileLogger = captureLogs(logger, logFile, getLogHeader(), config.maxLogLineLength, [category]);
		if (autoDispose)
			loggers.push(fileLogger);
		return fileLogger;
	}
}

function buildLogHeaders(logger?: Logger, workspaceContext?: WorkspaceContext) {
	clearLogHeader();
	addToLogHeader(() => `Dart Code extension: ${extensionVersion}`);
	addToLogHeader(() => {
		const ext = vs.extensions.getExtension(flutterExtensionIdentifier)!;
		return `Flutter extension: ${ext.packageJSON.version} (${ext.isActive ? "" : "not "}activated)`;
	});
	addToLogHeader(() => ``);
	addToLogHeader(() => `App: ${vs.env.appName}`);
	if (vs.env.appHost)
		addToLogHeader(() => `App Host: ${vs.env.appHost}`);
	if (vs.env.remoteName)
		addToLogHeader(() => `Remote: ${vs.env.remoteName}`);
	if (hostKind)
		addToLogHeader(() => `Host Kind: ${hostKind}`);
	addToLogHeader(() => `Version: ${platformDisplayName} ${vs.version}`);
	if (workspaceContext) {
		addToLogHeader(() => ``);
		addToLogHeader(() => `Workspace type: ${workspaceContext.workspaceTypeDescription} (LSP)${vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length > 1 ? " (Multiroot)" : ""}`);
		addToLogHeader(() => `Workspace name: ${vs.workspace.name}`);
		const sdks = workspaceContext.sdks;
		addToLogHeader(() => ``);
		addToLogHeader(() => `Dart (${sdks.dartVersion}): ${sdks.dart}`);
		const deviceInfo = deviceManager?.currentDevice ? `${deviceManager?.currentDevice?.name} (${deviceManager?.currentDevice?.platform}/${deviceManager?.currentDevice?.platformType})` : `No device`;
		addToLogHeader(() => `Flutter (${sdks.flutterVersion}): ${sdks.flutter} (${deviceInfo})`);
	}
	addToLogHeader(() => ``);
	if (process.env.HTTP_PROXY || process.env.NO_PROXY)
		addToLogHeader(() => `HTTP_PROXY: ${process.env.HTTP_PROXY}, NO_PROXY: ${process.env.NO_PROXY}`);

	// Any time the log headers are rebuilt, we should re-log them.
	logger?.info(getLogHeader());
}


function handleConfigurationChange() {
	// TODOs
	// SDK
	const newSettings = getSettingsThatRequireRestart();
	const settingsChanged = previousSettings !== newSettings;
	previousSettings = newSettings;

	if (settingsChanged) {
		// Delay the restart slightly, because the config change may be transmitted to the LSP server
		// and shutting the server down too quickly results in that trying to write to a closed
		// stream.
		logger.warn(`Configuration changed, reloading`);
		setTimeout(() => util.promptToReloadExtension(logger), 50);
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

export async function deactivate(isRestart = false): Promise<void> {
	logger.info(`Extension deactivate was called (isRestart: ${isRestart})`);

	// Record session durations.
	const sessionEndTimestamp = Date.now();
	const sessionDurationMs = sessionEndTimestamp - extensionThisSessionStart; // Always record _this_ duration.
	const totalSessionDurationMs = isRestart ? undefined : sessionEndTimestamp - extensionTotalSessionStart; // Only record totals for non-restarts.
	if (analytics)
		analytics.logExtensionDeactivate({ sessionDurationMs, totalSessionDurationMs });

	extensionApiModel.clear();

	const loggersToDispose = [...loggers];
	loggers.length = 0;
	await Promise.allSettled([
		tryCleanup(() => setCommandVisiblity(false)),
		tryCleanup(() => maybeAnalyzer?.dispose()),
		tryCleanup(() => flutterDaemon?.shutdown()),
		tryCleanup(() => vs.commands.executeCommand("setContext", FLUTTER_SUPPORTS_ATTACH, false)),
		...loggersToDispose.map((l) => tryCleanup(() => l.dispose())),
	]);
	logger.info(`Extension cleanup done`);

	// Pump for any log events that might need to be written to the loggers.
	await new Promise((resolve) => setTimeout(resolve, 100));

	if (!isRestart) {
		logger.info(`Closing all loggers...`);
		await new Promise((resolve) => setTimeout(resolve, 50));
		await Promise.allSettled([
			tryCleanup(() => logger.dispose()),
			tryCleanup(() => ringLogger?.dispose()),
			tryCleanup(() => extensionLog?.dispose()),
		]);
		await new Promise((resolve) => setTimeout(resolve, 50));
	} else {
		logger.info(`Restarting...`);
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
}

function setCommandVisiblity(enable: boolean, workspaceContext?: WorkspaceContext) {
	void vs.commands.executeCommand("setContext", PROJECT_LOADED, enable);
	void vs.commands.executeCommand("setContext", DART_PROJECT_LOADED, enable && workspaceContext?.hasAnyStandardDartProjects);
	void vs.commands.executeCommand("setContext", FLUTTER_PROJECT_LOADED, enable && workspaceContext?.hasAnyFlutterProjects);
	void vs.commands.executeCommand("setContext", WEB_PROJECT_LOADED, enable && workspaceContext?.hasAnyWebProjects);
}

/// Calls a cleanup function in a try/catch to ensure we never throw and logs any error to the logger
/// and the console.
async function tryCleanup(f: () => void | Promise<void> | Thenable<void>): Promise<void> {
	try {
		await f();
	} catch (e) {
		try {
			console.error(`Error cleaning up during extension shutdown: ${e}`);
			logger.error(`Error cleaning up during extension shutdown: ${e}`);
		} catch { }
	}
}

