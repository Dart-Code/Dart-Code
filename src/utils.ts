import * as fs from "fs";
import * as glob from "glob";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import { commands, extensions, Position, Range, TextDocument, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { config } from "./config";
import { flutterExtensionIdentifier, forceWindowsDriveLetterToUppercase } from "./debug/utils";
import { referencesFlutterSdk } from "./sdk/utils";
import { getExtensionLogPath, logError } from "./utils/log";

export const extensionVersion = getExtensionVersion();
export const vsCodeVersionConstraint = getVsCodeVersionConstraint();
export const isDevExtension = checkIsDevExtension();
export const hasFlutterExtension = checkHasFlutterExtension();
export const FLUTTER_CREATE_PROJECT_TRIGGER_FILE = "dart_code_flutter_create.dart";
export const showLogAction = "Show Log";

export function fsPath(uri: Uri | string) {
	if (!config.normalizeWindowsDriveLetters)
		return uri instanceof Uri ? uri.fsPath : uri; // tslint:disable-line:disallow-fspath

	// tslint:disable-next-line:disallow-fspath
	return forceWindowsDriveLetterToUppercase(uri instanceof Uri ? uri.fsPath : uri);
}

export function isFlutterWorkspaceFolder(folder?: WorkspaceFolder): boolean {
	return !!(folder && isDartWorkspaceFolder(folder) && isFlutterProjectFolder(fsPath(folder.uri)));
}

export function isFlutterProjectFolder(folder?: string): boolean {
	return referencesFlutterSdk(folder);
}

export function getDartWorkspaceFolders(): WorkspaceFolder[] {
	if (!workspace.workspaceFolders)
		return [];
	return workspace.workspaceFolders.filter(isDartWorkspaceFolder);
}

export function isDartWorkspaceFolder(folder?: WorkspaceFolder): boolean {
	if (!folder || folder.uri.scheme !== "file")
		return false;

	// Currently we don't have good logic to know what's a Dart folder.
	// We could require a pubspec, but it's valid to just write scripts without them.
	// For now, nothing calls this that will do bad things if the folder isn't a Dart
	// project so we can review amend this in future if required.
	return true;
}

export function resolvePaths(p?: string) {
	if (!p) return undefined;
	if (p.startsWith("~/"))
		return path.join(os.homedir(), p.substr(2));
	if (!path.isAbsolute(p) && workspace.workspaceFolders && workspace.workspaceFolders.length)
		return path.join(fsPath(workspace.workspaceFolders[0].uri), p);
	return p;
}

export function mkDirRecursive(folder: string) {
	const parent = path.dirname(folder);
	if (!fs.existsSync(parent))
		mkDirRecursive(parent);
	if (!fs.existsSync(folder))
		fs.mkdirSync(folder);
}

export function createFolderForFile(file?: string) {
	if (!file || !path.isAbsolute(file))
		return;

	const folder = path.dirname(file);
	if (!fs.existsSync(folder))
		mkDirRecursive(folder);
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

export function getSdkVersion(sdkRoot?: string): string | undefined {
	if (!sdkRoot)
		return undefined;
	const versionFile = path.join(sdkRoot, "version");
	if (!fs.existsSync(versionFile))
		return undefined;
	try {
		return fs
			.readFileSync(versionFile, "utf8")
			.trim()
			.split("\n")
			.filter((l) => l)
			.filter((l) => l.trim().substr(0, 1) !== "#")
			.join("\n")
			.trim();
	} catch (e) {
		logError(e);
		return undefined;
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
	// If we're either in a top-level test folder or the file ends with _test.dart then
	// assume it's a test. We used to check for /test/ at any level, but sometimes people have
	// non-test files named test (https://github.com/Dart-Code/Dart-Code/issues/1165).
	return isInsideFolderNamed(file, "test") || (file && file.toLowerCase().endsWith("_test.dart"));
}

export function supportsPubRunTest(folder: string, file: string): boolean {
	return fs.existsSync(path.join(folder, ".packages"))
		&& fs.existsSync(path.join(folder, "pubspec.yaml"));
}

export function isInsideFolderNamed(file: string, folderName: string): boolean {
	if (!file)
		return false;

	if (!file.toLowerCase().endsWith(".dart"))
		return false;

	const ws = workspace.getWorkspaceFolder(Uri.file(file));

	if (!ws)
		return false;

	const relPath = path.relative(fsPath(ws.uri), file).toLowerCase();

	return relPath.startsWith(`${folderName}${path.sep}`);
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

function checkHasFlutterExtension() {
	return extensions.getExtension(flutterExtensionIdentifier) !== undefined;
}

export function isStableSdk(sdkVersion?: string): boolean {
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
			if (!resp || !resp.statusCode || resp.statusCode < 200 || resp.statusCode > 300) {
				reject({ message: `Failed to get Dart SDK Version ${resp && resp.statusCode}: ${resp && resp.statusMessage}` });
			} else {
				resp.on("data", (d) => {
					resolve(JSON.parse(d.toString()).version);
				});
			}
		});
		req.end();
	});
}

// Escapes a set of command line arguments so that the escaped string is suitable for passing as an argument
// to another shell command.
// Implementation is taken from https://github.com/xxorax/node-shell-escape
export function escapeShell(args: string[]) {
	const ret: string[] = [];
	args.forEach((arg) => {
		if (/[^A-Za-z0-9_\/:=-]/.test(arg)) {
			arg = "'" + arg.replace(/'/g, "'\\''") + "'";
			arg = arg.replace(/^(?:'')+/g, "") // unduplicate single-quote at the beginning
				.replace(/\\'''/g, "\\'"); // remove non-escaped single-quote if there are enclosed between 2 escaped
		}
		ret.push(arg);
	});
	return ret.join(" ");
}

export function openInBrowser(url: string) {
	commands.executeCommand("vscode.open", Uri.parse(url));
}

export class Sdks {
	public dart?: string;
	public flutter?: string;
	public fuchsia?: string;
	public projectType = ProjectType.Dart;
	public dartSdkIsFromFlutter: boolean;
}

export enum ProjectType {
	Dart,
	Flutter,
	Fuchsia,
}

export async function reloadExtension(prompt?: string, buttonText?: string, offerLogFile = false) {
	const restartAction = buttonText || "Restart";
	const actions = offerLogFile ? [restartAction, showLogAction] : [restartAction];
	const chosenAction = prompt && await window.showInformationMessage(prompt, ...actions);
	if (chosenAction === showLogAction) {
		openExtensionLogFile();
	} else if (!prompt || chosenAction === restartAction) {
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

export function getRandomInt(min: number, max: number) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min)) + min;
}

export function openExtensionLogFile() {
	workspace.openTextDocument(getExtensionLogPath()).then(window.showTextDocument);
}
