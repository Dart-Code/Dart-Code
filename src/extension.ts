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
	const sdks = util.findSdks();
	util.logTime("findSdks");
	analytics = new Analytics(sdks);
	if (!sdks.dart || (sdks.projectType === util.ProjectType.Flutter && !sdks.flutter)) {
		// HACK: In order to provide a more useful message if the user was trying to fun flutter.createProject
		// we need to hook the command and force the project type to Flutter to get the correct error message.
		// This can be reverted and improved if Code adds support for providing activation context:
		//     https://github.com/Microsoft/vscode/issues/44711
		let commandToReRun: string;
		context.subscriptions.push(vs.commands.registerCommand("flutter.createProject", (_) => {
			sdks.projectType = util.ProjectType.Flutter;
			commandToReRun = "flutter.createProject";
		}));
		context.subscriptions.push(vs.commands.registerCommand("flutter.doctor", (_) => {
			sdks.projectType = util.ProjectType.Flutter;
			commandToReRun = "flutter.doctor";
		}));
		// Wait a while before showing the error to allow the code above to have run.
		setTimeout(() => {
			if (sdks.projectType === util.ProjectType.Flutter) {
				if (sdks.flutter && !sdks.dart) {
					util.showFluttersDartSdkActivationFailure();
				} else {
					util.showFlutterActivationFailure(commandToReRun);
				}
			} else {
				util.showDartActivationFailure();
			}
			analytics.logSdkDetectionFailure();
		}, 250);
		return; // Don't set anything else up; we can't work like this!
	}

	// Show the SDK version in the status bar.
	const dartSdkVersion = util.getSdkVersion(sdks.dart);
	const flutterSdkVersion = util.getSdkVersion(sdks.flutter);
	if (dartSdkVersion) {
		const statusBarVersionTracker = new StatusBarVersionTracker(sdks.projectType, dartSdkVersion, flutterSdkVersion);
		context.subscriptions.push(statusBarVersionTracker);

		// Do update-check.
		if (config.checkForSdkUpdates && sdks.projectType === util.ProjectType.Dart) {
			util.getLatestSdkVersion().then((version) => {
				if (!util.versionIsAtLeast(dartSdkVersion, version))
					vs.window.showWarningMessage(
						`Version ${version} of the Dart SDK is available (you have ${dartSdkVersion}). Some features of Dart Code may not work correctly with an old SDK.`,
						"Go to Dart Downloads",
					).then((selectedItem) => {
						if (selectedItem)
							util.openInBrowser(util.DART_DOWNLOAD_URL);
					});
			}, util.logError);
		}

		analytics.sdkVersion = dartSdkVersion;
	}

	// Fire up the analyzer process.
	const analyzerStartTime = new Date();
	const analyzerPath = config.analyzerPath || path.join(sdks.dart, util.analyzerPath);
	if (!fs.existsSync(analyzerPath)) {
		vs.window.showErrorMessage("Could not find a Dart Analysis Server at " + analyzerPath);
		return;
	}

	analyzer = new Analyzer(path.join(sdks.dart, util.dartVMPath), analyzerPath);
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
	if (config.previewAnalyzeAngularTemplates) {
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

	// Set the root...
	// Handle project changes that might affect SDKs.
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => {
		recalculateAnalysisRoots();
	}));
	if (vs.workspace.workspaceFolders)
		recalculateAnalysisRoots();

	// Hook editor changes to send updated contents to analyzer.
	const fileChangeHandler = new FileChangeHandler(analyzer);
	context.subscriptions.push(vs.workspace.onDidOpenTextDocument((td) => fileChangeHandler.onDidOpenTextDocument(td)));
	context.subscriptions.push(vs.workspace.onDidChangeTextDocument((e) => fileChangeHandler.onDidChangeTextDocument(e)));
	context.subscriptions.push(vs.workspace.onDidCloseTextDocument((td) => fileChangeHandler.onDidCloseTextDocument(td)));
	vs.workspace.textDocuments.forEach((td) => fileChangeHandler.onDidOpenTextDocument(td)); // Handle already-open files.

	// Fire up Flutter daemon if required.
	if (sdks.projectType === util.ProjectType.Flutter) {
		flutterDaemon = new FlutterDaemon(path.join(sdks.flutter, util.flutterPath), sdks.flutter);
		context.subscriptions.push(flutterDaemon);

		let hotReloadDelayTimer: NodeJS.Timer;
		context.subscriptions.push(vs.workspace.onDidSaveTextDocument((td) => {
			// Don't do if setting is not enabled.
			if (!config.flutterHotReloadOnSave)
				return;

			// Don't do if we have errors for the saved file.
			const errors = diagnostics.get(td.uri);
			const hasErrors = errors && errors.find((d) => d.severity === vs.DiagnosticSeverity.Error) != null;
			if (hasErrors)
				return;

			// Debounce to avoid reloading multiple times during multi-file-save (Save All).
			// Hopefully we can improve in future: https://github.com/Microsoft/vscode/issues/42913
			if (hotReloadDelayTimer) {
				clearTimeout(hotReloadDelayTimer);
				hotReloadDelayTimer = null;
			}
			hotReloadDelayTimer = setTimeout(() => {
				hotReloadDelayTimer = null;
				vs.commands.executeCommand("flutter.hotReload");
			}, 200);
		}));
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

		// Hook open/active file changes so we can set priority files with the analyzer.
		const openFileTracker = new OpenFileTracker(analyzer);
		context.subscriptions.push(vs.workspace.onDidOpenTextDocument((td) => openFileTracker.updatePriorityFiles()));
		context.subscriptions.push(vs.workspace.onDidCloseTextDocument((td) => openFileTracker.updatePriorityFiles()));
		context.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => openFileTracker.updatePriorityFiles()));
		openFileTracker.updatePriorityFiles(); // Handle already-open files.
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
	context.subscriptions.push(new TypeHierarchyCommand(context, analyzer));

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

function findPackageRoots(root: string): string[] {
	// For repos with code inside a "packages" folder, the analyzer doesn't resolve package paths
	// correctly. Until this is fixed in the analyzer, detect this and perform a workaround.
	// This introduces other issues, so don't do it unless we know we need to (eg. flutter repo).
	//
	// See also:
	//   https://github.com/Dart-Code/Dart-Code/issues/275 - Original issue (flutter repo not resolving correctly)
	//   https://github.com/Dart-Code/Dart-Code/issues/280 - Issue introduced by the workaround
	//   https://github.com/dart-lang/sdk/issues/29414 - Analyzer issue (where the real fix will be)

	if (!isPackageRootWorkaroundRequired(root))
		return [root];

	console.log("Workspace root appears to need package root workaround...");

	const roots = getChildren(root, 3);

	if (roots.length === 0 || fs.existsSync(path.join(root, "pubspec.yaml")))
		roots.push(root);

	return roots;

	function getChildren(parent: string, numLevels: number): string[] {
		let packageRoots: string[] = [];
		const dirs = fs.readdirSync(parent).filter((item) => fs.statSync(path.join(parent, item)).isDirectory());
		dirs.forEach((folder) => {
			const folderPath = path.join(parent, folder);
			// If this is a package, add it. Else, recurse (if we still have levels to go).
			if (fs.existsSync(path.join(folderPath, "pubspec.yaml"))) {
				packageRoots.push(folderPath);
			} else if (numLevels > 1)
				packageRoots = packageRoots.concat(getChildren(folderPath, numLevels - 1));
		});
		return packageRoots;
	}
}

function isPackageRootWorkaroundRequired(root: string): boolean {
	// It's hard to tell if the packages folder is actually a real one (--packages-dir) or
	// this is a repo like Flutter, so we'll use the presence of a file we know exists only
	// in the flutter one. This is very fragile, but hopefully a very temporary workaround.
	return fs.existsSync(path.join(root, "packages", ".gitignore"))
		|| (
			// Since Flutter repro removed the .gitignore, also check if there are any non-symlinks.
			fs.existsSync(path.join(root, "packages"))
			&& !!fs.readdirSync(path.join(root, "packages"))
				.find((d) => path.join(root, "packages", d) === fs.realpathSync(path.join(root, "packages", d)))
		);
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
		+ config.previewAnalyzeAngularTemplates
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
