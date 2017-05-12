"use strict";

import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import * as as from "./analysis/analysis_server_types";
import { env, workspace, window, Position, Range, TextDocument, commands, Uri } from "vscode";
import { config } from "./config";

const isWin = /^win/.test(process.platform);
const dartExecutableName = isWin ? "dart.exe" : "dart";
const pubExecutableName = isWin ? "pub.bat" : "pub";
const flutterExecutableName = isWin ? "flutter.bat" : "flutter";
export const dartVMPath = "bin/" + dartExecutableName;
export const dartPubPath = "bin/" + pubExecutableName;
export const analyzerPath = "bin/snapshots/analysis_server.dart.snapshot";
export const flutterPath = "bin/" + flutterExecutableName;
export const extensionVersion = getExtensionVersion();
export const isDevelopment = checkIsDevelopment();

export function isFlutterProject(): boolean {
	if (workspace.rootPath)  // If VS Code has a project open
		if (fs.existsSync(path.join(workspace.rootPath, "pubspec.yaml"))){
			let regex = new RegExp('sdk:\\sflutter', 'i');
			return regex.test(fs.readFileSync((path.join(workspace.rootPath, "pubspec.yaml"))).toString());
		}
	return false;
}

export function findDartSdk(): string {
	// Flutter detection clause
	if (isFlutterProject() && findFlutterHome()){
		let flutterDartSdk = path.join(findFlutterHome(), "bin/cache/dart-sdk/bin");
		if (fs.existsSync(path.join(flutterDartSdk, dartExecutableName))){
			let realDartPath = fs.realpathSync(path.join(flutterDartSdk, dartExecutableName));
			return path.join(path.dirname(realDartPath), "..");
		}
	}

	let paths = (<string>process.env.PATH).split(path.delimiter);

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
		fs.accessSync(path.join(pathToTest, dartExecutableName), fs.constants.X_OK);
		return true; // If no error, we found a match!
	}
	catch (e) { }

	return false; // Didn't find it, so must be an invalid path.
}

export function findFlutterHome(): string {
	let paths = (<string>process.env.PATH).split(path.delimiter);

	let flutterHome = paths.find(hasFlutterExecutable);
	if (!flutterHome)
		return null;
	
	let realFlutterHome = fs.realpathSync(path.join(flutterHome, flutterExecutableName));

	return path.join(path.dirname(realFlutterHome), "..");
}

function hasFlutterExecutable(pathToTest: string): boolean{
	try {
		fs.accessSync(path.join(pathToTest, flutterExecutableName), fs.constants.X_OK);
		return true;
	}
	catch (e) { }

	return false;
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
		window.showErrorMessage("DEBUG: " + error.message);
	console.error(error.message);
}

export function getLatestSdkVersion(): PromiseLike<string> {
	return new Promise<string>((resolve, reject) => {
		const options: https.RequestOptions = {
			hostname: "storage.googleapis.com",
			port: 443,
			path: "/dart-archive/channels/stable/release/latest/VERSION",
			method: "GET",
		};

		let req = https.request(options, resp => {
			if (resp.statusCode < 200 || resp.statusCode > 300) {
				reject({ message: `Failed to get Dart SDK Version ${resp.statusCode}: ${resp.statusMessage}` });
			} else {
				resp.on('data', (d) => {
					resolve(JSON.parse(d.toString()).version);
				});
			}
		});
		req.end();
	});
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

export function openInBrowser(url: string) {
	commands.executeCommand("vscode.open", Uri.parse(url));
}
