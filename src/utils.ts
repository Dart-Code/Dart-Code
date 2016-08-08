"use strict";

import * as path from "path";
import * as fs from "fs";
import * as as from "./analysis_server_types";
import { workspace, Position, Range, TextDocument } from "vscode";
import { config } from "./config";

export const dartVMPath = "bin/dart";
export const analyzerPath = "bin/snapshots/analysis_server.dart.snapshot";

var isWin = /^win/.test(process.platform);
let dartExecutableName = isWin ? "dart.exe" : "dart";

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
		return fs.readFileSync(path.join(sdkRoot, "version"), "utf8");
	}
	catch (e) {
		return null;
	}
}

export function isAnalyzable(document: TextDocument): boolean {
	if (document.isUntitled || !document.fileName)
		return false;

	const analyzableLanguages = ["dart", "html"];
	const analyzableFilenames = [".analysis_options", "analysis_options.yaml"];

	return analyzableLanguages.indexOf(document.languageId) >= 0
		|| analyzableFilenames.indexOf(path.basename(document.fileName)) >= 0;
}
