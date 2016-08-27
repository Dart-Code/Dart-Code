"use strict";

import * as path from "path";
import * as fs from "fs";
import * as as from "./analysis/analysis_server_types";
import { env, workspace, window, Position, Range, TextDocument } from "vscode";
import { config } from "./config";

export const latestReleasedSdk = "1.18.1";
export const dartVMPath = "bin/dart";
export const analyzerPath = "bin/snapshots/analysis_server.dart.snapshot";
export const extensionVersion = getExtensionVersion();
export const isDevelopment = checkIsDevelopment();
const isWin = /^win/.test(process.platform);
const dartExecutableName = isWin ? "dart.exe" : "dart";

export function findDartSdk(lastKnownPath: string): string {
	let paths = (<string>process.env.PATH).split(path.delimiter);

	// If we have a last-known path then push that onto the front of the list to search first.
	if (lastKnownPath)
		paths.unshift(path.join(lastKnownPath, "bin"));

	// We don't expect the user to add .\bin in config, but it would be in the PATHs
	let userDefinedSdkPath = config.userDefinedSdkPath;
	if (userDefinedSdkPath)
		paths.unshift(path.join(userDefinedSdkPath, "bin"));

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

export interface Location {
	startLine: number;
	startColumn: number;
	length: number;
}

export function toPosition(location: Location): Position {
	return new Position(location.startLine - 1, location.startColumn - 1);
}

export function toRange(location: Location): Range {
	let startPos = toPosition(location);
	return new Range(startPos, startPos.translate(0, location.length));
}

export function getDartSdkVersion(sdkRoot: string): string {
	try {
		return fs.readFileSync(path.join(sdkRoot, "version"), "utf8").trim();
	}
	catch (e) {
		return null;
	}
}

export function isAnalyzable(document: TextDocument): boolean {
	if (document.isUntitled || !document.fileName)
		return false;

	if (!isWithinRootPath(document.fileName))
		return false;

	const analyzableLanguages = ["dart", "html"];
	const analyzableFilenames = [".analysis_options", "analysis_options.yaml"];

	return analyzableLanguages.indexOf(document.languageId) >= 0
		|| analyzableFilenames.indexOf(path.basename(document.fileName)) >= 0;
}

export function isWithinRootPath(file: string) {
	// asRelativePath returns the input if it's outside of the rootPath.
	// Edit: Doesn't actually work properly:
	//   https://github.com/Microsoft/vscode/issues/10446
	//return workspace.asRelativePath(document.fileName) != document.fileName;

	return workspace.rootPath != null && file.startsWith(workspace.rootPath + path.sep);
}

function getExtensionVersion(): string {
	let packageJson = require("../../package.json");
	return packageJson.version;
}

function checkIsDevelopment() {
	return extensionVersion.endsWith("-dev") || env.machineId == "someValue.machineId";
}

export function log(message: any): void {
	console.log(message);
}

export function logError(error: { message: string }): void {
	if (isDevelopment)
		window.showErrorMessage("DEBUG: " + error.message.toString());
	console.error(error.message);
}

export function isOutOfDate(versionToCheck: string, expectedVersion: string): boolean {
	// Versions can be in form:
	//   x.y.z-aaa+bbb
	// The +bbb is ignored for checking versions
	// All -aaa's come before the same version without
	function split(version: string): number[] {
		let parts = version.split('-');
		let numbers = parts[0].split(".").map(v => parseInt(v)); // Get x.y.z
		numbers.push(parts.length > 1 ? 0 : 1); // Push a .10 for -something or .1 for nothing so we can sort easily.
		return numbers;
	}

	let vCheck = split(versionToCheck);
	let vExpected = split(expectedVersion);

	for (let i = 0; i < vCheck.length; i++) {
		if (vExpected[i] > vCheck[i])
			return true;
		else if (vExpected[i] < vCheck[i])
			return false;
	}

	// If we got here, they're the same.
	return false;
}
