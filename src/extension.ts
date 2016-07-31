"use strict";

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Analyzer } from "./analyzer";
import { DartHoverProvider } from "./dart_hover_provider";
import { DartDiagnosticProvider } from "./dart_diagnostic_provider";
import { DartWorkspaceSymbolProvider } from "./dart_workspace_symbol_provider";

const configExtensionName = "dart";
const configSdkPathName = "sdkPath";
const dartVMPath = "bin/dart.exe";
const analyzerPath = "bin/snapshots/analysis_server.dart.snapshot";

const DART_MODE: vscode.DocumentFilter = { language: 'dart', scheme: 'file' };

let dartSdkRoot: string;
let analyzer: Analyzer;

export function activate(context: vscode.ExtensionContext) {
    console.log("Dart-Code activated!");

    dartSdkRoot = findDartSdk();
    if (dartSdkRoot == null) {
        vscode.window.showErrorMessage("Dart-Code: Could not find a Dart SDK to use. Please add it to your PATH or set it in the extensions settings and reload");
        return; // Don't set anything else up; we can't work like this!
    }

    analyzer = new Analyzer(path.join(dartSdkRoot, dartVMPath), path.join(dartSdkRoot, analyzerPath));

    analyzer.registerForServerConnected(e => {
        let message = `Connected to Dart analysis server version ${e.version}`;

        console.log(message);
        let disposable = vscode.window.setStatusBarMessage(message);

        setTimeout(() => disposable.dispose(), 3000);
    });

    // Set up providers.
    context.subscriptions.push(vscode.languages.registerHoverProvider(DART_MODE, new DartHoverProvider(analyzer)));
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
}

export function deactivate() {
    analyzer.stop();

    console.log("Dart-Code deactivated!");
}

function findDartSdk(): string {
    let config = vscode.workspace.getConfiguration(configExtensionName);
    let paths = (<string>process.env.PATH).split(";");

    // We don't expect the user to add .\bin in config, but it would be in the PATHs
    if (config.has(configSdkPathName))
        paths.unshift(path.join(config.get<string>(configSdkPathName), 'bin'));

    let sdkPath = paths.find(isValidDartSdk);
    if (sdkPath)
        return path.join(sdkPath, ".."); // Take .\bin back off.

    return null;
}

function isValidDartSdk(pathToTest: string): boolean {
    // Apparently this is the "correct" way to check files exist synchronously in Node :'(
    try {
        fs.accessSync(path.join(pathToTest, "..", analyzerPath), fs.R_OK);
        return true; // If no error, we found a match!
    }
    catch (e) { }

    return false; // Didn't find it, so must be an invalid path.
}
