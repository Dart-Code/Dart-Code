import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { commands, Position, Range, TextDocument, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { showLogAction } from "../shared/constants";
import { Logger } from "../shared/interfaces";
import { isWithinPath } from "../shared/utils";
import { hasPackagesFile, hasPubspec, mkDirRecursive } from "../shared/utils/fs";
import { fsPath, isDartWorkspaceFolder } from "../shared/vscode/utils";
import { locateBestProjectRoot } from "./project";
import { referencesFlutterSdk, referencesFlutterWeb } from "./sdk/utils";
import { getExtensionLogPath } from "./utils/log";

export const resolvedPromise = Promise.resolve(true);

export function isFlutterWorkspaceFolder(folder?: WorkspaceFolder): boolean {
	return !!(folder && isDartWorkspaceFolder(folder) && isFlutterProjectFolder(fsPath(folder.uri)));
}

export function isFlutterWebWorkspaceFolder(folder?: WorkspaceFolder): boolean {
	return !!(folder && isDartWorkspaceFolder(folder) && isFlutterWebProjectFolder(fsPath(folder.uri)));
}

export function isInsideFlutterProject(uri?: Uri): boolean {
	if (!uri)
		return false;

	const projectRoot = locateBestProjectRoot(fsPath(uri));
	if (projectRoot)
		return isFlutterProjectFolder(projectRoot);
	else
		return isFlutterWorkspaceFolder(workspace.getWorkspaceFolder(uri));
}

export function isInsideFlutterWebProject(uri?: Uri): boolean {
	if (!uri)
		return false;

	const projectRoot = locateBestProjectRoot(fsPath(uri));
	if (projectRoot)
		return isFlutterWebProjectFolder(projectRoot);
	else
		return isFlutterWebWorkspaceFolder(workspace.getWorkspaceFolder(uri));
}

export function isFlutterProjectFolder(folder?: string): boolean {
	return referencesFlutterSdk(folder);
}

export function isFlutterWebProjectFolder(folder?: string): boolean {
	return referencesFlutterWeb(folder);
}

export function resolvePaths<T extends string | undefined>(p: T): string | (undefined extends T ? undefined : never) {
	if (typeof p !== "string")
		return undefined as (undefined extends T ? undefined : never);

	if (p.startsWith("~/"))
		return path.join(os.homedir(), p.substr(2));
	if (!path.isAbsolute(p) && workspace.workspaceFolders && workspace.workspaceFolders.length)
		return path.join(fsPath(workspace.workspaceFolders[0].uri), p);
	return p;
}

/// Shortens a path to use ~ if it's inside the home directory.
export function homeRelativePath(p?: string) {
	if (!p) return undefined;
	const homedir = os.homedir();
	if (isWithinPath(p, homedir))
		return path.join("~", path.relative(homedir, p));
	return p;
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

export function getSdkVersion(logger: Logger, sdkRoot?: string): string | undefined {
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
		logger.error(e);
		return undefined;
	}
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

export function isTestFileOrFolder(path: string): boolean {
	return !!path && (isTestFile(path) || isTestFolder(path));
}

export function isTestFile(file: string): boolean {
	// If we're either in a top-level test folder or the file ends with _test.dart then
	// assume it's a test. We used to check for /test/ at any level, but sometimes people have
	// non-test files named test (https://github.com/Dart-Code/Dart-Code/issues/1165).
	return !!file && isDartFile(file) && (isInsideFolderNamed(file, "test") || file.toLowerCase().endsWith("_test.dart"));
}

// Similate to isTestFile, but requires that the file is _test.dart because it will be used as
// an entry point for pub test running.
export function isPubRunnableTestFile(file: string): boolean {
	return !!file && isDartFile(file) && file.toLowerCase().endsWith("_test.dart");
}

export function isTestFolder(path: string): boolean {
	return !!path && isInsideFolderNamed(path, "test") && fs.existsSync(path) && fs.statSync(path).isDirectory();
}

export function checkProjectSupportsPubRunTest(folder: string): boolean {
	return hasPackagesFile(folder) && hasPubspec(folder);
}

export function isDartFile(file: string): boolean {
	return !!file && path.extname(file.toLowerCase()) === ".dart" && fs.existsSync(file) && fs.statSync(file).isFile();
}

export function isInsideFolderNamed(file: string, folderName: string): boolean {
	if (!file)
		return false;

	const ws = workspace.getWorkspaceFolder(Uri.file(file));

	if (!ws)
		return false;

	const relPath = path.relative(fsPath(ws.uri), file).toLowerCase();

	return relPath === folderName || relPath.startsWith(`${folderName}${path.sep}`);
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

export function openExtensionLogFile() {
	workspace.openTextDocument(getExtensionLogPath()).then(window.showTextDocument);
}

export function notUndefined<T>(x: T | undefined): x is T {
	return x !== undefined;
}
