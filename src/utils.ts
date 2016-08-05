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

export function findDartSdk(): string {
    let paths = (<string>process.env.PATH).split(path.delimiter);

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
