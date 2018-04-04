import * as fs from "fs";
import * as path from "path";
import * as util from "./utils";
import * as vs from "vscode";
import { WorkspaceFolder } from "vscode";
import { ServerStatusNotification } from "./analysis/analysis_server_types";
import { Analyzer } from "./analysis/analyzer";
import { Analytics } from "./analytics";
import { AnalyzerStatusReporter } from "./analysis/analyzer_status_reporter";
import { DebugCommands } from "./commands/debug";
import { EditCommands } from "./commands/edit";
import { SdkCommands } from "./commands/sdk";
import { TypeHierarchyCommand } from "./commands/type_hierarchy";
import { config } from "./config";
import { ClosingLabelsDecorations } from "./decorations/closing_labels_decorations";
import { FileChangeHandler } from "./analysis/file_change_handler";
import { FlutterDaemon } from "./flutter/flutter_daemon";
import { OpenFileTracker } from "./analysis/open_file_tracker";
import { upgradeProject } from "./project_upgrade";
import { AssistCodeActionProvider } from "./providers/assist_code_action_provider";
import { DartCompletionItemProvider } from "./providers/dart_completion_item_provider";
import { DartDiagnosticProvider } from "./providers/dart_diagnostic_provider";
import { DartFormattingEditProvider } from "./providers/dart_formatting_edit_provider";
import { DartDocumentHighlightProvider } from "./providers/dart_highlighting_provider";
import { DartHoverProvider } from "./providers/dart_hover_provider";
import { DartLanguageConfiguration } from "./providers/dart_language_configuration";
import { DartReferenceProvider } from "./providers/dart_reference_provider";
import { DartRenameProvider } from "./providers/dart_rename_provider";
import { DartTypeFormattingEditProvider } from "./providers/dart_type_formatting_edit_provider";
import { DartSymbolProvider } from "./providers/dart_symbol_provider";
import { DebugConfigProvider } from "./providers/debug_config_provider";
import { FixCodeActionProvider } from "./providers/fix_code_action_provider";
import { LegacyDartDocumentSymbolProvider } from "./providers/legacy_dart_document_symbol_provider";
import { LegacyDartWorkspaceSymbolProvider } from "./providers/legacy_dart_workspace_symbol_provider";
import { SnippetCompletionItemProvider } from "./providers/snippet_completion_item_provider";
import { isPubGetProbablyRequired, promptToRunPubGet } from "./pub/pub";
import { showUserPrompts } from "./user_prompts";
import { DartPackagesProvider } from "./views/packages_view";
import { PromiseCompleter } from "./debug/utils";
import { StatusBarVersionTracker } from "./sdk/status_bar_version_tracker";
import { checkForProjectsInSubFolders } from "./project";
import { RefactorCodeActionProvider } from "./providers/refactor_code_action_provider";
import { RefactorCommands } from "./commands/refactor";
import { checkForSdkUpdates } from "./sdk/update_check";
import { setUpHotReloadOnSave } from "./flutter/hot_reload_save_handler";
import { findPackageRoots } from "./analysis/utils";
import { flutterPath, dartVMPath, analyzerSnapshotPath, handleMissingSdks, findSdks } from "./sdk/utils";
import { GoToSuperCommand } from "./commands/go_to_super";

const DART_MODE: vs.DocumentFilter[] = [{ language: "dart", scheme: "file" }];
const HTML_MODE: vs.DocumentFilter[] = [{ language: "html", scheme: "file" }];

const DART_PROJECT_LOADED = "dart-code:dartProjectLoaded";
const FLUTTER_PROJECT_LOADED = "dart-code:flutterProjectLoaded";
export const SERVICE_EXTENSION_CONTEXT_PREFIX = "dart-code:serviceExtension.";

let analyzer: Analyzer;
let flutterDaemon: FlutterDaemon;
let analysisRoots: string[] = [];
let analytics: Analytics;

let showTodos: boolean;
let showLintNames: boolean;
let analyzerSettings: string;

export function activate(context: vs.ExtensionContext, isRestart: boolean = false) {
	util.logTime("Code called activate");
	// Wire up a reload command that will re-initialise everything.
	context.subscriptions.push(vs.commands.registerCommand("_dart.reloadExtension", (_) => {
		deactivate(true);
		for (const sub of context.subscriptions) {
			try {
				sub.dispose();
			} catch (e) {
				console.error(e);
			}
		}
		activate(context, true);
	}));

	showTodos = config.showTodos;
	showLintNames = config.showLintNames;
	analyzerSettings = getAnalyzerSettings();

	const analysisCompleteCompleter = new PromiseCompleter<void>();
	const extensionStartTime = new Date();
	util.logTime();
	checkForProjectsInSubFolders();
	util.logTime("checkForProjectsInSubFolders");
	const sdks = findSdks();
	util.logTime("findSdks");
	analytics = new Analytics(sdks);
	if (!sdks.dart || (sdks.projectType === util.ProjectType.Flutter && !sdks.flutter)) {
		// Don't set anything else up; we can't work like this!
		return handleMissingSdks(context, analytics, sdks);
	}

	// Show the SDK version in the status bar.
	const dartSdkVersion = util.getSdkVersion(sdks.dart);
	const flutterSdkVersion = util.getSdkVersion(sdks.flutter);
	if (dartSdkVersion) {
		analytics.sdkVersion = dartSdkVersion;
		checkForSdkUpdates(sdks, dartSdkVersion);
		context.subscriptions.push(new StatusBarVersionTracker(sdks.projectType, dartSdkVersion, flutterSdkVersion));
	}

	// Fire up the analyzer process.
	const analyzerStartTime = new Date();
	const analyzerPath = config.analyzerPath || path.join(sdks.dart, analyzerSnapshotPath);
	if (!fs.existsSync(analyzerPath)) {
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

	// Log analysis server first analysis completion time when it completes.
	let analysisStartTime: Date;
	const analysisCompleteEvents = analyzer.registerForServerStatus((ss) => {
		// Analysis started for the first time.
		if (ss.analysis && ss.analysis.isAnalyzing && !analysisStartTime)
			analysisStartTime = new Date();

		// Analysis ends for the first time.
		if (ss.analysis && !ss.analysis.isAnalyzing && analysisStartTime) {
			const analysisEndTime = new Date();
			analysisCompleteCompleter.resolve();
			analytics.logAnalyzerFirstAnalysisTime(analysisEndTime.getTime() - analysisStartTime.getTime());
			analysisCompleteEvents.dispose();
		}
	});

	// Set up providers.
	const hoverProvider = new DartHoverProvider(analyzer);
	const formattingEditProvider = new DartFormattingEditProvider(analyzer);
	const typeFormattingEditProvider = new DartTypeFormattingEditProvider(analyzer);
	const completionItemProvider = new DartCompletionItemProvider(analyzer);
	const referenceProvider = new DartReferenceProvider(analyzer);
	const documentHighlightProvider = new DartDocumentHighlightProvider(analyzer);
	const assistCodeActionProvider = new AssistCodeActionProvider(analyzer);
	const fixCodeActionProvider = new FixCodeActionProvider(analyzer);
	const refactorCodeActionProvider = new RefactorCodeActionProvider(analyzer);
	const renameProvider = new DartRenameProvider(analyzer);

	const activeFileFilters = [DART_MODE];
	if (config.analyzeAngularTemplates && analyzer.capabilities.supportsAnalyzingHtmlFiles) {
		// Analyze Angular2 templates, requires the angular_analyzer_plugin.
		activeFileFilters.push(HTML_MODE);
	}

	const triggerCharacters = ".: =(${'\"".split("");
	activeFileFilters.forEach((filter) => {
		context.subscriptions.push(vs.languages.registerHoverProvider(filter, hoverProvider));
		context.subscriptions.push(vs.languages.registerDocumentFormattingEditProvider(filter, formattingEditProvider));
		context.subscriptions.push(vs.languages.registerCompletionItemProvider(filter, completionItemProvider, ...triggerCharacters));
		context.subscriptions.push(vs.languages.registerDefinitionProvider(filter, referenceProvider));
		context.subscriptions.push(vs.languages.registerReferenceProvider(filter, referenceProvider));
		context.subscriptions.push(vs.languages.registerDocumentHighlightProvider(filter, documentHighlightProvider));
		context.subscriptions.push(vs.languages.registerCodeActionsProvider(filter, assistCodeActionProvider));
		context.subscriptions.push(vs.languages.registerCodeActionsProvider(filter, fixCodeActionProvider));
		context.subscriptions.push(vs.languages.registerCodeActionsProvider(filter, refactorCodeActionProvider));
		context.subscriptions.push(vs.languages.registerRenameProvider(filter, renameProvider));
	});

	// Even with the angular_analyzer_plugin, the analysis server only supports
	// formatting for dart files.
	context.subscriptions.push(vs.languages.registerOnTypeFormattingEditProvider(DART_MODE, typeFormattingEditProvider, "}", ";"));

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
	if (vs.workspace.workspaceFolders)
		recalculateAnalysisRoots();

	// Hook editor changes to send updated contents to analyzer.
	context.subscriptions.push(new FileChangeHandler(analyzer));

	// Fire up Flutter daemon if required.
	if (sdks.projectType === util.ProjectType.Flutter) {
		flutterDaemon = new FlutterDaemon(path.join(sdks.flutter, flutterPath), sdks.flutter);
		context.subscriptions.push(flutterDaemon);
		setUpHotReloadOnSave(context, diagnostics);
	}

	util.logTime("All other stuff before debugger..");

	// Set up debug stuff.
	const debugProvider = new DebugConfigProvider(sdks, analytics, flutterDaemon && flutterDaemon.deviceManager);
	context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", debugProvider));
	context.subscriptions.push(debugProvider);

	// Setup that requires server version/capabilities.
	const connectedSetup = analyzer.registerForServerConnected((sc) => {
		connectedSetup.dispose();

		if (analyzer.capabilities.supportsClosingLabels && config.closingLabels) {
			context.subscriptions.push(new ClosingLabelsDecorations(analyzer));
		}

		if (analyzer.capabilities.supportsGetDeclerations) {
			context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new DartSymbolProvider(analyzer)));
		} else {
			context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new LegacyDartWorkspaceSymbolProvider(analyzer)));
		}

		const documentSymbolProvider = analyzer.capabilities.supportsGetDeclerationsForFile
			? new DartSymbolProvider(analyzer)
			: new LegacyDartDocumentSymbolProvider(analyzer);
		activeFileFilters.forEach((filter) => {
			context.subscriptions.push(vs.languages.registerDocumentSymbolProvider(filter, documentSymbolProvider));
		});

		context.subscriptions.push(new OpenFileTracker(analyzer));
	});

	// Handle config changes so we can reanalyze if necessary.
	context.subscriptions.push(vs.workspace.onDidChangeConfiguration(() => handleConfigurationChange(sdks)));
	context.subscriptions.push(vs.workspace.onDidSaveTextDocument((td) => {
		if (path.basename(td.fileName).toLowerCase() === "pubspec.yaml")
			handleConfigurationChange(sdks);
	}));

	// Handle project changes that might affect SDKs.
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => {
		handleConfigurationChange(sdks);
	}));

	// Register SDK commands.
	const sdkCommands = new SdkCommands(context, sdks, analytics);
	const debugCommands = new DebugCommands(context, analytics);

	// Set up commands for Dart editors.
	context.subscriptions.push(new EditCommands(context, analyzer));
	context.subscriptions.push(new RefactorCommands(context, analyzer));

	// Register misc commands.
	context.subscriptions.push(new TypeHierarchyCommand(analyzer));
	context.subscriptions.push(new GoToSuperCommand(analyzer));

	// Register our view providers.
	const dartPackagesProvider = new DartPackagesProvider();
	dartPackagesProvider.setWorkspaces(util.getDartWorkspaceFolders());
	context.subscriptions.push(dartPackagesProvider);
	vs.window.registerTreeDataProvider("dartPackages", dartPackagesProvider);
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => {
		dartPackagesProvider.setWorkspaces(util.getDartWorkspaceFolders());
	}));

	context.subscriptions.push(vs.commands.registerCommand("dart.package.openFile", (filePath) => {
		if (!filePath) return;

		vs.workspace.openTextDocument(filePath).then((document) => {
			vs.window.showTextDocument(document, { preview: true });
		}, (error) => util.logError);
	}));

	// Perform any required project upgrades.
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => upgradeProject(f.added.filter(util.isDartWorkspaceFolder))));
	upgradeProject(util.getDartWorkspaceFolders());

	// Prompt user for any special config we might want to set.
	showUserPrompts(context);

	// Turn on all the commands.
	setCommandVisiblity(true, sdks.projectType);

	// Prompt for pub get if required
	function checkForPackages() {
		const folders = util.getDartWorkspaceFolders();
		const foldersRequiringPackageGet = folders.filter((ws: WorkspaceFolder) => config.for(ws.uri).promptToGetPackages).filter(isPubGetProbablyRequired);
		if (foldersRequiringPackageGet.length > 0)
			promptToRunPubGet(foldersRequiringPackageGet);
	}
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => checkForPackages()));
	checkForPackages();

	// Log how long all this startup took.
	const extensionEndTime = new Date();
	if (isRestart) {
		analytics.logExtensionRestart(extensionEndTime.getTime() - extensionStartTime.getTime());
	} else {
		analytics.logExtensionStartup(extensionEndTime.getTime() - extensionStartTime.getTime());
	}

	return {
		analysisComplete: analysisCompleteCompleter.promise,
		analyzerCapabilities: analyzer.capabilities,
		debugProvider, // TODO: Remove this when we can get access via testing...
		sdks,
	};
}

function recalculateAnalysisRoots() {
	let newRoots: string[] = [];
	util.getDartWorkspaceFolders().forEach((f) => {
		newRoots = newRoots.concat(findPackageRoots(f.uri.fsPath));
	});
	analysisRoots = newRoots;

	analyzer.analysisSetAnalysisRoots({
		excluded: [],
		included: analysisRoots,
	});
}

function handleConfigurationChange(sdks: util.Sdks) {
	// TODOs
	const newShowTodoSetting = config.showTodos;
	const todoSettingChanged = showTodos !== newShowTodoSetting;
	showTodos = newShowTodoSetting;

	// Lint names.
	const newShowLintNameSetting = config.showLintNames;
	const showLintNameSettingChanged = showLintNames !== newShowLintNameSetting;
	showLintNames = newShowLintNameSetting;

	// SDK
	const newAnalyzerSettings = getAnalyzerSettings();
	const analyzerSettingsChanged = analyzerSettings !== newAnalyzerSettings;
	analyzerSettings = newAnalyzerSettings;

	if (todoSettingChanged || showLintNameSettingChanged) {
		analyzer.analysisReanalyze({
			roots: analysisRoots,
		});
	}

	if (analyzerSettingsChanged) {
		util.reloadExtension();
	}
}

function getAnalyzerSettings() {
	// The return value here is used to detect when any config option changes that requires a project reload.
	// It doesn't matter how these are combined; it just gets called on every config change and compared.
	// Usually these are options that affect the analyzer and need a reload, but config options used at
	// activation time will also need to be included.
	return "CONF-"
		+ config.sdkPath
		+ config.sdkPaths
		+ config.analyzerLogFile
		+ config.analyzerPath
		+ config.analyzerDiagnosticsPort
		+ config.analyzerObservatoryPort
		+ config.analyzerInstrumentationLogFile
		+ config.analyzerAdditionalArgs
		+ config.flutterSdkPath
		+ config.flutterSdkPaths
		+ config.flutterDaemonLogFile
		+ config.closingLabels
		+ config.analyzeAngularTemplates
		+ config.previewDart2;
}

export function deactivate(isRestart: boolean = false): PromiseLike<void> {
	setCommandVisiblity(false, null);
	if (!isRestart) {
		return analytics.logExtensionShutdown();
	}
}

function setCommandVisiblity(enable: boolean, projectType: util.ProjectType) {
	vs.commands.executeCommand("setContext", DART_PROJECT_LOADED, enable);
	vs.commands.executeCommand("setContext", FLUTTER_PROJECT_LOADED, enable && projectType === util.ProjectType.Flutter);
}
