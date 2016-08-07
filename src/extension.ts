"use strict";

import * as path from "path";
import * as util from "./utils";
import * as vscode from "vscode";
import { analytics } from "./analytics";
import { Analyzer } from "./analyzer";
import { AnalyzerStatusReporter } from "./analyzer_status_reporter";
import { config } from "./config";
import { DartCompletionItemProvider } from "./dart_completion_item_provider";
import { DartDefinitionProvider } from "./dart_definition_provider";
import { DartDiagnosticProvider } from "./dart_diagnostic_provider";
import { DartFormattingEditProvider } from "./dart_formatting_edit_provider";
import { DartHoverProvider } from "./dart_hover_provider";
import { DartIndentFixer } from "./dart_indent_fixer";
import { DartWorkspaceSymbolProvider } from "./dart_workspace_symbol_provider";
import { FileChangeHandler } from "./file_change_handler";
import { ServerStatusNotification } from "./analysis_server_types";

const DART_MODE: vscode.DocumentFilter = { language: "dart", scheme: "file" };
const stateLastKnownSdkPathName = "dart.lastKnownSdkPath";

let dartSdkRoot: string;
let analyzer: Analyzer;

let showTodos: boolean = config.showTodos;

export function activate(context: vscode.ExtensionContext) {
	console.log("Dart Code activated!");
	analytics.logActivation();

	dartSdkRoot = util.findDartSdk(<string>context.globalState.get(stateLastKnownSdkPathName));
	if (dartSdkRoot == null) {
		vscode.window.showErrorMessage("Could not find a Dart SDK to use. " +
			"Please install one (www.dartlang.org) add configure the 'dart.sdkPath' setting.");
		return; // Don't set anything else up; we can't work like this!
	}
	context.globalState.update(stateLastKnownSdkPathName, dartSdkRoot);

	// Show the SDK version in the status bar.
	let sdkVersion = util.getDartSdkVersion(dartSdkRoot);
	if (sdkVersion) {
		let versionStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, Number.MIN_VALUE);
		versionStatusItem.text = sdkVersion;
		versionStatusItem.tooltip = "Dart SDK Version";
		versionStatusItem.show();
		context.subscriptions.push(versionStatusItem);
	}

	analyzer = new Analyzer(path.join(dartSdkRoot, util.dartVMPath), path.join(dartSdkRoot, util.analyzerPath));

	// TODO: Check if EventEmitter<T> would be more appropriate than our own.

	// Set up providers.
	context.subscriptions.push(vscode.languages.registerHoverProvider(DART_MODE, new DartHoverProvider(analyzer)));
	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(DART_MODE, new DartFormattingEditProvider(analyzer)));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider(DART_MODE, new DartCompletionItemProvider(analyzer), "."));
	context.subscriptions.push(vscode.languages.registerDefinitionProvider(DART_MODE, new DartDefinitionProvider(analyzer)));
	context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new DartWorkspaceSymbolProvider(analyzer)));
	context.subscriptions.push(new AnalyzerStatusReporter(analyzer));

	// Set up diagnostics.
	let diagnostics = vscode.languages.createDiagnosticCollection("dart");
	context.subscriptions.push(diagnostics);
	let diagnosticsProvider = new DartDiagnosticProvider(analyzer, diagnostics);

	// Set the root...
	if (vscode.workspace.rootPath) {
		analyzer.analysisSetAnalysisRoots({
			included: [vscode.workspace.rootPath],
			excluded: [],
			packageRoots: null
		});
	}

	// Hook editor changes to send updated contents to analyzer.
	let fileChangeHandler = new FileChangeHandler(analyzer);
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(td => fileChangeHandler.onDidOpenTextDocument(td)));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => fileChangeHandler.onDidChangeTextDocument(e)));
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(td => fileChangeHandler.onDidCloseTextDocument(td)));
	vscode.workspace.textDocuments.forEach(td => fileChangeHandler.onDidOpenTextDocument(td)); // Handle already-open files.

	// Hook active editor change to reset Dart indenting.
	let dartIndentFixer = new DartIndentFixer();
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(td => dartIndentFixer.onDidChangeActiveTextEditor(td)));
	dartIndentFixer.onDidChangeActiveTextEditor(vscode.window.activeTextEditor); // Handle already-open file.

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(handleConfigurationChange));
}

function handleConfigurationChange() {
	let newShowTodoSetting = config.showTodos;
	let todoSettingChanged = showTodos != newShowTodoSetting;
	showTodos = newShowTodoSetting;

	if (todoSettingChanged) {
		analytics.logShowTodosToggled(showTodos);
		analyzer.analysisReanalyze({
			roots: [vscode.workspace.rootPath] 
		});
	}
}

export function deactivate() {
	analyzer.stop();

	console.log("Dart Code deactivated!");
}
