import * as fs from "fs";
import * as path from "path";
import { isArray } from "util";
import * as vs from "vscode";
import { WorkspaceFolder } from "vscode";
import { internalApiSymbol } from "../src/symbols";
import { Analyzer, AnalyzerCapabilities } from "./analysis/analyzer";
import { AnalyzerStatusReporter } from "./analysis/analyzer_status_reporter";
import { FileChangeHandler } from "./analysis/file_change_handler";
import { OpenFileTracker } from "./analysis/open_file_tracker";
import { findPackageRoots } from "./analysis/utils";
import { Analytics } from "./analytics";
import { DartExtensionApi } from "./api";
import { TestCodeLensProvider } from "./code_lens/test_code_lens_provider";
import { DebugCommands } from "./commands/debug";
import { EditCommands } from "./commands/edit";
import { GoToSuperCommand } from "./commands/go_to_super";
import { LoggingCommands } from "./commands/logging";
import { OpenInOtherEditorCommands } from "./commands/open_in_other_editors";
import { RefactorCommands } from "./commands/refactor";
import { SdkCommands } from "./commands/sdk";
import { TestCommands } from "./commands/test";
import { TypeHierarchyCommand } from "./commands/type_hierarchy";
import { config } from "./config";
import { flutterExtensionIdentifier, forceWindowsDriveLetterToUppercase, isWin, isWithinPath, LogCategory, platformName } from "./debug/utils";
import { ClosingLabelsDecorations } from "./decorations/closing_labels_decorations";
import { HotReloadCoverageDecorations } from "./decorations/hot_reload_coverage_decorations";
import { FlutterCapabilities } from "./flutter/capabilities";
import { setUpDaemonMessageHandler } from "./flutter/daemon_message_handler";
import { DaemonCapabilities, FlutterDaemon } from "./flutter/flutter_daemon";
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
import { DebugConfigProvider, HAS_LAST_DEBUG_CONFIG } from "./providers/debug_config_provider";
import { FixCodeActionProvider } from "./providers/fix_code_action_provider";
import { IgnoreLintCodeActionProvider } from "./providers/ignore_lint_code_action_provider";
import { LegacyDartWorkspaceSymbolProvider } from "./providers/legacy_dart_workspace_symbol_provider";
import { RefactorCodeActionProvider } from "./providers/refactor_code_action_provider";
import { SnippetCompletionItemProvider } from "./providers/snippet_completion_item_provider";
import { SourceCodeActionProvider } from "./providers/source_code_action_provider";
import { PubBuildRunnerTaskProvider } from "./pub/build_runner_task_provider";
import { PubGlobal } from "./pub/global";
import { isPubGetProbablyRequired, promptToRunPubGet } from "./pub/pub";
import { StatusBarVersionTracker } from "./sdk/status_bar_version_tracker";
import { checkForSdkUpdates } from "./sdk/update_check";
import { analyzerSnapshotPath, dartVMPath, findSdks, flutterPath, handleMissingSdks } from "./sdk/utils";
import { DartUriHandler } from "./uri_handlers/uri_handler";
import { showUserPrompts } from "./user_prompts";
import * as util from "./utils";
import { fsPath } from "./utils";
import { addToLogHeader, clearLogHeader, getExtensionLogPath, log, logError, logTo } from "./utils/log";
import { DartPackagesProvider } from "./views/packages_view";
import { TestResultsProvider } from "./views/test_view";

const DART_MODE: vs.DocumentFilter[] = [{ language: "dart", scheme: "file" }];
const HTML_MODE: vs.DocumentFilter[] = [{ language: "html", scheme: "file" }];

const DART_PROJECT_LOADED = "dart-code:dartProjectLoaded";
const FLUTTER_PROJECT_LOADED = "dart-code:flutterProjectLoaded";
export const FLUTTER_SUPPORTS_ATTACH = "dart-code:flutterSupportsAttach";
const DART_PLATFORM_NAME = "dart-code:platformName";
export const SERVICE_EXTENSION_CONTEXT_PREFIX = "dart-code:serviceExtension.";
export let extensionPath: string | undefined;

let analyzer: Analyzer;
let flutterDaemon: FlutterDaemon;
const flutterCapabilities = FlutterCapabilities.empty;
let analysisRoots: string[] = [];
let analytics: Analytics;

let showTodos: boolean | undefined;
let previousSettings: string;
let extensionLogger: { dispose: () => Promise<void> | void };

export function activate(context: vs.ExtensionContext, isRestart: boolean = false) {
	if (!extensionLogger)
		extensionLogger = logTo(getExtensionLogPath(), [LogCategory.General]);

	util.logTime("Code called activate");
	// Wire up a reload command that will re-initialise everything.
	context.subscriptions.push(vs.commands.registerCommand("_dart.reloadExtension", (_) => {
		log("Performing silent extension reload...");
		deactivate(true);
		const toDispose = context.subscriptions.slice();
		context.subscriptions.length = 0;
		for (const sub of toDispose) {
			try {
				sub.dispose();
			} catch (e) {
				logError(e);
			}
		}
		activate(context, true);
		log("Done!");
	}));

	showTodos = config.showTodos;
	previousSettings = getSettingsThatRequireRestart();

	extensionPath = context.extensionPath;
	const extensionStartTime = new Date();
	util.logTime();
	const sdks = findSdks();
	buildLogHeaders(sdks);
	util.logTime("findSdks");
	analytics = new Analytics(sdks);
	if (!sdks.dart || (sdks.projectType === util.ProjectType.Flutter && !sdks.flutter)) {
		// Don't set anything else up; we can't work like this!
		return handleMissingSdks(context, analytics, sdks);
	}

	if (sdks.flutterVersion)
		flutterCapabilities.version = sdks.flutterVersion;

	// Show the SDK version in the status bar.
	if (sdks.dartVersion) {
		analytics.sdkVersion = sdks.dartVersion;
		checkForSdkUpdates(sdks, sdks.dartVersion);
		context.subscriptions.push(new StatusBarVersionTracker(sdks.projectType, sdks.dartVersion, sdks.flutterVersion, sdks.dartSdkIsFromFlutter));
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

	analyzer = new Analyzer(path.join(sdks.dart, dartVMPath), analyzerPath);
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
	const hoverProvider = new DartHoverProvider(analyzer);
	const formattingEditProvider = new DartFormattingEditProvider(analyzer);
	const completionItemProvider = new DartCompletionItemProvider(analyzer);
	const referenceProvider = new DartReferenceProvider(analyzer);
	const documentHighlightProvider = new DartDocumentHighlightProvider(analyzer);
	const assistCodeActionProvider = new AssistCodeActionProvider(analyzer);
	const fixCodeActionProvider = new FixCodeActionProvider(analyzer);
	const refactorCodeActionProvider = new RefactorCodeActionProvider(analyzer);
	const sourceCodeActionProvider = new SourceCodeActionProvider(analyzer);
	const ignoreLintCodeActionProvider = new IgnoreLintCodeActionProvider(analyzer);
	const renameProvider = new DartRenameProvider(analyzer);
	const implementationProvider = new DartImplementationProvider(analyzer);

	const activeFileFilters = [DART_MODE];
	if (config.analyzeAngularTemplates && analyzer.capabilities.supportsAnalyzingHtmlFiles) {
		// Analyze Angular2 templates, requires the angular_analyzer_plugin.
		activeFileFilters.push(HTML_MODE);
	}

	const triggerCharacters = ".:=(${'\"/\\".split("");
	activeFileFilters.forEach((filter) => {
		context.subscriptions.push(vs.languages.registerHoverProvider(filter, hoverProvider));
		context.subscriptions.push(vs.languages.registerDocumentFormattingEditProvider(filter, formattingEditProvider));
		context.subscriptions.push(vs.languages.registerCompletionItemProvider(filter, completionItemProvider, ...triggerCharacters));
		context.subscriptions.push(vs.languages.registerDefinitionProvider(filter, referenceProvider));
		context.subscriptions.push(vs.languages.registerReferenceProvider(filter, referenceProvider));
		context.subscriptions.push(vs.languages.registerDocumentHighlightProvider(filter, documentHighlightProvider));
		context.subscriptions.push(vs.languages.registerCodeActionsProvider(filter, assistCodeActionProvider, assistCodeActionProvider.metadata));
		context.subscriptions.push(vs.languages.registerCodeActionsProvider(filter, fixCodeActionProvider, fixCodeActionProvider.metadata));
		context.subscriptions.push(vs.languages.registerCodeActionsProvider(filter, refactorCodeActionProvider, refactorCodeActionProvider.metadata));
		context.subscriptions.push(vs.languages.registerRenameProvider(filter, renameProvider));
	});

	// Some actions only apply to Dart.
	context.subscriptions.push(vs.languages.registerOnTypeFormattingEditProvider(DART_MODE, formattingEditProvider, "}", ";"));
	context.subscriptions.push(vs.languages.registerCodeActionsProvider(DART_MODE, sourceCodeActionProvider, sourceCodeActionProvider.metadata));
	context.subscriptions.push(vs.languages.registerCodeActionsProvider(DART_MODE, ignoreLintCodeActionProvider, ignoreLintCodeActionProvider.metadata));
	context.subscriptions.push(vs.languages.registerImplementationProvider(DART_MODE, implementationProvider));
	if (config.showTestCodeLens) {
		const codeLensProvider = new TestCodeLensProvider(analyzer);
		context.subscriptions.push(codeLensProvider);
		context.subscriptions.push(vs.languages.registerCodeLensProvider(DART_MODE, codeLensProvider));
	}

	// Task handlers.
	if (config.previewBuildRunnerTasks) {
		context.subscriptions.push(vs.tasks.registerTaskProvider("pub", new PubBuildRunnerTaskProvider(sdks)));
	}

	// Snippets are language-specific
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider("snippets/dart.json", (_) => true)));
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider("snippets/flutter.json", (uri) => util.isFlutterWorkspaceFolder(vs.workspace.getWorkspaceFolder(uri)))));

	context.subscriptions.push(vs.languages.setLanguageConfiguration(DART_MODE[0].language, new DartLanguageConfiguration()));
	const statusReporter = new AnalyzerStatusReporter(analyzer, sdks, analytics);

	// Set up diagnostics.
	const diagnostics = vs.languages.createDiagnosticCollection("dart");
	context.subscriptions.push(diagnostics);
	const diagnosticsProvider = new DartDiagnosticProvider(analyzer, diagnostics);

	// Set the roots, handling project changes that might affect SDKs.
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => recalculateAnalysisRoots()));
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
	if (sdks.projectType === util.ProjectType.Flutter) {
		flutterDaemon = new FlutterDaemon(path.join(sdks.flutter, flutterPath), sdks.flutter);
		context.subscriptions.push(flutterDaemon);
		setUpDaemonMessageHandler(context, flutterDaemon);
		setUpHotReloadOnSave(context, diagnostics);
	}

	util.logTime("All other stuff before debugger..");

	// Set up debug stuff.
	const debugProvider = new DebugConfigProvider(sdks, analytics, flutterDaemon && flutterDaemon.deviceManager, flutterCapabilities);
	context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", debugProvider));
	context.subscriptions.push(debugProvider);

	// Setup that requires server version/capabilities.
	const connectedSetup = analyzer.registerForServerConnected((sc) => {
		connectedSetup.dispose();

		if (analyzer.capabilities.supportsClosingLabels && config.closingLabels) {
			context.subscriptions.push(new ClosingLabelsDecorations(analyzer));
		}

		if (analyzer.capabilities.supportsGetDeclerations) {
			context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new DartWorkspaceSymbolProvider(analyzer)));
		} else {
			context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new LegacyDartWorkspaceSymbolProvider(analyzer)));
		}

		if (analyzer.capabilities.supportsCustomFolding && config.analysisServerFolding)
			context.subscriptions.push(vs.languages.registerFoldingRangeProvider(DART_MODE, new DartFoldingProvider(analyzer)));

		if (analyzer.capabilities.supportsGetSignature)
			context.subscriptions.push(vs.languages.registerSignatureHelpProvider(
				DART_MODE,
				new DartSignatureHelpProvider(analyzer),
				...(config.triggerSignatureHelpAutomatically ? ["(", ","] : []),
			));

		const documentSymbolProvider = new DartDocumentSymbolProvider(analyzer);
		activeFileFilters.forEach((filter) => {
			context.subscriptions.push(vs.languages.registerDocumentSymbolProvider(filter, documentSymbolProvider));
		});

		context.subscriptions.push(new OpenFileTracker(analyzer));
	});

	// Handle config changes so we can reanalyze if necessary.
	context.subscriptions.push(vs.workspace.onDidChangeConfiguration(() => handleConfigurationChange(sdks)));
	context.subscriptions.push(vs.workspace.onDidSaveTextDocument((td) => {
		if (path.basename(fsPath(td.uri)).toLowerCase() === "pubspec.yaml")
			handleConfigurationChange(sdks);
	}));

	// Handle project changes that might affect SDKs.
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => {
		handleConfigurationChange(sdks);
	}));

	// Register SDK commands.
	const pubGlobal = new PubGlobal(sdks);
	const sdkCommands = new SdkCommands(context, sdks, pubGlobal, flutterCapabilities, flutterDaemon && flutterDaemon.deviceManager);
	const debug = new DebugCommands(context, sdks, analytics, pubGlobal);

	// Register URI handler.
	context.subscriptions.push(vs.window.registerUriHandler(new DartUriHandler(flutterCapabilities)));

	// Set up commands for Dart editors.
	context.subscriptions.push(new EditCommands(context, analyzer));
	context.subscriptions.push(new RefactorCommands(context, analyzer));

	// Register misc commands.
	context.subscriptions.push(new TypeHierarchyCommand(analyzer));
	context.subscriptions.push(new GoToSuperCommand(analyzer));
	context.subscriptions.push(new LoggingCommands(context.logPath));
	context.subscriptions.push(new OpenInOtherEditorCommands(sdks));
	context.subscriptions.push(new TestCommands());

	// Register our view providers.
	const dartPackagesProvider = new DartPackagesProvider();
	dartPackagesProvider.setWorkspaces(util.getDartWorkspaceFolders());
	context.subscriptions.push(dartPackagesProvider);
	context.subscriptions.push(vs.window.registerTreeDataProvider("dartPackages", dartPackagesProvider));
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => {
		dartPackagesProvider.setWorkspaces(util.getDartWorkspaceFolders());
	}));
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
			testTreeProvider.setSelectedNodes(e.selection && e.selection.length === 1 ? e.selection[0] : undefined);
		}),
	);

	if (sdks.projectType !== util.ProjectType.Dart && config.previewHotReloadCoverageMarkers) {
		context.subscriptions.push(new HotReloadCoverageDecorations(debug));
	}

	context.subscriptions.push(vs.commands.registerCommand("dart.package.openFile", (filePath) => {
		if (!filePath) return;

		vs.workspace.openTextDocument(filePath).then((document) => {
			vs.window.showTextDocument(document, { preview: true });
		}, (error) => logError(error));
	}));

	// Warn the user if they've opened a folder with mismatched casing.
	if (vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length) {
		for (const wf of vs.workspace.workspaceFolders) {
			const userPath = forceWindowsDriveLetterToUppercase(fsPath(wf.uri));
			const realPath = forceWindowsDriveLetterToUppercase(util.trueCasePathSync(userPath));
			if (userPath && realPath && userPath !== realPath) {
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
		showUserPrompts(context, sdks);

	// Turn on all the commands.
	setCommandVisiblity(true, sdks.projectType);
	vs.commands.executeCommand("setContext", DART_PLATFORM_NAME, platformName);

	// Prompt for pub get if required
	function checkForPackages() {
		// Don't prompt for package updates in the Fuchsia tree.
		if (sdks.projectType === util.ProjectType.Fuchsia)
			return;
		const folders = util.getDartWorkspaceFolders();
		const foldersRequiringPackageGet = folders.filter((ws: WorkspaceFolder) => config.for(ws.uri).promptToGetPackages).filter(isPubGetProbablyRequired);
		if (foldersRequiringPackageGet.length > 0)
			promptToRunPubGet(foldersRequiringPackageGet);
	}
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => checkForPackages()));
	if (!isRestart)
		checkForPackages();

	// Begin activating dependant packages.
	if (sdks.projectType === util.ProjectType.Flutter || sdks.projectType === util.ProjectType.Fuchsia) {
		const flutterExtension = vs.extensions.getExtension(flutterExtensionIdentifier);
		if (flutterExtension) {
			log(`Activating Flutter extension for ${util.ProjectType[sdks.projectType]} project...`);
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

	return {
		...new DartExtensionApi(),
		[internalApiSymbol]: {
			analyzerCapabilities: analyzer.capabilities,
			cancelAllAnalysisRequests: () => analyzer.cancelAllRequests(),
			currentAnalysis: () => analyzer.currentAnalysis,
			daemonCapabilities: flutterDaemon ? flutterDaemon.capabilities : DaemonCapabilities.empty,
			debugProvider,
			flutterCapabilities,
			initialAnalysis,
			nextAnalysis,
			reanalyze,
			referenceProvider,
			renameProvider,
			sdks,
			testTreeProvider,
		} as InternalExtensionApi,
	};
}

function buildLogHeaders(sdks: util.Sdks) {
	clearLogHeader();
	addToLogHeader(() => `!! PLEASE REVIEW THIS LOG FOR SENSITIVE INFORMATION BEFORE SHARING !!`);
	addToLogHeader(() => ``);
	addToLogHeader(() => `Dart Code extension: ${util.extensionVersion}`);
	addToLogHeader(() => {
		const ext = vs.extensions.getExtension(flutterExtensionIdentifier);
		return `Flutter extension: ${ext.packageJSON.version} (${ext.isActive ? "" : "not "}activated)`;
	});
	addToLogHeader(() => `VS Code: ${vs.version}`);
	addToLogHeader(() => `Platform: ${platformName}`);
	addToLogHeader(() => `Workspace type: ${util.ProjectType[sdks.projectType]}`);
	addToLogHeader(() => `Multi-root?: ${vs.workspace.workspaceFolders && vs.workspace.workspaceFolders.length > 1}`);
	addToLogHeader(() => `Dart SDK:\n    Loc: ${sdks.dart}\n    Ver: ${util.getSdkVersion(sdks.dart)}`);
	addToLogHeader(() => `Flutter SDK:\n    Loc: ${sdks.flutter}\n    Ver: ${util.getSdkVersion(sdks.flutter)}`);
	addToLogHeader(() => `HTTP_PROXY: ${process.env.HTTP_PROXY}`);
	addToLogHeader(() => `NO_PROXY: ${process.env.NO_PROXY}`);
}

function recalculateAnalysisRoots() {
	let newRoots: string[] = [];
	util.getDartWorkspaceFolders().forEach((f) => {
		newRoots = newRoots.concat(findPackageRoots(analyzer, fsPath(f.uri)));
	});
	analysisRoots = newRoots;

	// Sometimes people open their home directories as the workspace root and
	// have all sorts of performance issues because of PubCache and AppData folders
	// so we will exclude them if the user has opened a parent folder (opening a
	// child of these directly will still work).
	const excludeFolders: string[] = [];
	if (isWin) {
		const addExcludeIfRequired = (folder: string) => {
			if (!folder || !path.isAbsolute(folder))
				return;
			const containingRoot = analysisRoots.find((root: string) => isWithinPath(folder, root));
			if (containingRoot) {
				log(`Excluding folder ${folder} from analysis roots as it is a child of analysis root ${containingRoot} and may cause performance issues.`);
				excludeFolders.push(folder);
			}
		};

		addExcludeIfRequired(process.env.PUB_CACHE);
		addExcludeIfRequired(process.env.APPDATA);
		addExcludeIfRequired(process.env.LOCALAPPDATA);
	}

	// For each workspace, handle excluded folders.
	util.getDartWorkspaceFolders().forEach((f) => {
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

function handleConfigurationChange(sdks: util.Sdks) {
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
		+ config.closingLabels
		+ config.analyzeAngularTemplates
		+ config.normalizeWindowsDriveLetters
		+ config.analysisServerFolding
		+ config.showTestCodeLens
		+ config.previewHotReloadCoverageMarkers
		+ config.previewBuildRunnerTasks
		+ config.triggerSignatureHelpAutomatically;
}

export async function deactivate(isRestart: boolean = false): Promise<void> {
	setCommandVisiblity(false, null);
	vs.commands.executeCommand("setContext", FLUTTER_SUPPORTS_ATTACH, false);
	if (!isRestart) {
		vs.commands.executeCommand("setContext", HAS_LAST_DEBUG_CONFIG, false);
		await analytics.logExtensionShutdown();
		if (extensionLogger)
			await extensionLogger.dispose();
	}
}

function setCommandVisiblity(enable: boolean, projectType: util.ProjectType) {
	vs.commands.executeCommand("setContext", DART_PROJECT_LOADED, enable);
	vs.commands.executeCommand("setContext", FLUTTER_PROJECT_LOADED, enable && projectType === util.ProjectType.Flutter);
}

export interface InternalExtensionApi {
	analyzerCapabilities: AnalyzerCapabilities;
	cancelAllAnalysisRequests: () => void;
	currentAnalysis: () => Promise<void>;
	daemonCapabilities: DaemonCapabilities;
	flutterCapabilities: FlutterCapabilities;
	debugProvider: DebugConfigProvider;
	nextAnalysis: () => Promise<void>;
	initialAnalysis: Promise<void>;
	reanalyze: () => void;
	referenceProvider: DartReferenceProvider;
	renameProvider: DartRenameProvider;
	sdks: util.Sdks;
	testTreeProvider: TestResultsProvider;
}
