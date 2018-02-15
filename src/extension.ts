"use strict";

import * as fs from "fs";
import * as path from "path";
import * as util from "./utils";
import * as vs from "vscode";
import { Analytics } from "./analytics";
import { Analyzer } from "./analysis/analyzer";
import { AnalyzerStatusReporter } from "./analyzer_status_reporter";
import { config } from "./config";
import { EditCommands } from "./commands/edit";
import { DartCompletionItemProvider } from "./providers/dart_completion_item_provider";
import { DartDefinitionProvider } from "./providers/dart_definition_provider";
import { DartReferenceProvider } from "./providers/dart_reference_provider";
import { DartDiagnosticProvider } from "./providers/dart_diagnostic_provider";
import { DartFormattingEditProvider } from "./providers/dart_formatting_edit_provider";
import { DartTypeFormattingEditProvider } from "./providers/dart_type_formatting_edit_provider";
import { DartDocumentHighlightProvider } from "./providers/dart_highlighting_provider";
import { DartHoverProvider } from "./providers/dart_hover_provider";
import { DartLanguageConfiguration } from "./providers/dart_language_configuration";
import { DartDocumentSymbolProvider } from "./providers/dart_document_symbol_provider";
import { DartWorkspaceSymbolProvider } from "./providers/dart_workspace_symbol_provider";
import { DartRenameProvider } from "./providers/dart_rename_provider";
import { FileChangeHandler } from "./file_change_handler";
import { FlutterDaemon } from "./flutter/flutter_daemon";
import { OpenFileTracker } from "./open_file_tracker";
import { SdkCommands } from "./commands/sdk";
import { DebugCommands } from "./commands/debug";
import { TypeHierarchyCommand } from "./commands/type_hierarchy";
import { ServerStatusNotification } from "./analysis/analysis_server_types";
import { DartPackagesProvider } from "./views/packages_view";
import { upgradeProject } from "./project_upgrade";
import { promptUserForConfigs } from "./user_config_prompts";
import { DartPackageFileContentProvider } from "./providers/dart_package_file_content_provider";
import { ClosingLabelsDecorations } from "./decorations/closing_labels_decorations";
import { DebugConfigProvider } from "./providers/debug_config_provider";
import { isPubGetProbablyRequired, promptToRunPubGet } from "./pub/pub";
import { WorkspaceFolder } from "vscode";
import { SnippetCompletionItemProvider } from "./providers/snippet_completion_item_provider";
import { isFlutterProject } from "./utils";
import { FixCodeActionProvider } from "./providers/fix_code_action_provider";
import { AssistCodeActionProvider } from "./providers/assist_code_action_provider";
import { LegacyDebugConfigProvider } from "./providers/legacy_debug_config_provider";

const DART_MODE: vs.DocumentFilter[] = [{ language: "dart", scheme: "file" }, { language: "dart", scheme: "dart-package" }];
const HTML_MODE: vs.DocumentFilter[] = [{ language: "html", scheme: "file" }, { language: "html", scheme: "dart-package" }];

const DART_DOWNLOAD_URL = "https://www.dartlang.org/install";
const FLUTTER_DOWNLOAD_URL = "https://flutter.io/setup/";

const DART_PROJECT_LOADED = "dart-code:dartProjectLoaded";
const FLUTTER_PROJECT_LOADED = "dart-code:flutterProjectLoaded";

let analyzer: Analyzer;
let flutterDaemon: FlutterDaemon;
let analysisRoots: string[] = [];
let analytics: Analytics;

let showTodos: boolean = config.showTodos;
let showLintNames: boolean = config.showLintNames;
let analyzerSettings: string = getAnalyzerSettings();

export function activate(context: vs.ExtensionContext) {
	const extensionStartTime = new Date();
	const sdks = util.findSdks();
	analytics = new Analytics(sdks);
	if (sdks.dart == null) {
		if (sdks.projectType === util.ProjectType.Flutter) {
			vs.window.showErrorMessage("Could not find a Flutter SDK to use. " +
				"Please add it to your PATH, set FLUTTER_ROOT or configure the 'dart.flutterSdkPath' and reload.",
				"Go to Flutter Downloads",
			).then((selectedItem) => {
				if (selectedItem)
					util.openInBrowser(FLUTTER_DOWNLOAD_URL);
			});
		} else {
			vs.window.showErrorMessage("Could not find a Dart SDK to use. " +
				"Please add it to your PATH or configure the 'dart.sdkPath' setting and reload.",
				"Go to Dart Downloads",
			).then((selectedItem) => {
				if (selectedItem)
					util.openInBrowser(DART_DOWNLOAD_URL);
			});
		}
		analytics.logSdkDetectionFailure();
		return; // Don't set anything else up; we can't work like this!
	}

	// Show the SDK version in the status bar.
	const sdkVersion = util.getDartSdkVersion(sdks.dart);
	if (sdkVersion) {
		const versionStatusItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 1);
		versionStatusItem.text = sdkVersion.length > 20 ? sdkVersion.substr(0, 17) + "…" : sdkVersion;
		versionStatusItem.tooltip = "Dart SDK Version" + ` (${util.ProjectType[sdks.projectType]}) v` + sdkVersion;
		versionStatusItem.show();
		context.subscriptions.push(versionStatusItem);

		// If we're set up for multiple versions, set up the command.
		if (config.sdkPaths && config.sdkPaths.length > 0)
			versionStatusItem.command = "dart.changeSdk";

		// Do update-check.
		if (config.checkForSdkUpdates && sdks.projectType === util.ProjectType.Dart) {
			util.getLatestSdkVersion().then((version) => {
				if (!util.versionIsAtLeast(sdkVersion, version))
					vs.window.showWarningMessage(
						`Version ${version} of the Dart SDK is available (you have ${sdkVersion}). Some features of Dart Code may not work correctly with an old SDK.`,
						"Go to Dart Downloads",
					).then((selectedItem) => {
						if (selectedItem)
							util.openInBrowser(DART_DOWNLOAD_URL);
					});
			}, util.logError);
		}

		analytics.sdkVersion = sdkVersion;
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
			analytics.logAnalyzerFirstAnalysisTime(analysisEndTime.getTime() - analysisStartTime.getTime());
			analysisCompleteEvents.dispose();
		}
	});

	// TODO: Check if EventEmitter<T> would be more appropriate than our own.

	// Set up providers.
	const hoverProvider = new DartHoverProvider(analyzer);
	const formattingEditProvider = new DartFormattingEditProvider(analyzer);
	const typeFormattingEditProvider = new DartTypeFormattingEditProvider(analyzer);
	const completionItemProvider = new DartCompletionItemProvider(analyzer);
	const definitionProvider = new DartDefinitionProvider(analyzer);
	const documentSymbolProvider = new DartDocumentSymbolProvider(analyzer);
	const referenceProvider = new DartReferenceProvider(analyzer);
	const documentHighlightProvider = new DartDocumentHighlightProvider(analyzer);
	const assistCodeActionProvider = new AssistCodeActionProvider(analyzer);
	const fixCodeActionProvider = new FixCodeActionProvider(analyzer);
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
		context.subscriptions.push(vs.languages.registerDefinitionProvider(filter, definitionProvider));
		context.subscriptions.push(vs.languages.registerDocumentSymbolProvider(filter, documentSymbolProvider));
		context.subscriptions.push(vs.languages.registerReferenceProvider(filter, referenceProvider));
		context.subscriptions.push(vs.languages.registerDocumentHighlightProvider(filter, documentHighlightProvider));
		context.subscriptions.push(vs.languages.registerCodeActionsProvider(filter, assistCodeActionProvider));
		context.subscriptions.push(vs.languages.registerCodeActionsProvider(filter, fixCodeActionProvider));
		context.subscriptions.push(vs.languages.registerRenameProvider(filter, renameProvider));
	});

	// Even with the angular_analyzer_plugin, the analysis server only supports
	// formatting for dart files.
	context.subscriptions.push(vs.languages.registerOnTypeFormattingEditProvider(DART_MODE, typeFormattingEditProvider, "}", ";"));

	// Snippets are language-specific
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider("snippets/dart.json", (_) => true)));
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new SnippetCompletionItemProvider("snippets/flutter.json", (uri) => isFlutterProject(vs.workspace.getWorkspaceFolder(uri)))));

	context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new DartWorkspaceSymbolProvider(analyzer)));
	context.subscriptions.push(vs.languages.setLanguageConfiguration(DART_MODE[0].language, new DartLanguageConfiguration()));
	context.subscriptions.push(vs.workspace.registerTextDocumentContentProvider("dart-package", new DartPackageFileContentProvider()));
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
		// TODO: finish wiring this up so we can manage the selected device from the status bar (eventualy - use first for now)
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

	// Set up debug stuff.
	// Remove all this when migrating to debugAdapterExecutable!
	context.subscriptions.push(vs.commands.registerCommand("dart.getDebuggerExecutable", (path: string) => {
		const entry = (path && isFlutterProject(vs.workspace.getWorkspaceFolder(vs.Uri.parse(path))))
			? context.asAbsolutePath("./out/src/debug/flutter_debug_entry.js")
			: context.asAbsolutePath("./out/src/debug/dart_debug_entry.js");

		return {
			args: [entry],
			command: "node",
		};
	}));
	const debugProvider = new DebugConfigProvider(sdks, analytics, flutterDaemon && flutterDaemon.deviceManager);
	const dummyDebugProvider = new LegacyDebugConfigProvider(debugProvider);
	context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart", debugProvider));
	context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("flutter", dummyDebugProvider));
	context.subscriptions.push(vs.debug.registerDebugConfigurationProvider("dart-cli", dummyDebugProvider));

	// Setup that requires server version/capabilities.
	const connectedSetup = analyzer.registerForServerConnected((sc) => {
		connectedSetup.dispose();

		if (analyzer.capabilities.supportsClosingLabels && config.closingLabels) {
			context.subscriptions.push(new ClosingLabelsDecorations(analyzer));
		}

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
	promptUserForConfigs(context);

	// Turn on all the commands.
	setCommandVisiblity(true, sdks.projectType);

	// Prompt for pub get if required
	function checkForPackages() {
		const folders = util.getDartWorkspaceFolders();
		const foldersRequiringPackageFetch = folders.filter((ws: WorkspaceFolder) => config.for(ws.uri).promptToFetchPackages).filter(isPubGetProbablyRequired);
		if (foldersRequiringPackageFetch.length > 0)
			promptToRunPubGet(foldersRequiringPackageFetch);
	}
	context.subscriptions.push(vs.workspace.onDidChangeWorkspaceFolders((f) => checkForPackages()));
	checkForPackages();

	// Log how long all this startup took.
	const extensionEndTime = new Date();
	analytics.logExtensionStartup(extensionEndTime.getTime() - extensionStartTime.getTime());
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

	// Project Type
	const projectTypeChanged = sdks.projectType !== util.findSdks().projectType;

	if (todoSettingChanged || showLintNameSettingChanged) {
		analyzer.analysisReanalyze({
			roots: analysisRoots,
		});
	}

	if (analyzerSettingsChanged || projectTypeChanged) {
		const reloadAction: string = "Reload Project";
		vs.window.showWarningMessage("The Dart SDK settings have been changed. Save your changes then reload the project to restart the analyzer.", reloadAction).then((res) => {
			if (res === reloadAction)
				vs.commands.executeCommand("workbench.action.reloadWindow");
		});
	}
}

function getAnalyzerSettings() {
	// The return value here is used to detect when any config option changes that requires a project reload.
	// It doesn't matter how these are combined; it just gets called on every config change and compared.
	// Usually these are options that affect the analyzer and need a reload, but config options used at
	// activation time will also need to be included.
	return "CONF-"
		+ config.userDefinedSdkPath
		+ config.sdkPaths
		+ config.analyzerLogFile
		+ config.analyzerPath
		+ config.analyzerDiagnosticsPort
		+ config.analyzerObservatoryPort
		+ config.analyzerInstrumentationLogFile
		+ config.analyzerAdditionalArgs
		+ config.flutterSdkPath
		+ config.flutterDaemonLogFile
		+ config.closingLabels
		+ config.previewAnalyzeAngularTemplates
		+ config.previewDart2;
}

export function deactivate(): PromiseLike<void> {
	setCommandVisiblity(false, null);
	return analytics.logExtensionShutdown();
}

function setCommandVisiblity(enable: boolean, projectType: util.ProjectType) {
	vs.commands.executeCommand("setContext", DART_PROJECT_LOADED, enable);
	vs.commands.executeCommand("setContext", FLUTTER_PROJECT_LOADED, enable && projectType === util.ProjectType.Flutter);
}
