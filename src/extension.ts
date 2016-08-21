"use strict";

import * as path from "path";
import * as util from "./utils";
import * as vs from "vscode";
import { analytics } from "./analytics";
import { Analyzer } from "./analysis/analyzer";
import { AnalyzerStatusReporter } from "./analyzer_status_reporter";
import { config } from "./config";
import { DartCommands } from "./providers/dart_commands";
import { DartCompletionItemProvider } from "./providers/dart_completion_item_provider";
import { DartDefinitionProvider } from "./providers/dart_definition_provider";
import { DartReferenceProvider } from "./providers/dart_reference_provider";
import { DartDiagnosticProvider } from "./providers/dart_diagnostic_provider";
import { DartFormattingEditProvider } from "./providers/dart_formatting_edit_provider";
import { DartDocumentHighlightProvider } from "./providers/dart_highlighting_provider";
import { DartHoverProvider } from "./providers/dart_hover_provider";
import { DartIndentFixer } from "./dart_indent_fixer";
import { DartDocumentSymbolProvider } from "./providers/dart_document_symbol_provider";
import { DartWorkspaceSymbolProvider } from "./providers/dart_workspace_symbol_provider";
import { FileChangeHandler } from "./file_change_handler";
import { OpenFileTracker } from "./open_file_tracker";
import { SdkCommands } from "./commands/sdk";
import { ServerStatusNotification } from "./analysis/analysis_server_types";
import * as debug from "./debug/sdk_path"

const DART_MODE: vs.DocumentFilter = { language: "dart", scheme: "file" };
const stateLastKnownSdkPathName = "dart.lastKnownSdkPath";

let dartSdkRoot: string;
let analyzer: Analyzer;

let showTodos: boolean = config.showTodos;

export function activate(context: vs.ExtensionContext) {
	dartSdkRoot = util.findDartSdk(<string>context.globalState.get(stateLastKnownSdkPathName));
	if (dartSdkRoot == null) {
		vs.window.showErrorMessage("Could not find a Dart SDK to use. " +
			"Please add it to your PATH or configure the 'dart.sdkPath' setting and reload.");
		return; // Don't set anything else up; we can't work like this!
	}
	context.globalState.update(stateLastKnownSdkPathName, dartSdkRoot);
	debug.writeSdkPath(dartSdkRoot); // Write the SDK path for the debugger to find.

	// Show the SDK version in the status bar.
	let sdkVersion = util.getDartSdkVersion(dartSdkRoot);
	if (sdkVersion) {
		let versionStatusItem = vs.window.createStatusBarItem(vs.StatusBarAlignment.Right, Number.MIN_VALUE);
		versionStatusItem.text = sdkVersion;
		versionStatusItem.tooltip = "Dart SDK Version";
		versionStatusItem.show();
		context.subscriptions.push(versionStatusItem);
	}

	// Fire up the analyzer process.
	analyzer = new Analyzer(path.join(dartSdkRoot, util.dartVMPath), path.join(dartSdkRoot, util.analyzerPath));
	context.subscriptions.push(analyzer);

	// Send an activation event once we get the analysis server version back.
	analytics.sdkVersion = sdkVersion;
	let connectedEvents = analyzer.registerForServerConnected(sc => {
		analytics.analysisServerVersion = sc.version;
		analytics.logActivation();
	});

	// TODO: Check if EventEmitter<T> would be more appropriate than our own.

	// Set up providers.
	context.subscriptions.push(vs.languages.registerHoverProvider(DART_MODE, new DartHoverProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerDocumentFormattingEditProvider(DART_MODE, new DartFormattingEditProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerCompletionItemProvider(DART_MODE, new DartCompletionItemProvider(analyzer), "."));
	context.subscriptions.push(vs.languages.registerDefinitionProvider(DART_MODE, new DartDefinitionProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerDocumentSymbolProvider(DART_MODE, new DartDocumentSymbolProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerReferenceProvider(DART_MODE, new DartReferenceProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerWorkspaceSymbolProvider(new DartWorkspaceSymbolProvider(analyzer)));
	context.subscriptions.push(vs.languages.registerDocumentHighlightProvider(DART_MODE, new DartDocumentHighlightProvider(analyzer)));
	context.subscriptions.push(new AnalyzerStatusReporter(analyzer));

	// Set up diagnostics.
	let diagnostics = vs.languages.createDiagnosticCollection("dart");
	context.subscriptions.push(diagnostics);
	let diagnosticsProvider = new DartDiagnosticProvider(analyzer, diagnostics);

	// Set the root...
	if (vs.workspace.rootPath) {
		analyzer.analysisSetAnalysisRoots({
			included: [vs.workspace.rootPath],
			excluded: [],
			packageRoots: null
		});
	}

	// Hook editor changes to send updated contents to analyzer.
	let fileChangeHandler = new FileChangeHandler(analyzer);
	context.subscriptions.push(vs.workspace.onDidOpenTextDocument(td => fileChangeHandler.onDidOpenTextDocument(td)));
	context.subscriptions.push(vs.workspace.onDidChangeTextDocument(e => fileChangeHandler.onDidChangeTextDocument(e)));
	context.subscriptions.push(vs.workspace.onDidCloseTextDocument(td => fileChangeHandler.onDidCloseTextDocument(td)));
	vs.workspace.textDocuments.forEach(td => fileChangeHandler.onDidOpenTextDocument(td)); // Handle already-open files.

	// Hook open/active file changes so we can set priority files with the analyzer.
	let openFileTracker = new OpenFileTracker(analyzer);
	context.subscriptions.push(vs.workspace.onDidOpenTextDocument(td => openFileTracker.updatePriorityFiles()));
	context.subscriptions.push(vs.workspace.onDidCloseTextDocument(td => openFileTracker.updatePriorityFiles()));
	context.subscriptions.push(vs.window.onDidChangeActiveTextEditor(e => openFileTracker.updatePriorityFiles()));
	openFileTracker.updatePriorityFiles(); // Handle already-open files.

	// Hook active editor change to reset Dart indenting.
	let dartIndentFixer = new DartIndentFixer();
	context.subscriptions.push(vs.window.onDidChangeActiveTextEditor(td => dartIndentFixer.onDidChangeActiveTextEditor(td)));
	dartIndentFixer.onDidChangeActiveTextEditor(vs.window.activeTextEditor); // Handle already-open file.

	// Handle config changes so we can reanalyze if necessary.
	context.subscriptions.push(vs.workspace.onDidChangeConfiguration(handleConfigurationChange));

	// Register SDK commands.
	let sdkCommands = new SdkCommands(dartSdkRoot);
	sdkCommands.registerCommands(context);

	// Set up commands for Dart editors.
	context.subscriptions.push(new DartCommands(context, analyzer));
}

function handleConfigurationChange() {
	let newShowTodoSetting = config.showTodos;
	let todoSettingChanged = showTodos != newShowTodoSetting;
	showTodos = newShowTodoSetting;

	if (todoSettingChanged) {
		analytics.logShowTodosToggled(showTodos);
		analyzer.analysisReanalyze({
			roots: [vs.workspace.rootPath]
		});
	}
}

export function deactivate() {
}
