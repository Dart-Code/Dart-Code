"use strict";

import * as vscode from "vscode";
import * as path from "path";
import * as util from "./utils";
import { Analyzer } from "./analyzer";
import { DartFormattingEditProvider } from "./dart_formatting_edit_provider";
import { DartHoverProvider } from "./dart_hover_provider";
import { DartCompletionItemProvider } from "./dart_completion_item_provider";
import { DartDiagnosticProvider } from "./dart_diagnostic_provider";
import { DartWorkspaceSymbolProvider } from "./dart_workspace_symbol_provider";
import { FileChangeHandler } from "./file_change_handler";
import { DartIndentFixer } from "./dart_indent_fixer";

const DART_MODE: vscode.DocumentFilter = { language: "dart", scheme: "file" };
const stateLastKnownSdkPathName = "dart.lastKnownSdkPath";

let dartSdkRoot: string;
let analyzer: Analyzer;

export function activate(context: vscode.ExtensionContext) {
    console.log("Dart Code activated!");

    dartSdkRoot = util.findDartSdk(<string>context.globalState.get(stateLastKnownSdkPathName));
    if (dartSdkRoot == null) {
        vscode.window.showErrorMessage("Dart Code: Could not find a Dart SDK to use. Please add it to your PATH or set it in the extensions settings and reload");
        return; // Don't set anything else up; we can't work like this!
    }
    context.globalState.update(stateLastKnownSdkPathName, dartSdkRoot);

    analyzer = new Analyzer(path.join(dartSdkRoot, util.dartVMPath), path.join(dartSdkRoot, util.analyzerPath));
    // TODO: Check if EventEmitter<T> would be more appropriate than our own.
    analyzer.registerForServerConnected(e => {
        let disposable = vscode.window.setStatusBarMessage(`Connected to Dart analysis server version ${e.version}`);
        setTimeout(() => disposable.dispose(), 3000);
    });

    // Set up providers.
    context.subscriptions.push(vscode.languages.registerHoverProvider(DART_MODE, new DartHoverProvider(analyzer)));
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(DART_MODE, new DartFormattingEditProvider(analyzer)));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(DART_MODE, new DartCompletionItemProvider(analyzer), "."));
    context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new DartWorkspaceSymbolProvider(analyzer)));

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
}

export function deactivate() {
    analyzer.stop();

    console.log("Dart Code deactivated!");
}
