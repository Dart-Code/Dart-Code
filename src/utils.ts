import * as fs from "fs";
import * as glob from "glob";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import { Position, Range, TextDocument, Uri, WorkspaceFolder, commands, window, workspace } from "vscode";
import { config } from "./config";
import { forceWindowsDriveLetterToUppercase } from "./debug/utils";
import { referencesFlutterSdk } from "./sdk/utils";

export const extensionVersion = getExtensionVersion();
export const vsCodeVersionConstraint = getVsCodeVersionConstraint();
export const isDevExtension = checkIsDevExtension();
export const FLUTTER_CREATE_PROJECT_TRIGGER_FILE = "dart_code_flutter_create.dart";

export function fsPath(uri: Uri) {
	if (!config.normalizeWindowsDriveLetters)
		return uri.fsPath; // tslint:disable-line:disallow-fspath

	// tslint:disable-next-line:disallow-fspath
	return forceWindowsDriveLetterToUppercase(uri.fsPath);
}

export function isFlutterWorkspaceFolder(folder: WorkspaceFolder): boolean {
	return isDartWorkspaceFolder(folder) && isFlutterProjectFolder(fsPath(folder.uri));
}

export function isFlutterProjectFolder(folder: string): boolean {
	return referencesFlutterSdk(folder);
}

export function getDartWorkspaceFolders(): WorkspaceFolder[] {
	if (!workspace.workspaceFolders)
		return [];
	return workspace.workspaceFolders.filter(isDartWorkspaceFolder);
}

export function isDartWorkspaceFolder(folder: WorkspaceFolder): boolean {
	if (!folder || folder.uri.scheme !== "file")
		return false;

	// Currently we don't have good logic to know what's a Dart folder.
	// We could require a pubspec, but it's valid to just write scripts without them.
	// For now, nothing calls this that will do bad things if the folder isn't a Dart
	// project so we can review amend this in future if required.
	return true;
}

export function resolvePaths(p: string) {
	if (!p) return null;
	if (p.startsWith("~/"))
		return path.join(os.homedir(), p.substr(2));
	if (!path.isAbsolute(p) && workspace.workspaceFolders && workspace.workspaceFolders.length)
		return path.join(fsPath(workspace.workspaceFolders[0].uri), p);
	return p;
}

export function createFolderIfRequired(file: string) {
	if (!file || !path.isAbsolute(file))
		return;

	const folder = path.dirname(file);
	function mkDirAndParents(folder: string) {
		const parent = path.dirname(folder);
		if (!fs.existsSync(parent))
			mkDirAndParents(parent);
		if (!fs.existsSync(folder))
			fs.mkdirSync(folder);
	}
	if (!fs.existsSync(folder))
		mkDirAndParents(folder);
	return file;
}

export interface Location {
	startLine: number;
	startColumn: number;
	length: number;
}

export function toRange(document: TextDocument, offset: number, length: number): Range {
	return new Range(document.positionAt(offset), document.positionAt(offset + length));
}

export function toPosition(location: Location): Position {
	return new Position(location.startLine - 1, location.startColumn - 1);
}

// Translates an offset/length to a Range.
// NOTE: Does not wrap lines because it does not have access to a TextDocument to know
// where the line ends.
export function toRangeOnLine(location: Location): Range {
	const startPos = toPosition(location);
	return new Range(startPos, startPos.translate(0, location.length));
}

export function getSdkVersion(sdkRoot: string): string {
	if (!sdkRoot)
		return null;
	try {
		return fs
			.readFileSync(path.join(sdkRoot, "version"), "utf8")
			.trim()
			.split("\n")
			.filter((l) => l)
			.filter((l) => l.trim().substr(0, 1) !== "#")
			.join("\n")
			.trim();
	} catch (e) {
		return null;
	}
}

export function shouldTriggerHotReload(document: TextDocument): boolean {
	if (!isAnalyzableAndInWorkspace(document))
		return false;

	return path.extname(fsPath(document.uri)) === ".dart";
}

export function isAnalyzable(document: TextDocument): boolean {
	if (document.isUntitled || !fsPath(document.uri) || document.uri.scheme !== "file")
		return false;

	const analyzableLanguages = ["dart", "html"];
	const analyzableFilenames = [".analysis_options", "analysis_options.yaml"];

	return analyzableLanguages.indexOf(document.languageId) >= 0
		|| analyzableFilenames.indexOf(path.basename(fsPath(document.uri))) >= 0;
}

export function isAnalyzableAndInWorkspace(document: TextDocument): boolean {
	return isAnalyzable(document) && isWithinWorkspace(fsPath(document.uri));
}

export function isWithinWorkspace(file: string) {
	return !!workspace.getWorkspaceFolder(Uri.file(file));
}

export function isTestFile(file: string): boolean {
	return isInsideFolderNamed(file, "test");
}

export function supportsPubRunTest(folder: string, file: string): boolean {
	return true;
}

export function isInsideFolderNamed(file: string, folderName: string): boolean {
	if (!file)
		return false;

	if (!file.toLowerCase().endsWith(".dart"))
		return false;

	const ws = workspace.getWorkspaceFolder(Uri.file(file));

	if (!ws)
		return false;

	const relPath = path.sep + path.relative(fsPath(ws.uri), file);

	// We only want to check the relative path from the workspace root so that if the whole project is inside a
	// test (etc.) folder (for ex. Dart Code's own tests) we don't falsely assume it's an end user test.
	return relPath.toLowerCase().indexOf(`${path.sep}${folderName}${path.sep}`) !== -1;
}

function getExtensionVersion(): string {
	const packageJson = require("../../package.json");
	return packageJson.version;
}

function getVsCodeVersionConstraint(): string {
	const packageJson = require("../../package.json");
	return packageJson.engines.vscode;
}

export function versionIsAtLeast(inputVersion: string, requiredVersion: string): boolean {
	return semver.gte(inputVersion, requiredVersion);
}

function checkIsDevExtension() {
	return extensionVersion.endsWith("-dev");
}

export function isStableSdk(sdkVersion: string): boolean {
	// We'll consider empty versions as dev; stable versions will likely always
	// be shipped with valid version files.
	return !!(sdkVersion && !semver.prerelease(sdkVersion));
}

export function getLatestSdkVersion(): PromiseLike<string> {
	return new Promise<string>((resolve, reject) => {
		const options: https.RequestOptions = {
			hostname: "storage.googleapis.com",
			method: "GET",
			path: "/dart-archive/channels/stable/release/latest/VERSION",
			port: 443,
		};

		const req = https.request(options, (resp) => {
			if (resp.statusCode < 200 || resp.statusCode > 300) {
				reject({ message: `Failed to get Dart SDK Version ${resp.statusCode}: ${resp.statusMessage}` });
			} else {
				resp.on("data", (d) => {
					resolve(JSON.parse(d.toString()).version);
				});
			}
		});
		req.end();
	});
}

export function escapeRegExp(input: string) {
	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

export function openInBrowser(url: string) {
	commands.executeCommand("vscode.open", Uri.parse(url));
}

export class Sdks {
	public dart: string;
	public flutter: string;
	public fuchsia: string;
	public projectType: ProjectType;
}

export enum ProjectType {
	Dart,
	Flutter,
	Fuchsia,
}

export async function reloadExtension(prompt?: string, buttonText?: string) {
	const restartAction = buttonText || "Restart";
	if (!prompt || await window.showInformationMessage(prompt, restartAction) === restartAction) {
		commands.executeCommand("_dart.reloadExtension");
	}
}

export function unique<T>(items: T[]): T[] {
	return Array.from(new Set(items));
}

const shouldLogTimings = false;
const start = process.hrtime();
let last = start;
function pad(str: string, length: number) {
	while (str.length < length)
		str = "0" + str;
	return str;
}
export const logTime = (taskFinished?: string) => {
	if (!shouldLogTimings)
		return;
	const diff = process.hrtime(start);
	console.log(`${pad((diff[0] - last[0]).toString(), 5)}.${pad((diff[1] - last[1]).toString(), 10)} ${taskFinished ? "<== " + taskFinished : ""}`);
	last = diff;
};

// Takes a path and resolves it to the real casing as it exists on the file
// system. Copied from https://stackoverflow.com/a/33139702.
export function trueCasePathSync(fsPath: string): string {
	// Normalize the path so as to resolve . and .. components.
	// !! As of Node v4.1.1, a path starting with ../ is NOT resolved relative
	// !! to the current dir, and glob.sync() below then fails.
	// !! When in doubt, resolve with fs.realPathSync() *beforehand*.
	let fsPathNormalized = path.normalize(fsPath);

	// OSX: HFS+ stores filenames in NFD (decomposed normal form) Unicode format,
	// so we must ensure that the input path is in that format first.
	if (process.platform === "darwin")
		fsPathNormalized = fsPathNormalized.normalize("NFD");

	// !! Windows: Curiously, the drive component mustn't be part of a glob,
	// !! otherwise glob.sync() will invariably match nothing.
	// !! Thus, we remove the drive component and instead pass it in as the 'cwd'
	// !! (working dir.) property below.
	const pathRoot = path.parse(fsPathNormalized).root;
	const noDrivePath = fsPathNormalized.slice(Math.max(pathRoot.length - 1, 0));

	// Perform case-insensitive globbing (on Windows, relative to the drive /
	// network share) and return the 1st match, if any.
	// Fortunately, glob() with nocase case-corrects the input even if it is
	// a *literal* path.
	return glob.sync(noDrivePath, { nocase: true, cwd: pathRoot })[0];
}
