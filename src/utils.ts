"use strict";

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as https from "https";
import * as as from "./analysis/analysis_server_types";
import { env, workspace, window, Position, Range, TextDocument, commands, Uri, WorkspaceFolder } from "vscode";
import { config } from "./config";
import { PackageMap } from "./debug/utils";
import * as semver from "semver";

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

export function referencesFlutterSdk(folder: string): boolean {
	if (folder && fs.existsSync(path.join(folder, "pubspec.yaml"))) {
		const regex = new RegExp('sdk\\s*:\\s*flutter', 'i');
		return regex.test(fs.readFileSync(path.join(folder, "pubspec.yaml")).toString());
	}
	return false;
}

export function searchPaths(searchPaths: string[], filter: (s: string) => boolean, executableName: string): string {
	let sdkPath =
		searchPaths
			.filter(p => p)
			.map(resolveHomePath)
			.map(p => path.basename(p) != "bin" ? path.join(p, "bin") : p) // Ensure /bin on end.
			.find(filter);

	sdkPath = sdkPath && fs.realpathSync(sdkPath);
	sdkPath = sdkPath && path.join(sdkPath, ".."); // Take /bin back off

	return sdkPath;
}

export function findSdks(): Sdks {
	const folders = getDartWorkspaceFolders()
		.map(w => w.uri.fsPath);
	const paths = (<string>process.env.PATH).split(path.delimiter);
	const platformName = isWin ? "win" : process.platform == "darwin" ? "mac" : "linux";

	let fuchsiaRoot: string, flutterProject: string;
	folders.forEach(folder => {
		fuchsiaRoot = fuchsiaRoot || findFuchsiaRoot(folder);
		flutterProject = flutterProject || (referencesFlutterSdk(folder) ? folder : null);
	});

	const flutterSdkSearchPaths = [
		config.flutterSdkPath,
		fuchsiaRoot && path.join(fuchsiaRoot, "lib/flutter"),
		fuchsiaRoot && path.join(fuchsiaRoot, "third_party/dart-pkg/git/flutter"),
		flutterProject,
		flutterProject && extractFlutterSdkPathFromPackagesFile(path.join(flutterProject, ".packages")),
		process.env.FLUTTER_ROOT
	].concat(paths);

	let flutterSdkPath = (fuchsiaRoot || flutterProject) &&
		searchPaths(flutterSdkSearchPaths, hasFlutterExecutable, flutterExecutableName);

	const dartSdkSearchPaths = [
		config.userDefinedSdkPath,
		fuchsiaRoot && path.join(fuchsiaRoot, "third_party/dart/tools/sdks", platformName, "dart-sdk"),
		fuchsiaRoot && path.join(fuchsiaRoot, "dart/tools/sdks", platformName, "dart-sdk"),
		flutterSdkPath && path.join(flutterSdkPath, "bin/cache/dart-sdk")
	].concat(paths);

	let dartSdkPath =
		searchPaths(dartSdkSearchPaths, hasDartExecutable, dartExecutableName);

	return {
		dart: dartSdkPath,
		flutter: (fuchsiaRoot || flutterProject) && flutterSdkPath,
		fuchsia: fuchsiaRoot,
		projectType: fuchsiaRoot ? ProjectType.Fuchsia : flutterProject ? ProjectType.Flutter : ProjectType.Dart
	}
}

function extractFlutterSdkPathFromPackagesFile(file: string): string {
	if (!fs.existsSync(file))
		return null;

	let path = new PackageMap(file).getPackagePath("flutter");

	if (!path)
		return null;

	// Trim suffix we don't need.
	const pathSuffix = "/packages/flutter/lib/";
	if (path.endsWith(pathSuffix)) {
		path = path.substr(0, path.length - pathSuffix.length)
	}

	// Make sure ends with a slash.
	if (!path.endsWith('/'))
		path = path + '/';

	// Append bin if required.
	if (!path.endsWith('/bin/')) {
		path = path + 'bin/';
	}

	// Windows fixup.		
	if (isWin) {
		path = path.replace(/\//g, '\\');
		if (path[0] == '\\')
			path = path.substring(1);
	}

	return path;
}

function findFuchsiaRoot(folder: string): string {
	if (folder) {
		// Walk up the directories from the workspace root, and see if there
		// exists a directory which has ".jiri_root" directory as a child.
		// If such directory is found, that is our fuchsia root.
		let dir = folder;
		while (dir != null) {
			try {
				if (fs.statSync(path.join(dir, ".jiri_root")).isDirectory()) {
					return dir;
				}
			}
			catch (e) { }

			const parentDir = path.dirname(dir);
			if (dir == parentDir)
				break;

			dir = parentDir;
		}
	}

	return null;
}

export function getDartWorkspaceFolders(): WorkspaceFolder[] {
	return workspace.workspaceFolders.filter(isDartWorkspaceFolder);
}

export function isDartWorkspaceFolder(folder: WorkspaceFolder): boolean {
	if (!folder || folder.uri.scheme != "file")
		return false;

	// TODO: Filter to only Dart projects.
	return true;
}

export const hasDartExecutable = (pathToTest: string) => hasExecutable(pathToTest, dartExecutableName);
const hasFlutterExecutable = (pathToTest: string) => hasExecutable(pathToTest, flutterExecutableName);

function hasExecutable(pathToTest: string, executableName: string): boolean {
	return fs.existsSync(path.join(pathToTest, executableName));
}

export function resolveHomePath(p: string) {
	if (p == null) return null;
	if (p.startsWith("~/"))
		return path.join(os.homedir(), p.substr(2));
	return p;
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

	const analyzableLanguages = ["dart", "html"];
	const analyzableFilenames = [".analysis_options", "analysis_options.yaml"];

	return analyzableLanguages.indexOf(document.languageId) >= 0
		|| analyzableFilenames.indexOf(path.basename(document.fileName)) >= 0;
}

export function isAnalyzableAndInWorkspace(document: TextDocument): boolean {
	if (document.isUntitled || !document.fileName)
		return false;

	return isAnalyzable(document) && isWithinWorkspace(document.fileName);
}

export function isWithinWorkspace(file: string) {
	// TODO: Is this fixed?
	// asRelativePath returns the input if it's outside of the rootPath.
	// Edit: Doesn't actually work properly:
	//   https://github.com/Microsoft/vscode/issues/10446
	//return workspace.asRelativePath(document.fileName) != document.fileName;
	// Edit: Still doesn't work properly!
	//   https://github.com/Microsoft/vscode/issues/33709

	const w = workspace.getWorkspaceFolder(Uri.file(file));
	const relative = w && path.relative(w.uri.fsPath, file);
	return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function toReadonlyUriIfExternal(file: string) {
	return isWithinWorkspace(file)
		? Uri.file(file)
		: Uri.file(file).with({ scheme: "dart-package" });
}

function getExtensionVersion(): string {
	let packageJson = require("../../package.json");
	return packageJson.version;
}

export function versionIsAtLeast(inputVersion: string, requiredVersion: string): boolean {
	return semver.gte(inputVersion, requiredVersion);
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

export class Sdks {
	dart: string;
	flutter: string;
	fuchsia: string;
	projectType: ProjectType;
}

export enum ProjectType {
	Dart,
	Flutter,
	Fuchsia
}
