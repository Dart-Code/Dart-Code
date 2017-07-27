"use strict";

import * as fs from "fs";
import * as path from "path";
import * as util from "./utils";
import * as vs from "vscode";
import { analytics } from "./analytics";
import { Analyzer } from "./analysis/analyzer";
import { AnalyzerStatusReporter } from "./analyzer_status_reporter";
import { config } from "./config";
import { EditCommands } from "./commands/edit";
import { DartCompletionItemProvider } from "./providers/dart_completion_item_provider";
import { DartCodeActionProvider } from "./providers/dart_code_action_provider";
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
import { TypeHierarchyCommand } from "./commands/type_hierarchy";
import { ServerStatusNotification } from "./analysis/analysis_server_types";
import { DartPackagesProvider } from "./views/packages_view";
import { upgradeProject } from "./project_upgrade";
import { promptUserForConfigs } from "./user_config_prompts";
import { FlutterWidgetConstructorDecoratorProvider } from "./providers/flutter_widget_constructor_decoration";
import { DartPackageFileContentProvider } from "./providers/dart_package_file_content_provider";

const DART_MODE: vs.DocumentFilter = { language: "dart", scheme: "file" };
const DART_DOWNLOAD_URL = "https://www.dartlang.org/install";
const FLUTTER_DOWNLOAD_URL = "https://flutter.io/setup/";

const DART_PROJECT_LOADED = "dart-code:dartProjectLoaded";
const FLUTTER_PROJECT_LOADED = "dart-code:flutterProjectLoaded";

export let sdks: util.Sdks;
export let analyzer: Analyzer;
export let flutterDaemon: FlutterDaemon;

let showTodos: boolean = config.showTodos, showLintNames: boolean = config.showLintNames;
let analyzerSettings: string = getAnalyzerSettings();

export function activate(context: vs.ExtensionContext) {
	let extensionStartTime = new Date();
	sdks = util.findSdks();
	if (sdks.dart == null) {
		if (util.isFlutterProject) {
			vs.window.showErrorMessage("Could not find a Flutter SDK to use. " +
				"Please add it to your PATH or set FLUTTER_HOME and reload.",
				"Go to Flutter Downloads"
			).then(selectedItem => {
				if (selectedItem)
					util.openInBrowser(FLUTTER_DOWNLOAD_URL);
			});
		}
		else {
			vs.window.showErrorMessage("Could not find a Dart SDK to use. " +
				"Please add it to your PATH or configure the 'dart.sdkPath' setting and reload.",
				"Go to Dart Downloads"
			).then(selectedItem => {
				if (selectedItem)
					util.openInBrowser(DART_DOWNLOAD_URL);
			});
		}
		analytics.logSdkDetectionFailure();
		return; // Don't set anything else up; we can't work like this!
	}

	// Show the SDK version in the status bar.
	let sdkVersion = util.getDartSdkVersion(sdks.dart);
	if (sdkVersion) {
		let versionStatusItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, 1);
		const suffix = util.isFuchsiaProject ? " (Fuchsia)" : util.isFlutterProject ? " (Flutter)" : "";
		versionStatusItem.text = sdkVersion + suffix;
		versionStatusItem.tooltip = "Dart SDK Version" + suffix;
		versionStatusItem.show();
		context.subscriptions.push(versionStatusItem);

		// If we're set up for multiple versions, set up the command.
		if (!util.isFlutterProject && !util.isFuchsiaProject && config.sdkContainer && fs.existsSync(config.sdkContainer))
			versionStatusItem.command = "dart.changeSdk";

		// Do update-check.
		if (config.checkForSdkUpdates && !util.isFlutterProject) {
			util.getLatestSdkVersion().then(version => {
				if (util.isOutOfDate(sdkVersion, version))
					vs.window.showWarningMessage(
						`Version ${version} of the Dart SDK is available (you have ${sdkVersion}). Some features of Dart Code may not work correctly with an old SDK.`,
						"Go to Dart Downloads"
					).then(selectedItem => {
						if (selectedItem)
							util.openInBrowser(DART_DOWNLOAD_URL);
					});
			}, util.logError);
		}

		analytics.sdkVersion = sdkVersion;
	}

	// Fire up the analyzer process.
	let analyzerStartTime = new Date();
	const analyzerPath = config.analyzerPath || path.join(sdks.dart, util.analyzerPath);
	analyzer = new Analyzer(path.join(sdks.dart, util.dartVMPath), analyzerPath);
	context.subscriptions.push(analyzer);

	// Log analysis server startup time when we get the welcome message/version.
	let connectedEvents = analyzer.registerForServerConnected(sc => {
		analytics.analysisServerVersion = sc.version;
		let analyzerEndTime = new Date();
		analytics.logAnalyzerStartupTime(analyzerEndTime.getTime() - analyzerStartTime.getTime());
		connectedEvents.dispose();
	});

	// Log analysis server first analysis completion time when it completes.
	var analysisStartTime: Date;
	let analysisCompleteEvents = analyzer.registerForServerStatus(ss => {
		// Analysis started for the first time.
		if (ss.analysis && ss.analysis.isAnalyzing && !analysisStartTime)
			analysisStartTime = new Date();

		// Analysis ends for the first time.
		if (ss.analysis && !ss.analysis.isAnalyzing && analysisStartTime) {
			let analysisEndTime = new Date();
			analytics.logAnalyzerFirstAnalysisTime(analysisEndTime.getTime() - analysisStartTime.getTime());
			analysisCompleteEvents.dispose();
		}
	});

	// TODO: Check if EventEmitter<T> would be more appropriate than our own.

	// Set up providers.
	context.subscriptions.push(vs.languages.registerHoverProvider(DART_MODE, new DartHoverProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerDocumentFormattingEditProvider(DART_MODE, new DartFormattingEditProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerOnTypeFormattingEditProvider(DART_MODE, new DartTypeFormattingEditProvider(analyzer), "}", ";"));
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new DartCompletionItemProvider(analyzer), ".", ":", " ", "=", "("));
	context.subscriptions.push(vs.languages.registerDefinitionProvider(DART_MODE, new DartDefinitionProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerDocumentSymbolProvider(DART_MODE, new DartDocumentSymbolProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerReferenceProvider(DART_MODE, new DartReferenceProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new DartWorkspaceSymbolProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerDocumentHighlightProvider(DART_MODE, new DartDocumentHighlightProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerCodeActionsProvider(DART_MODE, new DartCodeActionProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerRenameProvider(DART_MODE, new DartRenameProvider(analyzer)));
	context.subscriptions.push(vs.languages.setLanguageConfiguration(DART_MODE.language, new DartLanguageConfiguration()));
	context.subscriptions.push(vs.workspace.registerTextDocumentContentProvider("dart-package", new DartPackageFileContentProvider()));
	context.subscriptions.push(new AnalyzerStatusReporter(analyzer));

	// Set up diagnostics.
	let diagnostics = vs.languages.createDiagnosticCollection("dart");
	context.subscriptions.push(diagnostics);
	let diagnosticsProvider = new DartDiagnosticProvider(analyzer, diagnostics);

	// Set the root...
	if (vs.workspace.rootPath) {
		let packageRoots = findPackageRoots(vs.workspace.rootPath);
		analyzer.analysisSetAnalysisRoots({
			included: packageRoots,
			excluded: []
		});
	}

	// Hook editor changes to send updated contents to analyzer.
	let fileChangeHandler = new FileChangeHandler(analyzer);
	context.subscriptions.push(vs.workspace.onDidOpenTextDocument(td => fileChangeHandler.onDidOpenTextDocument(td)));
	context.subscriptions.push(vs.workspace.onDidChangeTextDocument(e => fileChangeHandler.onDidChangeTextDocument(e)));
	context.subscriptions.push(vs.workspace.onDidCloseTextDocument(td => fileChangeHandler.onDidCloseTextDocument(td)));
	vs.workspace.textDocuments.forEach(td => fileChangeHandler.onDidOpenTextDocument(td)); // Handle already-open files.

	// Fire up Flutter daemon if required.	
	if (util.isFlutterProject) {
		// TODO: finish wiring this up so we can manage the selected device from the status bar (eventualy - use first for now)
		flutterDaemon = new FlutterDaemon(path.join(sdks.flutter, util.flutterPath), vs.workspace.rootPath);
		context.subscriptions.push(flutterDaemon);

		context.subscriptions.push(vs.workspace.onDidSaveTextDocument(td => {
			// Don't do if setting is not enabled.
			if (!config.flutterHotReloadOnSave)
				return;

			// Don't do if we have errors for the saved file.
			let hasErrors = diagnostics.get(td.uri).find(d => d.severity == vs.DiagnosticSeverity.Error) != null;
			if (hasErrors)
				return;

			vs.commands.executeCommand('workbench.customDebugRequest', "hotReload");
		}));
	}

	// Enable editor decorations.
	if ((util.isFlutterProject || util.isFuchsiaProject) && config.previewFlutterCloseTagDecorations) {
		vs.window.showInformationMessage("Flutter \"closing tag\" decorations prototype is enabled - please give feedback!",
			"Give Feedback"
		).then(selectedItem => {
			if (selectedItem)
				util.openInBrowser("https://github.com/Dart-Code/Dart-Code/issues/383");
		});
		context.subscriptions.push(new FlutterWidgetConstructorDecoratorProvider(analyzer));
	}

	// Hook open/active file changes so we can set priority files with the analyzer.
	let openFileTracker = new OpenFileTracker(analyzer);
	context.subscriptions.push(vs.workspace.onDidOpenTextDocument(td => openFileTracker.updatePriorityFiles()));
	context.subscriptions.push(vs.workspace.onDidCloseTextDocument(td => openFileTracker.updatePriorityFiles()));
	context.subscriptions.push(vs.window.onDidChangeActiveTextEditor(e => openFileTracker.updatePriorityFiles()));
	openFileTracker.updatePriorityFiles(); // Handle already-open files.

	// Handle config changes so we can reanalyze if necessary.
	context.subscriptions.push(vs.workspace.onDidChangeConfiguration(handleConfigurationChange));
	context.subscriptions.push(vs.workspace.onDidSaveTextDocument(td => {
		if (path.basename(td.fileName).toLowerCase() == "pubspec.yaml")
			handleConfigurationChange();
	}));

	// Register SDK commands.
	let sdkCommands = new SdkCommands(sdks, flutterDaemon && flutterDaemon.deviceManager);
	sdkCommands.registerCommands(context);

	// Set up commands for Dart editors.
	context.subscriptions.push(new EditCommands(context, analyzer));

	// Register misc commands.
	context.subscriptions.push(new TypeHierarchyCommand(context, analyzer));

	// Register our view providers.
	const dartPackagesProvider = new DartPackagesProvider(vs.workspace.rootPath);
	context.subscriptions.push(dartPackagesProvider);
	vs.window.registerTreeDataProvider('dartPackages', dartPackagesProvider);
	context.subscriptions.push(vs.commands.registerCommand('dart.package.openFile', filePath => {
		if (!filePath) return;

		vs.workspace.openTextDocument(filePath).then(document => {
			vs.window.showTextDocument(document, { preview: true });
		}, error => { });
	}));

	// Perform any required project upgrades.
	upgradeProject();

	// Prompt user for any special config we might want to set.
	promptUserForConfigs(context);

	// Turn on all the commands.
	setCommandVisiblity(true);

	// Log how long all this startup took.
	let extensionEndTime = new Date();
	analytics.logExtensionStartup(extensionEndTime.getTime() - extensionStartTime.getTime());
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

	if (!isPackageRootWorkaroundRequired())
		return [vs.workspace.rootPath];

	console.log('Workspace root appears to need package root workaround...');

	function getChildren(parent: string, numLevels: number): string[] {
		let packageRoots: string[] = [];
		let dirs = fs.readdirSync(parent).filter(item => fs.statSync(path.join(parent, item)).isDirectory());
		dirs.forEach(folder => {
			let folderPath = path.join(parent, folder);
			// If this is a package, add it. Else, recurse (if we still have levels to go).
			if (fs.existsSync(path.join(folderPath, "pubspec.yaml"))) {
				packageRoots.push(folderPath);
			}
			else if (numLevels > 1)
				packageRoots = packageRoots.concat(getChildren(folderPath, numLevels - 1));
		});
		return packageRoots;
	}

	var roots = getChildren(root, 3);

	if (roots.length == 0 || fs.existsSync(path.join(root, "pubspec.yaml")))
		roots.push(root);

	return roots;
}

function isPackageRootWorkaroundRequired(): boolean {
	// It's hard to tell if the packages folder is actually a real one (--packages-dir) or
	// this is a repo like Flutter, so we'll use the presence of a file we know exists only
	// in the flutter one. This is very fragile, but hopefully a very temporary workaround.
	return fs.existsSync(path.join(vs.workspace.rootPath, "packages", ".gitignore"));
}

function handleConfigurationChange() {
	// TODOs
	let newShowTodoSetting = config.showTodos;
	let todoSettingChanged = showTodos != newShowTodoSetting;
	showTodos = newShowTodoSetting;

	// Lint names.
	let newShowLintNameSetting = config.showLintNames;
	let showLintNameSettingChanged = showLintNames != newShowLintNameSetting;
	showLintNames = newShowLintNameSetting;

	// SDK
	let newAnalyzerSettings = getAnalyzerSettings();
	let analyzerSettingsChanged = analyzerSettings != newAnalyzerSettings;
	analyzerSettings = newAnalyzerSettings;

	// Flutter
	let newFlutterSetting = util.checkIsFlutterProject();
	let flutterSettingChanged = util.isFlutterProject != newFlutterSetting;

	// Fuchsia
	let newFuchsiaSetting = util.checkIsFuchsiaProject();
	let fuchsiaSettingChanged = util.isFuchsiaProject != newFuchsiaSetting;

	if (todoSettingChanged || showLintNameSettingChanged) {
		let packageRoots = findPackageRoots(vs.workspace.rootPath);
		if (todoSettingChanged)
			analytics.logShowTodosToggled(showTodos);
		else if (showLintNameSettingChanged)
			analytics.logLintNamesToggled(showLintNames);
		analyzer.analysisReanalyze({
			roots: packageRoots
		});
	}

	if (analyzerSettingsChanged) {
		const reloadAction: string = "Reload Project";
		vs.window.showWarningMessage("The Dart SDK/Analyzer settings have been changed. Save your changes then reload the project to restart the analyzer.", reloadAction).then(res => {
			if (res == reloadAction)
				vs.commands.executeCommand("workbench.action.reloadWindow");
		});
	}

	if (flutterSettingChanged) {
		const reloadAction: string = "Reload Project";
		const msg = newFlutterSetting
			? "Your project now uses Flutter. Save your changes then reload the project to load the Flutter SDK."
			: "Your project no longer uses Flutter. Save your changes then reload the project to switch back to the standard Dart SDK.";
		vs.window.showWarningMessage(msg, reloadAction).then(res => {
			if (res == reloadAction)
				vs.commands.executeCommand("workbench.action.reloadWindow");
		});
	}

	if (fuchsiaSettingChanged) {
		const reloadAction: string = "Reload Project";
		const msg = newFuchsiaSetting
			? "Your project now uses Fuchsia. Save your changes then reload the project to load the Fuchsia Dart SDK."
			: "Your project no longer uses Fuchsia. Save your changes then reload the project to switch back to the standard Dart SDK.";
		vs.window.showWarningMessage(msg, reloadAction).then(res => {
			if (res == reloadAction)
				vs.commands.executeCommand("workbench.action.reloadWindow");
		});
	}
}

function getAnalyzerSettings() {
	// The return value here is used to detect when any config option changes that requires a project reload.
	// It doesn't matter how these are combined; it just gets called on every config change and compared.
	// Only options that requier an analyzer restart should be included.
	return "CONF-"
		+ config.userDefinedSdkPath
		+ config.sdkContainer
		+ config.analyzerLogFile
		+ config.analyzerPath
		+ config.analyzerDiagnosticsPort
		+ config.analyzerObservatoryPort
		+ config.analyzerInstrumentationLogFile
		+ config.analyzerAdditionalArgs
		+ config.flutterDaemonLogFile
		+ config.previewFlutterCloseTagDecorations;
}

export function deactivate() {
	setCommandVisiblity(false);
}

function setCommandVisiblity(enable: boolean) {
	vs.commands.executeCommand('setContext', DART_PROJECT_LOADED, enable);
	vs.commands.executeCommand('setContext', FLUTTER_PROJECT_LOADED, enable && util.isFlutterProject);
}
