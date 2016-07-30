"use strict";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

const configName = "dart";
const configSdkPath = "sdkPath";

let dartSdkRoot: string;

export function activate(context: vscode.ExtensionContext) {
    console.log("Dart-Code activated!");

    dartSdkRoot = findDartSdk();
    if (dartSdkRoot != null) {
        vscode.window.showErrorMessage("Dart-Code: Could not find a Dart SDK to use. Please add it to your PATH or set it in the extensions settings and reload");
        return; // Don't set anything else up; we can't work like this!
    }
}

export function deactivate() {
    console.log("Dart-Code deactivated!");
}

function findDartSdk(): string {
    let config = vscode.workspace.getConfiguration(configName);
    let paths = (<string>process.env.PATH).split(";");

    // We don't expect the user to add .\bin in config, but it would be in the PATHs
    if (config.has(configSdkPath))
        paths.unshift(path.join(config.get<string>(configSdkPath), 'bin'));

    let sdkPath = paths.find(isValidDartSdk);
    if (sdkPath)
        return path.join(sdkPath, ".."); // Take .\bin back off.

    return null;
}

function isValidDartSdk(pathToTest: string): boolean {
    // To check for a Dart SDK, we check for .\dart or .\dart.exe
    let dartLinux = path.join(pathToTest, "dart");
    let dartWindows = path.join(pathToTest, "dart.exe");

    // Apparently this is the "correct" way to check files exist synchronously in Node :'(
    try {
        fs.accessSync(dartLinux, fs.X_OK);
        return true; // If no error, we found a match!
    }
    catch (e) { }
    try {
        fs.accessSync(dartWindows, fs.X_OK);
        return true; // If no error, we found a match!
    }
    catch (e) { }

    return false; // Neither one worked, so this must be an invalid path.
}