"use strict";

import * as path from "path";
import * as fs from "fs";
import { workspace } from "vscode";

export const dartVMPath = "bin/dart";
export const analyzerPath = "bin/snapshots/analysis_server.dart.snapshot";
const configExtensionName = "dart";
const configSdkPathName = "sdkPath";
const configSetIndentName = "setIndentSettings";

let config = workspace.getConfiguration(configExtensionName);
var isWin = /^win/.test(process.platform);
let dartExecutableName = isWin ? "dart.exe" : "dart";

export function findDartSdk(): string {
    let paths = (<string>process.env.PATH).split(path.delimiter);

    // We don't expect the user to add .\bin in config, but it would be in the PATHs
    let userDefinedSdkPath = <string>config.get(configSdkPathName);
    if (userDefinedSdkPath)
        paths.unshift(path.join(userDefinedSdkPath, 'bin'));

    // Find which path has a Dart executable in it.
    let dartPath = paths.find(hasDartExecutable);
    if (!dartPath)
        return null;

    // To allow for symlinks, resolve the Dart executable to its real path.
    let realDartPath = fs.realpathSync(path.join(dartPath, dartExecutableName));

    // Return just the folder portion without the bin folder.
    return path.join(path.dirname(realDartPath), "..");
}

function hasDartExecutable(pathToTest: string): boolean {
    // Apparently this is the "correct" way to check files exist synchronously in Node :'(
    try {
        fs.accessSync(path.join(pathToTest, dartExecutableName), fs.X_OK);
        return true; // If no error, we found a match!
    }
    catch (e) { }

    return false; // Didn't find it, so must be an invalid path.
}
